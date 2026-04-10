/**
 * System rekomendacji pojazdów elektrycznych.
 *
 * Scoring oparty na "value for money" — każdy pojazd oceniany jest przez pryzmat
 * tego, ile zasięgu, baterii i wyposażenia oferuje względem swojej ceny.
 * Normalizacja min-max gwarantuje, że żadna skala jednostek nie faworyzuje jednej cechy.
 * Etykiety liderów muszą dokładnie odpowiadać stałej LEADER_LABELS w public/app.js.
 */

// ---------------------------------------------------------------------------
// Wagi scoringu "value for money" — suma = 1.0
// Każda metryka to stosunek cechy do ceny (np. km / 1000 PLN).
// ---------------------------------------------------------------------------
const SCORING_WEIGHTS = {
  rangePerPrice:     0.40,  // km zasięgu WLTP na 1000 PLN — najważniejsze kryterium
  batteryPerPrice:   0.30,  // kWh baterii na 1000 PLN
  equipmentPerPrice: 0.20,  // wynik wyposażenia na 1000 PLN
  efficiency:        0.10,  // niższe zużycie kWh/100 km → eko bonus
};

// Etykiety odznak liderów — muszą być identyczne z LEADER_LABELS w public/app.js
const BADGE_BEST_PRICE = '💰 Najlepsza cena';
const BADGE_BEST_RANGE = '🔋 Największy zasięg';
const BADGE_BEST_BATTERY = '⚡ Największa bateria';
const BADGE_BEST_POWER = '🚀 Największa moc';
const BADGE_BEST_EQUIPMENT = '🌿 Najbogatsze wyposażenie';

// ---------------------------------------------------------------------------

function safeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Normalizuje wartość do przedziału [0, 1].
 * inverse=true gdy niższa wartość jest lepsza (np. cena, zużycie energii).
 */
function normalizeForScore(value, min, max, inverse = false) {
  if (value === null || min === null || max === null) {
    return 0;
  }

  if (min === max) {
    return 1;
  }

  const ratio = (value - min) / (max - min);
  return inverse ? 1 - ratio : ratio;
}

function computeLeaders(vehicles) {
  const withPrice = vehicles.filter((v) => safeNumber(v.totalPricePln) !== null);
  const withRange = vehicles.filter((v) => safeNumber(v.rangeWltpKm) !== null);
  const withBattery = vehicles.filter((v) => safeNumber(v.batteryCapacityKwh) !== null);
  const withPower = vehicles.filter((v) => safeNumber(v.powerHp) !== null);
  const withEquipment = vehicles.filter((v) => safeNumber(v.equipmentScore) !== null);

  return {
    bestPrice: withPrice.length ? Math.min(...withPrice.map((v) => safeNumber(v.totalPricePln))) : null,
    bestRange: withRange.length ? Math.max(...withRange.map((v) => safeNumber(v.rangeWltpKm))) : null,
    bestBattery: withBattery.length ? Math.max(...withBattery.map((v) => safeNumber(v.batteryCapacityKwh))) : null,
    bestPower: withPower.length ? Math.max(...withPower.map((v) => safeNumber(v.powerHp))) : null,
    bestEquipment: withEquipment.length ? Math.max(...withEquipment.map((v) => safeNumber(v.equipmentScore))) : null,
  };
}

function buildBadges(vehicle, leaders) {
  const badges = [];
  const totalPrice = safeNumber(vehicle.totalPricePln);
  const range = safeNumber(vehicle.rangeWltpKm);
  const battery = safeNumber(vehicle.batteryCapacityKwh);
  const power = safeNumber(vehicle.powerHp);
  const equipment = safeNumber(vehicle.equipmentScore);

  if (leaders.bestPrice !== null && totalPrice === leaders.bestPrice) {
    badges.push(BADGE_BEST_PRICE);
  }

  if (leaders.bestRange !== null && range === leaders.bestRange) {
    badges.push(BADGE_BEST_RANGE);
  }

  if (leaders.bestBattery !== null && battery === leaders.bestBattery) {
    badges.push(BADGE_BEST_BATTERY);
  }

  if (leaders.bestPower !== null && power === leaders.bestPower) {
    badges.push(BADGE_BEST_POWER);
  }

  if (leaders.bestEquipment !== null && equipment === leaders.bestEquipment) {
    badges.push(BADGE_BEST_EQUIPMENT);
  }

  return badges;
}

/**
 * Oblicza wskaźnik "value for money" dla jednego pojazdu.
 * Zwraca null gdy brakuje ceny (bez ceny nie można ocenić VfM).
 * Jednostka: cecha / 1000 PLN (ułatwia porównywalność liczb).
 */
function computeValueRatios(vehicle) {
  const price = safeNumber(vehicle.totalPricePln);
  if (!price || price <= 0) {
    return { rangePerPrice: null, batteryPerPrice: null, equipmentPerPrice: null };
  }

  const kPrice = price / 1000; // cena w tysiącach PLN
  const range = safeNumber(vehicle.rangeWltpKm);
  const battery = safeNumber(vehicle.batteryCapacityKwh);
  const equipment = safeNumber(vehicle.equipmentScore);

  return {
    rangePerPrice:     range     !== null ? range     / kPrice : null,
    batteryPerPrice:   battery   !== null ? battery   / kPrice : null,
    equipmentPerPrice: equipment !== null ? equipment / kPrice : null,
  };
}

function enrichVehicles(vehicles) {
  const leaders = computeLeaders(vehicles);

  // Oblicz współczynniki VfM dla każdego pojazdu, a następnie ustal min/max do normalizacji
  const withRatios = vehicles.map((v) => ({ ...v, ...computeValueRatios(v) }));

  const pick = (field) => withRatios.map((v) => v[field]).filter((x) => x !== null);
  const minmax = (arr) => arr.length ? [Math.min(...arr), Math.max(...arr)] : [null, null];

  const [minRangePerPrice,     maxRangePerPrice]     = minmax(pick('rangePerPrice'));
  const [minBatteryPerPrice,   maxBatteryPerPrice]   = minmax(pick('batteryPerPrice'));
  const [minEquipmentPerPrice, maxEquipmentPerPrice] = minmax(pick('equipmentPerPrice'));
  const efficiencies = vehicles.map((v) => safeNumber(v.energyConsumptionKwh100km)).filter((x) => x !== null);
  const [minEfficiency,        maxEfficiency]        = minmax(efficiencies);

  const enriched = withRatios.map((vehicle) => {
    const badges = buildBadges(vehicle, leaders);
    const efficiency = safeNumber(vehicle.energyConsumptionKwh100km);

    // Wynik = ważona suma znormalizowanych wskaźników VfM
    const breakdown = {
      rangePerPrice:     normalizeForScore(vehicle.rangePerPrice,     minRangePerPrice,     maxRangePerPrice)     * SCORING_WEIGHTS.rangePerPrice,
      batteryPerPrice:   normalizeForScore(vehicle.batteryPerPrice,   minBatteryPerPrice,   maxBatteryPerPrice)   * SCORING_WEIGHTS.batteryPerPrice,
      equipmentPerPrice: normalizeForScore(vehicle.equipmentPerPrice, minEquipmentPerPrice, maxEquipmentPerPrice) * SCORING_WEIGHTS.equipmentPerPrice,
      efficiency:        normalizeForScore(efficiency,                minEfficiency,        maxEfficiency, true)  * SCORING_WEIGHTS.efficiency,
    };

    const recommendationScore =
      breakdown.rangePerPrice +
      breakdown.batteryPerPrice +
      breakdown.equipmentPerPrice +
      breakdown.efficiency;

    return {
      ...vehicle,
      recommendationBadges: badges,
      recommendationScore: Number(recommendationScore.toFixed(4)),
      recommendationBreakdown: breakdown,
    };
  });

  enriched.sort((a, b) => {
    if (b.recommendationScore !== a.recommendationScore) {
      return b.recommendationScore - a.recommendationScore;
    }
    // Remis: tańszy wygrywa
    const priceA = safeNumber(a.totalPricePln) ?? Number.MAX_SAFE_INTEGER;
    const priceB = safeNumber(b.totalPricePln) ?? Number.MAX_SAFE_INTEGER;
    return priceA - priceB;
  });

  return {
    items: enriched.map((vehicle, index) => ({
      ...vehicle,
      isSuggestedTop: index === 0,
    })),
    leaders,
  };
}

module.exports = {
  enrichVehicles,
  SCORING_WEIGHTS,
};
