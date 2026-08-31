# Wspólna płatność za figurki AXI

## Aktualizacja 31.08.2026 — nowy cennik i automatyczne 30%

| Wysokość | Nowa cena bazowa | Do zapłaty bez dodatkowego kodu |
| --- | --- | --- |
| 20–60 mm | 140 zł | 98 zł |
| 61–100 mm | 180 zł | 126 zł |
| 101–150 mm | 250 zł | 175 zł |
| 151–200 mm | 320 zł | 224 zł |
| 201–250 mm | 400 zł | 280 zł |

`pricing.mjs` definiuje ceny bazowe w groszach oraz `AUTOMATIC_DISCOUNT_PERCENT = 30`. `amount` oznacza kwotę po tej obniżce. Formularz, suma, analityka i serwer korzystają z tych samych cen. Zakres 20–250 mm jest ciągły; nadal wymagamy pełnych milimetrów. Rabat nie ma jeszcze ustalonej daty zakończenia.

Stripe otrzymuje już obniżone `unit_amount` (9800/12600/17500/22400/28000). Nie tworzymy kuponu, nie potrzebujemy nowych uprawnień klucza do automatycznej obniżki i nie zmieniamy istniejących Payment Links ani sesji. Dotychczasowe kody pozostają dodatkowym rabatem od obniżonej sumy; warunki i minimum sprawdza Stripe. Np. 32 mm kosztuje 98 zł, a poprawny kod 10% obniży tę kwotę do 88,20 zł.

Basin zapisuje cenę bazową całego koszyka (`cena_przed_rabatem`), obniżkę automatyczną (`rabat_automatyczny`, `rabat_automatyczny_procent`), sumę przed dodatkowym kodem (`cena_przed_kodem`), ewentualny `rabat_z_kodu`, łączny `rabat` i ostateczną `cena`. Metadane Stripe zawierają wersję cennika i procent automatycznej obniżki. Pole `total_details.amount_discount` w Stripe dotyczy wyłącznie dodatkowego kuponu — automatyczna obniżka jest już w cenach pozycji.

### Oznaczenie promocji

Właściciel potwierdził, że podane ceny bazowe były ostatnimi cenami przed obniżką. Zamiast wcześniejszego ogólnego banera formularz pokazuje dopasowany do motywu AXI panel „Własna figurka już od 98 zł” z oznaczeniem −30% i informacją, że promocja obejmuje wszystkie rozmiary. Kwota „od” jest pobierana automatycznie jako najniższa cena do zapłaty ze wspólnego cennika. Na kartach po wpisaniu rozmiaru nadal widać przekreśloną cenę przed obniżką, cenę do zapłaty oraz oznaczenie −30%. Wygląd nie zmienia kwot, kodów ani zasad płatności.

Potwierdzenie ostatniej ceny nie jest potwierdzeniem najniższej ceny z 30 dni. Nie oznaczamy tych wartości jako „najniższa cena z 30 dni”. Uzupełnienie tej informacji wymaga rzeczywistej historii cen od właściciela; ta zmiana nie stanowi oceny zgodności prawnej oznaczeń: [informacje UOKiK](https://prawakonsumenta.uokik.gov.pl/prawo-do-informacji/informacje-o-obnizkach-cen/).

### Bezpieczna publikacja

Wymagana wersja cennika to `2026-08-31-sale30-v4`. Nowy backend odrzuca stare formularze (HTTP 409 `pricing_changed`) przed utworzeniem sesji Stripe. Nowy formularz wymaga od backendu tej samej wersji, zgodnych kwot bazowych, obniżki automatycznej i kwoty końcowej, również bez kodu. Nie wysyła Basin ani nie przekierowuje przy rozbieżności. Usunięto awaryjne przekierowania do starych Payment Links, ponieważ miałyby nieaktualne ceny.

Opublikuj ten sam aktualny `main` w GitHub Pages i na Renderze (**Manual Deploy → Deploy latest commit**). Obie usługi muszą zakończyć publikację, zanim nowe zamówienia będą działać. Przez czas różnicy wersji lub ze starej otwartej karty formularz może prosić o odświeżenie, ale nie naliczy niezgodnej kwoty. `/health` udostępnia `pricingVersion`. Nie zmieniaj klucza produkcyjnego. Testy lokalne używają atrap Stripe/Basin, bez płatności i wysyłania zgłoszeń; nie zastępują sprawdzenia obu wdrożeń.

Poniżej zachowano historyczne etapy prac. Opis zgodności bez kodu ze starszym backendem oraz dawne kwoty dotyczą poprzednich wersji.

Weryfikacja tej aktualizacji: kontrola składni oraz 43 testy przeszły. Testy obejmują wszystkie 231 dopuszczalnych rozmiarów, obniżone pozycje Stripe, sumę 903 zł za pięć progów, dodatkowy kod, analitykę i odmowę płatności przy różnicach wersji/cen. Bez rzeczywistych obciążeń i zgłoszeń Basin.

## Aktualizacja 31.08.2026 — kod na stronie i akceptacja regulaminu

Kod promocyjny wpisuje się teraz w końcowym oknie formularza AXI3D, przy danych dostawy. Usunięto oba wskazane przez właściciela opisy pod listą figurek. Przed przyciskiem znajduje się niezaznaczony, wymagany checkbox „Akceptuję regulamin sklepu”, z linkiem otwieranym w nowej karcie.

Przy wpisanym kodzie przycisk „Sprawdź kod i cenę” przygotowuje sesję Stripe, ale nie wysyła zgłoszenia Basin i nie przekierowuje klienta. Backend wyszukuje aktywny kod przez `/v1/promotion_codes`, przekazuje zaufany identyfikator w `discounts[0][promotion_code]` i odczytuje faktyczny rabat z sesji Stripe. Formularz pokazuje rabat i końcową cenę. Dopiero „Przejdź do płatności” ponownie sprawdza kod/cenę i wysyła zamówienie. Zmieniona cena wymaga ponownego potwierdzenia. Zmiana kodu, rozmiarów lub e-maila usuwa poprzednią wycenę.

Nie ma już pola dodawania kodu w Stripe. Przy kodzie pomijamy `allow_promotion_codes`, bez kodu ustawiamy `false`; nie łączymy tego parametru z `discounts`. Niepoprawny kod, brak uprawnień, zerowy rabat dla wybranych produktów i niezgodne kwoty blokują przejście — nie ma cichego powrotu do pełnej ceny. Nie wyliczamy kuponów lokalnie. Obsługiwane są kody publiczne, bez przypisania do konkretnego `customer` / `customer_account`; sklep nie ma uwierzytelnionych kont klientów. Inne ograniczenia kuponu sprawdza Stripe. Nie tworzono nowych kodów ani rabatów.

Akceptacja jest wymagana zarówno w formularzu (także przy drugim kliknięciu), jak i w API tworzącym sesję (`termsAccepted: true`). Jest zapisywana w zgłoszeniu Basin oraz metadanych sesji i PaymentIntent razem z wersją regulaminu `2026-08-30`. Endpoint odczytu statusu istniejącej płatności pozostaje dostępny bez ponownej akceptacji. To zapis oświadczenia klienta, nie system uwierzytelniania ani gwarancja zgodności prawnej.

Basin otrzymuje `kod_promocyjny`, `cena_przed_rabatem`, `rabat`, końcową `cena` oraz akceptację i wersję regulaminu. Dwa pola cenowe rabatu dodajemy tylko dla zamówienia z kodem. Opisy pozycji zachowują ceny katalogowe. Przed realizacją należy sprawdzić status i końcową kwotę w Stripe; samo wyliczenie ceny nie jest płatnością. Przy rabacie 100% kwota może wynosić 0 — takie zamówienie wymaga odrębnego sprawdzenia ukończenia sesji (nie będzie zwykłego obciążenia karty). Zachowano istniejącą analitykę i weryfikację płatności z `session_id`.

### Weryfikacja

`npm run check` oraz 37 testów przeszły. Obejmują m.in. obowiązkową akceptację, brak uprawnień odczytu kodów, odrzucanie błędnych kodów bez powrotu do pełnej ceny, ceny po rabacie procentowym/kwotowym/100%, ponowne potwierdzenie zmienionej ceny i zachowanie dotychczasowej analityki. Nie wykonano rzeczywistej płatności ani wysyłki Basin.

### Wdrożenie

1. Klucz produkcyjny używany przez Render potrzebuje dodatkowo **Promotion Codes: Read** (API `promotion_code_read`), oprócz dotychczasowego dostępu Checkout Sessions. Nie potrzeba uprawnień tworzenia kuponów/kodów ani odczytu Customers. Nie możemy potwierdzić uprawnień klucza serwera na podstawie uprawnień osobnego połączenia wtyczki Stripe.
2. Po publikacji na `main` wykonaj **Manual Deploy → Deploy latest commit** na `axi-checkout`. Kod w GitHub Pages i kod backendu to osobne wdrożenia. Nie przełączaj klucza produkcyjnego na testowy.
3. Nowy formularz blokuje użycie kodu, jeżeli stary backend nie potwierdzi rabatu (`checkoutVersion: 2`). Bez kodu zachowuje zgodność ze starszą odpowiedzią. Po wdrożeniu backendu odśwież już otwarte formularze: starsza wersja bez checkboxa nie utworzy nowej sesji.
4. Sprawdź kod w osobnym środowisku testowym. Lokalne testy nie tworzą rzeczywistych sesji rabatowych i nie wysyłają Basin. Kontrola dostępu do kodów na wdrożonym API może użyć nieistniejącego kodu: oczekiwane 400, a 503 z logiem `promotion_lookup` / 403 wskazuje brak uprawnienia.

Dokumentacja: [wyszukiwanie kodów](https://docs.stripe.com/api/promotion_codes/list), [sesje Checkout](https://docs.stripe.com/api/checkout/sessions/create). Poniżej zachowano wcześniejsze etapy prac; informacja o wpisywaniu kodu na Stripe opisuje poprzednią wersję.

## Kody promocyjne — gałąź robocza `codex/promotion-codes`

Ta gałąź dodaje `allow_promotion_codes: true` przy tworzeniu Checkout Session. Klient wpisuje kod na stronie Stripe i widzi kwotę po rabacie przed zapłatą. Nie ma listy kodów ani obliczania rabatu po stronie przeglądarki: Stripe sprawdza aktywność, datę ważności, limity i warunki kodu. Nie zmieniono cennika, podatków, dostawy ani istniejących Payment Links.

Formularz pokazuje sumę **przed rabatem** i wskazuje miejsce wpisania kodu. Zgłoszenie Basin powstaje przed Checkout, dlatego zachowuje oryginalną cenę i dodatkowo zawiera `uwaga_dotyczaca_ceny`. Nie zawiera jeszcze zastosowanego kodu ani ostatecznego rabatu. Przed realizacją sprawdź końcową kwotę, rabat i status płatności w Stripe, używając numeru zamówienia. Nie oczekuj, że kwota po rabacie zawsze będzie równa `cena` w Basin.

### Przygotowanie i test

- W Stripe potrzebny jest kupon określający rabat oraz aktywny kod promocyjny powiązany z kuponem. Ta zmiana nie tworzy kodów ani nie ustala wysokości zniżek.
- Dla rabatu na całe zamówienie użyj kuponu bez ograniczenia do wybranych produktów. Integracja tworzy pozycje przez `price_data`; kupony przypisane do produktów starych Payment Links nie obejmą automatycznie nowych pozycji.
- Kody testowe i live są oddzielne. Sprawdzaj funkcję na osobnej usłudze z kluczem testowym i gałęzią `codex/promotion-codes`, korzystając z `/preview/`. Nie przełączaj działającego `axi-checkout` ani jego klucza na testowy. Utworzenie nowej usługi może być płatne — nie utworzono jej w ramach tej zmiany.
- Sprawdź koszyk np. 32/80/120 mm = 670 zł, poprawny kod procentowy i kwotowy, kod nieaktywny/wygasły oraz usunięcie kodu. Konkretny kod i wysokość rabatu należy wybrać w Stripe; nie zakładaj, że jakikolwiek przykładowy kod już istnieje.
- Testy lokalne sprawdzają parametry wysyłane do Stripe i dotychczasową logikę formularza. Nie zastępują testu faktycznego zastosowania kuponu w piaskownicy.
- Wdrożenie wymaga osobnej zgody na scalenie oraz wdrożenia backendu na Renderze. Samo wgranie HTML nie włączy pola w Stripe. Istniejące sesje i awaryjne Payment Links pozostają bez zmian.

Dokumentacja: [rabaty w Checkout](https://docs.stripe.com/payments/checkout/discounts), [kupony i kody promocyjne](https://docs.stripe.com/billing/subscriptions/coupons).

Poniższe sekcje dokumentują działającą wersję `main` i wcześniejsze etapy wdrożenia. Włączenie kodów w tej gałęzi jest świadomym odstępstwem od pierwotnego ustawienia bez rabatów.

## Aktualny stan — płatności live potwierdzone

Po zmianach właściciela Render zwrócił aktualny kod `69587a5` oraz sesję live. Odczyt tej sesji przez API konta AXI3D potwierdził `livemode: true`, walutę PLN i trzy pozycje: 32 mm = 200 zł, 80 mm = 220 zł, 120 mm = 250 zł, razem 670 zł. Status był `unpaid`; nie wykonano obciążenia ani zgłoszenia Basin. To potwierdza tworzenie sesji live, nie pełną realizację zamówienia.

Właściciel poinformował o wykupieniu płatnego Rendera. Dokładny plan nie jest widoczny przez publiczny endpoint. Z `render.yaml` usunięto `plan: free`: brak pola zachowuje bieżący plan istniejącej usługi, więc synchronizacja nie powinna cofnąć ręcznego upgrade'u. Utworzenie NOWEJ usługi z tego pliku korzysta z domyślnego płatnego planu Rendera; przed utworzeniem należy sprawdzić koszt. Nie utworzono nowej usługi ani nie zmieniono planu przez API.

Ta korekta dotyczy tylko konfiguracji i dokumentacji; nie wymaga ponownego wdrożenia kodu płatności. Poniżej pozostawiono historyczne etapy uruchomienia.

## Uruchomienie live — 30.08.2026

Właściciel zlecił publikację wszystkich zmian na `main`. Testy piaskownicy i formularza przeszły, ale kontrolne żądanie do działającego Rendera nadal zwróciło `cs_test_` pomimo deklaracji dodania klucza „real1”. Sama nazwa klucza w Stripe nie zmienia konfiguracji serwera.

Aby aktywować płatności produkcyjne w istniejącej usłudze Render:

1. W **Environment** ustaw wartość **STRIPE_SECRET_KEY** na klucz live (najlepiej restricted `rk_live_`, z uprawnieniem zapisu Checkout Sessions). „real1” może być nazwą klucza w Stripe, ale nie nazwą zmiennej odczytywanej przez aplikację. Nie zapisuj klucza w repozytorium ani rozmowie.
2. W **Settings → Build & Deploy → Branch** ustaw **main**. Samo scalenie kodu i zmiana `render.yaml` nie potwierdzają aktualizacji istniejącej usługi.
3. Zapisz ustawienia i wykonaj **Manual Deploy → Deploy latest commit**. Sprawdź SHA w `/health`, następnie utworzenie sesji `cs_live_` oraz prawidłową sumę. `/health` nie potwierdza trybu ani uprawnień klucza.

Formularz publiczny odrzuca sesje testowe przed wysłaniem zgłoszenia Basin i przed przekierowaniem. Dopóki backend zwraca `cs_test_`, płatności z nowego formularza są niedostępne; pola i zdjęcia pozostają zachowane. Po aktywowaniu prawidłowego klucza live nie trzeba ponownie zmieniać kodu formularza. Podgląd `/preview/` jest wtedy wyłączony.

Plan pozostaje `free`; nie zamówiono płatnej usługi. Automatyczne wdrożenia pozostają wyłączone. Odbioru załączników po stronie Basin nie potwierdzono rzeczywistym zgłoszeniem. Przed realizacją zamówienia trzeba ręcznie sprawdzić płatność w Stripe.

Poniższe sekcje opisują również wcześniejszą konfigurację i wyniki testów; aktualna docelowa gałąź to `main`.

## Uruchomienie

GitHub Pages obsługuje statyczną stronę, ale nie wykonuje kodu serwerowego. Moduł `api/server.mjs` wymaga osobnego hostingu Node.js 22+ z HTTPS. Nie ma zależności npm. Uruchom z katalogu repozytorium:

```sh
node api/server.mjs
```

W panelu sekretów hostingu ustaw `STRIPE_SECRET_KEY` (najpierw klucz testowy). Nie wklejaj go do rozmowy, plików strony ani GitHuba. Opcjonalnie ustaw `PORT`. `AXI_SITE_ORIGIN` domyślnie wynosi `https://axi3d.pl`, a `AXI_ALLOWED_ORIGINS` to `https://axi3d.pl,https://www.axi3d.pl`. Podczas testów dodaj dokładny adres testowej strony do dozwolonych źródeł. CORS nie jest uwierzytelnianiem; ogranicz ruch również na poziomie hostingu. Serwer ma limit 120 prób POST na minutę na proces i limit treści 8 KiB.

W `checkout-config.js` ustawiono publiczny adres `https://axi-checkout.onrender.com/checkout-session`. Ten plik nie zawiera żadnego klucza. Jest to adres produkcyjny formularza na `main`; działająca usługa musi używać klucza live. Jeśli adres zostanie wyczyszczony, pojedyncze zamówienie zachowuje dotychczasowy link Stripe; zamówienie z kilkoma figurkami nie zostanie wysłane ani opłacone częściowo.

### Samodzielny podgląd i test formularza

Po wdrożeniu najnowszego commitu otwórz `https://axi-checkout.onrender.com/preview/#zamow`. Nie trzeba tworzyć drugiej usługi ani zmieniać działającej strony GitHub Pages. Podgląd renderuje aktualny `index.html` i używa tego samego modułu formularza/cennika; obrazy pobiera z publicznej strony AXI3D. Ma widoczny baner testowy, wyłączoną analitykę i `noindex`.

1. W Renderze wybierz **Manual Deploy → Deploy latest commit**, poczekaj na status **Live**, następnie otwórz powyższy adres.
2. Dodaj kilka figurek, opisy i przykładowe zdjęcia. Rozmiary 32, 80 i 120 mm powinny dać 670 zł.
3. Wprowadź fikcyjne dane kontaktowe. Do pierwszego testu najprościej wybrać dostawę **Na adres**. Otwarcie mapy InPost można sprawdzić osobno.
4. Formularz podglądu NIE wysyła nic do Basin: zdjęcia zostają w przeglądarce, a klient przechodzi do piaskownicy Stripe. Użyj publicznej karty testowej `4242 4242 4242 4242`, dowolnej daty w przyszłości, np. `12/34`, i CVC `123`. Nie używaj prawdziwej karty.

Na prośbę właściciela usunięto opcję wysyłania próbnych zgłoszeń do Basin oraz jej opis. Nie zmienia to wysyłania zamówień z formularza produkcyjnego. Podsumowanie zawsze zaczyna się od „Suma:”, także przy niewypełnionych rozmiarach.

Podgląd i jego endpoint `/preview/checkout-session` działają tylko z kluczem zaczynającym się od `rk_test_` lub `sk_test_`. Po przełączeniu Rendera na klucz live zwracają 404; także wcześniej otwarta karta podglądu nie może stworzyć płatności produkcyjnej. Dodatkowo backend sprawdza `livemode: false` odpowiedzi Stripe, a formularz odrzuca linki sesji inne niż `cs_test_`. Podgląd nie korzysta ze starych linków live.

Powrót ze Stripe prowadzi do `/preview/success` albo `/preview/#zamow`, nie do produkcyjnej strony potwierdzenia. Obsługiwane są wyłącznie wymienione pliki podglądu — backend nie udostępnia katalogu repozytorium ani sekretów. CORS podglądu używa automatycznej zmiennej Render `RENDER_EXTERNAL_URL`, niezależnie od produkcyjnej listy źródeł. Główny endpoint `/checkout-session` nadal obsługuje wyłącznie dotychczasową listę źródeł AXI3D.

Źródła: [karty testowe Stripe](https://docs.stripe.com/testing), [zmienne środowiskowe Rendera](https://render.com/docs/environment-variables).

### Stan po podłączeniu Rendera — 30.08.2026

`GET https://axi-checkout.onrender.com/health` zwrócił `ok: true` i `checkoutConfigured: true`; preflight dla `https://axi3d.pl` zwrócił HTTP 204. Próba przygotowania płatności za 32/80/120 mm (670 zł) zakończyła się błędem, bez linku do Checkout. Nie wysyłano zgłoszenia Basin ani nie wykonano obciążenia.

Przegląd parametrów ujawnił błąd w kodzie: `payment_method_collection: if_required` jest dozwolone tylko dla subskrypcji, a ten endpoint używa `mode: payment`. Parametr usunięto. Dla dodatnich kwot Stripe nadal wymaga metody płatności. [Dokumentacja parametru](https://docs.stripe.com/api/checkout/sessions/create).

Poprawkę wdrożono jako `727a3d41d57e977ef34be880daa6cb22997b281d`; `/health` potwierdził tę wersję. Sesje testowe utworzyły się poprawnie, a przeglądarka pokazała 200 zł za 32 mm, 400 zł za 32+42 mm i 670 zł za 32+80+120 mm. Płatność mieszanego koszyka wykonano publiczną kartą testową Stripe i nastąpiło przekierowanie do strony podziękowania. Nie obciążano prawdziwej karty. Powtórzenie identycznego zamówienia zwróciło ten sam adres sesji. Testy te nie wysłały zgłoszenia Basin ani załączników.

Nowa funkcja podglądu wymaga kolejnego **Manual Deploy → Deploy latest commit**, ponieważ automatyczne wdrożenia pozostają wyłączone. Klucz testowy pozostaje bez zmian.

W razie kolejnego błędu log serwera zawiera wpis `[axi-checkout]` z typem zdarzenia, kodem HTTP Stripe i — jeśli dostępny — identyfikatorem `requestId`. HTTP 401 oznacza problem uwierzytelnienia, 403 brak uprawnień, a 400 nieprawidłowe parametry. Wyszukaj podany identyfikator w logach Stripe w odpowiednim trybie testowym. Log nie zawiera klucza, danych klienta ani pełnej treści błędu Stripe. Zdarzenie `stripe_transport_error` oznacza błąd połączenia/oczekiwania, a `stripe_invalid_response` nieprawidłową odpowiedź. [Znaczenie kodów HTTP Stripe](https://docs.stripe.com/error-low-level).

### Render — przygotowanie do testów

Repozytorium zawiera `render.yaml`: pojedyncza usługa Node.js we Frankfurcie, plan `free`, bez bazy danych i bez automatycznych wdrożeń. Plik niczego sam nie uruchamia ani nie zamawia płatnego planu. W panelu Render utwórz **New → Blueprint**, wybierz `Azya420/AXI` i gałąź `main` (do osobnych testów użyj oddzielnej usługi z kluczem testowym). Sprawdź koszt na ekranie podsumowania przed utworzeniem usługi. Sekret `STRIPE_SECRET_KEY` ma `sync: false`: wpisujesz go tylko w panelu Render, na początek z trybu testowego/sandbox Stripe.

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
