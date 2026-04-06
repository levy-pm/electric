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

  app.post('/api/upload', uploadLimiter, upload.single('configurationPdf'), asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Nie przeslano pliku PDF.' });
      return;
    }

    const uploadEntry = await store.createUpload(req.file);

    try {
      const rateInfo = await getEurExchangeRate();
      const extraction = await extractVehicleFromPdf(req.file.path, req.file.originalname);
      const vehicles = await Promise.all(extraction.vehicles.map(async (vehicle) => ({
        ...vehicle,
        combustionEquivalents: await findCombustionEquivalents(vehicle.brand, vehicle.model).catch(() => []),
        createdAt: new Date().toISOString(),
      })));

      await store.markUploadCompleted(uploadEntry.id, vehicles);

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
      const extraction = await importVehicleFromUrl(sourceUrl);
      const vehicles = await Promise.all(extraction.vehicles.map(async (vehicle) => ({
        ...vehicle,
        combustionEquivalents: await findCombustionEquivalents(vehicle.brand, vehicle.model).catch(() => []),
        createdAt: new Date().toISOString(),
      })));

      await store.markUploadCompleted(uploadEntry.id, vehicles);

      res.status(201).json({
        message: 'Link zostal odczytany i dodany do tabeli.',
        uploadId: uploadEntry.id,
        parser: extraction.parser,
        items: vehicles.map((vehicle) => toClientVehicle(vehicle, rateInfo)),
      });
    } catch (error) {
      await store.markUploadFailed(uploadEntry.id, error.message);
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
