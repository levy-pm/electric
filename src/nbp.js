const { config } = require('./config');

const CACHE = {
  value: null,
  expiresAt: 0,
};

let pendingRequest = null;

function roundValue(value, decimals = 2) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(parsed.toFixed(decimals));
}

function convertPlnToEur(amountPln, eurMidRate) {
  const price = roundValue(amountPln, 2);
  const rate = roundValue(eurMidRate, 6);

  if (price === null || rate === null || rate <= 0) {
    return null;
  }

  return roundValue(price / rate, 2);
}

function convertEurToPln(amountEur, eurMidRate) {
  const price = roundValue(amountEur, 2);
  const rate = roundValue(eurMidRate, 6);

  if (price === null || rate === null || rate <= 0) {
    return null;
  }

  return roundValue(price * rate, 2);
}

function buildApiUrl() {
  const baseUrl = new URL(config.nbpApiBaseUrl);
  const pathname = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
  baseUrl.pathname = `${pathname}exchangerates/rates/a/eur/`;
  baseUrl.searchParams.set('format', 'json');
  return baseUrl.toString();
}

async function fetchEurExchangeRate(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API nie jest dostepne w tym runtime.');
  }

  const response = await fetchImpl(buildApiUrl(), {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(config.nbpRequestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`NBP API zwrocilo status ${response.status}.`);
  }

  const payload = await response.json();
  const rate = payload && Array.isArray(payload.rates) ? payload.rates[0] : null;
  const mid = roundValue(rate && rate.mid, 4);

  if (mid === null || mid <= 0) {
    throw new Error('NBP API nie zwrocilo poprawnego kursu EUR.');
  }

  return {
    table: payload.table || 'A',
    code: payload.code || 'EUR',
    currency: payload.currency || 'euro',
    mid,
    no: rate && rate.no ? rate.no : null,
    effectiveDate: rate && rate.effectiveDate ? rate.effectiveDate : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function getEurExchangeRate(options = {}) {
  const { fetchImpl } = options;
  const now = Date.now();

  if (CACHE.value && CACHE.expiresAt > now) {
    return CACHE.value;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
    try {
      const rateInfo = await fetchEurExchangeRate(fetchImpl);
      CACHE.value = rateInfo;
      CACHE.expiresAt = Date.now() + config.nbpCacheTtlMs;
      return rateInfo;
    } catch (_error) {
      if (CACHE.value) {
        return {
          ...CACHE.value,
          stale: true,
        };
      }

      return null;
    } finally {
      pendingRequest = null;
    }
  })();

  return pendingRequest;
}

function clearExchangeRateCache() {
  CACHE.value = null;
  CACHE.expiresAt = 0;
  pendingRequest = null;
}

function resolvePricePair(amountPln, amountEur, eurRate) {
  const normalizedPln = roundValue(amountPln, 2);
  const normalizedEur = roundValue(amountEur, 2);

  if (normalizedPln !== null || normalizedEur !== null) {
    return {
      pln: normalizedPln !== null ? normalizedPln : convertEurToPln(normalizedEur, eurRate),
      eur: normalizedEur !== null ? normalizedEur : convertPlnToEur(normalizedPln, eurRate),
    };
  }

  return {
    pln: null,
    eur: null,
  };
}

function enrichVehiclePrices(vehicle, rateInfo) {
  const eurRate = rateInfo && Number.isFinite(rateInfo.mid) ? rateInfo.mid : null;
  const totalPrice = resolvePricePair(vehicle.totalPricePln, vehicle.totalPriceEur, eurRate);
  const basePrice = resolvePricePair(vehicle.basePricePln, vehicle.basePriceEur, eurRate);

  return {
    ...vehicle,
    totalPricePln: totalPrice.pln,
    totalPriceEur: totalPrice.eur,
    basePricePln: basePrice.pln,
    basePriceEur: basePrice.eur,
    exchangeRateEurPln: eurRate,
    exchangeRateEffectiveDate: rateInfo ? rateInfo.effectiveDate : null,
    exchangeRateTableNo: rateInfo ? rateInfo.no : null,
    exchangeRateIsStale: Boolean(rateInfo && rateInfo.stale),
  };
}

module.exports = {
  clearExchangeRateCache,
  convertEurToPln,
  convertPlnToEur,
  enrichVehiclePrices,
  fetchEurExchangeRate,
  getEurExchangeRate,
};
