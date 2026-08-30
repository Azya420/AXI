import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckout, validateOrder, stripeParameters } from '../api/checkout.mjs';
import { getPrice } from '../pricing.mjs';

const id = '081d9e64-638e-4a29-882e-39f5212cf96b';
const order = { orderId: id, email: 'test@example.com', items: [{ size: 32 }, { size: 80 }, { size: 120 }] };
const config = { stripeKey: 'test-only-not-a-real-key', siteOrigin: 'https://axi3d.pl', allowedOrigins: ['https://axi3d.pl'] };
const request = (body = order, headers = {}) => new Request('https://example.com/checkout-session', { method: 'POST', headers: { Origin: 'https://axi3d.pl', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('different sizes become three PLN line items totalling 670 zł', () => {
  const params = stripeParameters(validateOrder(order), config.siteOrigin);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '20000');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '22000');
  assert.equal(params.get('line_items[2][price_data][unit_amount]'), '25000');
  assert.equal(params.get('line_items[2][quantity]'), '1');
  assert.equal(params.get('line_items[2][price_data][currency]'), 'pln');
  assert.equal(params.get('payment_intent_data[metadata][order_id]'), id);
  assert.equal(params.get('client_reference_id'), id);
});
test('checkout enables promotion codes while preserving shipping and tax rules', () => {
  const params = stripeParameters(validateOrder(order), config.siteOrigin);
  assert.equal(params.get('automatic_tax[enabled]'), 'false');
  assert.equal(params.get('allow_promotion_codes'), 'true');
  assert.ok(![...params.keys()].some(key => key.startsWith('discounts[')), 'customer-entered codes must not conflict with an automatic discount');
  assert.equal(params.get('invoice_creation[enabled]'), 'false');
  assert.equal(params.get('billing_address_collection'), 'auto');
  assert.equal(params.get('customer_creation'), 'if_required');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('payment_method_collection'), null, 'subscription-only setting must be omitted for one-time payments');
  assert.ok(![...params.keys()].some(key => /shipping_options|tax_rates|payment_method_types/.test(key)));
});
test('client prices, quantities and redirect URLs cannot override server values', () => {
  const validated = validateOrder({ ...order, success_url: 'https://attacker.example', items: [{ size: 250, amount: 1, quantity: -8 }] });
  const params = stripeParameters(validated, config.siteOrigin);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '34000');
  assert.equal(params.get('line_items[0][quantity]'), '1');
  assert.equal(params.get('success_url'), 'https://axi3d.pl/dziekujemy.html');
});
test('multiple figures in the same bracket remain separate paid items', () => {
  const params = stripeParameters(validateOrder({ ...order, items: [{ size: 32 }, { size: 42 }] }), config.siteOrigin);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '20000');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '20000');
});
test('reject empty, oversized, fractional, string, out-of-range and unpriced orders', () => {
  for (const items of [[], Array(21).fill({ size: 32 }), [{ size: 19 }], [{ size: 251 }], [{ size: 32.4 }], [{ size: '32' }], [{ size: 65 }], [null]]) {
    assert.throws(() => validateOrder({ ...order, items }));
  }
  assert.throws(() => validateOrder({ ...order, email: 'invalid' }));
  assert.throws(() => validateOrder({ ...order, orderId: 'invalid' }));
  for (const size of [61, 69, 101, 109, 151, 159, 201, 209]) assert.equal(getPrice(size), null);
  for (const size of [20, 60, 70, 100, 110, 150, 160, 200, 210, 250]) assert.ok(getPrice(size));
});
test('retries use stable idempotency and changed orders use a different key', async () => {
  const keys = [];
  const stripe = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.headers.Authorization, 'Bearer ' + config.stripeKey);
    assert.equal(options.body.get('allow_promotion_codes'), 'true');
    keys.push(options.headers['Idempotency-Key']);
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/test-session' });
  };
  for (const body of [order, order, { ...order, items: [{ size: 250 }] }]) {
    const response = await handleCheckout(request(body), config, stripe);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), config.siteOrigin);
    assert.deepEqual(await response.json(), { url: 'https://checkout.stripe.com/c/pay/test-session' });
  }
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});
test('reject bad origin, content type, missing configuration and oversized body before Stripe', async () => {
  const never = () => { throw new Error('Unexpected Stripe request'); };
  assert.equal((await handleCheckout(request(order, { Origin: 'https://attacker.example' }), config, never)).status, 403);
  assert.equal((await handleCheckout(request(order, { 'Content-Type': 'text/plain' }), config, never)).status, 415);
  assert.equal((await handleCheckout(request(), { ...config, stripeKey: '' }, never)).status, 503);
  assert.equal((await handleCheckout(request({ ...order, excess: 'a'.repeat(9000) }), config, never)).status, 413);
  assert.equal((await handleCheckout(request({ ...order, items: [] }), config, never)).status, 400);
  const preflight = new Request('https://example.com/checkout-session', { method: 'OPTIONS', headers: { Origin: config.siteOrigin } });
  assert.equal((await handleCheckout(preflight, config, never)).status, 204);
});
test('Stripe failure and unsafe redirect do not leak provider errors or secrets', async () => {
  for (const stripe of [
    async () => Response.json({ error: { message: 'sensitive details ' + config.stripeKey } }, { status: 401 }),
    async () => Response.json({ url: 'https://attacker.example/pay' }),
    async () => { throw new Error(config.stripeKey); }
  ]) {
    const response = await handleCheckout(request(), config, stripe);
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes(config.stripeKey));
  }
});
test('server diagnostics identify Stripe failures without storing response bodies, keys or customer data', async () => {
  const logs = [];
  const loggedConfig = { ...config, reportStripeError: event => logs.push(event) };
  for (const status of [400, 401, 403, 429, 500]) {
    const stripe = async () => Response.json({ error: { message: config.stripeKey + ' ' + order.email } }, { status, headers: { 'Request-Id': 'req_CheckoutDiagnostic123' } });
    const response = await handleCheckout(request(), loggedConfig, stripe);
    assert.equal(response.status, 502);
    assert.deepEqual(logs.at(-1), { event: 'stripe_http_error', status, requestId: 'req_CheckoutDiagnostic123' });
    assert.ok(!(await response.text()).includes('req_CheckoutDiagnostic123'));
  }
  await handleCheckout(request(), loggedConfig, async () => { throw new Error(config.stripeKey); });
  assert.deepEqual(logs.at(-1), { event: 'stripe_transport_error' });
  await handleCheckout(request(), loggedConfig, async () => Response.json({}, { status: 401, headers: { 'Request-Id': 'invalid ' + config.stripeKey } }));
  assert.deepEqual(logs.at(-1), { event: 'stripe_http_error', status: 401 });
  assert.ok(!JSON.stringify(logs).includes(config.stripeKey));
  assert.ok(!JSON.stringify(logs).includes(order.email));
});
