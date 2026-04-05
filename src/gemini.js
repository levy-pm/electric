const { randomUUID } = require('crypto');
const { GoogleGenAI, createPartFromUri, createUserContent } = require('@google/genai');
const { config, validateConfig } = require('./config');
const { geminiVehicleResponseJsonSchema, normalizeVehicleExtraction } = require('./schema');

function buildPrompt(originalName) {
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
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        buildPrompt(originalName),
      ]),
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
  } finally {
    if (uploadedFile && uploadedFile.name) {
      await ai.files.delete({ name: uploadedFile.name }).catch(() => {});
    }
  }
}

module.exports = {
  extractVehicleFromPdf,
};
