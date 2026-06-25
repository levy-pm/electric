# Dokumentacja techniczna

## 1. Przegląd architektury

`electric` to monolityczna aplikacja Node.js (CommonJS) oparta na Express 5. Renderuje statyczny frontend (`public/`) i udostępnia REST API. Dane trzyma w MariaDB albo w pamięci procesu (`memory`). Analizę PDF i tekstu wykonuje Gemini Developer API. Kursy walut pochodzą z publicznego API NBP.

```
┌────────────┐    HTTP     ┌─────────────────────────────────────────┐
│ Przeglądarka│ ──────────▶ │ Express (src/server.js)                  │
│ public/*    │ ◀────────── │  • statyki + /vendor/tabulator           │
└────────────┘   JSON       │  • REST API                              │
                            │  • rate limit, noindex, error handler    │
                            └───┬───────────┬───────────┬──────────────┘
                                │           │           │
                      ┌─────────▼──┐ ┌──────▼─────┐ ┌───▼──────────┐
                      │ gemini.js  │ │ store.js   │ │ nbp.js       │
                      │ Gemini API │ │ MariaDB /  │ │ kurs EUR     │
                      │ + url-import│ │ memory     │ │ (cache)      │
                      └─────────────┘ └────────────┘ └──────────────┘
                                │
                      ┌─────────▼───────────┐
                      │ schema.js / equipment.js / recommendation.js │
                      │ normalizacja, kanonizacja, scoring           │
                      └──────────────────────────────────────────────┘
```

## 2. Struktura katalogów

```
electric/
├─ server.js               # punkt wejścia – startuje serwer
├─ src/
│  ├─ server.js            # budowa aplikacji Express, routing, middleware
│  ├─ config.js            # odczyt i walidacja zmiennych środowiskowych
│  ├─ store.js             # warstwa danych: MariaDB + tryb memory
│  ├─ gemini.js            # integracja z Gemini, retry, pula kluczy
│  ├─ url-import.js        # pobieranie linków, parsery Honda/Ford, fallback HTML
│  ├─ schema.js            # walidacja (Zod) + normalizacja rekordu pojazdu
│  ├─ equipment.js         # kanonizacja etykiet i budowa wpisów wyposażenia
│  ├─ recommendation.js    # scoring „value for money”, liderzy, odznaki
│  ├─ security.js          # nagłówki bezpieczeństwa, rate limity, ochrona SSRF
│  └─ nbp.js               # kurs EUR z NBP, cache, przeliczenia PLN↔EUR
├─ public/                 # frontend: index.html, app.js, styles.css, favicon
├─ scripts/
│  ├─ deploy-runner.js     # uruchamia pull-and-build.sh (cross-platform)
│  ├─ pull-and-build.sh    # samoleczący deploy (git reset + npm ci + restart)
│  └─ import-pdfs.js       # masowy import PDF z CLI
├─ test/                   # testy: equipment, recommendation, nbp, gemini, ux
├─ storage/                # uploads/ i logs/ (runtime, ignorowane w git)
├─ tmp/                    # restart.txt, deploy-meta.json, deploy.lock
├─ .htaccess               # konfiguracja Passenger (CloudLinux)
└─ .env.example            # szablon konfiguracji
```

## 3. Konfiguracja (`src/config.js`)

- Wszystkie ustawienia pochodzą ze zmiennych środowiskowych z sensownymi domyślnymi.
- `DB_MODE` domyślnie `memory`, ale przełącza się na `mariadb`, jeśli ustawiono `DB_NAME`.
- `parseGeminiApiKeys()` buduje pulę kluczy z `GEMINI_API_KEYS` (lista po przecinku) lub z `GEMINI_API_KEY` / `GOOGLE_API_KEY`, usuwając duplikaty.
- `validateConfig({ allowMissingGemini })` sprawdza komplet pól bazy przy `mariadb` i obecność klucza Gemini (chyba że jawnie dopuszczono brak – tak działa `npm run check`).

Pełna lista zmiennych: [README › Konfiguracja](../README.md#konfiguracja-zmienne-środowiskowe).

## 4. Warstwa danych (`src/store.js`)

Jedno API (`initStore`, `createUpload`, `markUploadCompleted/Failed`, `listVehicles`, `getVehicleById`, `updateVehicle`, `deleteVehicle`, `listEquipmentFacets`, `getUploadById`) z dwiema implementacjami: pamięciową i MariaDB.

### 4.1 Tryb `memory`

Dane w `Map`-ach (`uploads`, `vehicles`, `equipmentItems`, `vehicleEquipment`). Znikają po restarcie. Przeznaczony do dev i testów.

### 4.2 Tryb `mariadb`

Pula `mysql2/promise` (limit 10 połączeń, `namedPlaceholders`). Schemat tworzony idempotentnie przy starcie (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

Tabele:

- **`uploads`** – źródło rekordu (`source_type`: upload/url/manual), status parsowania (`pending`/`processing`/`completed`/`failed`), metadane pliku, błąd parsowania.
- **`vehicles`** – pełny rekord pojazdu; listy (wyposażenie, notatki, ostrzeżenia, odpowiedniki) trzymane jako kolumny `JSON`. FK do `uploads` z `ON DELETE CASCADE`.
- **`equipment_items`** – katalog unikalnych pozycji wyposażenia (`slug` UNIQUE, `label`).
- **`vehicle_equipment`** – tabela łącząca pojazd z pozycją wyposażenia, z typem (`standard`/`additional`/`package`) i kolejnością; indeks po `equipment_item_id`.

Zapis pojazdów w `markUploadCompleted` jest transakcyjny: kasuje poprzednie rekordy danego uploadu, wstawia nowe, upsertuje pozycje wyposażenia i ustawia status uploadu na `completed`. Błąd → rollback.

`listEquipmentFacets` zwraca pozycje wyposażenia z licznikiem użycia (do filtra na froncie) – w MariaDB przez `GROUP BY`, w memory przez agregację w pamięci.

## 5. Ekstrakcja danych

### 5.1 Gemini (`src/gemini.js`)

- **Klient:** `@google/genai`, model z `GEMINI_MODEL`, `temperature: 0.1`, wymuszony `responseMimeType: application/json` ze schematem JSON (`schema.js`).
- **PDF:** plik jest wysyłany przez File API (`ai.files.upload`), aplikacja czeka aż stan pliku będzie `ACTIVE` (`waitForUploadedFileReady`, polling), generuje ekstrakcję, a na końcu **usuwa** wgrany plik z Gemini.
- **Tekst:** `extractVehicleFromSourceText` – analiza wyciągu HTML przy fallbacku linków.
- **Odporność:**
  - `retryGeminiOperation` – ponowienia z backoffem wykładniczym dla błędów przejściowych (`429`, `503`, 5xx, „high demand”, „try again later”, „permission to access the file”).
  - `runGeminiOperationAcrossKeys` – po wyczerpaniu limitu/przeciążeniu jednego klucza przechodzi do kolejnego z puli.
  - `normalizeGeminiError` – mapuje błędy na czytelne komunikaty PL i odróżnia limit (nie-retryowalny) od przeciążenia (retryowalny). Limit kwoty **nie** jest mylony z błędem PDF.
- **Odpowiedniki spalinowe:** `findCombustionEquivalents` używa Gemini z `googleSearch`, z twardym timeoutem 15 s i fallbackiem do pustej listy (nie blokuje importu).

### 5.2 Import z linku (`src/url-import.js`)

1. `normalizeHttpUrl` – wymusza http/https.
2. `fetchRemoteDocument` – pobiera dokument, ręcznie obsługuje przekierowania (limit 5) i `<meta refresh>` (limit 2). Wykrywa PDF po `content-type` lub rozszerzeniu.
3. Routing:
   - **PDF** → zapis do pliku tymczasowego i ścieżka `extractVehicleFromPdf`.
   - **Honda** (`extractHondaApiContext` wykrywa kontekst) → bezpośrednie wywołania `configurator-api.honda.eu` (cars, specsandequipment, accessories) i złożenie rekordu z parametrów URL (grade, engine, colour, accessories).
   - **Ford** → `servicescache.ford.com/api/vehicle-model/v3/load` z tokenem konfiguracji zbudowanym z parametrów URL; przejście po strukturze `specs` i grupach marketingowych.
   - **Fallback** → `buildHtmlTextSnapshot` wyciąga istotne linie (cena, WLTP, kWh, wyposażenie itd.) i oddaje je Gemini jako tekst. Każdy wynik niesie `parser` (`remote-pdf`/`honda`/`ford`/`generic-html`/`fallback-text`).

### 5.3 Normalizacja (`src/schema.js`)

- Wejście walidowane Zodem (`extractedVehicleSchema`), gdzie liczby mogą przyjść jako string.
- `normalizeNumber`/`normalizeInteger` czyszczą formaty (separatory tysięcy, przecinek dziesiętny).
- `deriveDisplayName` buduje nazwę z marki/modelu/wersji, gdy brak jawnej.
- `calculateEquipmentScore` liczy wynik wyposażenia (1/2/3 za standard/dodatkowe/pakiety).
- Listy wyposażenia przechodzą przez `canonicalizeEquipmentList`.

### 5.4 Wyposażenie (`src/equipment.js`)

- `slugify` – slug ASCII z limitem 255 znaków (skraca i dokleja skrót SHA-1 dla bardzo długich etykiet, co chroni UNIQUE w bazie).
- `canonicalizeEquipmentLabel` – ujednolica wielkość liter, zachowuje akronimy (HUD, LED, WLTP, V2L…), poprawnie traktuje człony z `-` i `/`, spójniki pisze małą literą.
- `buildEquipmentEntries` – zamienia listy pojazdu na wpisy z typem, kolejnością i slugiem (podstawa tabeli `vehicle_equipment`).

## 6. Scoring i waluty

- **`src/recommendation.js`** – `enrichVehicles` liczy współczynniki cecha/cena, normalizuje min-max, waży (0,40/0,30/0,20/0,10), sortuje malejąco (remis → tańszy), wyznacza liderów i odznaki. Etykiety odznak muszą być zsynchronizowane z `public/app.js` (`LEADER_LABELS`).
- **`src/nbp.js`** – `getEurExchangeRate` pobiera kurs EUR (tabela A), cache z TTL i deduplikacją równoległych żądań (`pendingRequest`); przy błędzie zwraca ostatnią wartość z flagą `stale`. `enrichVehiclePrices` dolicza brakującą walutę i dokleja metadane kursu do rekordu.

> Uwaga: faktyczne wagi rankingu są zdefiniowane wyłącznie w `SCORING_WEIGHTS` w `src/recommendation.js`. Każdy pojazd niesie własny `recommendationBreakdown` z rozbiciem wyniku na składniki.

## 7. REST API

Wszystkie odpowiedzi to JSON. Każda odpowiedź ma nagłówek `X-Robots-Tag: noindex, nofollow, noarchive`. Błędy mają kształt `{ "error": "..." }` ze statusem dobranym przez globalny handler (400 dla błędów PDF/walidacji, 404 dla braków, 500 domyślnie).

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| `GET` | `/healthz` | Healthcheck: tryb, czas, model Gemini, rozmiar puli kluczy, metadane deploya. |
| `GET` | `/api/config` | Konfiguracja dla klienta (nazwa, tryb, limit pliku, model, rozmiar puli kluczy). |
| `GET` | `/api/cars` | Rekordy do tabeli + `summary` (top, liderzy, fasety wyposażenia, kurs, model rekomendacji). Wzbogaca o EUR. |
| `POST` | `/api/upload` | Synchroniczny upload jednego PDF (pole `configurationPdf`). Zwraca dodane rekordy. Rate-limit. |
| `POST` | `/api/upload-async` | Przyjmuje PDF i przetwarza w tle; zwraca `202` z `uploadId` i statusem `processing`. Rate-limit. |
| `GET` | `/api/uploads/:uploadId/status` | Status przetwarzania uploadu; po `completed` zwraca gotowe rekordy. |
| `POST` | `/api/uploads/:uploadId/complete` | Zapisuje gotowy wynik parsowania dla istniejącego uploadu (`vehicles[]`). |
| `GET` | `/api/uploads/:uploadId/file` | Pobiera oryginalny PDF (dla uploadów i wpisów ręcznych z plikiem). |
| `POST` | `/api/import-url` | Import z linku (`{ url }`). Zwraca `parser` i dodane rekordy. Rate-limit. |
| `POST` | `/api/manual` | Ręczny wpis (pola formularza, opcjonalny `configurationFile`). Rate-limit. |
| `PATCH` | `/api/vehicles/:id` | Edycja pojazdu (pola tekstowe, liczbowe, listy). Zwraca zaktualizowany rekord. |
| `DELETE` | `/api/vehicles/:id` | Usunięcie pojazdu. |
| `GET` | `/robots.txt` | `Disallow: /` dla wszystkich robotów. |

Edycja `PATCH` rozróżnia pola: tekstowe (`PATCH_TEXT_FIELDS`), liczbowe (`PATCH_NUMBER_FIELDS`, część zaokrąglana do całości) i tablicowe (`PATCH_ARRAY_FIELDS`). Niepoprawna liczba → `400`.

Limity (patrz §9.2): całe `/api` objęte globalnym limitem; mutacje (`PATCH`/`DELETE`/`complete`) dodatkowo limitem zapisu; upload/import limitem uploadu. Po przekroczeniu limitu endpoint zwraca `429` z komunikatem.

## 8. Frontend (`public/`)

- Statyczny `index.html` + `app.js` (~2,5 tys. linii) + `styles.css`. Brak bundlera; Tabulator serwowany z `node_modules` pod `/vendor/tabulator`.
- Czcionki z Google Fonts (Outfit, Space Grotesk).
- Główne elementy UI: karty podsumowania i liderów, pasek filtrów (szukaj + multi-select wyposażenia), tabela Tabulator, szuflada kolumn, modale (import z zakładkami plik/link/ręcznie, edycja wyposażenia, potwierdzenie usunięcia).
- Wersjonowanie statyk przez query string (`styles.css?v=...`) wymusza odświeżenie cache po deployu.
- Układ kolumn zapisywany w `localStorage`.

## 9. Bezpieczeństwo i odporność

Warstwa bezpieczeństwa jest skupiona w `src/security.js` i wpięta w `src/server.js`. Aplikacja nie ma kont użytkowników, więc nacisk położono na ochronę przed nadużyciem zasobów (rate limiting), atakami na warstwę przeglądarki (nagłówki) i nadużyciem importu z linku (SSRF).

### 9.1 Nagłówki bezpieczeństwa (`securityHeaders`)

Ustawiane na każdej odpowiedzi:

- **Content-Security-Policy** – `default-src 'self'`, `script-src 'self'` (brak inline JS – w kodzie nie ma handlerów `on*=`), `style-src 'self' 'unsafe-inline' fonts.googleapis.com`, `font-src 'self' fonts.gstatic.com`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`.
- **X-Content-Type-Options: nosniff**, **X-Frame-Options: DENY** (anty-clickjacking), **Referrer-Policy: no-referrer**.
- **Strict-Transport-Security** (HSTS, 1 rok), **Cross-Origin-Opener-Policy** i **Cross-Origin-Resource-Policy: same-origin**, **Permissions-Policy** wyłączające geolokalizację, kamerę, mikrofon, płatności, USB.
- **X-Robots-Tag** – brak indeksowania (uzupełnia `meta robots` i `robots.txt`).

### 9.2 Rate limiting (wielopoziomowy)

`app.set('trust proxy', config.trustProxy)` zapewnia poprawne IP klienta za Passengerem, dzięki czemu limity działają per realny klient, a nie per proxy.

- **Globalny limit API** – `apiLimiter` na całym `/api` (domyślnie 120 żądań/min/IP).
- **Limit zapisu** – `writeLimiter` na `PATCH`, `DELETE`, `POST /api/uploads/:id/complete` (domyślnie 30/min/IP).
- **Limit uploadu/importu** – `uploadLimiter` na `POST /api/upload*`, `/api/manual`, `/api/import-url` (domyślnie 20 / 15 min/IP) – chroni kosztowne wywołania Gemini.

### 9.3 Ochrona przed SSRF (import z linku)

`assertPublicUrl` jest wywoływane przed każdym pobraniem (również po każdym przekierowaniu i przy odpytaniu API Honda/Ford):

- dozwolone tylko `http`/`https`, bez danych logowania w URL,
- rozwiązanie nazwy hosta (DNS) i odrzucenie, jeśli którykolwiek adres trafia w zakres prywatny/zarezerwowany (loopback `127/8`, link-local `169.254/16` z metadanymi chmury, prywatne `10/8`, `172.16/12`, `192.168/16`, CGNAT, IPv6 ULA/link-local i mapowane IPv4),
- twardy limit rozmiaru pobranej treści (`URL_IMPORT_MAX_BYTES`, domyślnie 8 MB) dla HTML, JSON i PDF oraz timeout 15 s.

Bypass tylko w dev przez `URL_IMPORT_ALLOW_PRIVATE=true`.

### 9.4 Limity i higiena żądań

- `x-powered-by` wyłączony; body JSON limitowane do `JSON_BODY_LIMIT` (domyślnie 256 kB).
- Upload: tylko PDF (filtr MIME + rozszerzenie), limit rozmiaru pliku, `files: 1`, limity pól multipart, sanityzacja nazwy (`sanitize-filename`), losowa nazwa na dysku. Błędy multera (np. za duży plik) mapowane na `400` z czytelnym komunikatem.
- Pobieranie pliku chroni przed path traversal (`path.basename`).
- Zapytania SQL parametryzowane (mysql2 named placeholders) – brak SQL injection.
- Globalny handler błędów zwraca dla `5xx` generyczny komunikat (bez wycieku szczegółów), logując pełny błąd po stronie serwera; `4xx` zachowują czytelny komunikat.
- Dane pojazdów są escapowane przed wstawieniem do DOM (`escapeHtml`), w tym treść powiadomień (ochrona przed XSS).

### 9.5 Odporność

- Obsługa błędów Gemini i NBP nie wywraca aplikacji (retry, pula kluczy, cache, fallbacki).
- Import z linku ma timeouty i limity przekierowań; polling statusu po stronie frontu jest anulowany po zamknięciu okna importu.

## 10. Testy

| Plik | Zakres |
| --- | --- |
| `test/equipment.test.js` | Kanonizacja etykiet, slugi, deduplikacja. |
| `test/recommendation.test.js` | Scoring, liderzy, odznaki, sortowanie. |
| `test/nbp.test.js` | Przeliczenia walut, cache, fallback `stale`. |
| `test/gemini.test.js` | Klasyfikacja błędów, retry, pula kluczy, gotowość pliku. |
| `test/ux.test.js` | Playwright: layout, responsywność (375/768 px), modale. |

Uruchomienie: `npm test` (jednostkowe), `npm run test:ux` (UX, wymaga działającej aplikacji na `http://localhost:3000`).

## 11. Wdrożenie (DirectAdmin / Passenger)

1. Utwórz bazę MariaDB.
2. W `Setup Node.js App` ustaw aplikację dla domeny; `Application root` = katalog projektu, `Startup file` = `server.js`. Konfigurację Passengera odzwierciedla `.htaccess`.
3. Uzupełnij `.env` (dane bazy + klucz Gemini, `DB_MODE=mariadb`).
4. Zależności produkcyjne: `npm install --omit=dev`.
5. Automatyczny deploy przez cron co minutę:

```cron
* * * * * cd <katalog-aplikacji> && /bin/bash scripts/pull-and-build.sh >> storage/logs/deploy.log 2>&1
```

### `scripts/pull-and-build.sh`

- Blokuje równoległe deploye (`flock` na `tmp/deploy.lock`).
- `git fetch` + `git reset --hard origin/$SYNC_BRANCH` + `git clean -fd` → samoleczenie „dirty repo” na serwerze.
- Instaluje zależności (`npm ci --omit=dev`, fallback `npm install`).
- Restart Passengera przez `touch tmp/restart.txt`.
- Zapisuje stan ostatniego deploya do `tmp/deploy-meta.json` (czytane przez `/healthz`).
- Tryb `--status` raportuje HEAD lokalny/zdalny bez wdrażania.

`scripts/deploy-runner.js` uruchamia ten skrypt także na Windows (szuka Git Bash lub zmiennej `GIT_BASH`). Komendy: `npm run deploy:sync`, `npm run deploy:status`.

## 12. Masowy import PDF z CLI

```bash
npm run import:pdfs -- /ścieżka/do/katalogu-z-pdf
npm run import:pdfs -- "/ścieżka/do/x1.pdf" "/ścieżka/do/x2.pdf"
```

Skrypt kopiuje PDF-y do `storage/uploads`, tworzy rekord `uploads`, parsuje tym samym flow Gemini co aplikacja webowa, zapisuje pojazdy i oznacza import jako `completed` lub `failed`.
