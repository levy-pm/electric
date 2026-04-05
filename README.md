# electric

Lekki panel Node.js do porownywania konfiguracji aut elektrycznych z PDF-ow konfiguratora.

## Co robi aplikacja

- przyjmuje PDF konfiguratora bez logowania
- wysyla plik do Gemini File API i wyciaga dane do jednego rekordu tabeli
- zapisuje rekordy w MariaDB lub w trybie lokalnym `memory`
- trzyma wyposazenie takze w katalogu relacyjnym `equipment_items` + `vehicle_equipment`
- pokazuje ranking po cenie, zasiegu, baterii i wyposazeniu
- pozwala sortowac, filtrowac, szukac, ukrywac i przestawiac kolumny
- ustawia `noindex` przez `meta robots` i `X-Robots-Tag`

## Stack

- Node.js 20
- Express
- MariaDB 10.6 na hostingu
- Gemini Developer API przez `@google/genai`
- Tabulator na froncie

## Zmienne srodowiskowe

Skopiuj `.env.example` do `.env` i uzupelnij:

```env
PORT=3000
DB_MODE=memory
DB_HOST=localhost
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASSWORD=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
MAX_FILE_SIZE_MB=20
SYNC_BRANCH=main
```

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

Domyslnie bez bazy aplikacja startuje w trybie `memory`. Na serwerze ustaw `DB_MODE=mariadb`.

## Deploy na DirectAdmin

1. W panelu przejdz do `Bazy danych` i utworz baze np. `problems_electric`.
2. W `Setup Node.js App` utworz aplikacje dla `electric.motometr.pl`.
3. Jako `Application root` ustaw katalog projektu: `/home/problems/domains/electric.motometr.pl/public_html`.
4. Jako `Startup file` ustaw `server.js`.
5. W `.env` wpisz dane MariaDB i klucz Gemini.
6. Zainstaluj zaleznosci:

```bash
npm install --omit=dev
```

7. Dodaj cron:

```cron
* * * * * cd /home/problems/domains/electric.motometr.pl/public_html && /bin/bash scripts/pull-and-build.sh >> storage/logs/deploy.log 2>&1
```

Skrypt:

- blokuje rownolegle uruchomienia deploya
- robi `git fetch` + `git reset --hard origin/main` + `git clean -fd`, wiec sam leczy `dirty repo` na serwerze
- dogrywa zaleznosci przez `npm ci --omit=dev`
- restartuje Passenger przez `tmp/restart.txt`
- zapisuje stan ostatniego deploya do `tmp/deploy-meta.json`

Do recznej diagnostyki z panelu Node.js mozesz uruchomic:

```bash
npm run deploy:status
```

Na Windows skrypt szuka `Git Bash` albo zmiennej `GIT_BASH`. Na serwerze Linux dziala bez dodatkowej konfiguracji.

Do jednorazowego wymuszenia synchronizacji:

```bash
npm run deploy:sync
```

## API

- `GET /api/cars` - rekordy do tabeli
- `POST /api/upload` - upload jednego PDF-a pod polem `configurationPdf`
- `GET /api/config` - podstawowa konfiguracja klienta
- `GET /healthz` - prosty healthcheck + status ostatniego deploya

## Logika rekomendacji

Domyslny ranking MVP:

- cena: `40%`
- zasieg WLTP: `30%`
- bateria: `15%`
- wyposazenie: `15%`

Bateria ma mniejsza wage niz zasieg, bo w praktyce czesciowo opisuje ten sam benefit. Wyposazenie jest osobno katalogowane, wiec mozna potem dodac osobne wartosciowanie i filtry po konkretnych funkcjach.
