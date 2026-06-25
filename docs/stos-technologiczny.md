# Stos technologiczny

## Środowisko

| Element | Wersja / wymóg | Uwagi |
| --- | --- | --- |
| Node.js | ≥ 20 (`engines`) | Wymagane API: `fetch`, `AbortSignal.timeout`, `node --watch`, `node --test`. |
| Moduły | CommonJS (`"type": "commonjs"`) | Bez transpilacji i bundlera. |
| Hosting docelowy | DirectAdmin / CloudLinux + Passenger | Start z `server.js`, konfiguracja w `.htaccess`. |
| Baza | MariaDB 10.6 (produkcja) | W dev opcjonalny tryb `memory`. |

## Zależności produkcyjne

| Pakiet | Wersja | Rola w projekcie |
| --- | --- | --- |
| `express` | ^5.2.1 | Serwer HTTP, routing, statyki, middleware. |
| `@google/genai` | ^1.48.0 | Klient Gemini Developer API (File API + generowanie ze schematem JSON). |
| `mysql2` | ^3.20.0 | Pula połączeń MariaDB (`mysql2/promise`), named placeholders. |
| `multer` | ^2.1.1 | Obsługa uploadu plików (disk storage, limity, filtr PDF). |
| `express-rate-limit` | ^8.3.2 | Limitowanie żądań na endpointach przyjmujących dane. |
| `sanitize-filename` | ^1.6.4 | Bezpieczne nazwy wgrywanych plików. |
| `zod` | ^4.3.6 | Walidacja i typowanie danych z ekstrakcji Gemini. |
| `tabulator-tables` | ^6.4.0 | Interaktywna tabela na froncie (serwowana z `node_modules`). |

## Zależności deweloperskie

| Pakiet | Wersja | Rola |
| --- | --- | --- |
| `@playwright/test` | ^1.59.1 | Testy UX/E2E (layout, responsywność, modale). |

Testy jednostkowe korzystają z wbudowanego runnera Node (`node:test`) – bez dodatkowych zależności.

## Usługi zewnętrzne

| Usługa | Zastosowanie | Odporność |
| --- | --- | --- |
| Gemini Developer API | Ekstrakcja danych z PDF i tekstu, dobór odpowiedników spalinowych. | Retry z backoffem, pula kluczy, mapowanie błędów, timeout na wyszukiwanie. |
| NBP API (`api.nbp.pl`) | Kurs EUR (tabela A) do przeliczeń PLN↔EUR. | Cache z TTL, deduplikacja żądań, fallback `stale`. |
| Honda Configurator API | Dokładny odczyt konfiguracji Honda z linku. | Fallback do ekstrakcji tekstu przy błędzie. |
| Ford ServicesCache API | Dokładny odczyt konfiguracji Ford z linku. | Fallback do ekstrakcji tekstu przy błędzie. |

## Frontend

| Element | Technologia |
| --- | --- |
| Struktura | Statyczny `index.html` (bez frameworka). |
| Logika | Vanilla JavaScript (`public/app.js`). |
| Tabela | Tabulator 6. |
| Style | Ręczny CSS (`public/styles.css`), zmienne CSS. |
| Typografia | Google Fonts: Outfit, Space Grotesk. |

## Dlaczego takie wybory

- **Express 5 + CommonJS, bez bundlera** – mały, łatwy w utrzymaniu monolit, który uruchamia się wprost na Passengerze bez kroku budowania.
- **Gemini zamiast własnego parsera PDF** – konfiguratory różnych producentów mają niespójne układy; model językowy radzi sobie z nieregularnym tekstem lepiej niż reguły, a krytyczne marki (Honda, Ford) mają dedykowane parsery dla precyzji.
- **Tryb `memory` obok MariaDB** – natychmiastowy start w dev i w testach bez stawiania bazy.
- **Zod na granicy ekstrakcji** – dane z modelu bywają „luźne” (liczby jako stringi), walidacja i normalizacja w jednym miejscu chronią resztę aplikacji.
- **Tabulator** – gotowe sortowanie, filtrowanie, edycja inline i zarządzanie kolumnami bez pisania własnego komponentu tabeli.
- **Pula kluczy + cache NBP** – realna odporność na limity i chwilowe awarie usług zewnętrznych bez przerywania pracy użytkownika.
- **Bezpieczeństwo bez dodatkowych zależności** – nagłówki (CSP/HSTS/itd.) i ochrona SSRF są zaimplementowane ręcznie w `src/security.js` (moduły `dns`/`net` z Node), a rate limiting opiera się na obecnym już `express-rate-limit`. Brak nowych zależności = mniejsza powierzchnia ataku w łańcuchu dostaw i prostszy deploy.

## Bezpieczeństwo

| Warstwa | Mechanizm | Realizacja |
| --- | --- | --- |
| Przeglądarka | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy | `src/security.js` (`securityHeaders`) |
| Nadużycie zasobów | Rate limiting: API / zapis / upload | `express-rate-limit` (`createRateLimiter`) |
| Import z linku | Ochrona SSRF (blokada adresów prywatnych), limit rozmiaru, timeout | `src/security.js` (`assertPublicUrl`) + `src/url-import.js` |
| Dane wejściowe | Walidacja (Zod), sanityzacja nazw plików, limity multipart | `src/schema.js`, `sanitize-filename`, `multer` |
| Baza | Zapytania parametryzowane | `mysql2` named placeholders |
| Front | Escapowanie danych w DOM | `escapeHtml` w `public/app.js` |
