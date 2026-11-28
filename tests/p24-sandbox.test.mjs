import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import {
  P24_SANDBOX_API,
  P24_SANDBOX_GATEWAY,
  P24_PRODUCTION_API,
  P24_PRODUCTION_GATEWAY,
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
const liveConfig = {
  ...config,
  p24: { merchantId: 654321, posId: 654321, apiKey: 'live-api-key', crc: 'live-crc-key' },
  p24ApiBase: P24_PRODUCTION_API,
  p24GatewayBase: P24_PRODUCTION_GATEWAY,
  p24Environment: 'production',
  p24FixedAmount: 150,
  p24CheckoutVersion: 'p24-live-test-v1',
  p24Description: 'TEST LIVE AXI3D',
  p24ReturnPath: '/p24-live-test/return',
  p24NotificationPath: '/p24-live-test/notification',
  p24ResultPath: '/p24-live-test-result.html'
};
const productionConfig = {
  ...liveConfig,
  stripeKey: 'rk_live_promotion_fixture',
  p24FixedAmount: null,
  p24EnablePromotions: true,
  p24IncludeOrderData: true,
  p24SessionPrefix: 'axip24',
  p24CheckoutVersion: 'p24-production-v1',
  p24Description: 'Zamowienie AXI3D',
  p24ReturnPath: '/p24/return',
  p24NotificationPath: '/p24/notification',
  p24ResultPath: '/dziekujemy.html'
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

test('registration stores the prepared order before contacting Przelewy24', async () => {
  const events = [];
  const callbackConfig = {
    ...config,
    onP24Prepared: prepared => {
      events.push('stored');
      assert.equal(prepared.order.orderId, orderId);
      assert.equal(prepared.amount, 13449);
      assert.equal(prepared.currency, 'PLN');
      assert.equal(prepared.environment, 'sandbox');
    }
  };
  const provider = async () => {
    events.push('provider');
    return Response.json({ data: { token: 'prepared-12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
  };
  const response = await handleP24Register(request(), callbackConfig, provider);
  assert.equal(response.status, 200);
  assert.deepEqual(events, ['stored', 'provider']);
});

test('registration stops safely when the prepared order cannot be stored', async () => {
  let providerCalls = 0;
  const callbackConfig = {
    ...config,
    onP24Prepared: async () => { throw new Error('database unavailable'); }
  };
  const response = await handleP24Register(request(), callbackConfig, async () => {
    providerCalls++;
    return Response.json({ data: { token: 'must-not-be-used' } });
  });
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
  assert.match((await response.json()).error, /zapisać zamówienia/);
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

test('production test registration uses live P24 with a fixed real payment of 1.50 PLN', async () => {
  let sent;
  const p24 = async (url, options) => {
    assert.equal(url, P24_PRODUCTION_API + '/transaction/register');
    sent = JSON.parse(options.body);
    return Response.json({ data: { token: 'live-12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
  };
  const response = await handleP24Register(request(), liveConfig, p24);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, P24_PRODUCTION_GATEWAY + 'live-12345678-abcd-4321-abcd-123456789012');
  assert.equal(result.checkoutVersion, 'p24-live-test-v1');
  assert.equal(result.technicalTestAmount, 150);
  assert.equal(result.total, 150);
  assert.equal(result.shippingAmount, 0);
  assert.equal(sent.amount, 150);
  assert.equal(sent.shipping, undefined);
  assert.equal(sent.waitForResult, true);
  assert.equal(sent.urlStatus, liveConfig.backendOrigin + '/p24-live-test/notification');
  assert.match(sent.urlReturn, /^https:\/\/axi-checkout\.onrender\.com\/p24-live-test\/return\?sessionId=/);
  assert.match(sent.description, /^TEST LIVE AXI3D/);
  assert.equal(sent.sign, p24Sign({
    sessionId: sent.sessionId, merchantId: liveConfig.p24.merchantId, amount: 150, currency: 'PLN', crc: liveConfig.p24.crc
  }));
});

test('production testAccess uses secure P24 and reports the production environment', async () => {
  const p24 = async (url, options) => {
    assert.equal(url, P24_PRODUCTION_API + '/testAccess');
    assert.match(options.headers.Authorization, /^Basic /);
    return Response.json({ data: true, error: '' });
  };
  const response = await handleP24TestAccess(new Request('https://api.example/p24-live-test/access', { headers: { Origin: config.siteOrigin } }), liveConfig, p24);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, environment: 'production' });
});

test('production checkout charges the full trusted amount through secure Przelewy24', async () => {
  let sent;
  const provider = async (url, options) => {
    assert.equal(url, P24_PRODUCTION_API + '/transaction/register');
    sent = JSON.parse(options.body);
    return Response.json({ data: { token: 'production-12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
  };
  const response = await handleP24Register(request(), productionConfig, provider);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.checkoutVersion, 'p24-production-v1');
  assert.equal(result.url, P24_PRODUCTION_GATEWAY + 'production-12345678-abcd-4321-abcd-123456789012');
  assert.equal(result.total, 13449);
  assert.equal(result.shippingAmount, 1649);
  assert.equal(result.discount, 0);
  assert.equal(sent.amount, 13449);
  assert.equal(sent.shipping, 1649);
  assert.equal(sent.client, order.customerName);
  assert.equal(sent.address, order.deliveryDestination);
  assert.equal(sent.urlStatus, productionConfig.backendOrigin + '/p24/notification');
  assert.match(sent.urlReturn, /^https:\/\/axi-checkout\.onrender\.com\/p24\/return\?sessionId=axip24\./);
});

test('production P24 validates the existing promotion code and charges the discounted amount', async () => {
  const calls = [];
  const withCode = { ...order, promotionCode: 'SAVE10' };
  const provider = async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://api.stripe.com/v1/promotion_codes?')) {
      assert.equal(new URL(url).searchParams.get('code'), 'SAVE10');
      return Response.json({ data: [{
        id: 'promo_fixture', active: true, code: 'SAVE10', customer: null, customer_account: null,
        promotion: { type: 'coupon', coupon: { id: 'coupon_fixture', valid: true, percent_off: 10, metadata: {} } },
        restrictions: {}
      }] });
    }
    assert.equal(url, P24_PRODUCTION_API + '/transaction/register');
    const sent = JSON.parse(options.body);
    assert.equal(sent.amount, 12269);
    assert.equal(sent.shipping, 1649);
    return Response.json({ data: { token: 'promotion-12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
  };
  const response = await handleP24Register(request(withCode), productionConfig, provider);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(url => new URL(url).hostname), ['api.stripe.com', 'secure.przelewy24.pl']);
  const result = await response.json();
  assert.equal(result.promotionCode, 'SAVE10');
  assert.equal(result.discount, 1180);
  assert.equal(result.total, 12269);
});

test('single-use 99% code discounts delivery and is disabled only after verified P24 payment', async () => {
  const discountedOrder = {
    ...order,
    orderId: 'd94506db-c540-4be2-a5e9-5c7fe241df0d',
    promotionCode: 'P24-TEST-99-Q7M4'
  };
  let sessionId;
  let deactivated = false;
  const provider = async (url, options) => {
    if (url.startsWith('https://api.stripe.com/v1/promotion_codes?')) return Response.json({ data: [{
      id: 'promo_single_use', active: true, code: discountedOrder.promotionCode,
      max_redemptions: 1, times_redeemed: 0, customer: null, customer_account: null,
      promotion: { type: 'coupon', coupon: {
        id: 'coupon_99', valid: true, percent_off: 99, max_redemptions: 1, times_redeemed: 0,
        metadata: { shipping_discount_percent: '99' }
      } },
      restrictions: {}
    }] });
    if (url === P24_PRODUCTION_API + '/transaction/register') {
      const sent = JSON.parse(options.body);
      sessionId = sent.sessionId;
      assert.equal(sent.amount, 134);
      assert.equal(sent.shipping, 16);
      return Response.json({ data: { token: 'single-use-12345678-abcd-4321-abcd-123456789012' }, responseCode: 0 });
    }
    if (url === P24_PRODUCTION_API + '/transaction/verify') {
      assert.equal(deactivated, false);
      return Response.json({ data: { status: 'success' }, responseCode: 0 });
    }
    if (url === 'https://api.stripe.com/v1/promotion_codes/promo_single_use') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('active'), 'false');
      deactivated = true;
      return Response.json({ id: 'promo_single_use', active: false });
    }
    throw new Error('Unexpected provider URL: ' + url);
  };

  const registration = await handleP24Register(request(discountedOrder), productionConfig, provider);
  assert.equal(registration.status, 200);
  const result = await registration.json();
  assert.equal(result.discount, 11682);
  assert.equal(result.shippingAmount, 16);
  assert.equal(result.total, 134);
  assert.equal(deactivated, false);

  const notification = {
    merchantId: productionConfig.p24.merchantId,
    posId: productionConfig.p24.posId,
    sessionId,
    amount: 134,
    originAmount: 134,
    currency: 'PLN',
    orderId: 912345678,
    methodId: 154,
    statement: 'AXI3D test'
  };
  notification.sign = p24Sign({ ...notification, crc: productionConfig.p24.crc });
  const response = await handleP24Notification(new Request('https://api.example/p24/notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notification)
  }), productionConfig, provider);
  assert.equal(response.status, 200);
  assert.equal(deactivated, true);
});

test('paid P24 status can recover verification after a server restart', async () => {
  const recoveryOrderId = 'b47644cd-a199-42bd-846c-d87a266e58bd';
  const amount = 13449;
  const sessionId = createP24SessionId(recoveryOrderId, amount, productionConfig.p24.crc, 'axip24');
  const p24OrderId = 876543210;
  const calls = [];
  const provider = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/transaction/by/sessionId/')) return Response.json({
      data: { sessionId, status: 2, amount, currency: 'PLN', orderId: p24OrderId }, responseCode: 0
    });
    assert.equal(url, P24_PRODUCTION_API + '/transaction/verify');
    const sent = JSON.parse(options.body);
    assert.equal(sent.sign, p24Sign({ sessionId, orderId: p24OrderId, amount, currency: 'PLN', crc: productionConfig.p24.crc }));
    return Response.json({ data: { status: 'success' }, responseCode: 0 });
  };
  const statusRequest = new Request('https://api.example/p24/status?sessionId=' + encodeURIComponent(sessionId), { headers: { Origin: config.siteOrigin } });
  const response = await handleP24Status(statusRequest, productionConfig, provider);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'paid');
  assert.equal(result.verified, true);
  assert.equal(result.transactionId, 'p24-' + p24OrderId);
  assert.equal(calls.length, 2);
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

test('hidden live page submits a TEST LIVE intake and accepts only secure P24 for 1.50 PLN', async () => {
  const html = readFileSync(new URL('../p24-live-test.html', import.meta.url), 'utf8');
  assert.match(html, /prawdziwe 1,50 zł/);
  assert.match(html, /p24-live-test-config\.js/);
  assert.doesNotMatch(html, /tracking\.js|checkout-config\.js|p24-test-config\.js/);
  const dom = new JSDOM(html, { url: 'https://axi3d.pl/p24-live-test.html', pretendToBeVisual: true });
  const doc = dom.window.document;
  const calls = [];
  const redirects = [];
  const win = {
    document: doc, FormData: dom.window.FormData, crypto: webcrypto,
    AbortController, setTimeout, clearTimeout, Date: dom.window.Date,
    requestAnimationFrame: () => {}, alert: () => {}, location: { assign: url => redirects.push(url) },
    AXI_CHECKOUT_ENDPOINT: 'https://axi-checkout.onrender.com/p24-live-test/register',
    AXI_PREVIEW_MODE: true, AXI_P24_TEST_MODE: true, AXI_P24_TEST_SUBMIT: true, AXI_P24_LIVE_TEST_MODE: true,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('usebasin.com')) {
        assert.match(options.body.get('subject'), /^TEST LIVE P24 — NIE REALIZOWAĆ/);
        assert.equal(options.body.get('kwota_testowej_platnosci'), '1,50 zł');
        assert.match(options.body.get('status_platnosci'), /prawdziwą płatność 1,50 zł/);
        return Response.json({ success: true });
      }
      return Response.json({
        url: P24_PRODUCTION_GATEWAY + 'live-12345678-abcd-4321-abcd-123456789012',
        checkoutVersion: 'p24-live-test-v1', pricingVersion: PRICING_VERSION,
        regularSubtotal: 11800, saleSubtotal: 11800, automaticDiscount: 0,
        bulkDiscount: 0, bulkPricing: false, subtotal: 11800,
        deliveryMethod: 'address', shippingAmount: 0, discount: 0,
        total: 150, currency: 'pln', promotionCode: '', technicalTestAmount: 150
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
  input('name', 'Klient Live Test'); input('email', 'live@example.com'); input('phone', '600123456');
  const address = doc.querySelector('input[name="dostawa"][value="Na adres"]');
  address.checked = true; address.dispatchEvent(new dom.window.Event('change'));
  input('ulica', 'Testowa 1'); input('kod', '00-001'); input('miasto', 'Warszawa');
  doc.getElementById('terms-accepted').checked = true;
  doc.getElementById('commission-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, win.AXI_CHECKOUT_ENDPOINT);
  assert.match(calls[1].url, /^https:\/\/usebasin\.com\//);
  assert.deepEqual(redirects, [P24_PRODUCTION_GATEWAY + 'live-12345678-abcd-4321-abcd-123456789012']);
  dom.window.close();
});
