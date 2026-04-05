function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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
  const priceCandidates = vehicles.filter((vehicle) => safeNumber(vehicle.totalPricePln) !== null);
  const rangeCandidates = vehicles.filter((vehicle) => safeNumber(vehicle.rangeWltpKm) !== null);
  const batteryCandidates = vehicles.filter((vehicle) => safeNumber(vehicle.batteryCapacityKwh) !== null);
  const equipmentCandidates = vehicles.filter((vehicle) => safeNumber(vehicle.equipmentScore) !== null);

  return {
    bestPrice: priceCandidates.length
      ? Math.min(...priceCandidates.map((vehicle) => vehicle.totalPricePln))
      : null,
    bestRange: rangeCandidates.length
      ? Math.max(...rangeCandidates.map((vehicle) => vehicle.rangeWltpKm))
      : null,
    bestBattery: batteryCandidates.length
      ? Math.max(...batteryCandidates.map((vehicle) => vehicle.batteryCapacityKwh))
      : null,
    bestEquipment: equipmentCandidates.length
      ? Math.max(...equipmentCandidates.map((vehicle) => vehicle.equipmentScore))
      : null,
  };
}

function buildBadges(vehicle, leaders) {
  const badges = [];

  if (leaders.bestPrice !== null && vehicle.totalPricePln === leaders.bestPrice) {
    badges.push('Najlepsza cena');
  }

  if (leaders.bestRange !== null && vehicle.rangeWltpKm === leaders.bestRange) {
    badges.push('Największy zasięg');
  }

  if (leaders.bestBattery !== null && vehicle.batteryCapacityKwh === leaders.bestBattery) {
    badges.push('Największa bateria');
  }

  if (leaders.bestEquipment !== null && vehicle.equipmentScore === leaders.bestEquipment) {
    badges.push('Najbogatsze wyposażenie');
  }

  return badges;
}

function enrichVehicles(vehicles) {
  const weights = {
    price: 0.4,
    range: 0.3,
    battery: 0.15,
    equipment: 0.15,
  };

  const leaders = computeLeaders(vehicles);
  const priceValues = vehicles.map((vehicle) => safeNumber(vehicle.totalPricePln)).filter((value) => value !== null);
  const rangeValues = vehicles.map((vehicle) => safeNumber(vehicle.rangeWltpKm)).filter((value) => value !== null);
  const batteryValues = vehicles.map((vehicle) => safeNumber(vehicle.batteryCapacityKwh)).filter((value) => value !== null);
  const equipmentValues = vehicles.map((vehicle) => safeNumber(vehicle.equipmentScore)).filter((value) => value !== null);

  const minPrice = priceValues.length ? Math.min(...priceValues) : null;
  const maxPrice = priceValues.length ? Math.max(...priceValues) : null;
  const minRange = rangeValues.length ? Math.min(...rangeValues) : null;
  const maxRange = rangeValues.length ? Math.max(...rangeValues) : null;
  const minBattery = batteryValues.length ? Math.min(...batteryValues) : null;
  const maxBattery = batteryValues.length ? Math.max(...batteryValues) : null;
  const minEquipment = equipmentValues.length ? Math.min(...equipmentValues) : null;
  const maxEquipment = equipmentValues.length ? Math.max(...equipmentValues) : null;

  const enriched = vehicles.map((vehicle) => {
    const badges = buildBadges(vehicle, leaders);
    const breakdown = {
      price: normalizeForScore(vehicle.totalPricePln, minPrice, maxPrice, true) * weights.price,
      range: normalizeForScore(vehicle.rangeWltpKm, minRange, maxRange) * weights.range,
      battery: normalizeForScore(vehicle.batteryCapacityKwh, minBattery, maxBattery) * weights.battery,
      equipment: normalizeForScore(vehicle.equipmentScore, minEquipment, maxEquipment) * weights.equipment,
    };
    const recommendationScore =
      breakdown.price +
      breakdown.range +
      breakdown.battery +
      breakdown.equipment +
      badges.length;

    return {
      ...vehicle,
      recommendationBadges: badges,
      recommendationScore: Number(recommendationScore.toFixed(4)),
      recommendationBreakdown: breakdown,
    };
  });

  enriched.sort((left, right) => {
    if (right.recommendationScore !== left.recommendationScore) {
      return right.recommendationScore - left.recommendationScore;
    }

    const leftPrice = left.totalPricePln ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = right.totalPricePln ?? Number.MAX_SAFE_INTEGER;
    return leftPrice - rightPrice;
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
};
