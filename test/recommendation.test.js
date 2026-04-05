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

test('enrichVehicles handles numeric strings from the database when assigning leaders', () => {
  const payload = enrichVehicles([
    {
      id: 'ford',
      brand: 'Ford',
      model: 'Puma Gen-E',
      totalPricePln: 165550,
      rangeWltpKm: '404.00',
      batteryCapacityKwh: '47.00',
      powerHp: '168.00',
      equipmentScore: 43,
      energyConsumptionKwh100km: '14.50',
    },
    {
      id: 'renault',
      brand: 'Renault',
      model: '4 E-Tech',
      totalPricePln: 175300,
      rangeWltpKm: '391.00',
      batteryCapacityKwh: '42.00',
      powerHp: '150.00',
      equipmentScore: 22,
      energyConsumptionKwh100km: '15.80',
    },
  ]);

  const leader = payload.items.find((item) => item.id === 'ford');

  assert.ok(leader);
  assert.ok(leader.recommendationBadges.some((badge) => badge.includes('Najlepsza cena')));
  assert.ok(leader.recommendationBadges.some((badge) => badge.includes('Największy zasięg')));
  assert.ok(leader.recommendationBadges.some((badge) => badge.includes('Największa moc')));
});
