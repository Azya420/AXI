import { MAX_FIGURINES, PRICING_VERSION, AUTOMATIC_DISCOUNT_PERCENT, getPrice, formatPrice } from './pricing.mjs?v=20260831-sale30';

export function initOrderForm(win) {
  const doc = win.document;
  const byId = id => doc.getElementById(id);
  const form = byId('commission-form');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = 'true';
  // Walidujemy etapy osobno: wymagane dane kontaktowe są w zamkniętym oknie.
  form.noValidate = true;
  const list = byId('figurine-list');
  const template = list.firstElementChild.cloneNode(true);
  const addBtn = byId('add-figurine-btn');
  const openBtn = byId('open-shipping-btn');
  const submitBtn = byId('commission-submit');
  const modal = byId('shipping-modal');
  const errorBox = byId('order-error');
  const preview = win.AXI_PREVIEW_MODE === true;
  byId('shipping-order-summary').setAttribute('role', 'status');
  const cards = () => Array.from(list.children);
  const field = (card, name) => card.querySelector('[data-field="' + name + '"]');
  let nextId = 1;
  let busy = false;
  let completed = false;
  let lastFocused = null;
  let previousOverflow = '';
  let attempt = null;
  let promotionReview = null;
  let geowidgetInitialized = false;
  let previousDisabled = [];

  function countLabel(count) {
    if (count === 1) return '1 figurka';
    return count + (count >= 2 && count <= 4 ? ' figurki' : ' figurek');
  }
  function clearError() { errorBox.hidden = true; errorBox.textContent = ''; }
  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  const currentPromotion = () => byId('promotion-code').value.trim().toUpperCase();
  const pricingKey = () => JSON.stringify({ items: cards().map(card => Number(field(card, 'size').value)), email: byId('email').value.trim(), code: currentPromotion() });
  function analyticsSnapshot(items) {
    const analyticsItems = items.map((item, index) => {
      const price = getPrice(item.size);
      return {
        item_id: 'axi-figurine-' + (index + 1),
        item_name: 'Personalizowana figurka',
        item_category: 'Figurka 3D',
        item_variant: item.size + ' mm',
        price: price.amount / 100,
        quantity: 1
      };
    });
    return {
      currency: 'PLN',
      value: analyticsItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      items: analyticsItems
    };
  }
  function trackGaEvent(name, params) {
    if (preview || typeof win.gtag !== 'function') return;
    win.gtag('event', name, params);
  }
  function refresh() {
    let total = 0;
    let valid = true;
    const all = cards();
    all.forEach((card, index) => {
      card.querySelector('legend').textContent = 'Figurka ' + (index + 1);
      const remove = card.querySelector('.remove-figurine');
      remove.hidden = all.length === 1;
      remove.setAttribute('aria-label', 'Usuń figurkę ' + (index + 1));
      const prefix = index === 0 ? '' : 'figurka_' + (index + 1) + '_';
      field(card, 'description').name = prefix + 'opis';
      field(card, 'photos').name = prefix + 'zdjecia';
      field(card, 'size').name = prefix + 'rozmiar';
      const input = field(card, 'size');
      input.setCustomValidity('');
      const price = getPrice(Number(input.value));
      if (price) {
        total += price.amount;
        field(card, 'price').textContent = formatPrice(price.amount);
      } else {
        valid = false;
        field(card, 'price').textContent = input.value ? 'Sprawdź rozmiar' : 'Wpisz rozmiar';
      }
    });
    const label = countLabel(all.length);
    if (promotionReview?.key !== pricingKey()) promotionReview = null;
    const applied = valid && promotionReview;
    byId('figurine-count').value = String(all.length);
    byId('order-count-label').textContent = label;
    byId('order-total').textContent = valid ? 'Suma: ' + formatPrice(applied ? applied.total : total) : 'Suma:';
    byId('price-hidden').value = valid ? formatPrice(total) : '';
    byId('shipping-order-summary').textContent = label + (valid ? ' · Suma: ' + formatPrice(applied ? applied.total : total) : '');
    byId('promotion-result').hidden = !applied;
    byId('promotion-result').textContent = applied ? 'Kod zastosowany. Rabat: ' + formatPrice(applied.discount) + ' · Do zapłaty: ' + formatPrice(applied.total) : '';
    openBtn.textContent = all.length === 1 ? 'Zamów figurkę' : 'Zamów figurki';
    submitBtn.textContent = applied ? 'Przejdź do płatności' : currentPromotion() ? 'Sprawdź kod i cenę' : all.length === 1 ? 'Zamów figurkę' : 'Zamów figurki';
    addBtn.disabled = all.length >= MAX_FIGURINES;
    addBtn.textContent = all.length >= MAX_FIGURINES ? 'Maksymalnie ' + MAX_FIGURINES + ' figurek w zamówieniu' : '+ Dodaj kolejną figurkę';
  }
  addBtn.addEventListener('click', () => {
    if (busy || completed || cards().length >= MAX_FIGURINES) return;
    const card = template.cloneNode(true);
    const suffix = '-figurine-' + (++nextId);
    card.querySelectorAll('[id]').forEach(el => { el.id += suffix; });
    card.querySelectorAll('label[for]').forEach(el => { el.htmlFor += suffix; });
    card.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
    list.appendChild(card);
    clearError();
    refresh();
    field(card, 'description').focus();
  });
  list.addEventListener('click', event => {
    const remove = event.target.closest('.remove-figurine');
    if (!remove || busy || completed || cards().length < 2) return;
    remove.closest('.figurine-card').remove();
    clearError();
    refresh();
    addBtn.focus();
  });
  list.addEventListener('input', () => { if (!busy) { clearError(); refresh(); } });
  ['promotion-code', 'email'].forEach(id => byId(id).addEventListener('input', () => { if (!busy) { clearError(); refresh(); } }));
  function validateFigures() {
    for (const [index, card] of cards().entries()) {
      const input = field(card, 'size');
      input.setCustomValidity('');
      if (!getPrice(Number(input.value))) {
        input.setCustomValidity('Figurka ' + (index + 1) + ': podaj rozmiar od 20 do 250 mm w pełnych milimetrach.');
      }
      if (!input.checkValidity()) {
        closeModal();
        input.reportValidity();
        input.focus();
        return false;
      }
    }
    refresh();
    return true;
  }
  function initGeowidgetIfNeeded() {
    if (geowidgetInitialized) return;
    geowidgetInitialized = true;
    const script = doc.createElement('script');
    script.src = 'https://geowidget.easypack24.net/js/sdk-for-javascript.js';
    script.onload = () => {
      win.easyPack.init({ defaultLocale: 'pl', points: { types: ['parcel_locker'] }, map: { initialTypes: ['parcel_locker'] } });
      win.easyPack.mapWidget('easypack-map', point => {
        byId('paczkomat-hidden').value = point.name + ' — ' + point.address.line1 + ', ' + point.address.line2;
        byId('paczkomat-status').textContent = 'Wybrany paczkomat: ' + point.name + ' (' + point.address.line1 + ')';
        byId('easypack-map').style.display = 'none';
        byId('change-locker-btn').style.display = 'inline-block';
      });
    };
    script.onerror = () => {
      geowidgetInitialized = false;
      script.remove();
      byId('paczkomat-status').textContent = 'Nie udało się wczytać mapy. Wybierz dostawę na adres lub ponownie otwórz to okno.';
    };
    doc.body.appendChild(script);
  }
  function isLocker() { return doc.querySelector('input[name="dostawa"]:checked').value === 'Paczkomat InPost'; }
  function updateDelivery() {
    const locker = isLocker();
    byId('address-wrap').style.display = locker ? 'none' : 'block';
    byId('locker-wrap').style.display = locker ? 'block' : 'none';
    ['ulica', 'kod', 'miasto'].forEach(id => { byId(id).required = !locker; });
    if (locker && modal.classList.contains('active')) win.requestAnimationFrame(initGeowidgetIfNeeded);
  }
  doc.querySelectorAll('input[name="dostawa"]').forEach(radio => radio.addEventListener('change', updateDelivery));
  byId('change-locker-btn').addEventListener('click', () => {
    byId('easypack-map').style.display = 'block';
    byId('change-locker-btn').style.display = 'none';
  });
  function openModal() {
    if (busy || completed || !validateFigures()) return;
    clearError();
    if (!modal.classList.contains('active')) {
      lastFocused = doc.activeElement;
      previousOverflow = doc.body.style.overflow;
    }
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    doc.body.style.overflow = 'hidden';
    updateDelivery();
    byId('name').focus();
  }
  function closeModal() {
    if (busy || !modal.classList.contains('active')) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    doc.body.style.overflow = previousOverflow;
    if (lastFocused) lastFocused.focus();
  }
  openBtn.addEventListener('click', openModal);
  byId('shipping-modal-close').addEventListener('click', closeModal);
  byId('shipping-modal-backdrop').addEventListener('click', closeModal);
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const visible = Array.from(modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'))
        .filter(el => el.type !== 'hidden' && !el.closest('[hidden]') && !el.closest('[style*="display: none"]'));
      const first = visible[0], last = visible[visible.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  function setBusy(value) {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    if (value) {
      previousDisabled = Array.from(new Set([...form.elements, ...modal.querySelectorAll('button')])).map(el => [el, el.disabled]);
      previousDisabled.forEach(([el]) => { el.disabled = true; });
      submitBtn.textContent = 'Wysyłanie…';
    } else {
      previousDisabled.forEach(([el, disabled]) => { el.disabled = disabled; });
      refresh();
    }
  }
  async function responseJson(response) {
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok) throw new Error(data.error || data.message || 'Usługa jest chwilowo niedostępna. Spróbuj ponownie.');
    return data;
  }
  async function preparePayment(endpoint, order) {
    const controller = new win.AbortController();
    submitBtn.textContent = 'Przygotowywanie płatności…';
    const notice = win.setTimeout(() => {
      byId('shipping-order-summary').textContent = 'Czekamy na usługę płatności. Jej uruchomienie może potrwać około minuty. Nie zamykaj tego okna.';
    }, 8000);
    // Mieści wybudzenie darmowej instancji, ale nie blokuje formularza bez końca.
    const timeout = win.setTimeout(() => controller.abort(), 120000);
    try {
      return await responseJson(await win.fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order), signal: controller.signal
      }));
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Usługa płatności nie odpowiedziała na czas. Spróbuj ponownie.');
      throw error;
    } finally {
      win.clearTimeout(notice);
      win.clearTimeout(timeout);
      submitBtn.textContent = 'Wysyłanie…';
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || completed || !validateFigures()) return;
    if (!modal.classList.contains('active')) { openModal(); return; }
    if (!byId('terms-accepted').checked) { byId('terms-accepted').reportValidity(); byId('terms-accepted').focus(); return; }
    if (!form.reportValidity()) return;
    if (isLocker() && !byId('paczkomat-hidden').value) { win.alert('Wybierz paczkomat na mapie przed wysłaniem zamówienia.'); return; }
    if (!isLocker() && ['ulica', 'kod', 'miasto'].some(id => !byId(id).value.trim())) { win.alert('Podaj pełny adres dostawy.'); return; }
    clearError();
    const items = cards().map(card => ({ size: Number(field(card, 'size').value) }));
    const analytics = analyticsSnapshot(items);
    const promotionCode = currentPromotion();
    const endpoint = (win.AXI_CHECKOUT_ENDPOINT || '').trim();
    if (!endpoint) {
      closeModal();
      showError('Wspólna płatność nie jest jeszcze dostępna. Skontaktuj się z nami: kontakt@axi3d.pl.');
      return;
    }
    const payload = new win.FormData(form);
    // Nie zmieniamy pola telefonu — ponowienie nie doklei kolejnego +48.
    const digits = byId('phone').value.replace(/\D/g, '');
    payload.set('telefon', '+' + (digits.length === 11 && digits.startsWith('48') ? digits : '48' + digits));
    if (isLocker()) ['ulica', 'kod_pocztowy', 'miasto'].forEach(name => payload.delete(name));
    else payload.delete('paczkomat');
    payload.set('subject', (preview ? 'TEST — NIE REALIZOWAĆ — ' : 'Nowe zamówienie — ') + countLabel(items.length) + ' — AXI');
    if (preview) payload.set('tryb', 'TEST — NIE REALIZOWAĆ');
    payload.set('kod_promocyjny', promotionCode);
    payload.set('wersja_cennika', PRICING_VERSION);
    payload.set('uwaga_dotyczaca_ceny', 'Ceny figurek uwzględniają automatyczną obniżkę 30% od nowego cennika bazowego. Zaakceptowany kod może dodatkowo obniżyć sumę. Przed realizacją sprawdź płatność w Stripe po numerze zamówienia.');
    const regularSubtotal = items.reduce((sum, item) => sum + getPrice(item.size).regularAmount, 0);
    const subtotal = items.reduce((sum, item) => sum + getPrice(item.size).amount, 0);
    payload.set('cena_przed_rabatem', formatPrice(regularSubtotal));
    payload.set('rabat_automatyczny_procent', String(AUTOMATIC_DISCOUNT_PERCENT));
    payload.set('rabat_automatyczny', formatPrice(regularSubtotal - subtotal));
    payload.set('cena_przed_kodem', formatPrice(subtotal));
    payload.set('rabat', formatPrice(regularSubtotal - subtotal));
    payload.set('wersja_regulaminu', '2026-08-30');
    payload.set('podsumowanie_figurek', cards().map((card, index) => {
      const size = Number(field(card, 'size').value);
      return 'Figurka ' + (index + 1) + ': ' + size + ' mm, ' + formatPrice(getPrice(size).amount) + '\nOpis: ' + field(card, 'description').value + '\nZdjęcia: ' + (Array.from(field(card, 'photos').files).map(file => file.name).join(', ') || 'brak');
    }).join('\n\n'));
    // Ten sam koszyk zachowuje identyfikator przy ponowieniu po błędzie sieci.
    const fingerprint = JSON.stringify(Array.from(payload.entries()).filter(([key]) => !['numer_zamowienia', 'status_platnosci'].includes(key)).map(([key, val]) => [key, typeof val === 'string' ? val : [val.name, val.size, val.lastModified]]));
    if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, id: win.crypto.randomUUID() };
    const orderId = attempt.id;
    byId('order-reference').value = orderId;
    payload.set('numer_zamowienia', orderId);
    payload.set('status_platnosci', preview ? 'TEST — płatność w piaskownicy, bez prawdziwych pieniędzy' : 'Oczekuje na płatność — sprawdź opłacenie zamówienia w Stripe');
    if (!attempt.beginCheckoutTracked) {
      trackGaEvent('begin_checkout', analytics);
      attempt.beginCheckoutTracked = true;
    }
    setBusy(true);
    try {
      let paymentUrl;
      if (endpoint) {
        const data = await preparePayment(endpoint, { items, email: byId('email').value.trim(), orderId, promotionCode, termsAccepted: byId('terms-accepted').checked, pricingVersion: PRICING_VERSION });
        const url = new URL(data.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Nieprawidłowy adres płatności.');
        if (preview && !url.pathname.includes('/cs_test_')) throw new Error('Podgląd obsługuje wyłącznie płatności testowe.');
        if (!preview && !/^\/c\/pay\/cs_live_[A-Za-z0-9]+$/.test(url.pathname)) throw new Error('Płatności są chwilowo niedostępne. Skontaktuj się z nami: kontakt@axi3d.pl.');
        paymentUrl = url.href;
        // Wymagane również BEZ kodu: starszy backend może naliczać dawną cenę.
        if (data.checkoutVersion !== 2 || data.pricingVersion !== PRICING_VERSION ||
            data.promotionCode !== promotionCode || data.currency !== 'pln' ||
            data.subtotal !== subtotal || data.regularSubtotal !== regularSubtotal ||
            data.automaticDiscount !== regularSubtotal - subtotal ||
            !Number.isInteger(data.total) || !Number.isInteger(data.discount) ||
            data.total < 0 || data.discount < 0 || data.total + data.discount !== subtotal ||
            (!promotionCode && data.discount !== 0)) {
          throw new Error('Nie udało się potwierdzić aktualnej ceny. Odśwież stronę i spróbuj ponownie. Zamówienie nie zostało wysłane.');
        }
        if (promotionCode) {
          if (data.discount === 0) {
            throw new Error('Nie udało się potwierdzić rabatu. Zamówienie nie zostało wysłane.');
          }
          if (!promotionReview || promotionReview.key !== pricingKey() || promotionReview.total !== data.total || promotionReview.discount !== data.discount) {
            promotionReview = { key: pricingKey(), total: data.total, discount: data.discount };
            setBusy(false);
            submitBtn.focus();
            return; // Klient najpierw widzi cenę po rabacie, dopiero potem potwierdza zamówienie.
          }
          payload.set('rabat_z_kodu', formatPrice(data.discount));
          payload.set('rabat', formatPrice(regularSubtotal - data.total));
          payload.set('cena', formatPrice(data.total));
          analytics.value = data.total / 100;
        }
      }
      payload.set('link_do_platnosci', paymentUrl);
      // Jedno zgłoszenie zawiera wszystkie figurki i załączniki. Błąd nie może
      // przekierować do płatności ani automatycznie zdublować zamówienia.
      if (!preview) {
        await responseJson(await win.fetch(form.action, { method: 'POST', body: payload, headers: { Accept: 'application/json' } }));
        if (!attempt.leadTracked) {
          trackGaEvent('generate_lead', { currency: analytics.currency, value: analytics.value, lead_source: 'order_form' });
          attempt.leadTracked = true;
        }
      }
      completed = true;
      win.location.assign(paymentUrl);
    } catch (error) {
      promotionReview = null;
      setBusy(false);
      closeModal();
      showError('Nie udało się zakończyć zamówienia. ' + error.message + ' Twoje dane i zdjęcia pozostają w formularzu.');
    }
  });
  refresh();
  updateDelivery();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initOrderForm(window));
  else initOrderForm(window);
}
