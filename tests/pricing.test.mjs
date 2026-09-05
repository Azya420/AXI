import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrice, getItemSubtotal, PRICING_VERSION, SHIPPING_AMOUNT } from '../pricing.mjs';
import { handleCheckout } from '../api/checkout.mjs';

const config = { stripeKey: 'not-a-real-key', siteOrigin: 'https://axi3d.pl', allowedOrigins: ['https://axi3d.pl'] };
const order = { pricingVersion: PRICING_VERSION, termsAccepted: true,
  orderId: '081d9e64-638e-4a29-882e-39f5212cf96b', email: 'test@example.com',
  deliveryMethod: 'locker',
  items: [20, 61, 101, 151, 201].map(size => ({ size, amount: 1, quantity: 100, discount: 99 })) };
const request = body => new Request('https://api.example/checkout-session', {
  method: 'POST', headers: { Origin: config.siteOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('all 231 integer sizes use the base, 2-project and 3+ prices', () => {
  for (const [min, max, regularAmount, amount, pairAmount, bulkAmount] of [
    [20, 60, 9800, 9800, 8800, 6500], [61, 100, 12600, 12600, 11600, 10500], [101, 150, 17500, 17500, 16500, 15000],
    [151, 200, 22400, 22400, 21400, 19500], [201, 250, 28000, 28000, 27000, 24500]
  ]) {
    for (let size = min; size <= max; size++) {
      assert.equal(getPrice(size).amount, amount, 'payable amount at ' + size + ' mm');
      assert.equal(getPrice(size).regularAmount, regularAmount);
      assert.equal(getPrice(size, 2).amount, pairAmount, '2-project amount at ' + size + ' mm');
      assert.equal(getPrice(size, 3).amount, bulkAmount, '3+ amount at ' + size + ' mm');
      assert.equal(getPrice(size, 20).amount, bulkAmount);
    }
  }
  for (const size of [19, 251, 60.5, NaN, Infinity, '61', null]) assert.equal(getPrice(size), null);
});

test('two different projects use the dedicated prices in Stripe', async () => {
  const pairOrder = { ...order, items: [{ size: 32 }, { size: 120 }] };
  const response = await handleCheckout(request(pairOrder), config, async (url, options) => {
    assert.equal(options.body.get('line_items[0][price_data][unit_amount]'), '8800');
    assert.equal(options.body.get('line_items[1][price_data][unit_amount]'), '16500');
    assert.match(options.body.get('line_items[0][price_data][product_data][name]'), /cena za 2 projekty/);
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_Pair123', currency: 'pln',
      amount_subtotal: 25300, amount_total: 26949, total_details: { amount_discount: 0, amount_shipping: SHIPPING_AMOUNT } });
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.subtotal, 25300);
  assert.equal(data.bulkDiscount, 2000);
  assert.equal(data.bulkPricing, false);
});

test('every additional identical print uses the requested size-bracket price', () => {
  for (const [size, additional] of [[20, 1000], [61, 2000], [101, 4000], [151, 8000], [201, 15000]]) {
    assert.equal(getPrice(size).additionalCopyAmount, additional);
    assert.equal(getItemSubtotal(size, 3), getPrice(size).amount + 2 * additional);
  }
  assert.equal(getItemSubtotal(32, 1000), 1008800);
  for (const copies of [0, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) assert.equal(getItemSubtotal(32, copies), null);
});

test('all five 3+ line items plus shipping total 776,49 zł in Stripe', async () => {
  let calls = 0;
  const response = await handleCheckout(request(order), config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.method, 'POST');
    for (const [i, amount] of ['6500', '10500', '15000', '19500', '24500'].entries()) {
      assert.equal(options.body.get('line_items[' + i + '][price_data][unit_amount]'), amount);
      assert.equal(options.body.get('line_items[' + i + '][quantity]'), '1');
    }
    assert.equal(options.body.get('metadata[automatic_discount_percent]'), '0');
    assert.equal(options.body.get('metadata[regular_subtotal]'), '90300');
    assert.equal(options.body.get('metadata[pricing_version]'), PRICING_VERSION);
    assert.equal(options.body.get('metadata[shipping_amount]'), '1649');
    assert.equal(options.body.get('metadata[bulk_pricing_applied]'), 'true');
    assert.ok(![...options.body.keys()].some(key => key.startsWith('discounts[')));
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_Fixture123', currency: 'pln',
      amount_subtotal: 76000, amount_total: 77649, total_details: { amount_discount: 0, amount_shipping: SHIPPING_AMOUNT } });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const data = await response.json();
  assert.equal(data.total, 77649);
  assert.equal(data.shippingAmount, SHIPPING_AMOUNT);
  assert.equal(data.deliveryMethod, 'locker');
  assert.equal(data.regularSubtotal, 90300);
  assert.equal(data.saleSubtotal, 90300);
  assert.equal(data.automaticDiscount, 0);
  assert.equal(data.bulkDiscount, 14300);
  assert.equal(data.bulkPricing, true);
  assert.equal(data.discount, 0);
});

test('an old or missing pricing version blocks payment before contacting Stripe', async () => {
  for (const pricingVersion of [undefined, null, '', '2026-08-30', 1]) {
    let calls = 0;
    const response = await handleCheckout(request({ ...order, pricingVersion }), config, async () => { calls++; });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'pricing_changed');
    assert.equal(calls, 0);
  }
});
