import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrice, PRICING_VERSION } from '../pricing.mjs';
import { handleCheckout } from '../api/checkout.mjs';

const config = { stripeKey: 'not-a-real-key', siteOrigin: 'https://axi3d.pl', allowedOrigins: ['https://axi3d.pl'] };
const order = { pricingVersion: PRICING_VERSION, termsAccepted: true,
  orderId: '081d9e64-638e-4a29-882e-39f5212cf96b', email: 'test@example.com',
  items: [20, 61, 101, 151, 201].map(size => ({ size, amount: 1, quantity: 100, discount: 99 })) };
const request = body => new Request('https://api.example/checkout-session', {
  method: 'POST', headers: { Origin: config.siteOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('all 231 integer sizes use the requested base prices with exactly 30 percent deducted', () => {
  for (const [min, max, regularAmount, amount] of [
    [20, 60, 10000, 7000], [61, 100, 12000, 8400], [101, 150, 15000, 10500],
    [151, 200, 20000, 14000], [201, 250, 25000, 17500]
  ]) {
    for (let size = min; size <= max; size++) {
      assert.equal(getPrice(size).amount, amount, 'payable amount at ' + size + ' mm');
      assert.equal(getPrice(size).regularAmount, regularAmount);
    }
  }
  for (const size of [19, 251, 60.5, NaN, Infinity, '61', null]) assert.equal(getPrice(size), null);
});

test('all five discounted line items total 574 zł in Stripe without any coupon or client price override', async () => {
  let calls = 0;
  const response = await handleCheckout(request(order), config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.method, 'POST');
    for (const [i, amount] of ['7000', '8400', '10500', '14000', '17500'].entries()) {
      assert.equal(options.body.get('line_items[' + i + '][price_data][unit_amount]'), amount);
      assert.equal(options.body.get('line_items[' + i + '][quantity]'), '1');
    }
    assert.equal(options.body.get('metadata[automatic_discount_percent]'), '30');
    assert.equal(options.body.get('metadata[regular_subtotal]'), '82000');
    assert.equal(options.body.get('metadata[pricing_version]'), PRICING_VERSION);
    assert.ok(![...options.body.keys()].some(key => key.startsWith('discounts[')));
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_Fixture123', currency: 'pln',
      amount_subtotal: 57400, amount_total: 57400, total_details: { amount_discount: 0 } });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const data = await response.json();
  assert.equal(data.total, 57400);
  assert.equal(data.regularSubtotal, 82000);
  assert.equal(data.automaticDiscount, 24600);
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
