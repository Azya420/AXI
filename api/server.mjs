import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleCheckout } from './checkout.mjs';
import { handleStripeWebhook } from './order-confirmation.mjs';
import { isTestKey, previewResponse } from './preview.mjs';
import { PRICING_VERSION } from '../pricing.mjs';

const siteOrigin = process.env.AXI_SITE_ORIGIN || 'https://axi3d.pl';
const parsedOrigin = new URL(siteOrigin);
if (parsedOrigin.origin !== siteOrigin || parsedOrigin.protocol !== 'https:') throw new Error('AXI_SITE_ORIGIN must be an HTTPS origin without a trailing slash.');
const config = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  reportStripeError: diagnostic => console.error('[axi-checkout]', JSON.stringify(diagnostic)),
  siteOrigin,
  allowedOrigins: (process.env.AXI_ALLOWED_ORIGINS || 'https://axi3d.pl,https://www.axi3d.pl').split(',').map(value => value.trim()),
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
// Ograniczenie globalne na proces; nie ufamy nagłówkom IP od klienta.
// Przy skalowaniu do wielu procesów dodaj limit również w hostingu/proxy.
let windowStarted = Date.now();
let requestsInWindow = 0;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://axi-api.invalid').pathname;
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const confirmationConfigured = Boolean(config.stripeKey && config.webhookSecret && config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from && config.smtp.secure);
    res.end(JSON.stringify({ ok: true, checkoutConfigured: Boolean(config.stripeKey), confirmationConfigured, pricingVersion: PRICING_VERSION, revision: process.env.RENDER_GIT_COMMIT || null }));
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
