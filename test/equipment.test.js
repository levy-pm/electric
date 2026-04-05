const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeEquipmentList, canonicalizeEquipmentLabel, slugify } = require('../src/equipment');

test('canonicalizeEquipmentLabel keeps acronyms and title casing', () => {
  assert.equal(canonicalizeEquipmentLabel('wyswietlacz hud'), 'Wyswietlacz HUD');
  assert.equal(canonicalizeEquipmentLabel('pompa ciepla'), 'Pompa Ciepla');
});

test('canonicalizeEquipmentList splits newline and removes duplicates', () => {
  const result = canonicalizeEquipmentList([
    'wyswietlacz hud\npompa ciepla',
    'pompa ciepla',
    'adapter v2l',
  ]);

  assert.deepEqual(result, [
    'Wyswietlacz HUD',
    'Pompa Ciepla',
    'Adapter V2L',
  ]);
});

test('slugify trims very long equipment labels to fit database limits', () => {
  const longLabel = `Pakiet ${'bardzo '.repeat(60)}dlugiego wyposazenia premium`;
  const slug = slugify(longLabel);

  assert.ok(slug.length <= 255);
  assert.match(slug, /-[a-f0-9]{12}$/);
  assert.equal(slug, slugify(longLabel));
});
