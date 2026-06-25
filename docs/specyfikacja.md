# Specyfikacja funkcjonalna

## 1. Cel produktu

Aplikacja **electric** ma jeden cel: pozwolić w jednym miejscu porównać konfiguracje samochodów elektrycznych pochodzące z różnych konfiguratorów producentów, mimo że każdy producent prezentuje dane inaczej. Użytkownik nie musi ręcznie przepisywać parametrów – wgrywa PDF, link albo wypełnia formularz, a aplikacja sprowadza wszystko do wspólnego modelu danych i tworzy ranking według wartości za pieniądze.

Grupa docelowa: osoba wybierająca auto elektryczne, która zebrała kilka konfiguracji i chce je obiektywnie zestawić (cena, zasięg, bateria, wyposażenie), z cenami widocznymi również w EUR.

## 2. Zakres funkcjonalny

### 2.1 Dodawanie konfiguracji

Trzy niezależne ścieżki:

1. **PDF konfiguratora** – jeden lub wiele plików PDF (do 20 MB każdy). Analizowane przez Gemini File API.
2. **Link do konfiguracji** – adres URL do strony konfiguratora lub pliku PDF online.
   - Linki **Honda** i **Ford** są rozpoznawane i czytane bezpośrednio z API producenta (dokładniejsze niż ekstrakcja tekstu).
   - Pozostałe linki: pobranie strony, wyciągnięcie istotnych fragmentów tekstu i analiza przez Gemini. Link do PDF jest pobierany i traktowany jak upload PDF.
3. **Wpis ręczny** – formularz z pełnym zestawem pól (marka, model, wersja, ceny, parametry techniczne, wyposażenie, odpowiedniki spalinowe). Nie wymaga Gemini; opcjonalnie można dołączyć plik PDF jako załącznik.

### 2.2 Prezentacja i ranking

- Tabela wszystkich konfiguracji z sortowaniem, wyszukiwaniem i filtrem po wyposażeniu.
- Karta „najlepsza wartość” (rekomendacja nr 1) oraz karty liderów w kategoriach.
- Ceny w PLN z wartością EUR pod spodem (kurs NBP).
- Odznaki liderów na pojazdach.
- Porównanie z 3–5 odpowiednikami spalinowymi (dobierane przez Gemini z wyszukiwarką).

### 2.3 Zarządzanie danymi

- Edycja inline pól tekstowych, liczbowych i list wyposażenia.
- Usuwanie konfiguracji.
- Pobranie oryginalnego PDF (dla uploadów i wpisów ręcznych z załącznikiem) albo otwarcie źródłowego linku.
- Personalizacja widoku kolumn (ukrywanie, kolejność) zapisywana w przeglądarce.

### 2.4 Prywatność i SEO

- Strona jest celowo **niewidoczna dla wyszukiwarek**: `meta robots noindex,nofollow,noarchive`, nagłówek `X-Robots-Tag` na każdej odpowiedzi oraz `robots.txt` z `Disallow: /`.

## 3. Model danych pojazdu

Każdy pojazd (rekord `vehicles`) ma pola:

| Pole | Typ | Opis |
| --- | --- | --- |
| `brand`, `model`, `versionName`, `displayName` | tekst | Identyfikacja auta; `displayName` budowane automatycznie, gdy brak. |
| `currency` | tekst | Domyślnie `PLN`. |
| `basePricePln`, `totalPricePln` | liczba całkowita | Cena bazowa wersji i finalna cena konfiguracji. |
| `powerKw`, `powerHp`, `torqueNm` | liczba | Moc (kW/KM) i moment obrotowy. |
| `rangeWltpKm` | liczba | Zasięg WLTP w km. |
| `batteryCapacityKwh` | liczba | Pojemność baterii. |
| `energyConsumptionKwh100km` | liczba | Zużycie energii kWh/100 km. |
| `seats` | liczba całkowita | Liczba miejsc. |
| `fuelType`, `homologationStandard`, `technicalType` | tekst | Typ napędu, homologacja, typ techniczny. |
| `co2EmissionGkm` | liczba | Emisja CO₂ (dla aut elektrycznych zwykle 0/brak). |
| `exteriorColor` + `exteriorColorPricePln` | tekst + liczba | Kolor nadwozia i jego cena. |
| `wheels` + `wheelsPricePln` | tekst + liczba | Felgi i ich cena. |
| `interiorTrim` + `interiorPricePln` | tekst + liczba | Tapicerka/wnętrze i cena. |
| `configurationCode`, `sourceDate` | tekst | Kod konfiguracji i data źródła. |
| `standardEquipment`, `additionalEquipment`, `equipmentPackages` | listy tekstów | Wyposażenie seryjne, dodatkowe (płatne/wybrane), pakiety. |
| `notes`, `warnings` | listy tekstów | Notatki i ostrzeżenia (np. brak ceny bazowej). |
| `combustionEquivalents` | lista tekstów | Odpowiedniki spalinowe. |
| `equipmentScore` | liczba | Wynik wyposażenia (patrz §5). |

Rekord powstaje zawsze w kontekście `upload` (`source_type`: `upload` / `url` / `manual`), co pozwala odróżnić pochodzenie i obsłużyć pobieranie pliku lub link źródłowy.

## 4. Reguły ekstrakcji i normalizacji

- Gemini dostaje instrukcję, by **nie zgadywać** – pola nieznane są pomijane, a wątpliwości trafiają do `warnings`.
- Ceny normalizowane są do liczb całkowitych w PLN (usuwanie spacji, separatorów tysięcy, zamiana przecinka na kropkę).
- Każdy element wyposażenia jest osobnym wpisem i przechodzi **kanonizację etykiet** (wielkość liter, akronimy typu HUD/LED/WLTP, deduplikacja po slug). Dzięki temu „Pompa ciepła” z dwóch różnych PDF-ów to jedna pozycja w katalogu i jeden filtr.

## 5. Reguły scoringu

### 5.1 Wynik wyposażenia (`equipmentScore`)

Metryka porównawcza premiująca aktywnie wybrane opcje:

```
equipmentScore = liczba(standardEquipment) × 1
               + liczba(additionalEquipment) × 2
               + liczba(equipmentPackages) × 3
```

### 5.2 Ranking rekomendacji „value for money”

Każda metryka liczona jako stosunek cechy do ceny (na 1000 PLN), następnie normalizowana min-max w obrębie zestawu i ważona:

| Składnik | Waga | Sens |
| --- | --- | --- |
| `rangePerPrice` | 0,40 | km zasięgu WLTP na 1000 PLN. |
| `batteryPerPrice` | 0,30 | kWh baterii na 1000 PLN. |
| `equipmentPerPrice` | 0,20 | wynik wyposażenia na 1000 PLN. |
| `efficiency` | 0,10 | bonus za niskie zużycie kWh/100 km (im niżej, tym lepiej). |

Pojazd bez ceny nie może być oceniony pod kątem wartości – wypada poza wartościujące metryki. Przy remisie wyniku wygrywa tańszy pojazd. Pierwszy pojazd po sortowaniu jest oznaczany jako sugerowana rekomendacja (`isSuggestedTop`).

### 5.3 Odznaki liderów

Przyznawane pojazdom o skrajnych wartościach w zestawie:

- 💰 Najlepsza cena (min `totalPricePln`)
- 🔋 Największy zasięg (max `rangeWltpKm`)
- ⚡ Największa bateria (max `batteryCapacityKwh`)
- 🚀 Największa moc (max `powerHp`)
- 🌿 Najbogatsze wyposażenie (max `equipmentScore`)

## 6. Przeliczanie walut

- Kurs EUR pobierany z NBP (tabela A, kurs średni `mid`).
- Cache z TTL (domyślnie 12 h). Przy błędzie NBP używana jest ostatnia znana wartość oznaczona jako `stale`.
- Jeśli podano cenę tylko w jednej walucie, druga jest doliczana z kursu.

## 7. Ograniczenia i założenia

- Jakość danych z PDF/linku zależy od modelu Gemini; pola niepewne mają trafiać do `warnings`, ale model może się mylić – dane warto zweryfikować wzrokowo.
- Dedykowane parsery istnieją tylko dla Honda i Ford; inne marki idą ścieżką tekstową (mniej precyzyjną).
- W trybie `memory` dane nie przetrwają restartu serwera.
- Aplikacja nie ma logowania ani kont – każdy z dostępem do adresu widzi i edytuje te same dane.
- Limit uploadów: domyślnie 20 na okno 15 minut (per instancja).

## 8. Wymagania bezpieczeństwa

Aplikacja działa bez kont użytkowników i jest publicznie dostępna pod adresem, dlatego priorytetem jest ochrona przed nadużyciem zasobów, atakami botów i nadużyciem funkcji importu. Wymagania:

- **Ograniczanie ruchu (rate limiting)** – globalny limit dla całego API, ostrzejszy limit dla operacji zmieniających dane oraz dla kosztownych operacji uploadu/importu (chroni budżet Gemini i bazę przed zalaniem/DDoS aplikacyjnym). Limity konfigurowalne, naliczane per IP klienta (z uwzględnieniem proxy).
- **Nagłówki bezpieczeństwa przeglądarki** – Content-Security-Policy (bez inline JS), ochrona przed clickjackingiem (X-Frame-Options/`frame-ancestors`), nosniff, ograniczona Referrer-Policy, HSTS, Permissions-Policy.
- **Ochrona przed SSRF** – import z linku nie może pobierać adresów prywatnych/zarezerwowanych ani metadanych chmury; walidacja po rozwiązaniu DNS, także dla przekierowań.
- **Twarde limity rozmiaru** – maksymalny rozmiar żądania JSON, pliku PDF oraz treści pobieranej z linku; limit liczby plików i pól formularza; timeouty operacji sieciowych.
- **Higiena danych** – escapowanie danych przed wstawieniem do DOM (ochrona przed XSS), parametryzowane zapytania SQL (brak SQL injection), sanityzacja nazw plików, brak path traversal przy pobieraniu plików.
- **Nieujawnianie szczegółów** – błędy `5xx` zwracają komunikat ogólny; pełne błędy trafiają tylko do logów serwera.

Szczegóły implementacyjne i wartości domyślne: [dokumentacja techniczna › Bezpieczeństwo](dokumentacja-techniczna.md#9-bezpieczeństwo-i-odporność).

## 9. Wymagania niefunkcjonalne

- Node.js ≥ 20.
- Działanie na hostingu DirectAdmin/CloudLinux z Passengerem.
- Odporność na chwilowe przeciążenia Gemini (ponowienia + pula kluczy) i NBP (cache + stale).
- Responsywność interfejsu (pełna, zweryfikowana od 320 do 1920 px).
