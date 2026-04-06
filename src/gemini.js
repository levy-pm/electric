const { randomUUID } = require('crypto');
const { GoogleGenAI, createPartFromUri, createUserContent } = require('@google/genai');
const { config, validateConfig } = require('./config');
const { geminiVehicleResponseJsonSchema, normalizeVehicleExtraction } = require('./schema');

function buildPdfPrompt(originalName) {
  return [
    'Przeanalizuj zalaczony PDF konfiguratora auta elektrycznego.',
    `Nazwa pliku: ${originalName}.`,
    'Zwracaj tylko dane, ktore sa jawnie widoczne w PDF albo da sie je wywnioskowac z bardzo wysoka pewnoscia.',
    'Jesli pole jest nieznane, pomin je. Nie zgaduj.',
    'Ceny zwracaj jako liczby calkowite w PLN bez spacji i waluty.',
    'Moc zwracaj osobno w kW i KM, zasieg w km WLTP, zuzycie energii w kWh/100 km, bateria w kWh.',
    'additionalEquipment to platne lub wybrane opcje dodatkowe.',
    'standardEquipment to wyposazenie podstawowe samochodu.',
    'equipmentPackages to same nazwy pakietow.',
    'Kazdy element wyposazenia zwracaj jako osobny item tablicy.',
    'Nie zwracaj kilku cech w jednym wpisie tylko dlatego, ze staly obok siebie w PDF.',
    'Uzywaj powtarzalnych, kanonicznych etykiet funkcji, np. "Wyświetlacz HUD", "Pompa ciepła", "Podgrzewana kierownica".',
    'displayName powinno byc pelna nazwa skonfigurowanej wersji.',
    'basePricePln to cena bazowej wersji z podsumowania wersji.',
    'totalPricePln to finalna cena konfiguracji.',
    'configurationCode i sourceDate wypelnij tylko, gdy sa w PDF.',
    'W notes wpisz rzeczy przydatne, ktorych nie ma w polach glownych.',
    'W warnings wpisz watpliwosci, np. brak ceny bazowej albo brak baterii.',
  ].join(' ');
}

function buildTextPrompt(sourceLabel, sourceText) {
  return [
    'Przeanalizuj tekst z konfiguratora auta elektrycznego.',
    `Zrodlo: ${sourceLabel}.`,
    'Tekst moze pochodzic ze strony producenta albo z wyciagu HTML.',
    'Bierz pod uwage tylko informacje, ktore sa jednoznaczne w tresci.',
    'Jesli pole jest nieznane, pomin je. Nie zgaduj.',
    'Ceny zwracaj jako liczby calkowite w PLN bez spacji i waluty.',
    'Moc zwracaj osobno w kW i KM, zasieg w km WLTP, zuzycie energii w kWh/100 km, bateria w kWh.',
    'additionalEquipment to platne lub wybrane opcje dodatkowe.',
    'standardEquipment to wyposazenie podstawowe samochodu.',
    'equipmentPackages to same nazwy pakietow.',
    'Kazdy element wyposazenia zwracaj jako osobny item tablicy.',
    'Uzywaj powtarzalnych, kanonicznych etykiet funkcji, np. "Wyswietlacz HUD", "Pompa ciepla", "Podgrzewana kierownica".',
    'displayName powinno byc pelna nazwa skonfigurowanej wersji.',
    'basePricePln to cena bazowej wersji z podsumowania wersji.',
    'totalPricePln to finalna cena konfiguracji.',
    'configurationCode i sourceDate wypelnij tylko, gdy sa jawnie podane.',
    'W notes wpisz rzeczy przydatne, ktorych nie ma w polach glownych.',
    'W warnings wpisz watpliwosci, np. brak ceny bazowej albo brak baterii.',
    'PONIZEJ TRESC ZRODLOWA:',
    sourceText,
  ].join('\n\n');
}

async function generateVehicleExtraction(contents) {
  validateConfig({ allowMissingGemini: false });
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents,
    config: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseJsonSchema: geminiVehicleResponseJsonSchema,
    },
  });

  const rawText = (response && response.text ? response.text : '').trim();
  if (!rawText) {
    throw new Error('Gemini nie zwrocil danych.');
  }

  const parsedPayload = JSON.parse(rawText);
  const normalizedVehicle = normalizeVehicleExtraction(parsedPayload);

  return {
    rawText,
    rawPayload: parsedPayload,
    vehicles: [
      {
        id: randomUUID(),
        ...normalizedVehicle,
      },
    ],
  };
}

async function extractVehicleFromPdf(filePath, originalName) {
  validateConfig({ allowMissingGemini: false });
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const uploadedFile = await ai.files.upload({
    file: filePath,
    config: {
      mimeType: 'application/pdf',
      displayName: originalName,
    },
  });

  try {
    return generateVehicleExtraction(
      createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        buildPdfPrompt(originalName),
      ])
    );
  } finally {
    if (uploadedFile && uploadedFile.name) {
      await ai.files.delete({ name: uploadedFile.name }).catch(() => {});
    }
  }
}

async function extractVehicleFromSourceText(sourceLabel, sourceText) {
  const trimmedText = String(sourceText || '').trim();
  if (!trimmedText) {
    throw new Error('Brak tresci do analizy.');
  }

  return generateVehicleExtraction(buildTextPrompt(sourceLabel, trimmedText));
}

async function findCombustionEquivalents(brand, model) {
  if (!brand && !model) {
    return [];
  }

  validateConfig({ allowMissingGemini: false });
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const carName = [brand, model].filter(Boolean).join(' ');
  const prompt = [
    `Znajdź auta spalinowe (benzyna lub diesel) o podobnych gabarytach i segmencie rynkowym do elektrycznego ${carName}.`,
    'Skorzystaj z aktualnych informacji, uwzględniając wymiary, kategorię nadwozia i pozycję cenową.',
    'Podaj dokładnie 3-5 konkretnych modeli spalinowych jako tablicę JSON: ["Marka Model", ...].',
    'Odpowiedz TYLKO surową tablicą JSON, bez opisu, bez markdown.',
  ].join(' ');

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = (response.text || '').trim();
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean)
          .slice(0, 5);
      }
    }
  } catch {
    // Brak odpowiedzi lub błąd parsowania — zwracamy pustą listę
  }

  return [];
}

module.exports = {
  extractVehicleFromPdf,
  extractVehicleFromSourceText,
  findCombustionEquivalents,
};
