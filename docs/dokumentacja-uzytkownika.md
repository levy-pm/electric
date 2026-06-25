# Dokumentacja użytkownika

Przewodnik krok po kroku po porównywarce aut elektrycznych. Nie wymaga wiedzy technicznej.

## 1. Pierwsze spojrzenie na ekran

Po otwarciu aplikacji zobaczysz:

- **Górny pasek** – tytuł oraz przyciski **⚙️ Kolumny** i **📄 Dodaj konfigurację**.
- **Karta „Najlepsza wartość”** – auto z najlepszym stosunkiem parametrów do ceny (gdy są już dane).
- **Karty liderów** – najtańsze, z największym zasięgiem, baterią, mocą i najbogatszym wyposażeniem.
- **Pasek filtrów** – wyszukiwarka i filtr po wyposażeniu.
- **Tabela** – wszystkie dodane konfiguracje.

Gdy nie ma jeszcze danych, karta zachęca do dodania pierwszej konfiguracji.

## 2. Dodawanie auta

Kliknij **📄 Dodaj konfigurację**. Otworzy się okno z trzema zakładkami.

### 2.1 Zakładka „Plik” (PDF)

1. Wybierz jeden lub więcej plików PDF z konfiguratora (do 20 MB każdy).
2. Kliknij **Dodaj**.
3. Aplikacja odczyta dane i doda wiersze do tabeli. Przy wielu plikach są one przetwarzane po kolei.

> PDF pobierzesz zwykle z konfiguratora producenta jako „podsumowanie konfiguracji” lub ofertę.

### 2.2 Zakładka „Link”

1. Wklej adres URL konfiguracji (np. link z konfiguratora Honda lub Ford, albo link do PDF).
2. Kliknij **Dodaj**.
3. Dla Hondy i Forda dane są czytane wprost z systemu producenta. Inne linki są analizowane na podstawie treści strony.

### 2.3 Zakładka „Ręcznie”

Użyj, gdy nie masz PDF-a ani linku. Wpisz przynajmniej **markę lub model**, a następnie tyle pól, ile znasz: ceny, zasięg, baterię, moc, wyposażenie (po jednej pozycji w wierszu). Możesz dołączyć plik PDF jako załącznik. Kliknij **Dodaj**.

## 3. Czytanie rankingu

- **Karta „Najlepsza wartość”** wskazuje auto z najlepszym wynikiem „wartość za pieniądze” – ile zasięgu, baterii i wyposażenia dostajesz na każde wydane 1000 PLN, z premią za niskie zużycie energii.
- **Odznaki** na autach oznaczają rekordy w zestawie:
  - 💰 najlepsza cena,
  - 🔋 największy zasięg,
  - ⚡ największa bateria,
  - 🚀 największa moc,
  - 🌿 najbogatsze wyposażenie.
- **Ceny** widać w PLN, a pod spodem wartość w EUR przeliczoną po aktualnym kursie NBP. Jeśli kurs jest chwilowo niedostępny, używana jest ostatnia znana wartość.

## 4. Sortowanie, szukanie i filtrowanie

- **Sortowanie** – kliknij nagłówek kolumny (np. cena, zasięg), aby uporządkować tabelę.
- **Wyszukiwanie** – pole „Szukaj” filtruje po marce, modelu, kolorze i wyposażeniu.
- **Filtr wyposażenia** – rozwiń listę „Wyposażenie” i zaznacz funkcje (np. „Pompa ciepła”). Tabela pokaże tylko auta, które je mają. Przycisk **Wyczyść wybór** kasuje zaznaczenie, a **Wyczyść wszystko** resetuje wszystkie filtry.

## 5. Dostosowanie kolumn

Kliknij **⚙️ Kolumny**:

- włącz lub wyłącz widoczność poszczególnych kolumn,
- **Pokaż wszystkie** – włącza komplet,
- **Widok domyślny** – przywraca standardowy układ.

Twój układ kolumn jest zapamiętywany w przeglądarce – przy kolejnej wizycie zobaczysz go ponownie.

## 6. Edycja i usuwanie

- **Edycja inline** – kliknij komórkę w tabeli, aby poprawić wartość (tekst, liczbę lub listę wyposażenia). Zmiana zapisuje się od razu.
- **Wyposażenie** – pozycje seryjne i dodatkowe edytujesz w osobnym oknie z zakładkami; możesz dopisywać nowe pozycje.
- **Usuwanie** – akcja usunięcia konfiguracji prosi o potwierdzenie w osobnym oknie.
- **Plik / link źródłowy** – dla aut z PDF możesz pobrać oryginalny plik, a dla aut z linku otworzyć źródłowy adres.

## 7. Odpowiedniki spalinowe

Dla każdego auta aplikacja podpowiada 3–5 modeli spalinowych o zbliżonych gabarytach i segmencie. To punkt odniesienia, gdy porównujesz „elektryka” do tego, co znasz z rynku spalinowego.

## 8. Najczęstsze problemy

| Objaw | Przyczyna | Co zrobić |
| --- | --- | --- |
| „Model analizy jest chwilowo przeciążony” | Gemini ma wysoki ruch. | Spróbuj ponownie za kilka minut – aplikacja sama ponawia próby. |
| „Limit zapytań Gemini został osiągnięty” | Wyczerpany limit klucza API. | To nie błąd PDF-a. Spróbuj później lub poproś administratora o zmianę klucza/planu. |
| „Dozwolone są tylko pliki PDF” | Wybrano plik w innym formacie. | Wgraj plik `.pdf`. |
| „Limit uploadów został chwilowo osiągnięty” | Za dużo wgrań w krótkim czasie. | Odczekaj kilkanaście minut. |
| „Zbyt wiele zapytań” / błąd 429 | Wysłano bardzo dużo żądań w krótkim czasie (limit ochronny). | Odczekaj minutę i spróbuj ponownie. |
| „Adres URL wskazuje na adres prywatny” | Wklejono link do adresu lokalnego/wewnętrznego. | Wklej publiczny link do konfiguratora (https). |
| Brak ceny EUR pod ceną PLN | Cena nie została wykryta lub brak kursu. | Uzupełnij cenę ręcznie; kurs wróci po odświeżeniu. |
| Niepełne dane po imporcie | Konfigurator miał nietypowy układ. | Uzupełnij brakujące pola edycją inline; sprawdź kolumnę z ostrzeżeniami. |

## 9. Prywatność i bezpieczeństwo

- Strona jest celowo ukryta przed wyszukiwarkami (brak indeksowania). Nie ma kont użytkowników – każdy z dostępem do adresu widzi te same dane.
- Import z linku przyjmuje wyłącznie publiczne adresy `http`/`https` – linki do adresów lokalnych i wewnętrznych są odrzucane.
- Aplikacja stosuje limity liczby żądań, dzięki czemu jest odporna na zalewanie ruchem; przy bardzo intensywnym korzystaniu możesz chwilowo zobaczyć komunikat o limicie – to działanie zamierzone.
