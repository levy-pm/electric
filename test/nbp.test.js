const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearExchangeRateCache,
  convertEurToPln,
  convertPlnToEur,
  enrichVehiclePrices,
  getEurExchangeRate,
} = require('../src/nbp');

test('convertPlnToEur and convertEurToPln use the provided NBP rate', () => {
  assert.equal(convertPlnToEur(430000, 4.3), 100000);
  assert.equal(convertEurToPln(100000, 4.3), 430000);
});

test('enrichVehiclePrices adds EUR values and keeps PLN values', () => {
  const enriched = enrichVehiclePrices(
    { totalPricePln: 215000, basePricePln: 199000 },
    { mid: 4.25, effectiveDate: '2026-04-05', no: '066/A/NBP/2026' }
  );

  assert.equal(enriched.totalPricePln, 215000);
  assert.equal(enriched.totalPriceEur, 50588.24);
  assert.equal(enriched.basePricePln, 199000);
  assert.equal(enriched.basePriceEur, 46823.53);
  assert.equal(enriched.exchangeRateEurPln, 4.25);
  assert.equal(enriched.exchangeRateEffectiveDate, '2026-04-05');
  assert.equal(enriched.exchangeRateTableNo, '066/A/NBP/2026');
});

test('enrichVehiclePrices can reconstruct PLN from EUR when needed', () => {
  const enriched = enrichVehiclePrices(
    { totalPricePln: null, totalPriceEur: 100000 },
    { mid: 4.3, effectiveDate: '2026-04-05', no: '066/A/NBP/2026' }
  );

  assert.equal(enriched.totalPricePln, 430000);
  assert.equal(enriched.totalPriceEur, 100000);
});

test('getEurExchangeRate caches successful responses', async () => {
  clearExchangeRateCache();

  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        table: 'A',
        code: 'EUR',
        currency: 'euro',
        rates: [{ no: '066/A/NBP/2026', effectiveDate: '2026-04-05', mid: 4.25 }],
      }),
    };
  };

  const first = await getEurExchangeRate({ fetchImpl });
  const second = await getEurExchangeRate({ fetchImpl });

  assert.equal(calls, 1);
  assert.equal(first.mid, 4.25);
  assert.equal(second.mid, 4.25);

  clearExchangeRateCache();
});
