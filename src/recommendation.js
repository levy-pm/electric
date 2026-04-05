/**
 * System rekomendacji pojazdów elektrycznych.
 *
 * Każdy pojazd dostaje wynik [0, 1] jako ważoną sumę znormalizowanych metryk.
 * Normalizacja min-max gwarantuje, że żadna skala jednostek nie faworyzuje jednej cechy.
 * Etykiety liderów muszą dokładnie odpowiadać stałej LEADER_LABELS w public/app.js.
 */

// ---------------------------------------------------------------------------
// Wagi scoringu — suma = 1.0
// Dostosuj do preferencji użytkowników zmieniając tylko te wartości.
// ---------------------------------------------------------------------------
const SCORING_WEIGHTS = {
  price: 0.35,      // niższa cena końcowa → wyższy wynik
  range: 0.25,      // większy zasięg WLTP → wyższy wynik
  battery: 0.15,    // większa pojemność baterii → wyższy wynik
  power: 0.12,      // większa moc (KM) → wyższy wynik
  equipment: 0.08,  // więcej wyposażenia → wyższy wynik (kontrowersyjne — niska waga)
  efficiency: 0.05, // niższe zużycie energii kWh/100 km → wyższy wynik (eko bonus)
};

// Etykiety odznak liderów — muszą być identyczne z LEADER_LABELS w public/app.js
const BADGE_BEST_PRICE = '💰 Najlepsza cena';
const BADGE_BEST_RANGE = '🔋 Największy zasięg';
const BADGE_BEST_BATTERY = '⚡ Największa bateria';
const BADGE_BEST_POWER = '🚀 Największa moc';
const BADGE_BEST_EQUIPMENT = '🌿 Najbogatsze wyposażenie';

// ---------------------------------------------------------------------------

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
    bestPrice: withPrice.length ? Math.min(...withPrice.map((v) => v.totalPricePln)) : null,
    bestRange: withRange.length ? Math.max(...withRange.map((v) => v.rangeWltpKm)) : null,
    bestBattery: withBattery.length ? Math.max(...withBattery.map((v) => v.batteryCapacityKwh)) : null,
    bestPower: withPower.length ? Math.max(...withPower.map((v) => v.powerHp)) : null,
    bestEquipment: withEquipment.length ? Math.max(...withEquipment.map((v) => v.equipmentScore)) : null,
  };
}

function buildBadges(vehicle, leaders) {
  const badges = [];

  if (leaders.bestPrice !== null && vehicle.totalPricePln === leaders.bestPrice) {
    badges.push(BADGE_BEST_PRICE);
  }

  if (leaders.bestRange !== null && vehicle.rangeWltpKm === leaders.bestRange) {
    badges.push(BADGE_BEST_RANGE);
  }

  if (leaders.bestBattery !== null && vehicle.batteryCapacityKwh === leaders.bestBattery) {
    badges.push(BADGE_BEST_BATTERY);
  }

  if (leaders.bestPower !== null && vehicle.powerHp === leaders.bestPower) {
    badges.push(BADGE_BEST_POWER);
  }

  if (leaders.bestEquipment !== null && vehicle.equipmentScore === leaders.bestEquipment) {
    badges.push(BADGE_BEST_EQUIPMENT);
  }

  return badges;
}

function enrichVehicles(vehicles) {
  const leaders = computeLeaders(vehicles);

  // Zbierz wartości do normalizacji
  const prices = vehicles.map((v) => safeNumber(v.totalPricePln)).filter((x) => x !== null);
  const ranges = vehicles.map((v) => safeNumber(v.rangeWltpKm)).filter((x) => x !== null);
  const batteries = vehicles.map((v) => safeNumber(v.batteryCapacityKwh)).filter((x) => x !== null);
  const powers = vehicles.map((v) => safeNumber(v.powerHp)).filter((x) => x !== null);
  const equipments = vehicles.map((v) => safeNumber(v.equipmentScore)).filter((x) => x !== null);
  const efficiencies = vehicles.map((v) => safeNumber(v.energyConsumptionKwh100km)).filter((x) => x !== null);

  const minmax = (arr) => arr.length ? [Math.min(...arr), Math.max(...arr)] : [null, null];

  const [minPrice, maxPrice] = minmax(prices);
  const [minRange, maxRange] = minmax(ranges);
  const [minBattery, maxBattery] = minmax(batteries);
  const [minPower, maxPower] = minmax(powers);
  const [minEquipment, maxEquipment] = minmax(equipments);
  const [minEfficiency, maxEfficiency] = minmax(efficiencies);

  const enriched = vehicles.map((vehicle) => {
    const badges = buildBadges(vehicle, leaders);

    // Wynik = ważona suma znormalizowanych metryk (bez premii za odznaki — brak podwójnego liczenia)
    const breakdown = {
      price: normalizeForScore(vehicle.totalPricePln, minPrice, maxPrice, true) * SCORING_WEIGHTS.price,
      range: normalizeForScore(vehicle.rangeWltpKm, minRange, maxRange) * SCORING_WEIGHTS.range,
      battery: normalizeForScore(vehicle.batteryCapacityKwh, minBattery, maxBattery) * SCORING_WEIGHTS.battery,
      power: normalizeForScore(vehicle.powerHp, minPower, maxPower) * SCORING_WEIGHTS.power,
      equipment: normalizeForScore(vehicle.equipmentScore, minEquipment, maxEquipment) * SCORING_WEIGHTS.equipment,
      efficiency: normalizeForScore(vehicle.energyConsumptionKwh100km, minEfficiency, maxEfficiency, true) * SCORING_WEIGHTS.efficiency,
    };

    const recommendationScore =
      breakdown.price +
      breakdown.range +
      breakdown.battery +
      breakdown.power +
      breakdown.equipment +
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
    const priceA = a.totalPricePln ?? Number.MAX_SAFE_INTEGER;
    const priceB = b.totalPricePln ?? Number.MAX_SAFE_INTEGER;
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
