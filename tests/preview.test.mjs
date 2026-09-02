import test from 'node:test';
import assert from 'node:assert/strict';
import { isTestKey, previewResponse, renderPreviewHtml } from '../api/preview.mjs';
import { handleCheckout, stripeParameters } from '../api/checkout.mjs';

import { PRICING_VERSION } from '../pricing.mjs';

const config = { stripeKey: 'rk_test_fixture', siteOrigin: 'https://axi3d.pl' };
test('preview assets require a test key and never expose arbitrary repository files', async () => {
  assert.ok(isTestKey('sk_test_fixture'));
  for (const stripeKey of [undefined, '', 'pk_test_fixture', 'rk_live_fixture', 'sk_live_fixture']) {
    assert.ok(!isTestKey(stripeKey));
    for (const path of ['/preview/', '/preview/order-form.mjs', '/preview/checkout-config.js']) {
      assert.equal((await previewResponse(path, 'GET', { ...config, stripeKey })).status, 404);
    }
  }
  for (const path of ['/preview/.env', '/preview/api/server.mjs', '/preview/../api/checkout.mjs', '/preview/constructor']) {
    assert.equal((await previewResponse(path, 'GET', config)).status, 404);
  }
  assert.equal((await previewResponse('/preview/', 'POST', config)).status, 405);
});
test('preview renders the actual form, preserves navigation, loads public images and excludes analytics', async () => {
  const response = await previewResponse('/preview/', 'GET', config);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const html = await response.text();
  assert.match(html, /PODGLĄD TESTOWY/);
  assert.match(html, /id="add-figurine-btn"/);
  assert.match(html, /class="photo-upload-button" for="photos">Dodaj zdjęcie<\/label>/);
  assert.match(html, /<body id="top">/);
  assert.match(html, /<a class="logo" href="#top" aria-label="AXI — przejdź na górę strony">/);
  assert.ok(!html.includes('id="figurine-sale"'));
  assert.ok(!html.includes('Na wszystkie figurki. Rabat naliczamy automatycznie.'));
  assert.match(html, /id="promo-spotlight"/);
  assert.match(html, /Własna figurka już od/);
  assert.match(html, /class="journey-price-sticker"/);
  assert.match(html, /\.journey-source \.journey-media img\{\s*object-fit:contain;/);
  assert.match(html, /id="journey-min-price">98 zł/);
  assert.match(html, /id="promo-countdown"/);
  assert.match(html, /Oferta specjalna/);
  assert.match(html, /Im więcej figurek, tym taniej/);
  assert.match(html, /65 zł za figurkę/);
  assert.ok(html.indexOf('id="promo-spotlight"') < html.indexOf('<form id="commission-form"'));
  assert.ok(!html.includes('id="shipping-cost-label"'));
  assert.ok(!html.includes('preview-send-basin'));
  assert.match(html, /src="https:\/\/axi3d.pl\/logo%20white.png"/);
  assert.match(html, /href="#zamow"/);
  assert.ok(!html.includes('data-field="sale-badge"'));
  assert.match(html, /Paczkomat InPost \(16,49 zł\)/);
  assert.match(html, /Na adres \(19,49 zł\)/);
  assert.match(html, /src="order-form.mjs\?v=20260902-lowest-price-v1"/);
  assert.ok(!html.includes('var GA_ID'));
  assert.ok(!html.includes('googletagmanager.com'));
  assert.ok(!html.includes('tracking.js'));
  assert.ok(!html.includes('connect.facebook.net'));
  assert.ok(!html.includes('1665983241581980'));
  assert.ok(!html.includes(config.stripeKey));
  assert.match(await (await previewResponse('/preview/checkout-config.js', 'GET', config)).text(), /AXI_PREVIEW_MODE = true/);
  assert.equal(await (await previewResponse('/preview/order-form.mjs', 'HEAD', config)).text(), '');
  assert.equal((await previewResponse('/preview', 'GET', config)).headers.get('Location'), '/preview/');
});
test('preview does not rewrite remote references or empty image placeholders', () => {
  const html = renderPreviewHtml('<html><head></head><body><img src=""><img src="https://cdn.example/photo.png"><a href="regulamin.html">Regulamin</a></body></html>', config.siteOrigin);
  assert.match(html, /src=""/);
  assert.match(html, /src="https:\/\/cdn.example\/photo.png"/);
  assert.match(html, /href="https:\/\/axi3d.pl\/regulamin.html"/);
});
test('preview checkout returns to preview and rejects any non-test Stripe session', async () => {
  const order = { pricingVersion: PRICING_VERSION, termsAccepted: true, orderId: '3b6ad9b4-1c7d-42e2-b05d-3475a78c4d1e', email: 'test@example.com', deliveryMethod: 'locker', items: [{ size: 32 }] };
  const origin = 'https://axi-checkout.onrender.com';
  const params = stripeParameters(order, origin, true);
  assert.equal(params.get('success_url'), origin + '/preview/success');
  assert.equal(params.get('cancel_url'), origin + '/preview/#zamow');
  assert.equal(params.get('metadata[preview]'), 'true');
  const request = () => new Request(origin + '/preview/checkout-session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
  const previewConfig = { ...config, preview: true, siteOrigin: origin, allowedOrigins: [origin] };
  for (const livemode of [true, undefined, false]) {
    const response = await handleCheckout(request(), previewConfig, async () => Response.json({ livemode, url: 'https://checkout.stripe.com/c/pay/cs_test_preview', amount_subtotal: 9800, amount_total: 11449, currency: 'pln', total_details: { amount_discount: 0, amount_shipping: 1649 } }));
    assert.equal(response.status, livemode === false ? 200 : 502);
  }
});
