# Wspólna płatność za figurki AXI

Zmiana jest przygotowana do konfiguracji. Nie publikuj nowego formularza na `main`, dopóki endpoint Stripe nie zostanie wdrożony i sprawdzony w trybie testowym.

## Uruchomienie

GitHub Pages obsługuje statyczną stronę, ale nie wykonuje kodu serwerowego. Moduł `api/server.mjs` wymaga osobnego hostingu Node.js 22+ z HTTPS. Nie ma zależności npm. Uruchom z katalogu repozytorium:

```sh
node api/server.mjs
```

W panelu sekretów hostingu ustaw `STRIPE_SECRET_KEY` (najpierw klucz testowy). Nie wklejaj go do rozmowy, plików strony ani GitHuba. Opcjonalnie ustaw `PORT`. `AXI_SITE_ORIGIN` domyślnie wynosi `https://axi3d.pl`, a `AXI_ALLOWED_ORIGINS` to `https://axi3d.pl,https://www.axi3d.pl`. Podczas testów dodaj dokładny adres testowej strony do dozwolonych źródeł. CORS nie jest uwierzytelnianiem; ogranicz ruch również na poziomie hostingu. Serwer ma limit 120 prób POST na minutę na proces i limit treści 8 KiB.

W `checkout-config.js` wpisz publiczny adres HTTPS endpointu `/checkout-session`. Ten plik nie zawiera żadnego klucza. Bez adresu pojedyncze zamówienie zachowuje dotychczasowy link Stripe; zamówienie z kilkoma figurkami nie zostanie wysłane ani opłacone częściowo.

### Render — przygotowanie do testów

Repozytorium zawiera `render.yaml`: pojedyncza usługa Node.js we Frankfurcie, plan `free`, bez bazy danych i bez automatycznych wdrożeń. Plik niczego sam nie uruchamia ani nie zamawia płatnego planu. W panelu Render utwórz **New → Blueprint**, wybierz `Azya420/AXI` i gałąź `codex/multi-figurine-checkout`. Sprawdź koszt na ekranie podsumowania przed utworzeniem usługi. Sekret `STRIPE_SECRET_KEY` ma `sync: false`: wpisujesz go tylko w panelu Render, na początek z trybu testowego/sandbox Stripe.

Po wdrożeniu sprawdź `/health` (oba pola `ok` i `checkoutConfigured` powinny być `true`; to nie sprawdza jeszcze ważności klucza). Przekaż publiczny adres usługi do konfiguracji formularza. Do testu z lokalnej strony dopisz np. `http://localhost:8080` do `AXI_ALLOWED_ORIGINS` w panelu Render i uruchom statyczną stronę lokalnie. Nie dodawaj testowego endpointu do publicznej strony na `main`.

Darmowa usługa może wymagać wybudzenia: formularz po 8 sekundach pokazuje informację o oczekiwaniu, a po 120 sekundach przerywa oczekiwanie i pozwala ponowić bez utraty pól/zdjęć. Nie ma pętli zapytań utrzymującej usługę aktywną. Render nie zaleca darmowych instancji do produkcji. Decyzja o płatnym planie należy do właściciela; nie została podjęta w tej zmianie.

Po udanych testach wybierz docelowy plan, usuń lokalne źródło z CORS, ustaw sekret live, podmień `branch` w Blueprint na `main` i skoordynuj wdrożenie backendu z publikacją formularza. Jeżeli zmienisz plan w panelu, odzwierciedl tę zmianę w `render.yaml`, aby synchronizacja go nie cofnęła. Automatyczne wdrożenia pozostają wyłączone.

Dokumentacja: [Render Blueprint](https://render.com/docs/blueprint-spec), [ograniczenia darmowych usług](https://render.com/docs/free).

### Ustawienia Stripe sprawdzone 30.08.2026

Odczytano pięć aktywnych Payment Links używanych w `order-form.mjs` na koncie `axi3d`. Nie zmieniano linków i nie tworzono płatności. Wszystkie mają walutę PLN, ilość 1 i powrót do `https://axi3d.pl/dziekujemy.html`.

| Przedział strony | Cena | Obecny identyfikator ceny w Stripe |
| --- | --- | --- |
| 20–60 mm | 200 zł | `price_1TwIbPJ4e7f2KOLDScleAXhz` |
| 70–100 mm | 220 zł | `price_1TwIbcJ4e7f2KOLDyHZCbX86` |
| 110–150 mm | 250 zł | `price_1TwIbuJ4e7f2KOLDloTD3n2J` |
| 160–200 mm | 280 zł | `price_1TwIcJJ4e7f2KOLDdx8kPsRK` |
| 210–250 mm | 340 zł | `price_1TwIcbJ4e7f2KOLDkqpbfLA0` |

Linki nie doliczają dostawy, nie mają automatycznego podatku ani kodów rabatowych; tworzenie faktur jest wyłączone. Adres rozliczeniowy zbierany jest automatycznie, klient tworzony tylko w razie potrzeby, metody płatności wynikają z konfiguracji konta. Endpoint zachowuje te zasady. Nie oznacza to oceny prawidłowości podatków sklepu. Nazwa najtańszego produktu w Stripe to „Figurka 3-6cm”, ale formularz od początku dopuszcza 20–60 mm; zachowano zakres strony bez samodzielnej zmiany cennika.

Endpoint nadal używa `price_data` z kwotami serwerowego cennika i nazwą/rozmiarem każdej figurki, zamiast identyfikatorów cen live. Dzięki temu nie zależy od produktów dostępnych tylko na koncie live i można go sprawdzić z kluczem testowym. Nowe sesje nie dziedziczą automatycznie późniejszych zmian Payment Links: zmianę cen, podatków lub dostawy należy wprowadzić również w kodzie. Dostęp wtyczki obejmował tylko konto live — pełny test płatności nadal wymaga trybu testowego/sandbox i hostingu.

## Przebieg

1. Formularz zbiera do 20 figurek, każdą z osobnym opisem, rozmiarem i zdjęciami.
2. Serwer otrzymuje tylko rozmiary, e-mail i identyfikator zamówienia. Ceny odczytuje z `pricing.mjs`; nie ufa cenom ani ilościom z przeglądarki.
3. Stripe tworzy jedną sesję z osobną pozycją dla każdej figurki, ceną w PLN i ilością 1. Nie trzeba tworzyć nowych stałych linków dla każdej kombinacji rozmiarów.
4. Formularz wysyła jedno zgłoszenie multipart do istniejącego Basin. Zdjęcia mają osobne nazwy pól, a czytelne podsumowanie przypisuje załączniki do figurek. `numer_zamowienia` łączy zgłoszenie z `client_reference_id` i metadanymi Stripe. Zgłoszenie zawiera także link do dokończenia płatności.
5. Dopiero po udanym zgłoszeniu klient przechodzi do Stripe. Gdy Stripe lub Basin zwróci błąd, pola i pliki zostają w formularzu. Usunięto automatyczne wysyłanie do drugiego konta Basin: przy niejednoznacznym błędzie sieci mogło to dublować zgłoszenia. Jeśli odpowiedź Basin zaginie, ręczne ponowienie nadal może stworzyć dwa zgłoszenia — rozpoznaj je po tym samym numerze zamówienia.

## Kontrola przed publikacją

- Testowa płatność: jedna figurka; kilka w tej samej cenie; różne rozmiary (np. 32, 80 i 120 mm = 670 zł).
- Potwierdź dostarczenie wszystkich zdjęć i danych wspólnej dostawy przez Basin; sprawdź limity załączników i zgłoszeń na swoim planie.
- Sprawdź odpowiedź po błędzie Stripe/Basin i możliwość ponowienia bez utraty danych.
- Porównanie cennika i ustawień obecnych Payment Links wykonano 30.08.2026 (powyżej). Ponów sprawdzenie przed publikacją, jeżeli od tego czasu zmieniono konfigurację Stripe. Endpoint nie dolicza nowych opłat za dostawę ani podatków.
- Po przejściu na live zmień sekret w panelu hostingu i opublikuj kod strony.

Samo zgłoszenie w Basin i wejście na `dziekujemy.html` nie są dowodem zapłaty. Przed realizacją sprawdź w Stripe status `paid`, kwotę i numer zamówienia. Automatyczna realizacja wymaga osobnej obsługi podpisanych webhooków, w tym płatności asynchronicznych — nie została tutaj uruchomiona.

Powrót ze Stripe anuluje nawigację i ponownie ładuje formularz, tak jak wcześniej. Przeglądarka nie odtworzy wybranych plików po ponownym wczytaniu strony; przesłane zdjęcia pozostają w Basin. Link do płatności ze zgłoszenia pozwala ją dokończyć bez ponownego zamawiania.

Zachowano istniejące przedziały cenowe. Rozmiary 61–69, 101–109, 151–159 i 201–209 mm są odrzucane z czytelnym komunikatem, bo nie mają ceny w obecnym cenniku. Cennik nie został rozszerzony bez decyzji właściciela.

Testy logiki serwera i formularza (bez połączeń z Stripe/Basin): `npm ci` i `npm test`. Testy formularza korzystają z jsdom, bez uruchamiania przeglądarki. `npm run check` sprawdza składnię. Produkcyjny serwer nie wymaga zależności npm.
