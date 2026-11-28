import test from 'node:test';
import assert from 'node:assert/strict';
import { createP24SessionId, P24_SANDBOX_API } from '../api/p24-sandbox.mjs';
import { handlePreviewOrderAccount, savePendingP24Order } from '../api/supabase-orders.mjs';

const origin = 'https://axi-1.onrender.com';
const crc = 'sandbox-crc-fixture';
const userId = 'd74c1ed3-26a8-42dd-8e31-f5d665eb8bd1';
const config = {
  backendOrigin: origin,
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'sb_publishable_' + 'p'.repeat(30),
  supabaseSecretKey: 'sb_secret_' + 's'.repeat(40),
  p24: { merchantId: 12345, posId: 12345, apiKey: 'sandbox-api', crc }
};
const p24Config = {
  ...config,
  allowedOrigins: [origin],
  p24Environment: 'sandbox',
  p24IncludeOrderData: true
};

function session(orderId, amount = 13449) {
  return createP24SessionId(orderId, amount, crc, 'axitest');
}

function request(sessionId, action = 'inspect', token = '', rememberData = false) {
  return new Request(origin + '/preview/order-account', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ action, sessionId, rememberData })
  });
}

function orderRecord(orderId, sessionId, overrides = {}) {
  return {
    id: 'saved-order', order_number: orderId, user_id: null,
    customer_email: 'klient@example.com', customer_name: 'Jan Kowalski', customer_phone: '+48600123456',
    status: 'new', amount_total: 13449, currency: 'PLN', payment_provider: 'przelewy24_sandbox',
    payment_reference: sessionId, delivery_method: 'locker', delivery_destination: 'GLI01 — Rynek 1, Gliwice',
    ordered_at: '2026-11-28T09:00:00.000Z', ...overrides
  };
}

function paidP24(sessionId, status = 2) {
  return async (url, options = {}) => {
    if (url === P24_SANDBOX_API + '/transaction/by/sessionId/' + encodeURIComponent(sessionId)) {
      return Response.json({ data: { sessionId, status, orderId: 987654321, amount: 13449, currency: 'PLN' } });
    }
    if (url === P24_SANDBOX_API + '/transaction/verify') {
      assert.equal(options.method, 'PUT');
      return Response.json({ data: { status: 'success' } });
    }
    throw new Error('Unexpected P24 request: ' + url);
  };
}

function supabaseState(initialOrder, authEmail = 'klient@example.com') {
  let current = initialOrder ? { ...initialOrder } : null;
  const calls = [];
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, email: authEmail });
    if (url.includes('/rest/v1/orders?') && options.method === 'GET') return Response.json(current ? [current] : []);
    if (url.includes('/rest/v1/orders') && options.method === 'PATCH') {
      current = { ...current, ...body };
      return Response.json([current]);
    }
    if (url.includes('/rest/v1/orders') && options.method === 'POST') {
      current = { id: 'saved-order', ...body };
      return Response.json([current], { status: 201 });
    }
    if (url.includes('/rest/v1/profiles?')) return new Response(null, { status: 204 });
    throw new Error('Unexpected Supabase request: ' + url);
  };
  return { fetch, calls, get order() { return current; } };
}

test('Przelewy24 order is stored before the customer is redirected to the sandbox', async () => {
  const orderId = '81c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const sessionId = session(orderId);
  const state = supabaseState(null);
  const saved = await savePendingP24Order({
    sessionId, amount: 13449, currency: 'PLN', environment: 'sandbox',
    order: {
      orderId, email: 'Klient@example.com', customerName: 'Jan Kowalski', phone: '+48600123456',
      deliveryMethod: 'locker', deliveryDestination: 'GLI01 — Rynek 1, Gliwice'
    }
  }, config, state.fetch);
  assert.equal(saved.payment_provider, 'przelewy24_sandbox');
  assert.equal(saved.payment_reference, sessionId);
  assert.equal(saved.customer_phone, '+48600123456');
  assert.equal(saved.status, 'new');
});

test('inspection reveals an order only after server-side Przelewy24 verification', async () => {
  const orderId = '91c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const sessionId = session(orderId);
  const state = supabaseState(orderRecord(orderId, sessionId));
  const response = await handlePreviewOrderAccount(request(sessionId), config, p24Config, paidP24(sessionId), state.fetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    paid: true, orderNumber: orderId, customerEmail: 'klient@example.com', customerName: 'Jan Kowalski', amount: 13449, currency: 'PLN'
  });
  assert.equal(state.order.status, 'paid');

  const pendingId = 'a1c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const pendingSession = session(pendingId);
  const pendingState = supabaseState(orderRecord(pendingId, pendingSession));
  const pending = await handlePreviewOrderAccount(request(pendingSession), config, p24Config, paidP24(pendingSession, 0), pendingState.fetch);
  assert.equal(pending.status, 409);
  assert.match((await pending.json()).error, /nie została jeszcze potwierdzona/);

  const tampered = await handlePreviewOrderAccount(request(sessionId.slice(0, -1) + '0'), config, p24Config, paidP24(sessionId), state.fetch);
  assert.equal(tampered.status, 400);
});

test('claim requires an authenticated account with the same email as the paid P24 order', async () => {
  const orderId = 'b1c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const sessionId = session(orderId);
  const state = supabaseState(orderRecord(orderId, sessionId, { status: 'paid' }));
  const missing = await handlePreviewOrderAccount(request(sessionId, 'claim'), config, p24Config, paidP24(sessionId), state.fetch);
  assert.equal(missing.status, 401);

  const mismatchState = supabaseState(orderRecord(orderId, sessionId, { status: 'paid' }), 'inna-osoba@example.com');
  const mismatch = await handlePreviewOrderAccount(
    request(sessionId, 'claim', 'user-token-' + 'x'.repeat(24)), config, p24Config, paidP24(sessionId), mismatchState.fetch
  );
  assert.equal(mismatch.status, 403);
  assert.match((await mismatch.json()).error, /E-mail konta/);
});

test('claim links the verified P24 order and saves reusable details only when selected', async () => {
  const orderId = 'c1c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const sessionId = session(orderId);
  const state = supabaseState(orderRecord(orderId, sessionId, { status: 'paid' }));
  const response = await handlePreviewOrderAccount(
    request(sessionId, 'claim', 'user-token-' + 'x'.repeat(24), true), config, p24Config, paidP24(sessionId), state.fetch
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: true, orderNumber: orderId, remembered: true });
  assert.equal(state.order.user_id, userId);
  const profileWrite = state.calls.find(call => call.url.includes('/rest/v1/profiles?'));
  assert.equal(profileWrite.body.phone, '+48600123456');
  assert.equal(profileWrite.body.delivery_method, 'locker');
  const orderWrite = state.calls.find(call => call.url.includes('/rest/v1/orders') && call.options.method === 'PATCH' && call.body.user_id);
  assert.equal(orderWrite.options.headers.Authorization, undefined);
});

test('an existing P24 order cannot be reassigned to another account', async () => {
  const orderId = 'd1c9215c-9342-4e39-8ed1-2d9ef8ff2414';
  const sessionId = session(orderId);
  const state = supabaseState(orderRecord(orderId, sessionId, {
    status: 'paid', user_id: '9f19e40c-f44e-4f19-814f-454db93c4181'
  }));
  const response = await handlePreviewOrderAccount(
    request(sessionId, 'claim', 'user-token-' + 'x'.repeat(24)), config, p24Config, paidP24(sessionId), state.fetch
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /innego konta/);
});
