import { MAX_FIGURINES, MAX_COPIES_PER_FIGURINE, PRICE_BRACKETS, PRICING_VERSION, AUTOMATIC_DISCOUNT_PERCENT, BULK_MIN_FIGURINES, getPrice, getItemSubtotal, getDeliveryOption, formatPrice } from './pricing.mjs?v=20260905-two-project-pricing';

export const SPECIAL_OFFER_END = '2026-09-08T11:00:07Z';

export function formatSpecialOfferCountdown(now) {
  const remaining = Math.max(0, Date.parse(SPECIAL_OFFER_END) - now);
  if (remaining <= 0) return 'Oferta zakończona';
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
  return days ? days + (days === 1 ? ' dzień ' : ' dni ') + time : time;
}

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
  const minimumPrice = Math.min(...PRICE_BRACKETS.map(price => price.amount));
  byId('promo-spotlight').hidden = AUTOMATIC_DISCOUNT_PERCENT <= 0;
  byId('promo-discount').textContent = '−' + AUTOMATIC_DISCOUNT_PERCENT + '%';
  byId('promo-min-price').textContent = formatPrice(minimumPrice);
  byId('journey-min-price').textContent = formatPrice(minimumPrice);
  const promoCountdown = byId('promo-countdown');
  const refreshPromoCountdown = () => {
    const text = formatSpecialOfferCountdown(win.Date.now());
    promoCountdown.textContent = text;
    promoCountdown.setAttribute('aria-label', text === 'Oferta zakończona' ? text : 'Do końca oferty pozostało: ' + text);
  };
  refreshPromoCountdown();
  win.setInterval(refreshPromoCountdown, 1000);
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
  let figurineFormStarted = false;
  let shippingDetailsStarted = false;
  const selectedPhotos = new WeakMap();

  function photoKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join(':');
  }
  function syncPhotoInput(input, files) {
    try {
      const transfer = new win.DataTransfer();
      files.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
    } catch {
      // Używane wyłącznie przez środowiska bez DataTransfer (np. testy DOM).
      Object.defineProperty(input, 'files', { configurable: true, value: files });
    }
  }
  function renderPhotoList(card, files) {
    const photoList = field(card, 'photo-list');
    photoList.replaceChildren();
    files.forEach((file, index) => {
      const item = doc.createElement('li');
      item.className = 'photo-item';
      const name = doc.createElement('span');
      name.className = 'photo-name';
      name.textContent = file.name;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-photo';
      remove.dataset.photoIndex = String(index);
      remove.textContent = 'Usuń';
      remove.setAttribute('aria-label', 'Usuń zdjęcie ' + file.name);
      item.append(name, remove);
      photoList.appendChild(item);
    });
  }

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
  const deliveryMethod = () => isLocker() ? 'locker' : 'address';
  const cardItems = () => cards().map(card => ({ size: Number(field(card, 'size').value), copies: Number(field(card, 'copies').value) }));
  const pricingKey = () => JSON.stringify({ items: cardItems(), email: byId('email').value.trim(), code: currentPromotion(), deliveryMethod: deliveryMethod() });
  function analyticsSnapshot(items) {
    const analyticsItems = items.flatMap((item, index) => {
      const price = getPrice(item.size, items.length);
      const result = [{
        item_id: 'axi-figurine-' + (index + 1),
        item_name: 'Personalizowana figurka',
        item_category: 'Figurka 3D',
        item_variant: item.size + ' mm',
        price: price.amount / 100,
        quantity: 1
      }];
      if (item.copies > 1) result.push({
        item_id: 'axi-figurine-' + (index + 1) + '-copy',
        item_name: 'Dodatkowy identyczny wydruk',
        item_category: 'Figurka 3D — kopia',
        item_variant: item.size + ' mm',
        price: price.additionalCopyAmount / 100,
        quantity: item.copies - 1
      });
      return result;
    });
    return {
      currency: 'PLN',
      value: analyticsItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      items: analyticsItems
    };
  }
  function trackGaEvent(name, params) {
    if (preview || typeof win.gtag !== 'function') return false;
    win.gtag('event', name, params);
    return true;
  }
  function trackMetaEvent(name, params, options) {
    if (preview || !win.AXI_TRACKING?.trackMeta) return;
    win.AXI_TRACKING.trackMeta(name, params, options);
  }
  function trackFigurineFormStart(event) {
    if (figurineFormStarted || !event.target.closest('.figurine-card')) return;
    figurineFormStarted = trackGaEvent('figurine_form_start', {
      form_id: 'commission-form',
      form_name: 'Zamówienie figurki'
    });
  }
  form.addEventListener('input', trackFigurineFormStart);
  form.addEventListener('change', trackFigurineFormStart);
  function refresh() {
    let total = 0;
    let valid = true;
    const all = cards();
    const bulkPricing = all.length >= BULK_MIN_FIGURINES;
    const quantityPricing = all.length >= 2;
    all.forEach((card, index) => {
      card.querySelector('legend').textContent = 'Figurka ' + (index + 1);
      const remove = card.querySelector('.remove-figurine');
      remove.hidden = all.length === 1;
      remove.setAttribute('aria-label', 'Usuń figurkę ' + (index + 1));
      const prefix = index === 0 ? '' : 'figurka_' + (index + 1) + '_';
      field(card, 'description').name = prefix + 'opis';
      field(card, 'photos').name = prefix + 'zdjecia';
      field(card, 'size').name = prefix + 'rozmiar';
      field(card, 'copies').name = prefix + 'liczba_identycznych_wydrukow';
      const input = field(card, 'size');
      const copiesInput = field(card, 'copies');
      input.setCustomValidity('');
      copiesInput.setCustomValidity('');
      const price = getPrice(Number(input.value), all.length);
      const copies = Number(copiesInput.value);
      const itemSubtotal = getItemSubtotal(Number(input.value), copies, all.length);
      const addCopy = field(card, 'add-copy');
      const copyControls = field(card, 'copy-controls');
      const hasCopies = Number.isInteger(copies) && copies > 1;
      addCopy.hidden = hasCopies;
      copyControls.hidden = !hasCopies;
      addCopy.textContent = price ? '＋ Dodaj kolejny wydruk za ' + formatPrice(price.additionalCopyAmount) : '＋ Dodaj kolejny identyczny wydruk';
      const discounted = price && price.amount < price.regularAmount;
      const regularPrice = field(card, 'regular-price');
      const lowestPriceNote = field(card, 'lowest-price-note');
      regularPrice.hidden = !discounted;
      const comparisonTotal = price ? (quantityPricing ? price.saleAmount : price.regularAmount) + Math.max(0, copies - 1) * price.additionalCopyAmount : 0;
      regularPrice.textContent = discounted && itemSubtotal !== null ? formatPrice(comparisonTotal) : '';
      regularPrice.setAttribute('aria-label', discounted && itemSubtotal !== null ? (quantityPricing ? 'Cena przy 1 projekcie: ' : 'Cena przed obniżką: ') + formatPrice(comparisonTotal) : 'Cena przed obniżką');
      lowestPriceNote.hidden = !price;
      lowestPriceNote.textContent = price ? 'Najniższa cena pojedynczej figurki z 30 dni przed obniżką: ' + formatPrice(price.regularAmount) + '.' : '';
      field(card, 'price').setAttribute('aria-label', itemSubtotal !== null ? 'Cena za wszystkie identyczne wydruki tej figurki: ' + formatPrice(itemSubtotal) : 'Cena');
      field(card, 'copy-price').textContent = price ? 'Każdy dodatkowy identyczny wydruk: ' + formatPrice(price.additionalCopyAmount) + '.' : 'Każdy dodatkowy wydruk zostanie doliczony według rozmiaru.';
      if (itemSubtotal !== null) {
        total += itemSubtotal;
        field(card, 'price').textContent = formatPrice(itemSubtotal);
      } else {
        valid = false;
        field(card, 'price').textContent = !input.value ? 'Wpisz rozmiar' : !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES_PER_FIGURINE ? 'Sprawdź liczbę wydruków' : 'Sprawdź rozmiar';
      }
    });
    const totalCopies = all.reduce((sum, card) => sum + (Number.isInteger(Number(field(card, 'copies').value)) ? Number(field(card, 'copies').value) : 0), 0);
    const label = countLabel(totalCopies) + (totalCopies !== all.length ? ' · ' + all.length + (all.length === 1 ? ' projekt' : ' projekty') : '');
    const shippingAmount = getDeliveryOption(deliveryMethod()).amount;
    if (promotionReview?.key !== pricingKey()) promotionReview = null;
    const applied = valid && promotionReview;
    byId('figurine-count').value = String(totalCopies);
    byId('order-count-label').textContent = label;
    const figurinesTotal = applied ? applied.total - applied.shippingAmount : total;
    byId('order-total').textContent = valid ? 'Suma: ' + formatPrice(figurinesTotal) : 'Suma:';
    // Wartość pola ukrytego pozostaje ceną przed kodem. Po potwierdzeniu kodu
    // wpisujemy końcową kwotę do zgłoszenia bez zmiany identyfikatora próby.
    byId('price-hidden').value = valid ? formatPrice(total + shippingAmount) : '';
    byId('shipping-order-summary').textContent = label + (valid ? ' · Suma figurek: ' + formatPrice(figurinesTotal) : '');
    byId('promotion-result').hidden = !applied;
    byId('promotion-result').textContent = applied ? 'Kod zastosowany. Rabat: ' + formatPrice(applied.discount) + ' · Suma figurek po rabacie: ' + formatPrice(figurinesTotal) + '. Koszt dostawy zostanie doliczony w Stripe.' : '';
    openBtn.textContent = totalCopies === 1 ? 'Zamów figurkę' : 'Zamów figurki';
    submitBtn.textContent = applied ? 'Przejdź do płatności' : currentPromotion() ? 'Sprawdź kod i cenę' : totalCopies === 1 ? 'Zamów figurkę' : 'Zamów figurki';
    addBtn.disabled = all.length >= MAX_FIGURINES;
    addBtn.textContent = all.length >= MAX_FIGURINES ? 'Maksymalnie ' + MAX_FIGURINES + ' figurek w zamówieniu' : '+ Dodaj kolejną figurkę';
    const progress = Math.min(all.length, BULK_MIN_FIGURINES);
    byId('discount-progress-fill').style.width = ((progress - 1) / (BULK_MIN_FIGURINES - 1) * 100) + '%';
    byId('discount-progress').dataset.level = String(progress);
    const referenceSize = Number(field(all[0], 'size').value);
    const referencePrice = getPrice(referenceSize);
    byId('discount-step-price-1').textContent = referencePrice ? formatPrice(getPrice(referenceSize, 1).amount) : 'od 98 zł';
    byId('discount-step-price-2').textContent = referencePrice ? formatPrice(getPrice(referenceSize, 2).amount) : 'od 88 zł';
    byId('discount-step-price-3').textContent = referencePrice ? formatPrice(getPrice(referenceSize, 3).amount) : 'od 65 zł';
    byId('discount-step-1').classList.toggle('active', progress >= 1);
    byId('discount-step-2').classList.toggle('active', progress >= 2);
    byId('discount-step-3').classList.toggle('active', progress >= 3);
  }
  addBtn.addEventListener('click', () => {
    if (busy || completed || cards().length >= MAX_FIGURINES) return;
    const card = template.cloneNode(true);
    const suffix = '-figurine-' + (++nextId);
    card.querySelectorAll('[id]').forEach(el => { el.id += suffix; });
    card.querySelectorAll('label[for]').forEach(el => { el.htmlFor += suffix; });
    card.querySelectorAll('input, textarea').forEach(el => { el.value = el.dataset.field === 'copies' ? '1' : ''; });
    list.appendChild(card);
    clearError();
    refresh();
    field(card, 'description').focus();
  });
  list.addEventListener('click', event => {
    const removePhoto = event.target.closest('.remove-photo');
    if (removePhoto && !busy && !completed) {
      const card = removePhoto.closest('.figurine-card');
      const input = field(card, 'photos');
      const files = (selectedPhotos.get(input) || Array.from(input.files)).filter((_, index) => index !== Number(removePhoto.dataset.photoIndex));
      selectedPhotos.set(input, files);
      syncPhotoInput(input, files);
      renderPhotoList(card, files);
      clearError();
      return;
    }
    const addCopy = event.target.closest('[data-field="add-copy"]');
    if (addCopy && !busy && !completed) {
      const card = addCopy.closest('.figurine-card');
      field(card, 'copies').value = '2';
      clearError();
      refresh();
      field(card, 'copies').focus();
      return;
    }
    const removeCopies = event.target.closest('.remove-copies');
    if (removeCopies && !busy && !completed) {
      const card = removeCopies.closest('.figurine-card');
      field(card, 'copies').value = '1';
      clearError();
      refresh();
      field(card, 'add-copy').focus();
      return;
    }
    const remove = event.target.closest('.remove-figurine');
    if (!remove || busy || completed || cards().length < 2) return;
    remove.closest('.figurine-card').remove();
    clearError();
    refresh();
    addBtn.focus();
  });
  list.addEventListener('change', event => {
    const input = event.target.closest('[data-field="photos"]');
    if (!input || busy || completed) return;
    const previous = selectedPhotos.get(input) || [];
    const unique = new Map(previous.map(file => [photoKey(file), file]));
    Array.from(input.files).forEach(file => unique.set(photoKey(file), file));
    const files = Array.from(unique.values());
    selectedPhotos.set(input, files);
    syncPhotoInput(input, files);
    renderPhotoList(input.closest('.figurine-card'), files);
    clearError();
  });
  list.addEventListener('input', () => { if (!busy) { clearError(); refresh(); } });
  ['promotion-code', 'email'].forEach(id => byId(id).addEventListener('input', () => { if (!busy) { clearError(); refresh(); } }));
  function validateFigures() {
    for (const [index, card] of cards().entries()) {
      const input = field(card, 'size');
      const copiesInput = field(card, 'copies');
      input.setCustomValidity('');
      copiesInput.setCustomValidity('');
      if (!getPrice(Number(input.value))) {
        input.setCustomValidity('Figurka ' + (index + 1) + ': podaj rozmiar od 20 do 250 mm w pełnych milimetrach.');
      }
      if (!input.checkValidity()) {
        closeModal();
        input.reportValidity();
        input.focus();
        return false;
      }
      const copies = Number(copiesInput.value);
      if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES_PER_FIGURINE) {
        copiesInput.setCustomValidity('Figurka ' + (index + 1) + ': wybierz od 1 do ' + MAX_COPIES_PER_FIGURINE + ' identycznych wydruków.');
      }
      if (!copiesInput.checkValidity()) {
        closeModal();
        copiesInput.reportValidity();
        copiesInput.focus();
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
    if (!busy) { clearError(); refresh(); }
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
    if (!shippingDetailsStarted) {
      const analytics = analyticsSnapshot(cardItems());
      shippingDetailsStarted = trackGaEvent('shipping_details_start', {
        form_id: 'commission-form',
        form_name: 'Dane do wysyłki',
        ...analytics
      });
    }
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
    const items = cardItems();
    const selectedDeliveryMethod = deliveryMethod();
    const shippingAmount = getDeliveryOption(selectedDeliveryMethod).amount;
    const analytics = analyticsSnapshot(items);
    analytics.value += shippingAmount / 100;
    analytics.shipping = shippingAmount / 100;
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
    const totalCopies = items.reduce((sum, item) => sum + item.copies, 0);
    payload.set('subject', (preview ? 'TEST — NIE REALIZOWAĆ — ' : 'Nowe zamówienie — ') + countLabel(totalCopies) + ' — AXI');
    if (preview) payload.set('tryb', 'TEST — NIE REALIZOWAĆ');
    payload.set('kod_promocyjny', promotionCode);
    payload.set('wersja_cennika', PRICING_VERSION);
    payload.set('uwaga_dotyczaca_ceny', 'Ceny figurek uwzględniają automatyczną obniżkę 30%. Przy co najmniej 3 figurkach obowiązuje dodatkowy cennik ilościowy. Zaakceptowany kod może dodatkowo obniżyć sumę. Przed realizacją sprawdź płatność w Stripe po numerze zamówienia.');
    const regularSubtotal = items.reduce((sum, item) => sum + getPrice(item.size).regularAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
    const saleSubtotal = items.reduce((sum, item) => sum + getPrice(item.size).saleAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
    const subtotal = items.reduce((sum, item) => sum + getItemSubtotal(item.size, item.copies, items.length), 0);
    payload.set('koszt_wysylki', formatPrice(shippingAmount));
    payload.set('cena_przed_rabatem', formatPrice(regularSubtotal + shippingAmount));
    payload.set('rabat_automatyczny_procent', String(AUTOMATIC_DISCOUNT_PERCENT));
    payload.set('rabat_automatyczny', formatPrice(regularSubtotal - saleSubtotal));
    payload.set('rabat_ilosciowy', formatPrice(saleSubtotal - subtotal));
    payload.set('cennik_3_plus', items.length >= BULK_MIN_FIGURINES ? 'Tak' : 'Nie');
    payload.set('cena_przed_kodem', formatPrice(subtotal + shippingAmount));
    payload.set('rabat', formatPrice(regularSubtotal - subtotal));
    payload.set('wersja_regulaminu', '2026-08-30');
    payload.set('podsumowanie_figurek', cards().map((card, index) => {
      const size = Number(field(card, 'size').value);
      const copies = Number(field(card, 'copies').value);
      const copiesLabel = copies === 1 ? '1 identyczny wydruk' : copies >= 2 && copies <= 4 ? copies + ' identyczne wydruki' : copies + ' identycznych wydruków';
      return 'Figurka ' + (index + 1) + ': ' + size + ' mm, ' + copiesLabel + ', razem ' + formatPrice(getItemSubtotal(size, copies, items.length)) + '\nOpis: ' + field(card, 'description').value + '\nZdjęcia: ' + (Array.from(field(card, 'photos').files).map(file => file.name).join(', ') || 'brak');
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
      trackMetaEvent('InitiateCheckout', {
        value: analytics.value,
        currency: analytics.currency,
        content_type: 'product',
        content_ids: items.map(item => 'personalizowana-figurka-' + item.size + 'mm'),
        num_items: totalCopies
      }, { eventID: orderId + '-checkout' });
      attempt.beginCheckoutTracked = true;
    }
    setBusy(true);
    try {
      let paymentUrl;
      if (endpoint) {
        const data = await preparePayment(endpoint, { items, email: byId('email').value.trim(), orderId, deliveryMethod: selectedDeliveryMethod, promotionCode, termsAccepted: byId('terms-accepted').checked, pricingVersion: PRICING_VERSION });
        const url = new URL(data.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Nieprawidłowy adres płatności.');
        if (preview && !url.pathname.includes('/cs_test_')) throw new Error('Podgląd obsługuje wyłącznie płatności testowe.');
        if (!preview && !/^\/c\/pay\/cs_live_[A-Za-z0-9]+$/.test(url.pathname)) throw new Error('Płatności są chwilowo niedostępne. Skontaktuj się z nami: kontakt@axi3d.pl.');
        paymentUrl = url.href;
        // Wymagane również BEZ kodu: starszy backend może naliczać dawną cenę.
        if (data.checkoutVersion !== 4 || data.pricingVersion !== PRICING_VERSION ||
            data.promotionCode !== promotionCode || data.currency !== 'pln' ||
            data.subtotal !== subtotal || data.saleSubtotal !== saleSubtotal || data.regularSubtotal !== regularSubtotal ||
            data.deliveryMethod !== selectedDeliveryMethod || data.shippingAmount !== shippingAmount ||
            data.automaticDiscount !== regularSubtotal - saleSubtotal ||
            data.bulkDiscount !== saleSubtotal - subtotal || data.bulkPricing !== (items.length >= BULK_MIN_FIGURINES) ||
            !Number.isInteger(data.total) || !Number.isInteger(data.discount) ||
            data.total < shippingAmount || data.discount < 0 || data.total + data.discount !== subtotal + shippingAmount ||
            (!promotionCode && data.discount !== 0)) {
          throw new Error('Nie udało się potwierdzić aktualnej ceny. Odśwież stronę i spróbuj ponownie. Zamówienie nie zostało wysłane.');
        }
        if (promotionCode) {
          if (data.discount === 0) {
            throw new Error('Nie udało się potwierdzić rabatu. Zamówienie nie zostało wysłane.');
          }
          if (!promotionReview || promotionReview.key !== pricingKey() || promotionReview.total !== data.total || promotionReview.discount !== data.discount) {
            promotionReview = { key: pricingKey(), total: data.total, shippingAmount: data.shippingAmount, discount: data.discount };
            setBusy(false);
            submitBtn.focus();
            return; // Klient najpierw widzi cenę po rabacie, dopiero potem potwierdza zamówienie.
          }
          payload.set('rabat_z_kodu', formatPrice(data.discount));
          payload.set('rabat', formatPrice(regularSubtotal + shippingAmount - data.total));
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
          trackMetaEvent('Lead', { currency: analytics.currency, value: analytics.value }, { eventID: orderId + '-lead' });
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
