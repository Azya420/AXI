import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleCheckout } from './checkout.mjs';
import { handleStripeWebhook } from './order-confirmation.mjs';
import { isTestKey, previewResponse } from './preview.mjs';
import { P24_PRODUCTION_API, P24_PRODUCTION_GATEWAY, handleP24TestAccess, handleP24Register, handleP24Notification, handleP24Status, p24ReturnLocation } from './p24-sandbox.mjs';
import { PRICING_VERSION } from '../pricing.mjs';

const siteOrigin = process.env.AXI_SITE_ORIGIN || 'https://axi3d.pl';
const parsedOrigin = new URL(siteOrigin);
if (parsedOrigin.origin !== siteOrigin || parsedOrigin.protocol !== 'https:') throw new Error('AXI_SITE_ORIGIN must be an HTTPS origin without a trailing slash.');
const config = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  reportStripeError: diagnostic => console.error('[axi-checkout]', JSON.stringify(diagnostic)),
  reportP24Error: diagnostic => console.error('[axi-p24]', JSON.stringify(diagnostic)),
  siteOrigin,
  allowedOrigins: (process.env.AXI_ALLOWED_ORIGINS || 'https://axi3d.pl,https://www.axi3d.pl').split(',').map(value => value.trim()),
  p24: {
    merchantId: Number(process.env.P24_MERCHANT_ID || process.env.P24_SANDBOX_MERCHANT_ID),
    posId: Number(process.env.P24_POS_ID || process.env.P24_SANDBOX_POS_ID || process.env.P24_MERCHANT_ID || process.env.P24_SANDBOX_MERCHANT_ID),
    apiKey: process.env.P24_API_KEY || process.env.P24_SECRET_ID || process.env.P24_SANDBOX_API_KEY,
    crc: process.env.P24_CRC || process.env.P24_CRC_KEY || process.env.P24_SANDBOX_CRC
  },
  p24Live: {
    merchantId: Number(process.env.P24_LIVE_MERCHANT_ID),
    posId: Number(process.env.P24_LIVE_POS_ID || process.env.P24_LIVE_MERCHANT_ID),
    apiKey: process.env.P24_LIVE_API_KEY,
    crc: process.env.P24_LIVE_CRC
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM
  }
};

async function readRawRequest(req, limit = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
// Ustalony adres usługi, nigdy Host/Origin przesłany przez klienta.
const previewOrigin = process.env.RENDER_EXTERNAL_URL || 'https://axi-checkout.onrender.com';
if (new URL(previewOrigin).origin !== previewOrigin || !previewOrigin.startsWith('https://')) throw new Error('Invalid preview origin.');
config.backendOrigin = previewOrigin;
const p24LiveConfig = {
  ...config,
  p24: config.p24Live,
  p24ApiBase: P24_PRODUCTION_API,
  p24GatewayBase: P24_PRODUCTION_GATEWAY,
  p24Environment: 'production',
  p24FixedAmount: 150,
  p24CheckoutVersion: 'p24-live-test-v1',
  p24Description: 'TEST LIVE AXI3D',
  p24ReturnPath: '/p24-live-test/return',
  p24NotificationPath: '/p24-live-test/notification',
  p24ResultPath: '/p24-live-test-result.html'
};
const p24ProductionConfig = {
  ...config,
  p24: config.p24Live,
  p24ApiBase: P24_PRODUCTION_API,
  p24GatewayBase: P24_PRODUCTION_GATEWAY,
  p24Environment: 'production',
  p24FixedAmount: null,
  p24EnablePromotions: true,
  p24IncludeOrderData: true,
  p24SessionPrefix: 'axip24',
  p24CheckoutVersion: 'p24-production-v1',
  p24Description: 'Zamowienie AXI3D',
  p24ReturnPath: '/p24/return',
  p24NotificationPath: '/p24/notification',
  p24ResultPath: '/dziekujemy.html'
};
// Ograniczenie globalne na proces; nie ufamy nagłówkom IP od klienta.
// Przy skalowaniu do wielu procesów dodaj limit również w hostingu/proxy.
let windowStarted = Date.now();
let requestsInWindow = 0;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://axi-api.invalid').pathname;
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const confirmationConfigured = Boolean(config.stripeKey && config.webhookSecret && config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from && config.smtp.secure);
    const p24SandboxConfigured = Number.isSafeInteger(config.p24.merchantId) && config.p24.merchantId > 0 && Number.isSafeInteger(config.p24.posId) && config.p24.posId > 0 && Boolean(config.p24.apiKey && config.p24.crc);
    const p24LiveConfigured = Number.isSafeInteger(config.p24Live.merchantId) && config.p24Live.merchantId > 0 && Number.isSafeInteger(config.p24Live.posId) && config.p24Live.posId > 0 && Boolean(config.p24Live.apiKey && config.p24Live.crc);
    res.end(JSON.stringify({ ok: true, paymentProvider: 'przelewy24', checkoutConfigured: p24LiveConfigured, confirmationConfigured, p24SandboxConfigured, p24LiveConfigured, pricingVersion: PRICING_VERSION, revision: process.env.RENDER_GIT_COMMIT || null }));
    return;
  }
  if (pathname === '/p24-test/return' && req.method === 'GET') {
    res.writeHead(302, { Location: p24ReturnLocation(new Request('https://axi-api.invalid' + req.url), config), 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === '/p24-live-test/return' && req.method === 'GET') {
    res.writeHead(302, { Location: p24ReturnLocation(new Request('https://axi-api.invalid' + req.url), p24LiveConfig), 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === '/p24/return' && req.method === 'GET') {
    res.writeHead(302, { Location: p24ReturnLocation(new Request('https://axi-api.invalid' + req.url), p24ProductionConfig), 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === '/p24-test/access' || pathname === '/p24-test/register' || pathname === '/p24-test/notification' || pathname === '/p24-test/status') {
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); requestsInWindow = 0; }
    if (pathname === '/p24-test/register' && req.method === 'POST' && ++requestsInWindow > 120) {
      res.writeHead(429, { 'Retry-After': '60', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    try {
      const options = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { options.body = Readable.toWeb(req); options.duplex = 'half'; }
      const request = new Request('https://axi-api.invalid' + req.url, options);
      const response = pathname === '/p24-test/access'
        ? await handleP24TestAccess(request, config)
        : pathname === '/p24-test/register'
          ? await handleP24Register(request, config)
          : pathname === '/p24-test/notification'
            ? await handleP24Notification(request, config)
            : await handleP24Status(request, config);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Testowa usługa Przelewy24 jest chwilowo niedostępna.' }));
    }
    return;
  }
  if (pathname === '/p24-live-test/access' || pathname === '/p24-live-test/register' || pathname === '/p24-live-test/notification' || pathname === '/p24-live-test/status') {
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); requestsInWindow = 0; }
    if (pathname === '/p24-live-test/register' && req.method === 'POST' && ++requestsInWindow > 30) {
      res.writeHead(429, { 'Retry-After': '60', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    try {
      const options = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { options.body = Readable.toWeb(req); options.duplex = 'half'; }
      const request = new Request('https://axi-api.invalid' + req.url, options);
      const response = pathname === '/p24-live-test/access'
        ? await handleP24TestAccess(request, p24LiveConfig)
        : pathname === '/p24-live-test/register'
          ? await handleP24Register(request, p24LiveConfig)
          : pathname === '/p24-live-test/notification'
            ? await handleP24Notification(request, p24LiveConfig)
            : await handleP24Status(request, p24LiveConfig);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Produkcyjny test Przelewy24 jest chwilowo niedostępny.' }));
    }
    return;
  }
  if (pathname === '/p24/access' || pathname === '/p24/register' || pathname === '/p24/notification' || pathname === '/p24/status') {
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); requestsInWindow = 0; }
    if (pathname === '/p24/register' && req.method === 'POST' && ++requestsInWindow > 120) {
      res.writeHead(429, { 'Retry-After': '60', 'Cache-Control': 'no-store' }); res.end(); return;
    }
    try {
      const options = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { options.body = Readable.toWeb(req); options.duplex = 'half'; }
      const request = new Request('https://axi-api.invalid' + req.url, options);
      const response = pathname === '/p24/access'
        ? await handleP24TestAccess(request, p24ProductionConfig)
        : pathname === '/p24/register'
          ? await handleP24Register(request, p24ProductionConfig)
          : pathname === '/p24/notification'
            ? await handleP24Notification(request, p24ProductionConfig)
            : await handleP24Status(request, p24ProductionConfig);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Usługa Przelewy24 jest chwilowo niedostępna.' }));
    }
    return;
  }
  if (pathname === '/stripe-webhook') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    try {
      const result = await handleStripeWebhook(await readRawRequest(req), req.headers['stripe-signature'], config);
      res.writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(result.body);
    } catch {
      console.error('[axi-confirmation]', JSON.stringify({ event: 'confirmation_failed' }));
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Confirmation failed');
    }
    return;
  }
  const previewCheckout = pathname === '/preview/checkout-session';
  if (pathname === '/preview' || pathname.startsWith('/preview/')) {
    if (!previewCheckout) {
      try {
        const response = await previewResponse(pathname, req.method, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Nie udało się wczytać podglądu.');
      }
      return;
    }
    if (!isTestKey(config.stripeKey)) { res.writeHead(404); res.end(); return; }
  }
  if (pathname !== '/checkout-session' && !previewCheckout) { res.writeHead(404); res.end(); return; }
  if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); requestsInWindow = 0; }
  if (req.method === 'POST' && ++requestsInWindow > 120) {
    res.writeHead(429, { 'Retry-After': '60' }); res.end(); return;
  }
  try {
    const options = { method: req.method, headers: req.headers };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      options.body = Readable.toWeb(req);
      options.duplex = 'half';
    }
    const checkoutConfig = previewCheckout ? { ...config, preview: true, siteOrigin: previewOrigin, allowedOrigins: [previewOrigin] } : config;
    const response = await handleCheckout(new Request('https://axi-api.invalid/checkout-session', options), checkoutConfig);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Usługa płatności jest chwilowo niedostępna.' }));
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
