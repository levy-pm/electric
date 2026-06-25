const { z } = require('zod');
const { canonicalizeEquipmentList } = require('./equipment');

const extractedVehicleSchema = z.object({
  brand: z.string().nullish(),
  model: z.string().nullish(),
  versionName: z.string().nullish(),
  displayName: z.string().nullish(),
  currency: z.string().nullish(),
  basePricePln: z.union([z.number(), z.string()]).nullish(),
  totalPricePln: z.union([z.number(), z.string()]).nullish(),
  powerKw: z.union([z.number(), z.string()]).nullish(),
  powerHp: z.union([z.number(), z.string()]).nullish(),
  torqueNm: z.union([z.number(), z.string()]).nullish(),
  rangeWltpKm: z.union([z.number(), z.string()]).nullish(),
  batteryCapacityKwh: z.union([z.number(), z.string()]).nullish(),
  energyConsumptionKwh100km: z.union([z.number(), z.string()]).nullish(),
  seats: z.union([z.number(), z.string()]).nullish(),
  fuelType: z.string().nullish(),
  homologationStandard: z.string().nullish(),
  co2EmissionGkm: z.union([z.number(), z.string()]).nullish(),
  technicalType: z.string().nullish(),
  exteriorColor: z.string().nullish(),
  exteriorColorPricePln: z.union([z.number(), z.string()]).nullish(),
  wheels: z.string().nullish(),
  wheelsPricePln: z.union([z.number(), z.string()]).nullish(),
  interiorTrim: z.string().nullish(),
  interiorPricePln: z.union([z.number(), z.string()]).nullish(),
  additionalEquipment: z.array(z.union([z.string(), z.number()])).nullish(),
  standardEquipment: z.array(z.union([z.string(), z.number()])).nullish(),
  equipmentPackages: z.array(z.union([z.string(), z.number()])).nullish(),
  configurationCode: z.string().nullish(),
  sourceDate: z.string().nullish(),
  notes: z.array(z.union([z.string(), z.number()])).nullish(),
  warnings: z.array(z.union([z.string(), z.number()])).nullish(),
});

const geminiVehicleResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brand: { type: 'string' },
    model: { type: 'string' },
    versionName: { type: 'string' },
    displayName: { type: 'string' },
    currency: { type: 'string' },
    basePricePln: { type: 'number' },
    totalPricePln: { type: 'number' },
    powerKw: { type: 'number' },
    powerHp: { type: 'number' },
    torqueNm: { type: 'number' },
    rangeWltpKm: { type: 'number' },
    batteryCapacityKwh: { type: 'number' },
    energyConsumptionKwh100km: { type: 'number' },
    seats: { type: 'number' },
    fuelType: { type: 'string' },
    homologationStandard: { type: 'string' },
    co2EmissionGkm: { type: 'number' },
    technicalType: { type: 'string' },
    exteriorColor: { type: 'string' },
    exteriorColorPricePln: { type: 'number' },
    wheels: { type: 'string' },
    wheelsPricePln: { type: 'number' },
    interiorTrim: { type: 'string' },
    interiorPricePln: { type: 'number' },
    additionalEquipment: { type: 'array', items: { type: 'string' } },
    standardEquipment: { type: 'array', items: { type: 'string' } },
    equipmentPackages: { type: 'array', items: { type: 'string' } },
    configurationCode: { type: 'string' },
    sourceDate: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

function normalizeString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

function normalizeNumber(value, decimals = 2) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
  }

  const sanitized = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');

  if (!sanitized) {
    return null;
  }

  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function normalizeInteger(value) {
  const normalized = normalizeNumber(value, 0);
  return normalized === null ? null : Math.round(normalized);
}

function normalizeStringArray(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))];
}

function deriveDisplayName(vehicle) {
  const explicit = normalizeString(vehicle.displayName);
  if (explicit) {
    return explicit;
  }

  return [vehicle.brand, vehicle.model, vehicle.versionName]
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(' ');
}

function calculateEquipmentScore(vehicle) {
  return (
    vehicle.standardEquipment.length +
    vehicle.additionalEquipment.length * 2 +
    vehicle.equipmentPackages.length * 3
  );
}

function normalizeVehicleExtraction(rawVehicle) {
  const parsed = extractedVehicleSchema.parse(rawVehicle || {});
  const normalized = {
    brand: normalizeString(parsed.brand),
    model: normalizeString(parsed.model),
    versionName: normalizeString(parsed.versionName),
    displayName: normalizeString(parsed.displayName),
    currency: normalizeString(parsed.currency) || 'PLN',
    basePricePln: normalizeInteger(parsed.basePricePln),
    totalPricePln: normalizeInteger(parsed.totalPricePln),
    powerKw: normalizeNumber(parsed.powerKw),
    powerHp: normalizeNumber(parsed.powerHp),
    torqueNm: normalizeNumber(parsed.torqueNm),
    rangeWltpKm: normalizeNumber(parsed.rangeWltpKm),
    batteryCapacityKwh: normalizeNumber(parsed.batteryCapacityKwh),
    energyConsumptionKwh100km: normalizeNumber(parsed.energyConsumptionKwh100km),
    seats: normalizeInteger(parsed.seats),
    fuelType: normalizeString(parsed.fuelType),
    homologationStandard: normalizeString(parsed.homologationStandard),
    co2EmissionGkm: normalizeNumber(parsed.co2EmissionGkm),
    technicalType: normalizeString(parsed.technicalType),
    exteriorColor: normalizeString(parsed.exteriorColor),
    exteriorColorPricePln: normalizeInteger(parsed.exteriorColorPricePln),
    wheels: normalizeString(parsed.wheels),
    wheelsPricePln: normalizeInteger(parsed.wheelsPricePln),
    interiorTrim: normalizeString(parsed.interiorTrim),
    interiorPricePln: normalizeInteger(parsed.interiorPricePln),
    additionalEquipment: canonicalizeEquipmentList(parsed.additionalEquipment),
    standardEquipment: canonicalizeEquipmentList(parsed.standardEquipment),
    equipmentPackages: canonicalizeEquipmentList(parsed.equipmentPackages),
    configurationCode: normalizeString(parsed.configurationCode),
    sourceDate: normalizeString(parsed.sourceDate),
    notes: normalizeStringArray(parsed.notes),
    warnings: normalizeStringArray(parsed.warnings),
  };

  normalized.displayName = deriveDisplayName(normalized);
  normalized.equipmentScore = calculateEquipmentScore(normalized);

  return normalized;
}

module.exports = {
  geminiVehicleResponseJsonSchema,
  normalizeVehicleExtraction,
};
