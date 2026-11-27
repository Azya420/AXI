import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupabasePublicConfig, isTestKey, previewResponse, renderPreviewHtml } from '../api/preview.mjs';
import { handleCheckout, stripeParameters } from '../api/checkout.mjs';

import { PRICING_VERSION } from '../pricing.mjs';

const config = {
  stripeKey: 'rk_test_fixture',
  siteOrigin: 'https://axi3d.pl',
  supabaseUrl: 'https://exampleproject.supabase.co',
  supabasePublishableKey: `sb_publishable_${'a'.repeat(30)}`
};
test('preview assets require a test key and never expose arbitrary repository files', async () => {
  assert.ok(isTestKey('sk_test_fixture'));
  for (const stripeKey of [undefined, '', 'pk_test_fixture', 'rk_live_fixture', 'sk_live_fixture']) {
    assert.ok(!isTestKey(stripeKey));
    for (const path of ['/preview/', '/preview/konto.html', '/preview/account-icon.svg', '/preview/order-form.mjs', '/preview/checkout-config.js', '/preview/supabase-config.js']) {
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
  assert.match(html, /Im więcej figurek, tym taniej/);
  assert.match(html, /id="promo-pair-price"/);
  assert.match(html, /id="promo-bulk-price"/);
  assert.match(html, /class="journey-price-sticker"/);
  assert.match(html, /\.journey-source \.journey-media img\{\s*object-fit:contain;/);
  assert.match(html, /id="journey-min-price">78 zł/);
  assert.match(html, /w zestawie/);
  assert.doesNotMatch(html, /id="promo-countdown"/);
  assert.match(html, /Rabat ilościowy/);
  assert.match(html, /78 zł\/szt\./);
  assert.ok(html.indexOf('id="promo-spotlight"') < html.indexOf('<form id="commission-form"'));
  assert.ok(!html.includes('id="shipping-cost-label"'));
  assert.ok(!html.includes('preview-send-basin'));
  assert.match(html, /src="https:\/\/axi3d.pl\/logo%20white.png"/);
  assert.match(html, /href="#zamow"/);
  assert.match(html, /class="axi-account-link" href="\/preview\/konto\.html" aria-label="Moje konto"/);
  assert.match(html, /src="\/preview\/account-icon\.svg" alt=""/);
  assert.ok(!html.includes('data-field="sale-badge"'));
  assert.match(html, /Paczkomat InPost \(16,49 zł\)/);
  assert.match(html, /Na adres \(19,49 zł\)/);
  assert.match(html, /src="order-form\.mjs\?v=[A-Za-z0-9-]+"/);
  assert.ok(!html.includes('var GA_ID'));
  assert.ok(!html.includes('googletagmanager.com'));
  assert.ok(!html.includes('tracking.js'));
  assert.ok(!html.includes('connect.facebook.net'));
  assert.ok(!html.includes('1665983241581980'));
  assert.ok(!html.includes(config.stripeKey));
  assert.match(await (await previewResponse('/preview/checkout-config.js', 'GET', config)).text(), /AXI_PREVIEW_MODE = true/);
  const iconResponse = await previewResponse('/preview/account-icon.svg', 'GET', config);
  assert.equal(iconResponse.headers.get('Content-Type'), 'image/svg+xml; charset=utf-8');
  assert.match(await iconResponse.text(), /<title>Moje konto<\/title>/);
  assert.equal(await (await previewResponse('/preview/order-form.mjs', 'HEAD', config)).text(), '');
  assert.equal((await previewResponse('/preview', 'GET', config)).headers.get('Location'), '/preview/');
});
test('preview exposes only a validated public Supabase configuration', async () => {
  assert.ok(isSupabasePublicConfig(config));
  for (const invalid of [
    {},
    { ...config, supabaseUrl: 'http://exampleproject.supabase.co' },
    { ...config, supabaseUrl: 'https://exampleproject.supabase.co/path' },
    { ...config, supabaseUrl: 'https://exampleproject.supabase.co.evil.example' },
    { ...config, supabasePublishableKey: 'service_role_secret' }
  ]) assert.equal(isSupabasePublicConfig(invalid), false);

  const response = await previewResponse('/preview/supabase-config.js', 'GET', config);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const source = await response.text();
  assert.match(source, /window\.AXI_SUPABASE/);
  assert.match(source, /exampleproject\.supabase\.co/);
  assert.match(source, /sb_publishable_/);
  assert.ok(!source.includes(config.stripeKey));
  assert.doesNotMatch(source, /service_role|secret/i);

  const disabled = await (await previewResponse('/preview/supabase-config.js', 'GET', {
    ...config,
    supabasePublishableKey: 'not-public'
  })).text();
  assert.equal(disabled, 'window.AXI_SUPABASE = null;\n');
});
test('account page supports registration, login, password reset and logout without exposing secrets', async () => {
  const response = await previewResponse('/preview/konto.html', 'GET', config);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.match(html, /PODGLĄD TESTOWY/);
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /id="forgot-form"/);
  assert.match(html, /id="reset-form"/);
  assert.match(html, /id="logout-button"/);
  assert.match(html, /src="\/preview\/supabase-config\.js"/);
  assert.match(html, /src="\/preview\/account\.mjs"/);
  assert.ok(!html.includes(config.stripeKey));
  assert.ok(!html.includes(config.supabasePublishableKey));
  const script = await (await previewResponse('/preview/account.mjs', 'GET', config)).text();
  assert.match(script, /signInWithPassword/);
  assert.match(script, /resetPasswordForEmail/);
  assert.match(script, /updateUser/);
  assert.match(script, /signOut/);
});
test('preview does not rewrite remote references or empty image placeholders', () => {
  const html = renderPreviewHtml('<html><head></head><body><img src=""><img src="https://cdn.example/photo.png"><a href="regulamin.html">Regulamin</a></body></html>', config.siteOrigin);
  assert.match(html, /src=""/);
  assert.match(html, /src="https:\/\/cdn.example\/photo.png"/);
  assert.match(html, /href="https:\/\/axi3d.pl\/regulamin.html"/);
});
test('preview checkout returns to preview and rejects any non-test Stripe session', async () => {
  const order = { pricingVersion: PRICING_VERSION, termsAccepted: true, orderId: '3b6ad9b4-1c7d-42e2-b05d-3475a78c4d1e', email: 'test@example.com', customerName: 'Jan Kowalski', deliveryDestination: 'GLI01 — Rynek 1, Gliwice', deliveryMethod: 'locker', items: [{ size: 32 }] };
  const origin = 'https://axi-checkout.onrender.com';
  const params = stripeParameters(order, origin, true);
  assert.equal(params.get('success_url'), origin + '/preview/success');
  assert.equal(params.get('cancel_url'), origin + '/preview/#zamow');
  assert.equal(params.get('metadata[preview]'), 'true');
  const request = () => new Request(origin + '/preview/checkout-session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
  const previewConfig = { ...config, preview: true, siteOrigin: origin, allowedOrigins: [origin] };
  for (const livemode of [true, undefined, false]) {
    const response = await handleCheckout(request(), previewConfig, async () => Response.json({ livemode, url: 'https://checkout.stripe.com/c/pay/cs_test_preview', amount_subtotal: 11800, amount_total: 13449, currency: 'pln', total_details: { amount_discount: 0, amount_shipping: 1649 } }));
    assert.equal(response.status, livemode === false ? 200 : 502);
  }
});

