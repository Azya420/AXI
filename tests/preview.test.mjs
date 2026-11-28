import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isP24PreviewConfig, isSupabasePublicConfig, previewResponse, renderPreviewHtml } from '../api/preview.mjs';
import { P24_SANDBOX_GATEWAY, handleP24Register } from '../api/p24-sandbox.mjs';

import { PRICING_VERSION } from '../pricing.mjs';

const config = {
  stripeKey: 'rk_test_fixture',
  siteOrigin: 'https://axi3d.pl',
  supabaseUrl: 'https://exampleproject.supabase.co',
  supabasePublishableKey: `sb_publishable_${'a'.repeat(30)}`,
  p24: { merchantId: 12345, posId: 12345, apiKey: 'sandbox-api', crc: 'sandbox-crc' }
};
test('preview assets require Przelewy24 sandbox configuration and never expose arbitrary repository files', async () => {
  assert.ok(isP24PreviewConfig(config));
  for (const p24 of [undefined, {}, { ...config.p24, merchantId: 0 }, { ...config.p24, apiKey: '' }, { ...config.p24, crc: '' }]) {
    assert.ok(!isP24PreviewConfig({ ...config, p24 }));
    for (const path of ['/preview/', '/preview/konto.html', '/preview/admin.html', '/preview/success', '/preview/account-icon.svg', '/preview/order-form.mjs', '/preview/admin.mjs', '/preview/preview-success.mjs', '/preview/saved-customer.mjs', '/preview/checkout-config.js', '/preview/supabase-config.js']) {
      assert.equal((await previewResponse(path, 'GET', { ...config, p24 })).status, 404);
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
  assert.doesNotMatch(html, /PODGLĄD TESTOWY/);
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
  assert.match(html, /src="\/preview\/supabase-config\.js"/);
  assert.match(html, /src="\/preview\/saved-customer\.mjs"/);
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
  const checkoutConfig = await (await previewResponse('/preview/checkout-config.js', 'GET', config)).text();
  assert.match(checkoutConfig, /AXI_PREVIEW_MODE = true/);
  assert.match(checkoutConfig, /\/preview\/p24\/register/);
  assert.doesNotMatch(checkoutConfig, /stripe/i);
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
test('account page supports login, password reset and logout while registration stays after checkout', async () => {
  const response = await previewResponse('/preview/konto.html', 'GET', config);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.doesNotMatch(html, /PODGLĄD TESTOWY/);
  assert.match(html, /id="login-form"/);
  assert.doesNotMatch(html, /id="register-form"/);
  assert.match(html, /id="forgot-form"/);
  assert.match(html, /id="reset-form"/);
  assert.match(html, /id="logout-button"/);
  assert.match(html, /id="admin-link" href="\/preview\/admin\.html" role="menuitem" hidden/);
  assert.match(html, /id="profile-menu" hidden/);
  assert.match(html, /id="profile-menu-button"[^>]+aria-label="Menu konta"/);
  assert.match(html, /src="\/preview\/account-icon\.svg" alt=""/);
  assert.match(html, /id="profile-dropdown" role="menu" hidden/);
  assert.match(html, /id="orders-state"/);
  assert.match(html, /id="orders-list"/);
  assert.doesNotMatch(html, /Zaloguj się lub utwórz konto, aby w przyszłości sprawdzać swoje zamówienia/);
  assert.doesNotMatch(html, /Zalogowano|Twoje konto testowe|account-email/);
  assert.ok(html.indexOf('id="logout-button"') < html.indexOf('<main>'));
  assert.match(html, /src="\/preview\/supabase-config\.js"/);
  assert.match(html, /src="\/preview\/account\.mjs"/);
  assert.ok(!html.includes(config.stripeKey));
  assert.ok(!html.includes(config.supabasePublishableKey));
  const script = await (await previewResponse('/preview/account.mjs', 'GET', config)).text();
  assert.match(script, /signInWithPassword/);
  assert.doesNotMatch(script, /signUp/);
  assert.match(script, /resetPasswordForEmail/);
  assert.match(script, /updateUser/);
  assert.match(script, /signOut/);
  assert.match(script, /setProfileMenu/);
  assert.match(script, /from\('orders'\)/);
  assert.match(script, /from\('order_status_history'\)/);
});
test('paid preview return offers post-order registration, login and optional saved details', async () => {
  const response = await previewResponse('/preview/success', 'GET', config);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Dziękujemy za zamówienie/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /id="login-form"/);
  assert.match(html, /Zapamiętaj moje dane kontaktowe i dostawy/);
  assert.match(html, /src="\/preview\/preview-success\.mjs"/);
  const script = await (await previewResponse('/preview/preview-success.mjs', 'GET', config)).text();
  assert.match(script, /signUp/);
  assert.match(script, /signInWithPassword/);
  assert.match(script, /action: 'claim'/);
  assert.match(script, /rememberData/);
});
test('hidden admin panel manages assignments and statuses without embedding secrets', async () => {
  const response = await previewResponse('/preview/admin.html', 'GET', config);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.doesNotMatch(html, /PANEL ADMINISTRACYJNY — ŚRODOWISKO TESTOWE/);
  assert.match(html, /<h1>Panel administracyjny<\/h1>/);
  assert.match(html, /id="order-form"/);
  assert.match(html, /id="account-select"/);
  assert.match(html, /id="status-select"/);
  assert.match(html, /id="orders-list"/);
  assert.match(html, /src="\/preview\/admin\.mjs"/);
  assert.ok(!html.includes(config.stripeKey));
  assert.ok(!html.includes(config.supabasePublishableKey));
  const script = await (await previewResponse('/preview/admin.mjs', 'GET', config)).text();
  assert.match(script, /profile\.role !== 'admin'/);
  assert.match(script, /from\('profiles'\)/);
  assert.match(script, /from\('orders'\)\.update/);
  assert.doesNotMatch(script, /service_role|SUPABASE_SECRET/i);
});
test('order portal migration enables RLS and restricts writes to administrators', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261127183000_create_test_order_portal.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.profiles enable row level security/);
  assert.match(sql, /alter table public\.orders enable row level security/);
  assert.match(sql, /alter table public\.order_status_history enable row level security/);
  assert.match(sql, /with check \(public\.is_axi_admin\(\)\)/);
  assert.match(sql, /user_id = auth\.uid\(\)/);
  assert.match(sql, /revoke all on table public\.orders from anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.orders to authenticated/);
  assert.doesNotMatch(sql, /grant\s+(?:all|insert|update)[^;]+\s+to\s+anon/i);
});
test('post-order migration stores payment references and optional reusable customer details', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261127213000_add_post_order_accounts.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists customer_name/);
  assert.match(sql, /add column if not exists saved_data_at/);
  assert.match(sql, /add column if not exists payment_reference/);
  assert.match(sql, /unique index if not exists orders_payment_reference_unique_idx/);
  assert.doesNotMatch(sql, /grant\s+(?:all|insert|update)[^;]+\s+to\s+anon/i);
});
test('Przelewy24 preview migration stores the phone needed for optional profile reuse', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261128100000_add_p24_preview_orders.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists customer_phone/);
});
test('preview does not rewrite remote references or empty image placeholders', () => {
  const html = renderPreviewHtml('<html><head></head><body><img src=""><img src="https://cdn.example/photo.png"><a href="regulamin.html">Regulamin</a></body></html>', config.siteOrigin);
  assert.match(html, /src=""/);
  assert.match(html, /src="https:\/\/cdn.example\/photo.png"/);
  assert.match(html, /href="https:\/\/axi3d.pl\/regulamin.html"/);
});
test('preview checkout uses only Przelewy24 sandbox and returns to the account success page', async () => {
  const order = { pricingVersion: PRICING_VERSION, termsAccepted: true, orderId: '3b6ad9b4-1c7d-42e2-b05d-3475a78c4d1e', email: 'test@example.com', customerName: 'Jan Kowalski', phone: '+48600123456', deliveryDestination: 'GLI01 — Rynek 1, Gliwice', deliveryMethod: 'locker', items: [{ size: 32 }] };
  const origin = 'https://axi-checkout.onrender.com';
  let sent;
  let prepared;
  const previewConfig = {
    ...config, siteOrigin: origin, backendOrigin: origin, allowedOrigins: [origin],
    p24Environment: 'sandbox', p24CheckoutVersion: 'p24-preview-v1',
    p24ReturnPath: '/preview/p24/return', p24NotificationPath: '/preview/p24/notification',
    onP24Prepared: value => { prepared = value; }
  };
  const response = await handleP24Register(new Request(origin + '/preview/p24/register', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(order)
  }), previewConfig, async (url, options) => {
    assert.equal(new URL(url).hostname, 'sandbox.przelewy24.pl');
    sent = JSON.parse(options.body);
    return Response.json({ data: { token: 'preview-12345678-abcd-4321-abcd-123456789012' } });
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, P24_SANDBOX_GATEWAY + 'preview-12345678-abcd-4321-abcd-123456789012');
  assert.equal(result.checkoutVersion, 'p24-preview-v1');
  assert.equal(prepared.sessionId, sent.sessionId);
  assert.equal(prepared.order.phone, '+48600123456');
  assert.equal(sent.urlReturn, origin + '/preview/p24/return?sessionId=' + encodeURIComponent(sent.sessionId));
  assert.equal(sent.urlStatus, origin + '/preview/p24/notification');
  const formScript = await (await previewResponse('/preview/order-form.mjs', 'GET', config)).text();
  assert.match(formScript, /sandbox\.przelewy24\.pl/);
  assert.doesNotMatch(formScript, /checkout\.stripe\.com/);
});

