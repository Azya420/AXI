import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { initOrderForm } from '../order-form.mjs';
import { renderPreviewHtml } from '../api/preview.mjs';

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
      return Response.json(url.includes('/checkout-session') ? { url: preview ? 'https://checkout.stripe.com/c/pay/cs_test_preview' : 'https://checkout.stripe.com/c/pay/cs_live_fixture' } : { success: true });
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
  s.size(0, '32'); s.input(s.$('desc'), 'Pierwsza postać'); s.attach(0, 'first.png');
  s.$('add-figurine-btn').click(); s.size(1, '80');
  s.$('add-figurine-btn').click(); s.size(2, '120');
  assert.equal(s.$('desc').value, 'Pierwsza postać');
  assert.equal(s.$('photos').files[0].name, 'first.png');
  assert.equal(s.$('price-hidden').value, '670 zł');
  assert.equal(s.cards()[1].querySelector('textarea').value, '');
  const ids = [...s.doc.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const label of s.$('figurine-list').querySelectorAll('label[for]')) assert.ok(s.$(label.htmlFor));
  s.cards()[1].querySelector('.remove-figurine').click();
  assert.equal(s.$('price-hidden').value, '450 zł');
  assert.equal(s.cards()[1].querySelector('legend').textContent, 'Figurka 2');
  assert.equal(s.cards()[1].querySelector('input[type=file]').name, 'figurka_2_zdjecia');
  s.cards()[0].querySelector('.remove-figurine').click();
  assert.equal(s.$('price-hidden').value, '250 zł');
  assert.equal(s.cards()[0].querySelector('input[type=number]').name, 'rozmiar');
  assert.ok(s.cards()[0].querySelector('.remove-figurine').hidden);
  s.dom.window.close();
});
test('blank, fractional and unpriced sizes block shipping; maximum count enforced', () => {
  const s = setup();
  for (const size of ['', '65', '32.5', '251']) {
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
  assert.equal(payload.get('cena'), '450 zł');
  assert.equal(payload.get('liczba_figurek'), '2');
  assert.equal(payload.get('opis'), 'Druid'); assert.equal(payload.get('figurka_2_opis'), 'Smok');
  assert.equal(payload.get('zdjecia').name, 'druid.png');
  assert.deepEqual(payload.getAll('figurka_2_zdjecia').map(f => f.name), ['dragon.png', 'dragon-back.png']);
  assert.equal(payload.get('telefon'), '+48600123456');
  assert.equal(payload.get('email'), 'test@example.com');
  assert.equal(payload.get('miasto'), 'Warszawa');
  assert.equal(payload.get('numer_zamowienia'), checkout.orderId);
  assert.equal(payload.get('link_do_platnosci'), 'https://checkout.stripe.com/c/pay/cs_live_fixture');
  assert.match(payload.get('podsumowanie_figurek'), /Figurka 2: 120 mm, 250 zł/);
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
test('single-figure fallback retains existing Stripe link and locker shipping', async () => {
  const s = setup(); s.win.AXI_CHECKOUT_ENDPOINT = ''; s.size(0, '80'); s.fillShipping();
  const locker = s.doc.querySelector('input[name="dostawa"][value="Paczkomat InPost"]');
  locker.checked = true; locker.dispatchEvent(new s.dom.window.Event('change'));
  await s.submit(); assert.equal(s.calls.length, 0); assert.equal(s.alerts.length, 1);
  s.$('paczkomat-hidden').value = 'WAW123'; await s.submit();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].body.get('paczkomat'), 'WAW123'); assert.equal(s.calls[0].body.get('ulica'), null);
  assert.match(s.redirects[0], /^https:\/\/buy\.stripe\.com\/8x2bJ23jK0nH8X504teZ201\?/);
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
  resolveCheckout(Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_fixture' }));
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
