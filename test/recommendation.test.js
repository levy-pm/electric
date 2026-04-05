const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichVehicles } = require('../src/recommendation');

test('enrichVehicles sorts the strongest candidate to the top', () => {
  const payload = enrichVehicles([
    {
      id: 'a',
      displayName: 'Model A',
      totalPricePln: 190000,
      rangeWltpKm: 380,
      batteryCapacityKwh: 52,
      powerHp: 130,
      equipmentScore: 14,
      energyConsumptionKwh100km: 17.8,
    },
    {
      id: 'b',
      displayName: 'Model B',
      totalPricePln: 175000,
      rangeWltpKm: 410,
      batteryCapacityKwh: 60,
      powerHp: 150,
      equipmentScore: 18,
      energyConsumptionKwh100km: 16.2,
    },
  ]);

  assert.equal(payload.items[0].id, 'b');
  assert.equal(payload.items[0].isSuggestedTop, true);
  assert.ok(payload.items[0].recommendationBadges.some((badge) => badge.includes('Najlepsza cena')));
  assert.ok(payload.items[0].recommendationBadges.some((badge) => badge.includes('zasi')));
});
