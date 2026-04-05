const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');
const { config } = require('./config');
const { buildEquipmentEntries } = require('./equipment');

const memoryState = {
  uploads: new Map(),
  vehicles: new Map(),
  equipmentItems: new Map(),
  vehicleEquipment: new Map(),
};

let pool;

function serializeJson(value) {
  return JSON.stringify(value ?? []);
}

function parseJson(value) {
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function mapVehicleRow(row) {
  return {
    id: row.id,
    uploadId: row.upload_id,
    brand: row.brand,
    model: row.model,
    versionName: row.version_name,
    displayName: row.display_name,
    currency: row.currency,
    basePricePln: row.base_price_pln,
    totalPricePln: row.total_price_pln,
    powerKw: row.power_kw,
    powerHp: row.power_hp,
    torqueNm: row.torque_nm,
    rangeWltpKm: row.range_wltp_km,
    batteryCapacityKwh: row.battery_capacity_kwh,
    energyConsumptionKwh100km: row.energy_consumption_kwh_100km,
    seats: row.seats,
    fuelType: row.fuel_type,
    homologationStandard: row.homologation_standard,
    co2EmissionGkm: row.co2_emission_gkm,
    technicalType: row.technical_type,
    exteriorColor: row.exterior_color,
    exteriorColorPricePln: row.exterior_color_price_pln,
    wheels: row.wheels,
    wheelsPricePln: row.wheels_price_pln,
    interiorTrim: row.interior_trim,
    interiorPricePln: row.interior_price_pln,
    configurationCode: row.configuration_code,
    sourceDate: row.source_date,
    additionalEquipment: parseJson(row.additional_equipment),
    standardEquipment: parseJson(row.standard_equipment),
    equipmentPackages: parseJson(row.equipment_packages),
    notes: parseJson(row.notes),
    warnings: parseJson(row.warnings),
    equipmentScore: row.equipment_score,
    createdAt: row.created_at,
  };
}

async function initMariaDbPool() {
  if (pool) {
    return pool;
  }

  pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    connectionLimit: 10,
    namedPlaceholders: true,
  });

  return pool;
}

async function ensureMariaDbSchema() {
  const db = await initMariaDbPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id CHAR(36) PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes BIGINT NOT NULL,
      parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      parse_error TEXT NULL,
      uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      parsed_at DATETIME NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id CHAR(36) PRIMARY KEY,
      upload_id CHAR(36) NOT NULL,
      brand VARCHAR(120) NULL,
      model VARCHAR(120) NULL,
      version_name VARCHAR(255) NULL,
      display_name VARCHAR(255) NULL,
      currency VARCHAR(16) NOT NULL DEFAULT 'PLN',
      base_price_pln INT NULL,
      total_price_pln INT NULL,
      power_kw DECIMAL(10,2) NULL,
      power_hp DECIMAL(10,2) NULL,
      torque_nm DECIMAL(10,2) NULL,
      range_wltp_km DECIMAL(10,2) NULL,
      battery_capacity_kwh DECIMAL(10,2) NULL,
      energy_consumption_kwh_100km DECIMAL(10,2) NULL,
      seats INT NULL,
      fuel_type VARCHAR(100) NULL,
      homologation_standard VARCHAR(100) NULL,
      co2_emission_gkm DECIMAL(10,2) NULL,
      technical_type VARCHAR(100) NULL,
      exterior_color VARCHAR(255) NULL,
      exterior_color_price_pln INT NULL,
      wheels VARCHAR(255) NULL,
      wheels_price_pln INT NULL,
      interior_trim VARCHAR(255) NULL,
      interior_price_pln INT NULL,
      configuration_code VARCHAR(64) NULL,
      source_date VARCHAR(64) NULL,
      additional_equipment JSON NULL,
      standard_equipment JSON NULL,
      equipment_packages JSON NULL,
      notes JSON NULL,
      warnings JSON NULL,
      equipment_score INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_vehicles_upload FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_items (
      id CHAR(36) PRIMARY KEY,
      slug VARCHAR(255) NOT NULL UNIQUE,
      label VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_equipment (
      vehicle_id CHAR(36) NOT NULL,
      equipment_item_id CHAR(36) NOT NULL,
      equipment_type ENUM('standard', 'additional', 'package') NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (vehicle_id, equipment_item_id, equipment_type),
      INDEX idx_vehicle_equipment_item (equipment_item_id),
      CONSTRAINT fk_vehicle_equipment_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT fk_vehicle_equipment_item FOREIGN KEY (equipment_item_id) REFERENCES equipment_items(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

async function initStore() {
  if (config.dbMode === 'mariadb') {
    await ensureMariaDbSchema();
  }
}

async function createUpload(file) {
  const upload = {
    id: randomUUID(),
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    parseStatus: 'processing',
    uploadedAt: new Date().toISOString(),
  };

  if (config.dbMode === 'memory') {
    memoryState.uploads.set(upload.id, upload);
    return upload;
  }

  const db = await initMariaDbPool();
  await db.execute(
    `INSERT INTO uploads (id, original_name, stored_name, mime_type, size_bytes, parse_status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [upload.id, upload.originalName, upload.storedName, upload.mimeType, upload.sizeBytes]
  );

  return upload;
}

async function markUploadCompleted(uploadId, vehicles) {
  if (config.dbMode === 'memory') {
    const current = memoryState.uploads.get(uploadId);
    if (current) {
      current.parseStatus = 'completed';
      current.parsedAt = new Date().toISOString();
    }

    vehicles.forEach((vehicle) => {
      memoryState.vehicles.set(vehicle.id, { ...vehicle, uploadId });
      const entries = buildEquipmentEntries(vehicle);
      memoryState.vehicleEquipment.set(vehicle.id, entries);

      entries.forEach((entry) => {
        if (!memoryState.equipmentItems.has(entry.slug)) {
          memoryState.equipmentItems.set(entry.slug, {
            id: entry.id,
            slug: entry.slug,
            label: entry.label,
          });
        }
      });
    });

    return;
  }

  const db = await initMariaDbPool();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(`DELETE FROM vehicles WHERE upload_id = ?`, [uploadId]);

    for (const vehicle of vehicles) {
      await connection.execute(
        `INSERT INTO vehicles (
          id, upload_id, brand, model, version_name, display_name, currency,
          base_price_pln, total_price_pln, power_kw, power_hp, torque_nm,
          range_wltp_km, battery_capacity_kwh, energy_consumption_kwh_100km,
          seats, fuel_type, homologation_standard, co2_emission_gkm, technical_type,
          exterior_color, exterior_color_price_pln, wheels, wheels_price_pln,
          interior_trim, interior_price_pln, configuration_code, source_date,
          additional_equipment, standard_equipment, equipment_packages, notes, warnings,
          equipment_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vehicle.id,
          uploadId,
          vehicle.brand,
          vehicle.model,
          vehicle.versionName,
          vehicle.displayName,
          vehicle.currency,
          vehicle.basePricePln,
          vehicle.totalPricePln,
          vehicle.powerKw,
          vehicle.powerHp,
          vehicle.torqueNm,
          vehicle.rangeWltpKm,
          vehicle.batteryCapacityKwh,
          vehicle.energyConsumptionKwh100km,
          vehicle.seats,
          vehicle.fuelType,
          vehicle.homologationStandard,
          vehicle.co2EmissionGkm,
          vehicle.technicalType,
          vehicle.exteriorColor,
          vehicle.exteriorColorPricePln,
          vehicle.wheels,
          vehicle.wheelsPricePln,
          vehicle.interiorTrim,
          vehicle.interiorPricePln,
          vehicle.configurationCode,
          vehicle.sourceDate,
          serializeJson(vehicle.additionalEquipment),
          serializeJson(vehicle.standardEquipment),
          serializeJson(vehicle.equipmentPackages),
          serializeJson(vehicle.notes),
          serializeJson(vehicle.warnings),
          vehicle.equipmentScore,
        ]
      );

      const entries = buildEquipmentEntries(vehicle);
      for (const entry of entries) {
        const itemId = await upsertEquipmentItem(connection, entry);
        await connection.execute(
          `INSERT INTO vehicle_equipment (vehicle_id, equipment_item_id, equipment_type, sort_order)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
          [vehicle.id, itemId, entry.type, entry.sortOrder]
        );
      }
    }

    await connection.execute(
      `UPDATE uploads SET parse_status = 'completed', parsed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [uploadId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markUploadFailed(uploadId, errorMessage) {
  if (config.dbMode === 'memory') {
    const current = memoryState.uploads.get(uploadId);
    if (current) {
      current.parseStatus = 'failed';
      current.parseError = errorMessage;
    }
    return;
  }

  const db = await initMariaDbPool();
  await db.execute(
    `UPDATE uploads SET parse_status = 'failed', parse_error = ? WHERE id = ?`,
    [errorMessage, uploadId]
  );
}

async function listVehicles() {
  if (config.dbMode === 'memory') {
    return [...memoryState.vehicles.values()]
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  }

  const db = await initMariaDbPool();
  const [rows] = await db.query(`SELECT * FROM vehicles ORDER BY created_at DESC`);
  return rows.map(mapVehicleRow);
}

async function upsertEquipmentItem(connection, entry) {
  const equipmentId = randomUUID();
  await connection.execute(
    `INSERT INTO equipment_items (id, slug, label)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE label = VALUES(label)`,
    [equipmentId, entry.slug, entry.label]
  );

  const [rows] = await connection.execute(
    `SELECT id FROM equipment_items WHERE slug = ? LIMIT 1`,
    [entry.slug]
  );

  return rows[0].id;
}

async function listEquipmentFacets() {
  if (config.dbMode === 'memory') {
    const usage = new Map();

    for (const entries of memoryState.vehicleEquipment.values()) {
      const seen = new Set();
      entries.forEach((entry) => {
        if (seen.has(entry.slug)) {
          return;
        }

        seen.add(entry.slug);
        const current = usage.get(entry.slug) || { slug: entry.slug, label: entry.label, usageCount: 0 };
        current.usageCount += 1;
        usage.set(entry.slug, current);
      });
    }

    return [...usage.values()].sort((left, right) => right.usageCount - left.usageCount || left.label.localeCompare(right.label, 'pl'));
  }

  const db = await initMariaDbPool();
  const [rows] = await db.query(`
    SELECT ei.slug, ei.label, COUNT(DISTINCT ve.vehicle_id) AS usageCount
    FROM equipment_items ei
    JOIN vehicle_equipment ve ON ve.equipment_item_id = ei.id
    GROUP BY ei.id, ei.slug, ei.label
    ORDER BY usageCount DESC, ei.label ASC
  `);

  return rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    usageCount: Number(row.usageCount),
  }));
}

module.exports = {
  initStore,
  createUpload,
  markUploadCompleted,
  markUploadFailed,
  listVehicles,
  listEquipmentFacets,
};
