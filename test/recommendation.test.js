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
      equipmentScore: 14,
    },
    {
      id: 'b',
      displayName: 'Model B',
      totalPricePln: 175000,
      rangeWltpKm: 410,
      batteryCapacityKwh: 60,
      equipmentScore: 18,
    },
  ]);

  assert.equal(payload.items[0].id, 'b');
  assert.equal(payload.items[0].isSuggestedTop, true);
  assert.ok(payload.items[0].recommendationBadges.includes('Najlepsza cena'));
  assert.ok(payload.items[0].recommendationBadges.includes('Największy zasięg'));
});
