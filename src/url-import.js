const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { extractVehicleFromPdf, extractVehicleFromSourceText } = require('./gemini');
const { normalizeVehicleExtraction } = require('./schema');

const REQUEST_HEADERS = {
  'user-agent': 'electric.motometr.pl/1.0 (+https://electric.motometr.pl)',
  accept: 'text/html,application/pdf,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
};

function normalizeHttpUrl(input) {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('Podaj link do konfiguracji.');
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withProtocol);

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('Obslugiwane sa tylko linki HTTP i HTTPS.');
  }

  return parsed.toString();
}

function extractMetaRefreshUrl(html, baseUrl) {
  const match = String(html || '').match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i
  );

  if (!match || !match[1]) {
    return null;
  }

  try {
    return new URL(match[1].trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

function collectUrlParams(inputUrl) {
  const parsed = new URL(inputUrl);
  const merged = new URLSearchParams(parsed.search);
  const hashQuery = parsed.hash.includes('?') ? parsed.hash.split('?')[1] : '';

  if (hashQuery) {
    const hashParams = new URLSearchParams(hashQuery);
    for (const [key, value] of hashParams.entries()) {
      merged.append(key, value);
    }
  }

  return merged;
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function roundMoney(value) {
  const parsed = parseDecimal(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseHondaPricePair(value) {
  const [left, right] = String(value || '')
    .split(';')
    .map((item) => roundMoney(item));

  return {
    primary: left || 0,
    secondary: right || 0,
  };
}

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sumMoney(values) {
  return values.reduce((total, value) => total + (roundMoney(value) || 0), 0);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Nie udalo sie pobrac danych producenta (${response.status}).`);
  }

  return response.json();
}

async function fetchRemoteDocument(inputUrl, depth = 0) {
  const response = await fetch(inputUrl, {
    headers: REQUEST_HEADERS,
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Link konfiguracji przekierowal bez docelowego adresu (${response.status}).`);
    }

    if (depth >= 5) {
      throw new Error('Przekroczono limit przekierowan dla linku konfiguracji.');
    }

    return fetchRemoteDocument(new URL(location, inputUrl).toString(), depth + 1);
  }

  if (!response.ok) {
    throw new Error(`Nie udalo sie pobrac konfiguracji z linku (${response.status}).`);
  }

  const finalUrl = inputUrl;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/pdf') || /\.pdf(?:$|\?)/i.test(finalUrl)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      kind: 'pdf',
      finalUrl,
      contentType,
      buffer,
      originalName: path.basename(new URL(finalUrl).pathname) || 'configuration.pdf',
    };
  }

  const text = await response.text();
  const refreshUrl = extractMetaRefreshUrl(text, finalUrl);

  if (refreshUrl && refreshUrl !== finalUrl && depth < 2) {
    return fetchRemoteDocument(refreshUrl, depth + 1);
  }

  return {
    kind: 'html',
    finalUrl,
    contentType,
    text,
  };
}

function extractHondaApiContext(html) {
  const match = String(html || '').match(
    /https:\/\/configurator-api\.honda\.eu\/configurator\/v1\/data\/live\/([^/]+)\/cars\/models\/([^/]+)\/([^/]+)\//i
  );

  if (!match) {
    return null;
  }

  return {
    locale: match[1],
    modelCode: match[2],
    modelYear: match[3],
    baseUrl: `https://configurator-api.honda.eu/configurator/v1/data/live/${match[1]}/cars/models/${match[2]}/${match[3]}`,
  };
}

function flattenHondaEquipment(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections.flatMap((section) =>
    Array.isArray(section.items)
      ? section.items
          .filter((item) => item && item.standard && item.name)
          .map((item) => item.name)
      : []
  );
}

function findHondaSpecValue(specSections, matcher) {
  if (!Array.isArray(specSections)) {
    return null;
  }

  for (const section of specSections) {
    for (const item of section.items || []) {
      if (matcher.test(String(item.name || ''))) {
        return item.value;
      }
    }
  }

  return null;
}

function parsePowerPair(value) {
  const match = String(value || '').match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (!match) {
    return { hp: null, kw: null };
  }

  return {
    hp: parseDecimal(match[1]),
    kw: parseDecimal(match[2]),
  };
}

async function extractHondaVehicle(finalUrl, html) {
  const apiContext = extractHondaApiContext(html);
  if (!apiContext) {
    throw new Error('Nie rozpoznano konfiguratora Honda.');
  }

  const params = collectUrlParams(finalUrl);
  const grade = params.get('grade');
  const engine = params.get('engine');

  if (!grade || !engine) {
    throw new Error('Brakuje parametrow wersji Honda w linku.');
  }

  const carData = await fetchJson(
    `${apiContext.baseUrl}/cars?grade=${encodeURIComponent(grade)}&etd=${encodeURIComponent(engine)}`
  );
  const specsData = await fetchJson(`${apiContext.baseUrl}/cars/${carData.code}/specsandequipment`);
  const accessoriesData = await fetchJson(
    `${apiContext.baseUrl}/cars/${carData.code}/accessorieswithoutfeatured`
  );

  const selectedColourCode = params.get('colour');
  const selectedColour = (carData.colours || []).find(
    (colour) => normalizeCode(colour.code) === normalizeCode(selectedColourCode)
  );
  const selectedExterior = selectedColour
    ? (carData.exteriors || []).find((item) => item.code === selectedColour.exterior)
    : null;
  const selectedInterior = selectedColour
    ? (carData.interiors || []).find((item) => item.code === selectedColour.interior)
    : null;

  const selectedAccessoryCodes = params.getAll('accessories').map(normalizeCode);
  const selectedAccessories = (accessoriesData.accessories || []).filter((item) =>
    selectedAccessoryCodes.includes(normalizeCode(item.partNumber))
  );

  const accessoryPackages = selectedAccessories
    .filter((item) => /pakiet/i.test(item.group || '') || /pakiet/i.test(item.title || ''))
    .map((item) => item.title);
  const accessoryOptions = selectedAccessories
    .filter((item) => !/pakiet/i.test(item.group || '') && !/pakiet/i.test(item.title || ''))
    .map((item) => item.title);

  const selectedWheels =
    selectedAccessories.find((item) => item.type === 'wheels') ||
    (accessoriesData.accessories || []).find((item) => item.standard && item.type === 'wheels') ||
    null;

  const colourPrice = selectedColour ? parseHondaPricePair(selectedColour.price).primary : 0;
  const totalPrice =
    roundMoney(carData.price) +
    colourPrice +
    sumMoney(selectedAccessories.map((item) => item.price));

  const power = parsePowerPair(findHondaSpecValue(specsData.specs, /Moc maksymalna/i));

  return normalizeVehicleExtraction({
    brand: 'Honda',
    model: carData.modelName || 'e:Ny1',
    versionName: carData.gradeName || grade,
    displayName: ['Honda', carData.modelName || 'e:Ny1', carData.gradeName || grade]
      .filter(Boolean)
      .join(' '),
    currency: 'PLN',
    basePricePln: roundMoney(carData.price),
    totalPricePln: totalPrice,
    powerKw: power.kw,
    powerHp: power.hp,
    torqueNm: findHondaSpecValue(specsData.specs, /moment obrotowy/i),
    rangeWltpKm: findHondaSpecValue(specsData.specs, /Zasi.g .*WLTP.*mieszany/i),
    batteryCapacityKwh: findHondaSpecValue(specsData.specs, /Pojemn.*akumulatora/i),
    energyConsumptionKwh100km: findHondaSpecValue(specsData.specs, /zu.ycie energii.*mieszany/i),
    seats: findHondaSpecValue(specsData.specs, /Liczba miejsc/i),
    fuelType: 'Elektryczny',
    technicalType: carData.engineName || engine,
    exteriorColor: selectedExterior ? selectedExterior.name : null,
    exteriorColorPricePln: colourPrice || null,
    wheels: selectedWheels ? selectedWheels.title : null,
    wheelsPricePln: selectedWheels ? roundMoney(selectedWheels.price) : null,
    interiorTrim: selectedInterior ? selectedInterior.name : null,
    interiorPricePln: selectedColour ? parseHondaPricePair(selectedColour.price).secondary : null,
    standardEquipment: flattenHondaEquipment(specsData.equipment),
    additionalEquipment: accessoryOptions,
    equipmentPackages: accessoryPackages,
    configurationCode: carData.code,
    notes: ['Import z linku Honda'],
    warnings: [],
  });
}

function walkFordSpecEntries(node, output = []) {
  if (!node || typeof node !== 'object') {
    return output;
  }

  if (node.name && node.unitTypes) {
    output.push(node);
  }

  if (node.children && typeof node.children === 'object') {
    for (const child of Object.values(node.children)) {
      walkFordSpecEntries(child, output);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'children' || key === 'unitTypes') {
      continue;
    }

    if (value && typeof value === 'object') {
      walkFordSpecEntries(value, output);
    }
  }

  return output;
}

function findFordSpecEntry(specs, matcher) {
  const entries = walkFordSpecEntries(specs);
  return entries.find((entry) => matcher.test(String(entry.name || ''))) || null;
}

function findFordSpecEntryByPhrases(specs, phrases) {
  const entries = walkFordSpecEntries(specs);
  const normalizedPhrases = phrases.map((phrase) => normalizeSearchText(phrase));

  return (
    entries.find((entry) => {
      const normalizedName = normalizeSearchText(entry.name);
      return normalizedPhrases.some((phrase) => normalizedName.includes(phrase));
    }) || null
  );
}

function pickFordUnitValue(entry, preferredUnits = []) {
  if (!entry || !entry.unitTypes) {
    return null;
  }

  for (const unit of preferredUnits) {
    if (entry.unitTypes[unit] && entry.unitTypes[unit].value !== undefined) {
      return entry.unitTypes[unit].value;
    }
  }

  const first = Object.values(entry.unitTypes)[0];
  return first && first.value !== undefined ? first.value : null;
}

function buildFordConfigToken(inputUrl) {
  const parsed = new URL(inputUrl);
  const catalogId = parsed.searchParams.get('catalogId');
  const series = parsed.searchParams.get('series');
  const trim = parsed.searchParams.get('trim');
  const powertrain = parsed.searchParams.get('powertrain');
  const bodystyle = parsed.searchParams.get('bodystyle');
  const paint = parsed.searchParams.get('paint');
  const features = parsed.searchParams.getAll('features');

  if (!catalogId || !series || !trim || !powertrain || !bodystyle || !paint) {
    throw new Error('Brakuje parametrow konfiguracji Ford w linku.');
  }

  return `${catalogId}~${[series, trim, powertrain, bodystyle, paint, ...features].join(',')}`;
}

function getFordFeatureLabel(feature) {
  return feature.descKf || feature.name || feature.desc || null;
}

function isFordStructuralGroup(groupCode) {
  return ['series', 'bodystyle', 'drive', 'entity', 'ecomm', 'ecomm-ftype', 'paint', 'trim'].includes(
    groupCode
  );
}

async function extractFordVehicle(finalUrl) {
  const configToken = buildFordConfigToken(finalUrl);
  const endpoint =
    'https://www.servicescache.ford.com/api/vehicle-model/v3/load?' +
    new URLSearchParams({
      locale: 'pl_PL',
      retrieve:
        'images,specs,featuresMkt,selectedMkt,featureImages,featureSpecs,keyFeatures,keyFeaturesModel,keyFeaturesWalkup,uscCodes,prices,featurePrices,content',
      config: configToken,
      expConditions: '2d-background',
      namedConfig: 'default',
    }).toString();

  const payload = await fetchJson(endpoint);
  const data = payload.data || {};
  const marketingGroups = Array.isArray(data.features && data.features.byMarketing)
    ? data.features.byMarketing
    : [];
  const walkupFeatures =
    (((data.keyFeatures || {}).walkup || {}).combined || {}).features || [];

  const versionFeature =
    marketingGroups.find((group) => group.code === 'series')?.features?.find((feature) => feature.state === 'S') ||
    null;
  const paintFeature =
    marketingGroups.find((group) => group.code === 'paint')?.features?.find((feature) => feature.state === 'S') ||
    null;
  const trimFeature =
    marketingGroups.find((group) => group.code === 'trim')?.features?.find((feature) => feature.state === 'S') ||
    null;

  const selectedFeatureEntries = marketingGroups.flatMap((group) => {
    if (isFordStructuralGroup(group.code)) {
      return [];
    }

    return (group.features || []).filter(
      (feature) =>
        feature.state === 'S' &&
        getFordFeatureLabel(feature) &&
        roundMoney(feature.featurePrice && feature.featurePrice.basePrice && feature.featurePrice.basePrice.grossRetail) !==
          null
    );
  });

  const standardEquipment = walkupFeatures
    .filter((feature) => feature.state === 'I' && getFordFeatureLabel(feature))
    .map((feature) => getFordFeatureLabel(feature));

  const equipmentPackages = selectedFeatureEntries
    .filter((feature) => /pakiet/i.test(getFordFeatureLabel(feature)))
    .map((feature) => getFordFeatureLabel(feature));

  const additionalEquipment = selectedFeatureEntries
    .filter((feature) => !/pakiet/i.test(getFordFeatureLabel(feature)))
    .map((feature) => getFordFeatureLabel(feature));

  const wheelsFeature =
    walkupFeatures.find((feature) => /obr.cze|felgi/i.test(getFordFeatureLabel(feature) || '')) ||
    selectedFeatureEntries.find((feature) => /obr.cze|felgi/i.test(getFordFeatureLabel(feature) || '')) ||
    null;

  const powerEntry = findFordSpecEntry(data.specs, /Moc maksymalna/i);
  const batteryEntry = findFordSpecEntryByPhrases(data.specs, [
    'uzyteczna pojemnosc baterii',
    'pojemnosc baterii',
  ]);
  const rangeEntry = findFordSpecEntryByPhrases(data.specs, [
    'zasieg elektryczny (cykl mieszany)',
    'maksymalny zasieg w cyklu miejskim (wltp)',
  ]);
  const consumptionEntry = findFordSpecEntryByPhrases(data.specs, [
    'zuzycie energii elektrycznej',
    'zuzycie energii',
  ]);
  const transmissionEntry = findFordSpecEntryByPhrases(data.specs, ['skrzynia biegow']);
  const fuelEntry = findFordSpecEntryByPhrases(data.specs, ['rodzaj paliwa']);

  return normalizeVehicleExtraction({
    brand: 'Ford',
    model: data.props ? data.props['nameplate-label'] : null,
    versionName: versionFeature ? versionFeature.name : null,
    displayName: ['Ford', data.props ? data.props['nameplate-label'] : null, versionFeature ? versionFeature.name : null]
      .filter(Boolean)
      .join(' '),
    currency: 'PLN',
    basePricePln: data.price && data.price.basePrice ? data.price.basePrice.grossRetail : null,
    totalPricePln:
      (((data.price || {}).finalPrice || {}).recommendedOTRPromotionalPriceWithAccessories ||
        ((data.price || {}).finalPrice || {}).recommendedOTRPromotionalPrice ||
        (((data.price || {}).totalPriceWithIncentives || {}).grossRetailWithAccessories || null)),
    powerKw: pickFordUnitValue(powerEntry, ['kW', 'kw']),
    powerHp: pickFordUnitValue(powerEntry, ['PS']),
    torqueNm: pickFordUnitValue(findFordSpecEntry(data.specs, /moment obrotowy/i), ['Nm']),
    rangeWltpKm: pickFordUnitValue(rangeEntry, ['km', 'Km']),
    batteryCapacityKwh: pickFordUnitValue(batteryEntry, ['kWh']),
    energyConsumptionKwh100km: pickFordUnitValue(consumptionEntry, ['kWh100km', 'kWh/100km', 'kWh100Km']),
    seats: pickFordUnitValue(findFordSpecEntry(data.specs, /Liczba miejsc/i), ['seats']),
    fuelType: pickFordUnitValue(fuelEntry, ['-']),
    technicalType: pickFordUnitValue(transmissionEntry, ['-']),
    exteriorColor: paintFeature ? paintFeature.name : null,
    wheels: wheelsFeature ? getFordFeatureLabel(wheelsFeature) : null,
    interiorTrim: trimFeature ? trimFeature.name : null,
    standardEquipment,
    additionalEquipment,
    equipmentPackages,
    configurationCode: data.props ? data.props['catalog-id'] : null,
    notes: ['Import z linku Ford'],
    warnings: [],
  });
}

function decodeHtmlEntities(input) {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function buildHtmlTextSnapshot(sourceUrl, finalUrl, html) {
  const stripped = decodeHtmlEntities(String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const relevantLines = stripped
    .filter((line) =>
      /(cena|price|wltp|kwh|km|bateria|battery|wypos|equipment|pakiet|range|model|konfigurator|trim|kolor|color|moc|power)/i.test(
        line
      )
    )
    .slice(0, 200);

  const params = collectUrlParams(finalUrl);
  const serializedParams = [...params.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');

  return [
    `URL zgloszony przez uzytkownika: ${sourceUrl}`,
    `URL po przekierowaniach: ${finalUrl}`,
    serializedParams ? `Parametry konfiguracji:\n${serializedParams}` : '',
    'Najwazniejsze fragmenty strony:',
    relevantLines.join('\n').slice(0, 18000),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function importVehicleFromUrl(sourceUrl) {
  const normalizedUrl = normalizeHttpUrl(sourceUrl);
  const remote = await fetchRemoteDocument(normalizedUrl);

  if (remote.kind === 'pdf') {
    const tempFilePath = path.join(os.tmpdir(), `electric-${randomUUID()}.pdf`);
    await fs.writeFile(tempFilePath, remote.buffer);

    try {
      const extraction = await extractVehicleFromPdf(tempFilePath, remote.originalName || 'configuration.pdf');
      return {
        ...extraction,
        resolvedUrl: remote.finalUrl,
        parser: 'remote-pdf',
      };
    } finally {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
    }
  }

  try {
    if (/\.honda\./i.test(new URL(remote.finalUrl).hostname) && extractHondaApiContext(remote.text)) {
      return {
        vehicles: [
          {
            id: randomUUID(),
            ...await extractHondaVehicle(remote.finalUrl, remote.text),
          },
        ],
        resolvedUrl: remote.finalUrl,
        parser: 'honda',
      };
    }

    if (/\.ford\./i.test(new URL(remote.finalUrl).hostname)) {
      return {
        vehicles: [
          {
            id: randomUUID(),
            ...await extractFordVehicle(remote.finalUrl),
          },
        ],
        resolvedUrl: remote.finalUrl,
        parser: 'ford',
      };
    }
  } catch (error) {
    return {
      ...(await extractVehicleFromSourceText(
        remote.finalUrl,
        buildHtmlTextSnapshot(normalizedUrl, remote.finalUrl, remote.text)
      )),
      resolvedUrl: remote.finalUrl,
      parser: 'fallback-text',
      warnings: [error.message],
    };
  }

  return {
    ...(await extractVehicleFromSourceText(
      remote.finalUrl,
      buildHtmlTextSnapshot(normalizedUrl, remote.finalUrl, remote.text)
    )),
    resolvedUrl: remote.finalUrl,
    parser: 'generic-html',
  };
}

module.exports = {
  importVehicleFromUrl,
};
