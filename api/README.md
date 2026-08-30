# Wspólna płatność za figurki AXI

Zmiana jest przygotowana do konfiguracji. Nie publikuj nowego formularza na `main`, dopóki endpoint Stripe nie zostanie wdrożony i sprawdzony w trybie testowym.

## Uruchomienie

GitHub Pages obsługuje statyczną stronę, ale nie wykonuje kodu serwerowego. Moduł `api/server.mjs` wymaga osobnego hostingu Node.js 22+ z HTTPS. Nie ma zależności npm. Uruchom z katalogu repozytorium:

```sh
node api/server.mjs
```

W panelu sekretów hostingu ustaw `STRIPE_SECRET_KEY` (najpierw klucz testowy). Nie wklejaj go do rozmowy, plików strony ani GitHuba. Opcjonalnie ustaw `PORT`. `AXI_SITE_ORIGIN` domyślnie wynosi `https://axi3d.pl`, a `AXI_ALLOWED_ORIGINS` to `https://axi3d.pl,https://www.axi3d.pl`. Podczas testów dodaj dokładny adres testowej strony do dozwolonych źródeł. CORS nie jest uwierzytelnianiem; ogranicz ruch również na poziomie hostingu. Serwer ma limit 120 prób POST na minutę na proces i limit treści 8 KiB.

W `checkout-config.js` wpisz publiczny adres HTTPS endpointu `/checkout-session`. Ten plik nie zawiera żadnego klucza. Bez adresu pojedyncze zamówienie zachowuje dotychczasowy link Stripe; zamówienie z kilkoma figurkami nie zostanie wysłane ani opłacone częściowo.

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
- W trybie live porównaj cennik, VAT i dostawę z dotychczasowymi Payment Links. Endpoint odtwarza jedynie widoczne ceny brutto figurek; nie konfiguruje automatycznie podatków, rabatów ani opłat za dostawę. Ustawienia dotychczasowych linków Stripe nie przechodzą do nowych sesji.
- Po przejściu na live zmień sekret w panelu hostingu i opublikuj kod strony.

Samo zgłoszenie w Basin i wejście na `dziekujemy.html` nie są dowodem zapłaty. Przed realizacją sprawdź w Stripe status `paid`, kwotę i numer zamówienia. Automatyczna realizacja wymaga osobnej obsługi podpisanych webhooków, w tym płatności asynchronicznych — nie została tutaj uruchomiona.

Powrót ze Stripe anuluje nawigację i ponownie ładuje formularz, tak jak wcześniej. Przeglądarka nie odtworzy wybranych plików po ponownym wczytaniu strony; przesłane zdjęcia pozostają w Basin. Link do płatności ze zgłoszenia pozwala ją dokończyć bez ponownego zamawiania.

Zachowano istniejące przedziały cenowe. Rozmiary 61–69, 101–109, 151–159 i 201–209 mm są odrzucane z czytelnym komunikatem, bo nie mają ceny w obecnym cenniku. Cennik nie został rozszerzony bez decyzji właściciela.

Testy logiki serwera i formularza (bez połączeń z Stripe/Basin): `npm ci` i `npm test`. Testy formularza korzystają z jsdom, bez uruchamiania przeglądarki. `npm run check` sprawdza składnię. Produkcyjny serwer nie wymaga zależności npm.
