import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrice, PRICING_VERSION, SHIPPING_AMOUNT } from '../pricing.mjs';
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
    [20, 60, 14000, 9800], [61, 100, 18000, 12600], [101, 150, 25000, 17500],
    [151, 200, 32000, 22400], [201, 250, 40000, 28000]
  ]) {
    for (let size = min; size <= max; size++) {
      assert.equal(getPrice(size).amount, amount, 'payable amount at ' + size + ' mm');
      assert.equal(getPrice(size).regularAmount, regularAmount);
    }
  }
  for (const size of [19, 251, 60.5, NaN, Infinity, '61', null]) assert.equal(getPrice(size), null);
});

test('all five discounted line items plus shipping total 919,49 zł in Stripe', async () => {
  let calls = 0;
  const response = await handleCheckout(request(order), config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.method, 'POST');
    for (const [i, amount] of ['9800', '12600', '17500', '22400', '28000'].entries()) {
      assert.equal(options.body.get('line_items[' + i + '][price_data][unit_amount]'), amount);
      assert.equal(options.body.get('line_items[' + i + '][quantity]'), '1');
    }
    assert.equal(options.body.get('metadata[automatic_discount_percent]'), '30');
    assert.equal(options.body.get('metadata[regular_subtotal]'), '129000');
    assert.equal(options.body.get('metadata[pricing_version]'), PRICING_VERSION);
    assert.equal(options.body.get('metadata[shipping_amount]'), '1649');
    assert.ok(![...options.body.keys()].some(key => key.startsWith('discounts[')));
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_live_Fixture123', currency: 'pln',
      amount_subtotal: 90300, amount_total: 91949, total_details: { amount_discount: 0, amount_shipping: SHIPPING_AMOUNT } });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const data = await response.json();
  assert.equal(data.total, 91949);
  assert.equal(data.shippingAmount, SHIPPING_AMOUNT);
  assert.equal(data.regularSubtotal, 129000);
  assert.equal(data.automaticDiscount, 38700);
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
