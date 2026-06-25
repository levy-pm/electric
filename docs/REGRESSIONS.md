# Regressions

Rejestr naprawionych regresji i znanych pułapek. Każdy wpis: **objaw → przyczyna → naprawa → jak nie powtórzyć**. Dopisuj nowe pozycje na górę. Format daty: `RRRR-MM-DD`.

## Jak korzystać

- Zanim zmienisz kod w obszarze opisanym poniżej, przeczytaj odpowiedni wpis – to mapa min.
- Po naprawie regresji dopisz wpis. Po dodaniu funkcji, która łatwo się psuje, dopisz „znaną pułapkę”.
- Po większej zmianie sprawdź sekcję [Checklist przed oddaniem](#checklist-przed-oddaniem).

---

## Naprawione regresje

Poniższe pozycje zrekonstruowano z historii git (commity `fix:`). Daty odpowiadają kolejności wdrożeń.

### Hardening bezpieczeństwa (2026-06-25)
- **Zakres:** dodano warstwę bezpieczeństwa (`src/security.js`) i wpięto ją w `src/server.js`.
- **SSRF w imporcie z linku:** `POST /api/import-url` pobierał dowolny adres po stronie serwera (ryzyko dostępu do `169.254.169.254`, `localhost`, sieci wewnętrznej). Dodano `assertPublicUrl` – walidację po DNS odrzucającą adresy prywatne/zarezerwowane, także dla przekierowań; limit rozmiaru odpowiedzi i timeout.
- **Brak globalnego rate limitu:** wcześniej tylko upload był limitowany; `GET/PATCH/DELETE` były otwarte. Dodano globalny limiter `/api`, limiter zapisu (PATCH/DELETE/complete) i `trust proxy` dla poprawnego IP za Passengerem.
- **Brak nagłówków bezpieczeństwa:** dodano CSP (bez inline JS – usunięto inline `onclick` z toasta), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
- **Wyciek błędów:** `5xx` zwracały `error.message`; teraz generyczny komunikat, pełny błąd tylko do logów.
- **Limity żądań:** JSON ograniczony do 256 kB, multipart do 1 pliku + limity pól; błędy multera mapowane na `400`.
- **Jak nie powtórzyć:** każdy nowy fetch po stronie serwera na adres z danych użytkownika przepuszczaj przez `assertPublicUrl`; nowe endpointy `/api` są automatycznie objęte globalnym limitem, mutacje dodatkowo dopnij `writeLimiter`.

### Przegląd kodu – naprawione błędy (2026-06-25)
- **XSS w powiadomieniach:** `showNotification` wstawiał `message` do `innerHTML` bez escapowania (komunikaty serwera/nazwy z PDF mogły zawierać `<img onerror>`). Dodano `escapeHtml(String(message))`.
- **Martwa walidacja nazwy:** kolumna „Model” miała zdublowany klucz `cellEdited`, przez co walidacja pustej nazwy nigdy się nie uruchamiała (override `makeTextCellEdited` zapisywał pustą wartość jako `null`). Walidacja przeniesiona do faktycznie używanego override.
- **Surowy błąd zapisu:** `saveVehiclePatch` używał `response.json()` – przy odpowiedzi nie-JSON (np. strona błędu proxy) pokazywał `Unexpected token <`. Ujednolicono z odpornym `readApiPayload`.
- **Polling bez anulowania:** odpytywanie statusu importu trwało po zamknięciu okna (do 15 min, efekty uboczne na ukrytym UI). Dodano token anulowania unieważniany przy zamknięciu modalu.
- **Kolejność migracji bazy:** `ALTER TABLE vehicles ... combustion_equivalents` był wykonywany **przed** `CREATE TABLE vehicles`, co wywracało inicjalizację na świeżej bazie MariaDB. ALTER przeniesiony za CREATE.
- **Mylące dane API:** usunięto nieużywane, nieaktualne pole `summary.recommendationModel` z `/api/cars` (rozjeżdżało się z faktycznym scoringiem).

### Formularz ręczny nie zapisywał wielu aut (2026-06-25)
- **Objaw:** dodanie kilku aut przez zakładkę „Ręcznie” zostawiało w tabeli tylko ostatnie. W trybie `memory` kolejne rekordy nadpisywały się pod kluczem `undefined`; w MariaDB wstawienie `NULL` do `CHAR(36) PRIMARY KEY` groziło błędem i rollbackiem (import mógł w ogóle nie przejść).
- **Przyczyna:** obiekt `vehicle` w `POST /api/manual` nie miał pola `id` (ścieżka PDF nadaje je przez `randomUUID()`, ręczna – nie).
- **Naprawa:** dodano `id: randomUUID()` przy budowie rekordu w `src/server.js`.
- **Jak nie powtórzyć:** każdy rekord przekazywany do `store.markUploadCompleted` musi mieć własne `id` – to klucz w trybie `memory` i PK w bazie. Przy dodawaniu nowej ścieżki tworzenia pojazdu sprawdź, czy nadaje `id`.

### Za małe cele dotykowe i ciasny formularz na wąskich ekranach (2026-06-25)
- **Objaw:** przyciski tekstowe „Wyczyść…” miały 23px wysokości (poniżej komfortu dotyku), a formularz ręczny na ekranach ≤360px przycinał placeholdery w układzie 2-kolumnowym.
- **Naprawa:** `.text-button` dostał `min-height: 28px` + `inline-flex`; `.manual-form-grid` przechodzi w jedną kolumnę poniżej 360px. Podbita wersja `styles.css?v=20260625-1`.
- **Jak nie powtórzyć:** elementy klikalne trzymaj na min. ~28px wysokości; gęste siatki formularzy testuj na 320px. Weryfikacja: brak poziomego przepełnienia od 320 do 1920px (audyt Playwright).

### Wydajność i stany ładowania
- **Objaw:** tabela pojawiała się dopiero po pobraniu danych, ekran sprawiał wrażenie zawieszonego.
- **Naprawa:** natychmiastowe pokazanie szkieletu (skeleton) tabeli na starcie oraz stany ładowania (`fix: show table skeleton immediately on load`, `feat: improve load performance and add skeleton states`).
- **Jak nie powtórzyć:** każda operacja sieciowa na froncie musi mieć stan ładowania; nie blokuj pierwszego renderu na danych.

### Modale i akcje w tabeli
- **Objaw:** niespójne zachowanie modali (przewijanie tła, zakładki) i akcji wierszy; modale „przeciekały”.
- **Naprawa:** poprawione blokowanie modalu i obsługa akcji (`fix: improve modal and action handling`, `feat: ...improved modal locking`); responsywne zakładki modalu (`fix: make modal tabs responsive`).
- **Jak nie powtórzyć:** przy dodawaniu modalu pamiętaj o blokadzie scrolla tła i testach na 375/768 px.

### Układ kolumn znikał po odświeżeniu
- **Objaw:** zapisany układ kolumn nie wracał po przeładowaniu tabeli.
- **Naprawa:** przywracanie zapisanego układu po refreshu (`fix: restore saved column layout after table refresh`) na bazie `feat: persist custom column layouts`.
- **Jak nie powtórzyć:** po każdym `setColumns`/refreshu Tabulatora ponownie aplikuj układ z `localStorage`.

### Podświetlenie rekomendowanego wiersza
- **Objaw:** `border-left` na wierszach Tabulatora rozjeżdżał layout komórek.
- **Naprawa:** zamiana na `inset box-shadow` (`fix: replace border-left with inset box-shadow on highlighted Tabulator rows`) i normalizacja podświetlenia (`fix: normalize highlighted recommendation rows`).
- **Jak nie powtórzyć:** dekoracje wierszy w Tabulatorze rób przez `box-shadow`, nie przez `border`, który zmienia model pudełka komórki.

### Edycja inline w tabeli
- **Objaw:** edycja komórek nie wyzwalała się poprawnie (pojedyncze/podwójne kliknięcie, delegacja zdarzeń).
- **Naprawa:** seria poprawek obsługi kliknięć i edytorów nakładkowych (`fix: capture table clicks for inline editing`, `fix: delegate cell clicks...`, `feat: use overlay editors for inline table edits`, `feat: enable inline editing across table cells`).
- **Jak nie powtórzyć:** zmiany w obsłudze zdarzeń tabeli testuj na wszystkich typach kolumn (tekst, liczba, listy).

### Gemini – limity, przeciążenia, stabilność
- **Objaw:** wyczerpany limit klucza był mylony z błędem PDF; chwilowe `503` wywracały import; uploady plików bywały niestabilne; zapytania o odpowiedniki spalinowe potrafiły wisieć.
- **Naprawa:** czytelne komunikaty limitu (`fix: surface Gemini quota exhaustion clearly`), pula kluczy z fallbackiem (`feat: add Gemini API key pool fallback`), retry błędów przejściowych (`fix: retry busy Gemini requests`), stabilizacja uploadu PDF i czekanie na `ACTIVE` (`fix: stabilize Gemini PDF uploads`), twardy timeout na lookup spalinowych (`fix: timebox combustion equivalent lookups`), twardsza obsługa odpowiedzi (`fix: harden upload response handling`).
- **Jak nie powtórzyć:** każdy nowy call do Gemini przepuszczaj przez `runGeminiOperationAcrossKeys`/`retryGeminiOperation`; nie traktuj błędu limitu jako błędu danych wejściowych; operacje pomocnicze (np. wyszukiwanie) muszą mieć timeout i fallback.

### Slug wyposażenia za długi dla bazy
- **Objaw:** bardzo długie etykiety wyposażenia przekraczały limit kolumny/UNIQUE w MariaDB.
- **Naprawa:** ograniczenie długości slugu z doklejeniem skrótu SHA-1 (`fix: cap equipment slugs for database safety`) oraz `label` jako `TEXT` (`fix: allow longer equipment labels in mariadb`).
- **Jak nie powtórzyć:** wszystko, co trafia do kolumny z UNIQUE/`VARCHAR`, musi mieć ograniczoną i deterministyczną długość.

### Karty liderów dla danych z bazy
- **Objaw:** karty liderów (np. zasięg) nie pojawiały się dla wartości pochodzących z MariaDB.
- **Naprawa:** `fix: restore range leader cards for db values`.
- **Jak nie powtórzyć:** scoring i liderzy muszą działać identycznie dla wartości liczbowych i stringów – używaj `safeNumber` na wejściu.

### Cache statyk po deployu
- **Objaw:** przeglądarka trzymała stary CSS/JS po wdrożeniu.
- **Naprawa:** wersjonowanie statyk w query string (`fix: cache bust production stylesheet`, `fix: refresh cached frontend assets`, `fix: refresh cached recommendation script`, `fix(ui): bump static asset cache versions`).
- **Jak nie powtórzyć:** po zmianie `public/*.js|css` podbij `?v=...` w `index.html`.

### Spójność metryki rekomendacji
- **Objaw:** opis modelu rekomendacji rozjechał się ze scoringiem po przejściu na „value for money”.
- **Naprawa:** `feat: switch recommendations to value-for-money scoring`, `fix(ui): update summary metric to cost-per-km`.
- **Jak nie powtórzyć:** wagi i etykiety w `src/recommendation.js` oraz `LEADER_LABELS`/`recommendationModel` w UI trzymaj zsynchronizowane. Patrz uwaga w [dokumentacji technicznej §6](dokumentacja-techniczna.md#6-scoring-i-waluty).

---

## Znane pułapki (do uniknięcia)

- **Tryb `memory` gubi dane** – po restarcie procesu znikają. Do realnych danych używaj `DB_MODE=mariadb`.
- **Etykiety odznak w dwóch miejscach** – `src/recommendation.js` (`BADGE_*`) i `public/app.js` (`LEADER_LABELS`) muszą być znakowo identyczne (łącznie z emoji).
- **Brak konta = współdzielone dane** – każdy z dostępem do URL edytuje te same rekordy.
- **Gemini bywa pewny siebie** – dane z importu warto zweryfikować wzrokowo; pola niepewne powinny lądować w `warnings`.
- **Parsery Honda/Ford zależą od kształtu API producenta** – zmiana po stronie producenta wywoła fallback do ekstrakcji tekstu (mniej dokładnej). Przy raporcie „dane z Honda/Ford są ubogie” sprawdź, czy nie zadziałał fallback.
- **Kurs NBP może być `stale`** – flaga `exchangeRateIsStale` oznacza użycie ostatniej znanej wartości; nie traktuj jako błędu.

## Checklist przed oddaniem

1. `npm run check` – konfiguracja OK.
2. `npm test` – testy jednostkowe zielone.
3. Po zmianach UI: `npm run test:ux` oraz przegląd w przeglądarce na 375 px i 768 px, konsola bez błędów.
4. Po zmianie `public/*.css|js`: podbity `?v=...` w `index.html`.
5. Po zmianie scoringu/odznak: zgodność `recommendation.js` ↔ `app.js`.
6. Brak sekretów w commicie (`.env` jest ignorowany).
