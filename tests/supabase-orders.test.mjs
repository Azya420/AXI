import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreviewOrderAccount } from '../api/supabase-orders.mjs';

const origin = 'https://axi-1.onrender.com';
const sessionId = 'cs_test_PostOrderFixture123';
const orderId = '81c9215c-9342-4e39-8ed1-2d9ef8ff2414';
const userId = 'd74c1ed3-26a8-42dd-8e31-f5d665eb8bd1';
const config = {
  backendOrigin: origin,
  stripeKey: 'sk_test_fixture',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'sb_publishable_' + 'p'.repeat(30),
  supabaseSecretKey: 'sb_secret_' + 's'.repeat(40)
};

function request(body, token = '') {
  return new Request(origin + '/preview/order-account', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
}

function stripeSession(overrides = {}) {
  return async () => Response.json({
    id: sessionId,
    livemode: false,
    payment_status: 'paid',
    client_reference_id: orderId,
    customer_details: { email: 'klient@example.com' },
    amount_total: 13449,
    currency: 'pln',
    created: 1795759200,
    metadata: {
      preview: 'true', customer_name: 'Jan Kowalski', phone: '+48600123456',
      shipping_method: 'locker', delivery_destination: 'GLI01 — Rynek 1, Gliwice'
    },
    line_items: { data: [] },
    ...overrides
  });
}

test('inspection reveals a paid sandbox order only after server-side Stripe verification', async () => {
  const response = await handlePreviewOrderAccount(request({ action: 'inspect', sessionId }), config, stripeSession(), async () => {
    throw new Error('Supabase must not be called for inspection');
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    paid: true, orderNumber: orderId, customerEmail: 'klient@example.com', customerName: 'Jan Kowalski', amount: 13449, currency: 'PLN'
  });
  for (const unsafe of [
    { payment_status: 'unpaid' }, { livemode: true }, { metadata: { preview: 'false' } }, { client_reference_id: 'invalid' }
  ]) {
    const rejected = await handlePreviewOrderAccount(request({ action: 'inspect', sessionId }), config, stripeSession(unsafe));
    assert.equal(rejected.status, 409);
  }
});

test('claim requires an authenticated account with the same email as the paid order', async () => {
  const missing = await handlePreviewOrderAccount(request({ action: 'claim', sessionId }), config, stripeSession(), async () => {
    throw new Error('No token should stop before Supabase');
  });
  assert.equal(missing.status, 401);

  const mismatchSupabase = async url => {
    assert.match(url, /\/auth\/v1\/user$/);
    return Response.json({ id: userId, email: 'inna-osoba@example.com' });
  };
  const mismatch = await handlePreviewOrderAccount(request({ action: 'claim', sessionId }, 'user-token-' + 'x'.repeat(24)), config, stripeSession(), mismatchSupabase);
  assert.equal(mismatch.status, 403);
  assert.match((await mismatch.json()).error, /E-mail konta/);
});

test('claim creates one paid order and saves reusable details only when selected', async () => {
  const calls = [];
  const supabase = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, email: 'Klient@example.com' });
    if (url.includes('/rest/v1/orders?')) return Response.json([]);
    if (url.endsWith('/rest/v1/orders')) return Response.json([{ id: 'saved-order', ...JSON.parse(options.body) }], { status: 201 });
    if (url.includes('/rest/v1/profiles?')) return new Response(null, { status: 204 });
    throw new Error('Unexpected Supabase request: ' + url);
  };
  const response = await handlePreviewOrderAccount(
    request({ action: 'claim', sessionId, rememberData: true }, 'user-token-' + 'x'.repeat(24)),
    config, stripeSession(), supabase
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: true, orderNumber: orderId, remembered: true });
  const orderWrite = calls.find(call => call.url.endsWith('/rest/v1/orders'));
  assert.equal(orderWrite.body.user_id, userId);
  assert.equal(orderWrite.body.status, 'paid');
  assert.equal(orderWrite.body.payment_reference, sessionId);
  assert.equal(orderWrite.body.amount_total, 13449);
  const profileWrite = calls.find(call => call.url.includes('/rest/v1/profiles?'));
  assert.equal(profileWrite.body.phone, '+48600123456');
  assert.equal(profileWrite.body.delivery_method, 'locker');
  assert.equal(orderWrite.options.headers.Authorization, undefined);
  assert.ok(calls.every(call => call.options.headers.apikey !== config.supabasePublishableKey || call.url.endsWith('/auth/v1/user')));
  assert.ok(!(await (await handlePreviewOrderAccount(request({ action: 'inspect', sessionId }), config, stripeSession())).text()).includes(config.supabaseSecretKey));
});

test('an existing order cannot be reassigned to another account', async () => {
  const supabase = async url => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, email: 'klient@example.com' });
    if (url.includes('/rest/v1/orders?')) return Response.json([{
      id: 'existing', order_number: orderId, user_id: '9f19e40c-f44e-4f19-814f-454db93c4181',
      customer_email: 'klient@example.com', payment_reference: sessionId
    }]);
    throw new Error('Write must not happen');
  };
  const response = await handlePreviewOrderAccount(
    request({ action: 'claim', sessionId }, 'user-token-' + 'x'.repeat(24)), config, stripeSession(), supabase
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /innego konta/);
});
