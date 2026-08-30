import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleCheckout } from './checkout.mjs';

const siteOrigin = process.env.AXI_SITE_ORIGIN || 'https://axi3d.pl';
const parsedOrigin = new URL(siteOrigin);
if (parsedOrigin.origin !== siteOrigin || parsedOrigin.protocol !== 'https:') throw new Error('AXI_SITE_ORIGIN must be an HTTPS origin without a trailing slash.');
const config = {
  stripeKey: process.env.STRIPE_SECRET_KEY,
  reportStripeError: diagnostic => console.error('[axi-checkout]', JSON.stringify(diagnostic)),
  siteOrigin,
  allowedOrigins: (process.env.AXI_ALLOWED_ORIGINS || 'https://axi3d.pl,https://www.axi3d.pl').split(',').map(value => value.trim())
};
// Ograniczenie globalne na proces; nie ufamy nagłówkom IP od klienta.
// Przy skalowaniu do wielu procesów dodaj limit również w hostingu/proxy.
let windowStarted = Date.now();
let requestsInWindow = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, checkoutConfigured: Boolean(config.stripeKey), revision: process.env.RENDER_GIT_COMMIT || null }));
    return;
  }
  if (req.url !== '/checkout-session') { res.writeHead(404); res.end(); return; }
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
    const response = await handleCheckout(new Request('https://axi-api.invalid/checkout-session', options), config);
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
