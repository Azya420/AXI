import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { getPrice, PRICING_VERSION } from '../pricing.mjs';
import { initOrderForm } from '../order-form.mjs';
import { renderPreviewHtml } from '../api/preview.mjs';

function priceResponse(order, preview = false) {
  const subtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).amount, 0);
  const regularSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).regularAmount, 0);
  return { url: preview ? 'https://checkout.stripe.com/c/pay/cs_test_preview' : 'https://checkout.stripe.com/c/pay/cs_live_fixture',
    checkoutVersion: 2, pricingVersion: PRICING_VERSION, subtotal, regularSubtotal,
    automaticDiscount: regularSubtotal - subtotal, total: subtotal, discount: 0, currency: 'pln', promotionCode: '' };
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function setup(preview = false) {
  const dom = new JSDOM(preview ? renderPreviewHtml(html, 'https://axi3d.pl') : html, { url: 'https://axi3d.pl/', pretendToBeVisual: true });
  const doc = dom.window.document;
  const calls = [], redirects = [], alerts = [];
  let failure = '';
  const win = {
    document: doc, FormData: dom.window.FormData, crypto: webcrypto,
    AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: () => {},
    alert: message => alerts.push(message), location: { assign: url => redirects.push(url) },
    AXI_CHECKOUT_ENDPOINT: 'https://api.example.com/checkout-session',
    AXI_PREVIEW_MODE: preview,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (failure && (failure === 'all' || (failure === 'basin' && url.includes('usebasin')))) throw new Error('Test network error');
      return Response.json(url.includes('/checkout-session') ? priceResponse(JSON.parse(options.body), preview) : { success: true });
    }
  };
  initOrderForm(win);
  const $ = id => doc.getElementById(id);
  const cards = () => [...$('figurine-list').children];
  const input = (el, value) => { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const size = (index, value) => input(cards()[index].querySelector('[data-field="size"]'), value);
  function fillShipping() {
    $('open-shipping-btn').click();
    input($('name'), 'Test Klienta'); input($('email'), 'test@example.com'); input($('phone'), '600123456');
    const address = doc.querySelector('input[name="dostawa"][value="Na adres"]');
    address.checked = true; address.dispatchEvent(new dom.window.Event('change'));
    input($('ulica'), 'Testowa 1'); input($('kod'), '00-001'); input($('miasto'), 'Warszawa');
    $('terms-accepted').checked = true;
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  const submit = async () => { $('commission-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); };
  const attach = (index, name) => {
    const input = cards()[index].querySelector('[data-field="photos"]');
    // jsdom nie ma DataTransfer. Zapełniamy jego natywny FileList, aby
    // FormData serializował rzeczywisty plik, nie atrapę pola formularza.
    const symbol = Object.getOwnPropertySymbols(input.files).find(s => s.toString() === 'Symbol(impl)');
    const file = new dom.window.File(['test photo'], name, { type: 'image/png' });
    const fileSymbol = Object.getOwnPropertySymbols(file).find(s => s.toString() === 'Symbol(impl)');
    input.files[symbol].push(file[fileSymbol]);
  };
  return { dom, doc, win, $, cards, size, input, calls, redirects, alerts, fillShipping, submit, attach, tick, fail: value => { failure = value; } };
}

test('add/remove preserves existing inputs, renumbers cards and sums different sizes', () => {
  const s = setup();
  assert.equal(s.$('promo-discount').textContent, '−30%');
  assert.equal(s.$('promo-min-price').textContent, '98 zł');
  assert.equal(s.$('promo-spotlight').hidden, false);
  s.size(0, '32'); s.input(s.$('desc'), 'Pierwsza postać'); s.attach(0, 'first.png');
  s.$('add-figurine-btn').click(); s.size(1, '80');
  s.$('add-figurine-btn').click(); s.size(2, '120');
  assert.equal(s.$('desc').value, 'Pierwsza postać');
  assert.equal(s.$('photos').files[0].name, 'first.png');
  assert.equal(s.$('price-hidden').value, '399 zł');
  assert.equal(s.cards()[1].querySelector('textarea').value, '');
  const ids = [...s.doc.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const label of s.$('figurine-list').querySelectorAll('label[for]')) assert.ok(s.$(label.htmlFor));
  s.cards()[1].querySelector('.remove-figurine').click();
  assert.equal(s.$('price-hidden').value, '273 zł');
  assert.equal(s.cards()[1].querySelector('legend').textContent, 'Figurka 2');
  assert.equal(s.cards()[1].querySelector('input[type=file]').name, 'figurka_2_zdjecia');
  s.cards()[0].querySelector('.remove-figurine').click();
  assert.equal(s.$('price-hidden').value, '175 zł');
  assert.equal(s.cards()[0].querySelector('input[type=number]').name, 'rozmiar');
  assert.ok(s.cards()[0].querySelector('.remove-figurine').hidden);
  s.dom.window.close();
});
test('blank, fractional and out-of-range sizes block shipping; maximum count enforced', () => {
  const s = setup();
  for (const size of ['', '19', '32.5', '251']) {
    s.size(0, size); s.$('open-shipping-btn').click();
    assert.ok(!s.$('shipping-modal').classList.contains('active'));
  }
  s.size(0, '32'); s.$('add-figurine-btn').click(); s.$('open-shipping-btn').click();
  assert.ok(!s.$('shipping-modal').classList.contains('active'));
  for (let i = 0; i < 30; i++) s.$('add-figurine-btn').click();
  assert.equal(s.cards().length, 20); assert.ok(s.$('add-figurine-btn').disabled);
  s.dom.window.close();
});
test('one multipart submission carries independent files, sizes, prices and shared shipping', async () => {
  const s = setup();
  s.size(0, '32'); s.input(s.$('desc'), 'Druid'); s.attach(0, 'druid.png');
  s.$('add-figurine-btn').click(); s.size(1, '120');
  s.input(s.cards()[1].querySelector('textarea'), 'Smok'); s.attach(1, 'dragon.png'); s.attach(1, 'dragon-back.png');
  s.fillShipping(); await s.submit();
  assert.equal(s.calls.length, 2);
  const checkout = JSON.parse(s.calls[0].body);
  assert.deepEqual(checkout.items, [{ size: 32 }, { size: 120 }]);
  const payload = s.calls[1].body;
  assert.equal(payload.get('cena'), '273 zł');
  assert.equal(payload.get('liczba_figurek'), '2');
  assert.equal(payload.get('opis'), 'Druid'); assert.equal(payload.get('figurka_2_opis'), 'Smok');
  assert.equal(payload.get('zdjecia').name, 'druid.png');
  assert.deepEqual(payload.getAll('figurka_2_zdjecia').map(f => f.name), ['dragon.png', 'dragon-back.png']);
  assert.equal(payload.get('telefon'), '+48600123456');
  assert.equal(payload.get('email'), 'test@example.com');
  assert.equal(payload.get('miasto'), 'Warszawa');
  assert.equal(payload.get('numer_zamowienia'), checkout.orderId);
  assert.equal(payload.get('link_do_platnosci'), 'https://checkout.stripe.com/c/pay/cs_live_fixture');
  assert.match(payload.get('podsumowanie_figurek'), /Figurka 2: 120 mm, 175 zł/);
  assert.equal(s.redirects.length, 1);
  await s.submit(); assert.equal(s.calls.length, 2, 'no duplicate submit after success');
  s.dom.window.close();
});
test('errors preserve files; retry retains order ID and does not duplicate phone prefix', async () => {
  const s = setup(); s.size(0, '32'); s.attach(0, 'first.png');
  s.fillShipping(); s.fail('basin'); await s.submit();
  assert.equal(s.redirects.length, 0); assert.equal(s.calls.length, 2);
  assert.equal(s.$('photos').files[0].name, 'first.png');
  assert.equal(s.$('phone').value, '600123456');
  assert.ok(!s.$('order-error').hidden); assert.ok(!s.$('commission-submit').disabled);
  const orderId = JSON.parse(s.calls[0].body).orderId;
  s.fail(''); s.$('open-shipping-btn').click(); await s.submit();
  assert.equal(JSON.parse(s.calls[2].body).orderId, orderId);
  assert.equal(s.calls[3].body.get('telefon'), '+48600123456');
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});
test('Stripe failure sends no Basin order; unconfigured multi-cart cannot use a single-item payment link', async () => {
  const s = setup(); s.size(0, '32'); s.$('add-figurine-btn').click(); s.size(1, '80'); s.fillShipping();
  s.fail('all'); await s.submit(); assert.equal(s.calls.length, 1); assert.equal(s.redirects.length, 0);
  s.win.AXI_CHECKOUT_ENDPOINT = ''; s.$('open-shipping-btn').click(); await s.submit();
  assert.equal(s.calls.length, 1); assert.match(s.$('order-error').textContent, /nie jest jeszcze dostępna/);
  s.dom.window.close();
});
test('single figure uses current checkout pricing and retains locker shipping', async () => {
  const s = setup(); s.size(0, '80'); s.fillShipping();
  const locker = s.doc.querySelector('input[name="dostawa"][value="Paczkomat InPost"]');
  locker.checked = true; locker.dispatchEvent(new s.dom.window.Event('change'));
  await s.submit(); assert.equal(s.calls.length, 0); assert.equal(s.alerts.length, 1);
  s.$('paczkomat-hidden').value = 'WAW123'; await s.submit();
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].body.get('paczkomat'), 'WAW123'); assert.equal(s.calls[1].body.get('ulica'), null);
  assert.equal(s.redirects[0], 'https://checkout.stripe.com/c/pay/cs_live_fixture');
  s.dom.window.close();
});
test('slow checkout shows progress, prevents duplicates and clears timers on success', async () => {
  const s = setup(); s.size(0, '32'); s.fillShipping();
  const timers = new Map();
  s.win.setTimeout = (callback, delay) => { timers.set(delay, callback); return delay; };
  s.win.clearTimeout = id => timers.delete(id);
  const fetch = s.win.fetch;
  let resolveCheckout, attempts = 0;
  s.win.fetch = (url, options) => {
    if (!url.includes('/checkout-session')) return fetch(url, options);
    attempts++;
    return new Promise(resolve => { resolveCheckout = resolve; });
  };
  await s.submit();
  timers.get(8000)();
  assert.match(s.$('shipping-order-summary').textContent, /około minuty/);
  assert.equal(s.$('shipping-order-summary').getAttribute('role'), 'status');
  assert.ok(s.$('commission-submit').disabled);
  await s.submit(); assert.equal(attempts, 1);
  resolveCheckout(Response.json(priceResponse({ items: [{ size: 32 }] })));
  await s.tick();
  assert.equal(timers.size, 0); assert.equal(s.calls.length, 1);
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});
test('checkout timeout unlocks the form, retains files and retries the same order', async () => {
  const s = setup(); s.size(0, '32'); s.attach(0, 'first.png'); s.fillShipping();
  const timers = new Map();
  s.win.setTimeout = (callback, delay) => { timers.set(delay, callback); return delay; };
  s.win.clearTimeout = id => timers.delete(id);
  const fetch = s.win.fetch;
  let orderId;
  s.win.fetch = (url, options) => {
    orderId = JSON.parse(options.body).orderId;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  await s.submit(); timers.get(120000)(); await s.tick();
  assert.equal(s.calls.length, 0); assert.equal(s.redirects.length, 0);
  assert.equal(timers.size, 0);
  assert.ok(!s.$('commission-submit').disabled);
  assert.match(s.$('order-error').textContent, /nie odpowiedziała na czas/);
  assert.equal(s.$('photos').files[0].name, 'first.png');
  s.win.fetch = fetch; s.$('open-shipping-btn').click(); await s.submit();
  assert.equal(JSON.parse(s.calls[0].body).orderId, orderId);
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});
test('preview skips Basin and uploads while retaining the real order flow', async () => {
  const s = setup(true); s.size(0, '32'); s.attach(0, 'test.png'); s.fillShipping();
  assert.equal(s.$('preview-send-basin'), null);
  await s.submit();
  assert.equal(s.calls.length, 1);
  assert.ok(s.calls[0].url.includes('/checkout-session'));
  assert.deepEqual(JSON.parse(s.calls[0].body).items, [{ size: 32 }]);
  assert.deepEqual(s.redirects, ['https://checkout.stripe.com/c/pay/cs_test_preview']);
  s.dom.window.close();
});
test('preview cannot use a live Stripe URL or fall back to a legacy live Payment Link', async () => {
  const s = setup(true); s.size(0, '32'); s.fillShipping();
  s.win.fetch = async () => Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_wrong' });
  await s.submit();
  assert.equal(s.redirects.length, 0);
  assert.match(s.$('order-error').textContent, /wyłącznie płatności testowe/);
  s.win.AXI_CHECKOUT_ENDPOINT = ''; s.$('open-shipping-btn').click(); await s.submit();
  assert.equal(s.redirects.length, 0);
  assert.match(s.$('order-error').textContent, /nie jest jeszcze dostępna/);
  s.dom.window.close();
});


test('production rejects sandbox sessions before Basin and preserves files for retry', async () => {
  const s = setup(); s.size(0, '32'); s.attach(0, 'first.png'); s.fillShipping();
  const fetch = s.win.fetch;
  const calls = [];
  s.win.fetch = async (url, options) => {
    calls.push(url);
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_wrong' });
  };
  await s.submit();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/checkout-session'));
  assert.equal(s.redirects.length, 0);
  assert.equal(s.$('photos').files[0].name, 'first.png');
  assert.ok(!s.$('commission-submit').disabled);
  assert.match(s.$('order-error').textContent, /Płatności są chwilowo niedostępne/);
  s.win.fetch = fetch; s.$('open-shipping-btn').click(); await s.submit();
  assert.equal(s.calls.length, 2);
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});

test('terms start unchecked and must be accepted before preparing payment or sending Basin', async () => {
  const s = setup();
  assert.equal(s.$('terms-accepted').checked, false);
  assert.equal(s.$('terms-accepted').required, true);
  assert.equal(s.$('terms-accepted').form, s.$('commission-form'));
  assert.equal(s.doc.querySelector('.terms-consent a').getAttribute('href'), 'regulamin.html');
  s.size(0, '32'); s.fillShipping(); s.$('terms-accepted').checked = false;
  await s.submit(); assert.equal(s.calls.length, 0); assert.equal(s.redirects.length, 0);
  assert.equal(s.doc.activeElement, s.$('terms-accepted'));
  s.$('terms-accepted').checked = true; await s.submit();
  assert.equal(JSON.parse(s.calls[0].body).termsAccepted, true);
  assert.equal(s.calls[1].body.get('akceptacja_regulaminu'), 'Tak');
  assert.equal(s.calls[1].body.get('wersja_regulaminu'), '2026-08-30');
  s.dom.window.close();
});

function discountResponse(total = 8820, discount = 980) {
  return { url: 'https://checkout.stripe.com/c/pay/cs_live_Promo123', checkoutVersion: 2, pricingVersion: PRICING_VERSION, regularSubtotal: 14000, automaticDiscount: 4200, subtotal: 9800, total, discount, currency: 'pln', promotionCode: 'SAVE10' };
}
test('onsite code shows discounted total for confirmation before submitting final Basin price', async () => {
  const s = setup(); s.size(0, '32'); s.attach(0, 'first.png'); s.fillShipping();
  s.input(s.$('promotion-code'), ' save10 ');
  const requests = [];
  const originalFetch = s.win.fetch;
  s.win.fetch = async (url, options) => {
    if (!url.includes('/checkout-session')) return originalFetch(url, options);
    requests.push(JSON.parse(options.body)); return Response.json(discountResponse());
  };
  assert.equal(s.$('commission-submit').textContent, 'Sprawdź kod i cenę');
  await s.submit();
  assert.equal(s.calls.length, 0, 'review never submits Basin');
  assert.equal(s.redirects.length, 0);
  assert.equal(requests[0].promotionCode, 'SAVE10');
  assert.equal(s.$('order-total').textContent, 'Suma: 88,2 zł');
  assert.match(s.$('promotion-result').textContent, /Rabat: 9,8 zł/);
  assert.equal(s.$('commission-submit').textContent, 'Przejdź do płatności');
  assert.equal(s.$('photos').files[0].name, 'first.png');
  s.$('terms-accepted').checked = false; await s.submit();
  assert.equal(requests.length, 1, 'revoking consent blocks the confirmed-price step too');
  s.$('terms-accepted').checked = true; await s.submit();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].orderId, requests[1].orderId);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].body.get('cena'), '88,2 zł');
  assert.equal(s.calls[0].body.get('cena_przed_rabatem'), '140 zł');
  assert.equal(s.calls[0].body.get('rabat'), '51,8 zł');
  assert.equal(s.calls[0].body.get('kod_promocyjny'), 'SAVE10');
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});

test('invalid codes and older backends cannot silently charge the undiscounted price', async () => {
  for (const result of [
    () => Response.json({ error: 'Kod jest nieprawidłowy.' }, { status: 400 }),
    () => Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_Old123' }),
    () => Response.json({ ...discountResponse(), total: 1 })
  ]) {
    const s = setup(); s.size(0, '32'); s.attach(0, 'first.png'); s.fillShipping(); s.input(s.$('promotion-code'), 'SAVE10');
    let requests = 0;
    s.win.fetch = async () => { requests++; return result(); };
    await s.submit();
    assert.equal(requests, 1);
    assert.equal(s.redirects.length, 0);
    assert.equal(s.$('photos').files[0].name, 'first.png');
    assert.equal(s.$('promotion-code').value, 'SAVE10');
    assert.equal(s.$('order-error').hidden, false);
    assert.equal(s.$('commission-submit').disabled, false);
    s.dom.window.close();
  }
});

test('editing code, email or figurine sizes clears the previous discount', async () => {
  for (const edit of [s => s.input(s.$('promotion-code'), ''), s => s.input(s.$('email'), 'other@example.com'), s => s.size(0, '80')]) {
    const s = setup(); s.size(0, '32'); s.fillShipping(); s.input(s.$('promotion-code'), 'SAVE10');
    s.win.fetch = async () => Response.json(discountResponse());
    await s.submit(); assert.equal(s.$('promotion-result').hidden, false);
    edit(s);
    assert.equal(s.$('promotion-result').hidden, true);
    assert.notEqual(s.$('commission-submit').textContent, 'Przejdź do płatności');
    assert.notEqual(s.$('order-total').textContent, 'Suma: 88,2 zł');
    s.dom.window.close();
  }
});

test('a changed discounted price requires confirmation again before any redirect', async () => {
  const s = setup(); s.size(0, '32'); s.fillShipping(); s.input(s.$('promotion-code'), 'SAVE10');
  let count = 0;
  const fetch = s.win.fetch;
  s.win.fetch = async (url, options) => url.includes('/checkout-session')
    ? Response.json(++count === 1 ? discountResponse() : discountResponse(9310, 490))
    : fetch(url, options);
  await s.submit(); await s.submit();
  assert.equal(s.calls.length, 0); assert.equal(s.redirects.length, 0);
  assert.equal(s.$('order-total').textContent, 'Suma: 93,1 zł');
  await s.submit(); assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});

test('all five new brackets sum to 903 zł in the form, shipping, Basin and analytics', async () => {
  const s = setup();
  assert.equal(s.$('order-total').textContent, 'Suma:');
  const events = [];
  s.win.gtag = (...args) => events.push(args);
  for (const [i, size] of ['60', '61', '101', '151', '201'].entries()) {
    if (i) s.$('add-figurine-btn').click();
    s.size(i, size);
  }
  assert.deepEqual(s.cards().map(card => card.querySelector('[data-field="price"]').textContent), ['98 zł', '126 zł', '175 zł', '224 zł', '280 zł']);
  assert.equal(s.$('order-total').textContent, 'Suma: 903 zł');
  s.fillShipping();
  assert.match(s.$('shipping-order-summary').textContent, /Suma: 903 zł/);
  await s.submit();
  assert.equal(s.calls.length, 2);
  assert.equal(JSON.parse(s.calls[0].body).pricingVersion, PRICING_VERSION);
  const payload = s.calls[1].body;
  assert.equal(payload.get('cena'), '903 zł');
  assert.equal(payload.get('cena_przed_rabatem'), '1290 zł');
  assert.equal(payload.get('rabat_automatyczny'), '387 zł');
  assert.equal(payload.get('rabat_automatyczny_procent'), '30');
  assert.equal(payload.get('rabat'), '387 zł');
  assert.equal(events.find(event => event[1] === 'begin_checkout')[2].value, 903);
  assert.equal(events.find(event => event[1] === 'generate_lead')[2].value, 903);
  assert.equal(s.redirects.length, 1);
  s.dom.window.close();
});

test('without a code an old backend, wrong amount or wrong pricing version never redirects or sends Basin', async () => {
  const valid = priceResponse({ items: [{ size: 32 }] });
  for (const response of [
    { url: valid.url }, { ...valid, pricingVersion: 'old' },
    { ...valid, subtotal: 20000, total: 20000 }, { ...valid, total: 9801 },
    { ...valid, total: 8820, discount: 980 }, { ...valid, automaticDiscount: 0 },
    { ...valid, regularSubtotal: 20000 }, { ...valid, currency: 'eur' }
  ]) {
    const s = setup(); s.size(0, '32'); s.attach(0, 'keep.png'); s.fillShipping();
    let calls = 0;
    s.win.fetch = async url => {
      calls++; assert.ok(url.endsWith('/checkout-session')); return Response.json(response);
    };
    await s.submit();
    assert.equal(calls, 1); assert.equal(s.redirects.length, 0);
    assert.match(s.$('order-error').textContent, /potwierdzić aktualnej ceny/);
    assert.equal(s.$('photos').files[0].name, 'keep.png');
    s.dom.window.close();
  }
});

test('even one figurine cannot fall back to an old Payment Link when the endpoint is missing', async () => {
  const s = setup(); s.size(0, '32'); s.fillShipping(); s.win.AXI_CHECKOUT_ENDPOINT = '';
  await s.submit();
  assert.equal(s.calls.length, 0); assert.equal(s.redirects.length, 0);
  assert.equal(s.$('order-error').hidden, false);
  s.dom.window.close();
});
