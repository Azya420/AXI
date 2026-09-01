import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckout, validateOrder } from '../api/checkout.mjs';

import { PRICING_VERSION } from '../pricing.mjs';

const config = { stripeKey: 'not-a-real-key', siteOrigin: 'https://axi3d.pl', allowedOrigins: ['https://axi3d.pl'] };
const order = { pricingVersion: PRICING_VERSION, orderId: '081d9e64-638e-4a29-882e-39f5212cf96b', email: 'test@example.com', deliveryMethod: 'locker', items: [{ size: 32 }, { size: 80 }], termsAccepted: true, promotionCode: '  SAVE10  ' };
const request = body => new Request('https://api.example/checkout-session', { method: 'POST', headers: { Origin: config.siteOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const promotion = { id: 'promo_Valid123', active: true, code: 'save10', customer: null, customer_account: null };
const session = { url: 'https://checkout.stripe.com/c/pay/cs_live_Test123', currency: 'pln', amount_subtotal: 22400, amount_total: 21809, total_details: { amount_discount: 2240, amount_shipping: 1649 } };

test('server rejects missing consent and malformed codes before any Stripe request', async () => {
  let calls = 0;
  const stripe = () => { calls++; throw new Error('Unexpected Stripe request'); };
  for (const termsAccepted of [undefined, false, 'true', 1]) {
    const response = await handleCheckout(request({ ...order, termsAccepted }), config, stripe);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'terms_required');
  }
  for (const promotionCode of [123, {}, 'a'.repeat(501), 'SAVE&limit=1', 'SAVE CODE']) {
    assert.throws(() => validateOrder({ ...order, promotionCode }));
  }
  assert.equal(calls, 0);
});

test('server resolves the typed code, applies only its trusted ID and returns Stripe totals', async () => {
  const calls = [];
  const response = await handleCheckout(request({ ...order, promotionId: 'promo_Attacker', total: 1 }), config, async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      const query = new URL(url).searchParams;
      assert.equal(query.get('code'), 'SAVE10');
      assert.equal(query.get('active'), 'true');
      assert.equal(options.headers.Authorization, 'Bearer ' + config.stripeKey);
      return Response.json({ data: [promotion] });
    }
    assert.equal(options.body.get('discounts[0][promotion_code]'), promotion.id);
    assert.equal(options.body.get('allow_promotion_codes'), null);
    assert.equal(options.body.get('metadata[terms_accepted]'), 'true');
    assert.equal(options.body.get('metadata[terms_version]'), '2026-08-30');
    assert.equal(options.body.get('line_items[0][price_data][unit_amount]'), '9800');
    return Response.json(session);
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(await response.json(), { url: session.url, checkoutVersion: 3, pricingVersion: PRICING_VERSION, regularSubtotal: 32000, saleSubtotal: 22400, automaticDiscount: 9600, bulkDiscount: 0, bulkPricing: false, subtotal: 22400, deliveryMethod: 'locker', shippingAmount: 1649, discount: 2240, total: 21809, currency: 'pln', promotionCode: 'SAVE10' });
});

test('invalid, inactive and customer-restricted codes never create a full-price session', async () => {
  for (const data of [[], [{ ...promotion, active: false }], [{ ...promotion, code: 'OTHER' }], [{ ...promotion, customer: 'cus_Private' }], [{ ...promotion, customer_account: 'acct_Private' }]]) {
    let calls = 0;
    const response = await handleCheckout(request(order), config, async (_, options) => {
      calls++; assert.equal(options.method, 'GET'); return Response.json({ data });
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_promotion_code');
    assert.equal(calls, 1);
  }
});

test('missing promotion-code permission fails safely without leaking Stripe details', async () => {
  const logs = [];
  const response = await handleCheckout(request(order), { ...config, reportStripeError: log => logs.push(log) }, async () => Response.json({ error: { message: config.stripeKey } }, { status: 403 }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'promotion_codes_unavailable');
  assert.deepEqual(logs, [{ event: 'stripe_http_error', status: 403, stage: 'promotion_lookup' }]);
  assert.ok(!JSON.stringify(logs).includes(config.stripeKey));
});

test('Stripe eligibility rejection, no discount and inconsistent totals block checkout', async () => {
  for (const result of [
    () => Response.json({ error: { message: 'secret provider message' } }, { status: 400 }),
    () => Response.json({ ...session, amount_total: 24049, total_details: { amount_discount: 0, amount_shipping: 1649 } }),
    () => Response.json({ ...session, amount_total: 1 }),
    () => Response.json({ ...session, currency: 'eur' })
  ]) {
    const response = await handleCheckout(request(order), config, async (_, options) => options.method === 'GET' ? Response.json({ data: [promotion] }) : result());
    assert.ok([400, 502].includes(response.status));
    const body = await response.text();
    assert.ok(!body.includes(session.url));
    assert.ok(!body.includes('secret provider message'));
  }
});

test('percentage, fixed amount and full discount use Stripe amounts without browser calculations', async () => {
  for (const discount of [2240, 5000, 22400]) {
    const response = await handleCheckout(request(order), config, async (_, options) => options.method === 'GET'
      ? Response.json({ data: [promotion] })
      : Response.json({ ...session, amount_total: 22400 + 1649 - discount, total_details: { amount_discount: discount, amount_shipping: 1649 } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).total, 22400 + 1649 - discount);
  }
});

test('a promotion code stacks on the trusted 3+ prices without discounting shipping', async () => {
  const bulkOrder = { ...order, items: [{ size: 32 }, { size: 80 }, { size: 120 }] };
  const response = await handleCheckout(request(bulkOrder), config, async (_, options) => {
    if (options.method === 'GET') return Response.json({ data: [promotion] });
    assert.deepEqual([0, 1, 2].map(index => options.body.get('line_items[' + index + '][price_data][unit_amount]')), ['6500', '10500', '15000']);
    assert.equal(options.body.get('metadata[bulk_pricing_applied]'), 'true');
    return Response.json({ ...session, amount_subtotal: 32000, amount_total: 30449,
      total_details: { amount_discount: 3200, amount_shipping: 1649 } });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: session.url, checkoutVersion: 3, pricingVersion: PRICING_VERSION,
    regularSubtotal: 57000, saleSubtotal: 39900, automaticDiscount: 17100,
    bulkDiscount: 7900, bulkPricing: true, subtotal: 32000, deliveryMethod: 'locker', shippingAmount: 1649,
    discount: 3200, total: 30449, currency: 'pln', promotionCode: 'SAVE10' });
});
