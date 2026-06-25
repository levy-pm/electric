# Dokumentacja – electric

Centrum dokumentacji porównywarki aut elektrycznych. Wybierz dokument odpowiedni do roli:

| Dokument | Dla kogo | Co znajdziesz |
| --- | --- | --- |
| [Specyfikacja](specyfikacja.md) | Product / analityk | Cel produktu, zakres funkcjonalny, model danych, reguły scoringu, ograniczenia. |
| [Dokumentacja użytkownika](dokumentacja-uzytkownika.md) | Użytkownik końcowy | Jak dodać auto, czytać ranking, filtrować, edytować, rozwiązywać problemy. |
| [Dokumentacja techniczna](dokumentacja-techniczna.md) | Developer / DevOps | Architektura, moduły, pełne API, schemat bazy, deploy, testy. |
| [Stos technologiczny](stos-technologiczny.md) | Developer | Lista zależności, wersje, uzasadnienie wyborów. |
| [Regressions](REGRESSIONS.md) | Maintainer | Rejestr naprawionych regresji i znanych pułapek. |

Wprowadzenie i szybki start: [README projektu](../README.md).

## Mapa projektu w pigułce

- **Backend:** `src/` (Express, ekstrakcja Gemini, store MariaDB/memory, scoring, kursy NBP).
- **Frontend:** `public/` (statyczny HTML + Tabulator + `app.js`).
- **Skrypty:** `scripts/` (deploy, masowy import PDF).
- **Testy:** `test/` (jednostkowe `node --test` + UX Playwright).
- **Dane runtime:** `storage/uploads`, `storage/logs`, `tmp/`.
