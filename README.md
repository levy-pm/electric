# ⚡ electric

**Porównywarka aut elektrycznych z konfiguratorów PDF, linków i wpisu ręcznego.**

Wgrywasz konfigurację samochodu elektrycznego (PDF z dowolnego konfiguratora producenta, link do konfiguracji online albo dane wpisane ręcznie), a aplikacja wyciąga z niej kluczowe parametry, zapisuje je w jednej tabeli i tworzy ranking „najlepsza wartość za pieniądze”. Ceny pokazywane są w PLN i EUR po aktualnym kursie NBP.

Aplikacja jest celowo oznaczona jako `noindex` – niewidoczna dla wyszukiwarek.

---

## Spis treści

- [Co robi aplikacja](#co-robi-aplikacja)
- [Jak to działa](#jak-to-działa)
- [Szybki start](#szybki-start)
- [Konfiguracja (zmienne środowiskowe)](#konfiguracja-zmienne-środowiskowe)
- [Skrypty npm](#skrypty-npm)
- [Stos technologiczny](#stos-technologiczny)
- [Dokumentacja](#dokumentacja)

---

## Co robi aplikacja

- **Trzy drogi dodania auta** – PDF konfiguratora, link do konfiguracji online, formularz ręczny.
- **Automatyczne wyciąganie danych** – PDF i tekst stron analizuje Gemini, zwraca ustrukturyzowany rekord (cena, moc, zasięg WLTP, bateria, zużycie energii, wyposażenie).
- **Dedykowane parsery** – konfiguratory Honda i Ford są czytane bezpośrednio z ich API (bez Gemini), reszta linków idzie przez ekstrakcję tekstu HTML.
- **Ranking „value for money”** – pojazdy są sortowane wg ilości zasięgu, baterii i wyposażenia w przeliczeniu na 1000 PLN, z bonusem za niskie zużycie energii.
- **Odznaki liderów** – najlepsza cena, największy zasięg, największa bateria, największa moc, najbogatsze wyposażenie.
- **Ceny PLN + EUR** – kurs EUR pobierany z NBP (tabela A), z cache i fallbackiem na ostatnią znaną wartość.
- **Katalog wyposażenia** – każda pozycja jest kanonizowana i przechowywana relacyjnie, dzięki czemu można filtrować pojazdy po konkretnych funkcjach.
- **Interaktywna tabela** – sortowanie, wyszukiwanie, filtr po wyposażeniu, ukrywanie i przestawianie kolumn (układ zapisywany lokalnie), edycja inline i usuwanie rekordów.
- **Porównanie ze spalinowymi** – Gemini dobiera 3–5 odpowiedników spalinowych dla każdego auta.
- **Prywatność domyślnie** – `noindex` przez `meta robots`, nagłówek `X-Robots-Tag` i `robots.txt` blokujący indeksowanie.
- **Warstwa bezpieczeństwa** – nagłówki bezpieczeństwa (CSP, HSTS, anty-clickjacking), wielopoziomowy rate limiting (API / zapis / upload), ochrona przed SSRF przy imporcie z linku, twarde limity rozmiaru żądań i plików. Szczegóły: [docs/dokumentacja-techniczna.md › Bezpieczeństwo](docs/dokumentacja-techniczna.md#9-bezpieczeństwo-i-odporność).

## Jak to działa

```
PDF / link / formularz
        │
        ▼
   /api/upload*, /api/import-url, /api/manual
        │
        ▼
  Ekstrakcja danych
  • PDF  → Gemini File API
  • link → parser Honda/Ford albo tekst HTML → Gemini
  • ręcznie → walidacja pól
        │
        ▼
  Normalizacja (schema.js) + kanonizacja wyposażenia (equipment.js)
        │
        ▼
  Zapis: MariaDB albo tryb pamięciowy (memory)
        │
        ▼
  /api/cars → wzbogacenie o kurs NBP + scoring → tabela na froncie
```

## Szybki start

Wymagany Node.js ≥ 20.

```bash
npm install
cp .env.example .env   # uzupełnij GEMINI_API_KEY
npm run dev
```

Aplikacja wystartuje na `http://localhost:3000`. Bez ustawionej bazy działa w trybie **memory** (dane znikają po restarcie) – idealne do testów. Do realnego użycia ustaw `DB_MODE=mariadb` i dane połączenia.

Bez klucza Gemini front i tabela działają, ale import PDF/linku zwróci błąd. Wpis ręczny nie potrzebuje Gemini.

## Konfiguracja (zmienne środowiskowe)

Skopiuj `.env.example` do `.env` i uzupełnij:

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera HTTP. |
| `DB_MODE` | `memory` (lub `mariadb`, gdy podano `DB_NAME`) | Tryb składowania danych. |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` | Połączenie z MariaDB. |
| `DB_SOCKET_PATH` | – | Gniazdo zamiast host/port (opcjonalnie). |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | – | Dane bazy (wymagane przy `mariadb`). |
| `GEMINI_API_KEYS` | – | Lista kluczy po przecinku; ma priorytet nad `GEMINI_API_KEY`. |
| `GEMINI_API_KEY` | – | Pojedynczy klucz Gemini. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model używany do analizy. |
| `GEMINI_BUSY_RETRY_ATTEMPTS` | `3` | Liczba ponowień przy `429/503`. |
| `GEMINI_BUSY_RETRY_BASE_DELAY_MS` | `5000` | Bazowe opóźnienie ponowienia (backoff wykładniczy). |
| `NBP_CACHE_TTL_MINUTES` | `720` | Czas życia cache kursu EUR. |
| `NBP_REQUEST_TIMEOUT_MS` | `8000` | Timeout zapytania do NBP. |
| `MAX_FILE_SIZE_MB` | `20` | Maksymalny rozmiar wgrywanego PDF. |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | `900000` | Okno limitu uploadów (15 min). |
| `UPLOAD_RATE_LIMIT_MAX` | `20` | Maks. liczba uploadów w oknie. |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Okno globalnego limitu API. |
| `API_RATE_LIMIT_MAX` | `120` | Maks. liczba żądań API na okno (per IP). |
| `WRITE_RATE_LIMIT_WINDOW_MS` | `60000` | Okno limitu operacji zapisu. |
| `WRITE_RATE_LIMIT_MAX` | `30` | Maks. liczba zapisów (PATCH/DELETE/complete) na okno. |
| `JSON_BODY_LIMIT` | `256kb` | Maksymalny rozmiar ciała żądania JSON. |
| `TRUST_PROXY` | `1` | Liczba zaufanych proxy (poprawne IP klienta za Passengerem). |
| `URL_IMPORT_MAX_BYTES` | `8388608` | Limit rozmiaru pobieranej treści z linku (8 MB). |
| `URL_IMPORT_ALLOW_PRIVATE` | `false` | Zezwól na linki do adresów prywatnych (tylko dev). |
| `SYNC_BRANCH` | `main` | Gałąź synchronizowana przez deploy. |

`GEMINI_API_KEYS` przyjmuje listę kluczy rozdzielonych przecinkami. Aplikacja próbuje klucze po kolei, gdy poprzedni dostanie limit albo powtarzające się błędy `429/503`.

## Skrypty npm

| Komenda | Działanie |
|---|---|
| `npm run dev` | Serwer z auto-restartem (`node --watch`). |
| `npm start` | Serwer produkcyjny. |
| `npm run check` | Walidacja konfiguracji bez startu (dopuszcza brak Gemini). |
| `npm test` | Testy jednostkowe (`node --test`). |
| `npm run test:ux` | Testy UX w Playwright (`test/ux.test.js`). |
| `npm run import:pdfs -- <ścieżki>` | Masowy import PDF z CLI. |
| `npm run deploy:sync` | Wymuszenie synchronizacji z gałęzią produkcyjną. |
| `npm run deploy:status` | Status ostatniego deploya. |

## Stos technologiczny

Node.js 20 · Express 5 · MariaDB 10.6 (mysql2) · Gemini Developer API (`@google/genai`) · Multer · Zod · express-rate-limit · Tabulator (front) · Playwright (testy UX). Szczegóły: [docs/stos-technologiczny.md](docs/stos-technologiczny.md).

## Dokumentacja

Pełna dokumentacja znajduje się w katalogu [`docs/`](docs/):

- [Specyfikacja](docs/specyfikacja.md) – wymagania, zakres, model danych, reguły biznesowe.
- [Dokumentacja użytkownika](docs/dokumentacja-uzytkownika.md) – jak korzystać z aplikacji krok po kroku.
- [Dokumentacja techniczna](docs/dokumentacja-techniczna.md) – architektura, moduły, API, baza, deploy.
- [Stos technologiczny](docs/stos-technologiczny.md) – zależności i uzasadnienie wyborów.
- [Regressions](docs/REGRESSIONS.md) – rejestr naprawionych regresji i znanych pułapek.

## Licencja

ISC.
