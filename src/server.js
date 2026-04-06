const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sanitizeFilename = require('sanitize-filename');
const { config } = require('./config');
const { buildEquipmentEntries } = require('./equipment');
const { extractVehicleFromPdf, findCombustionEquivalents } = require('./gemini');
const { importVehicleFromUrl } = require('./url-import');
const { enrichVehiclePrices, getEurExchangeRate } = require('./nbp');
const { enrichVehicles } = require('./recommendation');
const store = require('./store');

function ensureDirectories() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });
}

function readDeployMeta() {
  const filePath = path.join(config.rootDir, 'tmp', 'deploy-meta.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createUploadMiddleware() {
  const diskStorage = multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, config.uploadDir);
    },
    filename(_req, file, callback) {
      const cleanName = sanitizeFilename(file.originalname || 'config.pdf');
      const extension = path.extname(cleanName) || '.pdf';
      callback(null, `${Date.now()}-${randomUUID()}${extension}`);
    },
  });

  return multer({
    storage: diskStorage,
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
    },
    fileFilter(_req, file, callback) {
      const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
      callback(isPdf ? null : new Error('Dozwolone sa tylko pliki PDF.'), isPdf);
    },
  });
}

function toClientVehicle(vehicle, rateInfo = null) {
  const equipmentEntries = buildEquipmentEntries(vehicle);
  const allEquipment = [...new Map(equipmentEntries.map((entry) => [entry.slug, entry.label])).values()];
  const equipmentSlugs = [...new Set(equipmentEntries.map((entry) => entry.slug))];
  const configurationDownloadUrl =
    vehicle.sourceType === 'upload' ? `/api/uploads/${vehicle.uploadId}/file` : null;
  const configurationSourceUrl = vehicle.sourceType === 'url' ? vehicle.sourceUrl : null;

  return enrichVehiclePrices({
    ...vehicle,
    additionalEquipmentCount: Array.isArray(vehicle.additionalEquipment) ? vehicle.additionalEquipment.length : 0,
    standardEquipmentCount: Array.isArray(vehicle.standardEquipment) ? vehicle.standardEquipment.length : 0,
    equipmentPackagesCount: Array.isArray(vehicle.equipmentPackages) ? vehicle.equipmentPackages.length : 0,
    allEquipment,
    equipmentSlugs,
    configurationDownloadUrl,
    configurationSourceUrl,
  }, rateInfo);
}

function createSummary(payload, equipmentFacets, rateInfo = null) {
  return {
    topRecommendation: payload.items[0] || null,
    leaders: payload.leaders,
    totalRows: payload.items.length,
    equipmentFacets,
    exchangeRate: rateInfo
      ? {
          code: rateInfo.code,
          mid: rateInfo.mid,
          effectiveDate: rateInfo.effectiveDate,
          tableNo: rateInfo.no,
          stale: Boolean(rateInfo.stale),
        }
      : null,
    recommendationModel: {
      price: 0.4,
      range: 0.3,
      battery: 0.15,
      equipment: 0.15,
    },
  };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const PATCH_TEXT_FIELDS = [
  'brand',
  'model',
  'versionName',
  'displayName',
  'currency',
  'fuelType',
  'homologationStandard',
  'technicalType',
  'exteriorColor',
  'wheels',
  'interiorTrim',
  'configurationCode',
  'sourceDate',
];

const PATCH_NUMBER_FIELDS = [
  'basePricePln',
  'totalPricePln',
  'powerKw',
  'powerHp',
  'torqueNm',
  'rangeWltpKm',
  'batteryCapacityKwh',
  'energyConsumptionKwh100km',
  'seats',
  'co2EmissionGkm',
  'exteriorColorPricePln',
  'wheelsPricePln',
  'interiorPricePln',
];

const PATCH_INTEGER_FIELDS = new Set([
  'basePricePln',
  'totalPricePln',
  'seats',
  'exteriorColorPricePln',
  'wheelsPricePln',
  'interiorPricePln',
]);

const PATCH_ARRAY_FIELDS = ['equipmentPackages', 'standardEquipment', 'additionalEquipment', 'notes', 'combustionEquivalents'];

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeOptionalNumber(field, value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`${field} musi być liczbą.`);
    error.statusCode = 400;
    throw error;
  }

  return PATCH_INTEGER_FIELDS.has(field) ? Math.round(parsed) : parsed;
}

function normalizeStringArray(field, value) {
  if (!Array.isArray(value)) {
    const error = new Error(`${field} musi być tablicą.`);
    error.statusCode = 400;
    throw error;
  }

  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function enrichExtractedVehicles(extraction) {
  return Promise.all((extraction.vehicles || []).map(async (vehicle) => ({
    ...vehicle,
    combustionEquivalents: await findCombustionEquivalents(vehicle.brand, vehicle.model).catch(() => []),
    createdAt: new Date().toISOString(),
  })));
}

async function processUploadInBackground(uploadEntry, processor) {
  try {
    const extraction = await processor();
    const vehicles = await enrichExtractedVehicles(extraction);
    await store.markUploadCompleted(uploadEntry.id, vehicles);
    return {
      parser: extraction.parser || null,
      vehicles,
    };
  } catch (error) {
    await store.markUploadFailed(uploadEntry.id, error.message);
    throw error;
  }
}

async function createApp() {
  ensureDirectories();
  await store.initStore();

  const app = express();
  const upload = createUploadMiddleware();
  const uploadLimiter = rateLimit({
    windowMs: config.uploadRateLimitWindowMs,
    limit: config.uploadRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Limit uploadow zostal chwilowo osiagniety.' },
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });
  app.use('/vendor/tabulator', express.static(path.join(config.rootDir, 'node_modules', 'tabulator-tables', 'dist')));
  app.use(express.static(path.join(config.rootDir, 'public')));

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      mode: config.dbMode,
      time: new Date().toISOString(),
      deploy: readDeployMeta(),
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      appName: config.appName,
      dbMode: config.dbMode,
      maxFileSizeMb: config.maxFileSizeMb,
      geminiModel: config.geminiModel,
    });
  });

  app.get('/api/cars', asyncRoute(async (_req, res) => {
    const vehicles = await store.listVehicles();
    const equipmentFacets = await store.listEquipmentFacets();
    const rateInfo = await getEurExchangeRate();
    const ranked = enrichVehicles(vehicles.map((vehicle) => toClientVehicle(vehicle, rateInfo)));

    res.json({
      items: ranked.items,
      summary: createSummary(ranked, equipmentFacets, rateInfo),
    });
  }));

  app.get('/api/uploads/:uploadId/file', asyncRoute(async (req, res) => {
    const uploadEntry = await store.getUploadById(req.params.uploadId);
    if (!uploadEntry || uploadEntry.sourceType !== 'upload' || !uploadEntry.storedName) {
      res.status(404).json({ error: 'Nie znaleziono pliku konfiguracji.' });
      return;
    }

    const safeName = path.basename(uploadEntry.storedName);
    const filePath = path.join(config.uploadDir, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Plik konfiguracji nie istnieje na serwerze.' });
      return;
    }

    res.download(filePath, uploadEntry.originalName || safeName);
  }));

  app.get('/api/uploads/:uploadId/status', asyncRoute(async (req, res) => {
    const uploadEntry = await store.getUploadById(req.params.uploadId);
    if (!uploadEntry) {
      res.status(404).json({ error: 'Nie znaleziono importu.' });
      return;
    }

    let items = [];
    if (uploadEntry.parseStatus === 'completed') {
      const rateInfo = await getEurExchangeRate();
      const vehicles = await store.listVehicles();
      items = vehicles
        .filter((vehicle) => vehicle.uploadId === uploadEntry.id)
        .map((vehicle) => toClientVehicle(vehicle, rateInfo));
    }

    res.json({
      uploadId: uploadEntry.id,
      status: uploadEntry.parseStatus,
      error: uploadEntry.parseError || null,
      parsedAt: uploadEntry.parsedAt || null,
      items,
    });
  }));

  app.post('/api/uploads/:uploadId/complete', asyncRoute(async (req, res) => {
    const uploadEntry = await store.getUploadById(req.params.uploadId);
    if (!uploadEntry) {
      res.status(404).json({ error: 'Nie znaleziono importu.' });
      return;
    }

    const inputVehicles = Array.isArray(req.body && req.body.vehicles) ? req.body.vehicles : [];
    if (!inputVehicles.length) {
      res.status(400).json({ error: 'Przekaz tablice vehicles z co najmniej jednym rekordem.' });
      return;
    }

    const vehicles = inputVehicles.map((vehicle) => ({
      id: normalizeOptionalText(vehicle.id) || randomUUID(),
      brand: normalizeOptionalText(vehicle.brand),
      model: normalizeOptionalText(vehicle.model),
      versionName: normalizeOptionalText(vehicle.versionName),
      displayName: normalizeOptionalText(vehicle.displayName),
      currency: normalizeOptionalText(vehicle.currency) || 'PLN',
      basePricePln: vehicle.basePricePln ?? null,
      totalPricePln: vehicle.totalPricePln ?? null,
      powerKw: vehicle.powerKw ?? null,
      powerHp: vehicle.powerHp ?? null,
      torqueNm: vehicle.torqueNm ?? null,
      rangeWltpKm: vehicle.rangeWltpKm ?? null,
      batteryCapacityKwh: vehicle.batteryCapacityKwh ?? null,
      energyConsumptionKwh100km: vehicle.energyConsumptionKwh100km ?? null,
      seats: vehicle.seats ?? null,
      fuelType: normalizeOptionalText(vehicle.fuelType),
      homologationStandard: normalizeOptionalText(vehicle.homologationStandard),
      co2EmissionGkm: vehicle.co2EmissionGkm ?? null,
      technicalType: normalizeOptionalText(vehicle.technicalType),
      exteriorColor: normalizeOptionalText(vehicle.exteriorColor),
      exteriorColorPricePln: vehicle.exteriorColorPricePln ?? null,
      wheels: normalizeOptionalText(vehicle.wheels),
      wheelsPricePln: vehicle.wheelsPricePln ?? null,
      interiorTrim: normalizeOptionalText(vehicle.interiorTrim),
      interiorPricePln: vehicle.interiorPricePln ?? null,
      configurationCode: normalizeOptionalText(vehicle.configurationCode),
      sourceDate: normalizeOptionalText(vehicle.sourceDate),
      additionalEquipment: Array.isArray(vehicle.additionalEquipment) ? vehicle.additionalEquipment : [],
      standardEquipment: Array.isArray(vehicle.standardEquipment) ? vehicle.standardEquipment : [],
      equipmentPackages: Array.isArray(vehicle.equipmentPackages) ? vehicle.equipmentPackages : [],
      notes: Array.isArray(vehicle.notes) ? vehicle.notes : [],
      warnings: Array.isArray(vehicle.warnings) ? vehicle.warnings : [],
      combustionEquivalents: Array.isArray(vehicle.combustionEquivalents) ? vehicle.combustionEquivalents : [],
      equipmentScore: vehicle.equipmentScore ?? null,
      createdAt: normalizeOptionalText(vehicle.createdAt) || new Date().toISOString(),
    }));

    await store.markUploadCompleted(uploadEntry.id, vehicles);

    const rateInfo = await getEurExchangeRate();
    res.status(201).json({
      message: 'Import zostal zapisany jako zakonczony.',
      uploadId: uploadEntry.id,
      items: vehicles.map((vehicle) => toClientVehicle(vehicle, rateInfo)),
    });
  }));

  app.post('/api/upload', uploadLimiter, upload.single('configurationPdf'), asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Nie przeslano pliku PDF.' });
      return;
    }

    const uploadEntry = await store.createUpload(req.file);

    try {
      const rateInfo = await getEurExchangeRate();
      const { vehicles } = await processUploadInBackground(
        uploadEntry,
        () => extractVehicleFromPdf(req.file.path, req.file.originalname)
      );

      res.status(201).json({
        message: 'Plik zostal odczytany i dodany do tabeli.',
        uploadId: uploadEntry.id,
        items: vehicles.map((vehicle) => toClientVehicle(vehicle, rateInfo)),
      });
    } catch (error) {
      await store.markUploadFailed(uploadEntry.id, error.message);
      throw error;
    }
  }));

  app.post('/api/upload-async', uploadLimiter, upload.single('configurationPdf'), asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Nie przeslano pliku PDF.' });
      return;
    }

    const uploadEntry = await store.createUpload(req.file);

    setImmediate(() => {
      processUploadInBackground(
        uploadEntry,
        () => extractVehicleFromPdf(req.file.path, req.file.originalname)
      ).catch((error) => {
        console.error('Asynchroniczny import PDF nie powiodl sie:', error);
      });
    });

    res.status(202).json({
      message: 'Plik zostal przyjety do przetworzenia.',
      uploadId: uploadEntry.id,
      status: 'processing',
    });
  }));

  app.post('/api/import-url', uploadLimiter, asyncRoute(async (req, res) => {
    const sourceUrl = String(req.body && req.body.url ? req.body.url : '').trim();
    if (!sourceUrl) {
      res.status(400).json({ error: 'Podaj link do konfiguracji.' });
      return;
    }

    const uploadEntry = await store.createUpload({
      sourceType: 'url',
      sourceUrl,
      originalName: 'Link konfiguracji',
      storedName: '',
      mimeType: 'text/html',
      sizeBytes: 0,
    });

    try {
      const rateInfo = await getEurExchangeRate();
      const { parser, vehicles } = await processUploadInBackground(
        uploadEntry,
        () => importVehicleFromUrl(sourceUrl)
      );

      res.status(201).json({
        message: 'Link zostal odczytany i dodany do tabeli.',
        uploadId: uploadEntry.id,
        parser,
        items: vehicles.map((vehicle) => toClientVehicle(vehicle, rateInfo)),
      });
    } catch (error) {
      throw error;
    }
  }));

  app.patch('/api/vehicles/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const patch = {};

    for (const field of PATCH_TEXT_FIELDS) {
      if (body[field] !== undefined) {
        patch[field] = normalizeOptionalText(body[field]);
      }
    }

    for (const field of PATCH_NUMBER_FIELDS) {
      if (body[field] !== undefined) {
        patch[field] = normalizeOptionalNumber(field, body[field]);
      }
    }

    for (const field of PATCH_ARRAY_FIELDS) {
      if (body[field] !== undefined) {
        patch[field] = normalizeStringArray(field, body[field]);
      }
    }

    try {
      const rateInfo = await getEurExchangeRate();
      const updated = await store.updateVehicle(id, patch);
      res.json({ message: 'Zaktualizowano pomyslnie.', vehicle: toClientVehicle(updated, rateInfo) });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        res.status(404).json({ error: 'Nie znaleziono pojazdu.' });
      } else {
        throw error;
      }
    }
  }));

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || (String(error.message || '').includes('PDF') ? 400 : 500);
    res.status(status).json({
      error: error.message || 'Wystapil nieoczekiwany blad.',
    });
  });

  return app;
}

async function startServer() {
  const app = await createApp();

  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      console.log(`electric listening on http://localhost:${config.port}`);
      resolve(server);
    });
  });
}

module.exports = {
  createApp,
  startServer,
};
