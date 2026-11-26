import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import {
  P24_SANDBOX_API,
  P24_SANDBOX_GATEWAY,
  createP24SessionId,
  parseP24SessionId,
  p24Sign,
  handleP24TestAccess,
  handleP24Register,
  handleP24Notification,
  handleP24Status
} from '../api/p24-sandbox.mjs';
import { PRICING_VERSION } from '../pricing.mjs';
import { initOrderForm } from '../p24-test-form.mjs';

const orderId = '42c83558-f0af-40fe-a108-e61a071081d7';
const order = {
  pricingVersion: PRICING_VERSION,
  termsAccepted: true,
  orderId,
  email: 'sandbox@example.com',
  customerName: 'Klient Testowy',
  deliveryDestination: 'WAW01 — Warszawa',
  deliveryMethod: 'locker',
  promotionCode: '',
  items: [{ size: 32, copies: 1, description: 'Testowa figurka' }]
};
const config = {
  siteOrigin: 'https://axi3d.pl',
  backendOrigin: 'https://axi-checkout.onrender.com',
  allowedOrigins: ['https://axi3d.pl'],
  p24: { merchantId: 123456, posId: 123456, apiKey: 'sandbox-api-key', crc: 'sandbox-crc-key' }
};
const request = (body = order, origin = 'https://axi3d.pl') => new Request('https://api.example/p24-test/register', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('signed P24 sandbox session detects changes to order or amount', () => {
  const sessionId = createP24SessionId(orderId, 13449, config.p24.crc);
  assert.deepEqual(parseP24SessionId(sessionId, config.p24.crc), { orderId, amount: 13449 });
  assert.equal(parseP24SessionId(sessionId.replace('.13449.', '.13448.'), config.p24.crc), null);
  assert.equal(parseP24SessionId(sessionId, 'wrong-crc'), null);
});

test('testAccess uses sandbox credentials without exposing them to the browser', async () => {
  const calls = [];
  const p24 = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ data: true, error: '' });
  };
  const response = await handleP24TestAccess(new Request('https://api.example/p24-test/access', { headers: { Origin: config.siteOrigin } }), config, p24);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, environment: 'sandbox' });
  assert.equal(calls[0].url, P24_SANDBOX_API + '/testAccess');
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.ok(!(await (await handleP24TestAccess(new Request('https://api.example/p24-test/access', { headers: { Origin: config.siteOrigin } }), config, p24)).text()).includes(config.p24.apiKey));
});

test('registration calculates the trusted server total and returns only a sandbox redirect', async () => {
  let sent;
  const p24 = async (url, options) => {
    assert.equal(url, P24_SANDBOX_API + '/transaction/register');
    assert.equal(options.method, 'POST');
    sent = JSON.parse(options.body);
    return Response.json({ data: { token: '12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
  };
  const response = await handleP24Register(request(), config, p24);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, P24_SANDBOX_GATEWAY + '12345678-abcd-4321-abcd-123456789012');
  assert.equal(result.checkoutVersion, 'p24-sandbox-v1');
  assert.equal(result.subtotal, 11800);
  assert.equal(result.shippingAmount, 1649);
  assert.equal(result.total, 13449);
  assert.equal(sent.amount, 13449);
  assert.equal(sent.shipping, 1649);
  assert.equal(sent.currency, 'PLN');
  assert.equal(sent.urlStatus, config.backendOrigin + '/p24-test/notification');
  assert.equal(sent.waitForResult, true);
  assert.match(sent.urlReturn, /^https:\/\/axi-checkout\.onrender\.com\/p24-test\/return\?sessionId=/);
  assert.equal(sent.sign, p24Sign({
    sessionId: sent.sessionId, merchantId: config.p24.merchantId, amount: 13449, currency: 'PLN', crc: config.p24.crc
  }));
  assert.deepEqual(parseP24SessionId(sent.sessionId, config.p24.crc), { orderId, amount: 13449 });
});

test('registration rejects foreign origins, production-independent missing config and Stripe promotion codes', async () => {
  const never = () => { throw new Error('Unexpected P24 request'); };
  assert.equal((await handleP24Register(request(order, 'https://attacker.example'), config, never)).status, 403);
  assert.equal((await handleP24Register(request(), { ...config, p24: { ...config.p24, apiKey: '' } }, never)).status, 503);
  const withCode = { ...order, promotionCode: 'TEST10' };
  const response = await handleP24Register(request(withCode), config, never);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Kody promocyjne/);
});

test('valid notification is signed, verified through P24 and visible on the result page status endpoint', async () => {
  const amount = 13449;
  const sessionId = createP24SessionId(orderId, amount, config.p24.crc);
  const notification = {
    merchantId: config.p24.merchantId,
    posId: config.p24.posId,
    sessionId,
    amount,
    originAmount: amount,
    currency: 'PLN',
    orderId: 9876543210,
    methodId: 154,
    statement: 'P24-TEST-AXI'
  };
  notification.sign = p24Sign({ ...notification, crc: config.p24.crc });
  let verifyBody;
  const verify = async (url, options) => {
    assert.equal(url, P24_SANDBOX_API + '/transaction/verify');
    assert.equal(options.method, 'PUT');
    verifyBody = JSON.parse(options.body);
    return Response.json({ data: { status: 'success' }, responseCode: 0 });
  };
  const notifyRequest = new Request('https://api.example/p24-test/notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notification)
  });
  const notificationResponse = await handleP24Notification(notifyRequest, config, verify);
  assert.equal(notificationResponse.status, 200);
  assert.equal(verifyBody.sign, p24Sign({ sessionId, orderId: notification.orderId, amount, currency: 'PLN', crc: config.p24.crc }));

  const statusFetch = async (url, options) => {
    assert.equal(url, P24_SANDBOX_API + '/transaction/by/sessionId/' + encodeURIComponent(sessionId));
    assert.match(options.headers.Authorization, /^Basic /);
    return Response.json({ data: { sessionId, status: 2, amount, currency: 'PLN' }, responseCode: 0 });
  };
  const statusRequest = new Request('https://api.example/p24-test/status?sessionId=' + encodeURIComponent(sessionId), { headers: { Origin: config.siteOrigin } });
  const statusResponse = await handleP24Status(statusRequest, config, statusFetch);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { status: 'paid', verified: true, amount, currency: 'PLN' });
});

test('invalid P24 notification signature never reaches transaction verification', async () => {
  const amount = 13449;
  const sessionId = createP24SessionId(orderId, amount, config.p24.crc);
  const notification = {
    merchantId: config.p24.merchantId, posId: config.p24.posId, sessionId, amount, originAmount: amount,
    currency: 'PLN', orderId: 123456789, methodId: 154, statement: 'P24-TEST-AXI', sign: '0'.repeat(96)
  };
  const never = () => { throw new Error('Unexpected verification request'); };
  const response = await handleP24Notification(new Request('https://api.example/p24-test/notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notification)
  }), config, never);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /podpis/);
});

test('hidden test page sends a marked Basin submission and then uses only P24 sandbox', async () => {
  const html = readFileSync(new URL('../p24-sandbox-test.html', import.meta.url), 'utf8');
  assert.match(html, /usebasin\.com\/f\/235f4a9bd75b/);
  assert.doesNotMatch(html, /tracking\.js|checkout-config\.js|order-form\.mjs/);
  assert.match(html, /noindex,nofollow,noarchive/);
  const dom = new JSDOM(html, { url: 'https://axi3d.pl/p24-sandbox-test.html', pretendToBeVisual: true });
  const doc = dom.window.document;
  const calls = [];
  const redirects = [];
  const win = {
    document: doc,
    FormData: dom.window.FormData,
    crypto: webcrypto,
    AbortController,
    setTimeout,
    clearTimeout,
    Date: dom.window.Date,
    requestAnimationFrame: () => {},
    alert: () => {},
    location: { assign: url => redirects.push(url) },
    AXI_CHECKOUT_ENDPOINT: 'https://axi-checkout.onrender.com/p24-test/register',
    AXI_PREVIEW_MODE: true,
    AXI_P24_TEST_MODE: true,
    AXI_P24_TEST_SUBMIT: true,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('usebasin.com')) {
        assert.equal(options.body.get('tryb'), 'TEST — NIE REALIZOWAĆ');
        assert.match(options.body.get('subject'), /^TEST — NIE REALIZOWAĆ/);
        assert.equal(options.body.get('status_platnosci'), 'TEST — sandbox Przelewy24, bez prawdziwych pieniędzy');
        assert.match(options.body.get('link_do_platnosci'), /^https:\/\/sandbox\.przelewy24\.pl\/trnRequest\//);
        return Response.json({ success: true });
      }
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.items[0].size, 32);
      return Response.json({
        url: P24_SANDBOX_GATEWAY + '12345678-abcd-4321-abcd-123456789012',
        checkoutVersion: 'p24-sandbox-v1', pricingVersion: PRICING_VERSION,
        regularSubtotal: 11800, saleSubtotal: 11800, automaticDiscount: 0,
        bulkDiscount: 0, bulkPricing: false, subtotal: 11800,
        deliveryMethod: 'address', shippingAmount: 1949, discount: 0,
        total: 13749, currency: 'pln', promotionCode: ''
      });
    }
  };
  initOrderForm(win);
  const input = (id, value) => {
    const element = doc.getElementById(id);
    element.value = value;
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  input('scale', '32');
  doc.getElementById('open-shipping-btn').click();
  input('name', 'Klient Testowy');
  input('email', 'sandbox@example.com');
  input('phone', '600123456');
  const address = doc.querySelector('input[name="dostawa"][value="Na adres"]');
  address.checked = true;
  address.dispatchEvent(new dom.window.Event('change'));
  input('ulica', 'Testowa 1');
  input('kod', '00-001');
  input('miasto', 'Warszawa');
  doc.getElementById('terms-accepted').checked = true;
  doc.getElementById('commission-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, win.AXI_CHECKOUT_ENDPOINT);
  assert.match(calls[1].url, /^https:\/\/usebasin\.com\//);
  assert.deepEqual(redirects, [P24_SANDBOX_GATEWAY + '12345678-abcd-4321-abcd-123456789012']);
  dom.window.close();
});
