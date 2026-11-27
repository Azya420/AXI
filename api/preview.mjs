import { readFile } from 'node:fs/promises';

export const isTestKey = key => typeof key === 'string' && /^(?:rk|sk)_test_/.test(key);

export function isSupabasePublicConfig(config) {
  if (!config || typeof config.supabaseUrl !== 'string' || typeof config.supabasePublishableKey !== 'string') return false;
  let url;
  try { url = new URL(config.supabaseUrl); } catch { return false; }
  return url.protocol === 'https:' && url.pathname === '/' && url.search === '' && url.hash === '' &&
    url.hostname.endsWith('.supabase.co') && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.supabasePublishableKey);
}

export function renderPreviewHtml(source, siteOrigin) {
  const notice = `<aside class="axi-preview-notice" aria-label="Podgląd testowy">
    <strong>PODGLĄD TESTOWY — płatności bez prawdziwych pieniędzy</strong>
    <p>Dodawaj figurki i sprawdzaj sumę. W tym podglądzie zgłoszenie i zdjęcia nie są wysyłane do Basin.
    Używaj fikcyjnych danych i przykładowych zdjęć.</p>
    <a href="#zamow">Przejdź do nowego formularza ↓</a>
  </aside>`;
  let html = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, script => script.includes('var GA_ID') ? '' : script)
    .replace(/<script\b[^>]*\bdata-analytics\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\b(src|href|data-full|data-ref)="([^"]+)"/g, (full, attribute, value) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return full;
      if (/\.(?:png|jpe?g|webp|svg|gif|ico)(?:[?#]|$)/i.test(value) || value === 'regulamin.html') {
        return attribute + '="' + new URL(value, siteOrigin + '/').href + '"';
      }
      return full;
    })
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>TEST — nowy formularz AXI3D</title>')
    .replace('<a class="nav-cta" href="#zamow">Zamów figurkę</a>', `<div class="axi-nav-actions">
      <a class="nav-cta" href="#zamow">Zamów figurkę</a>
      <a class="axi-account-link" href="/preview/konto.html" aria-label="Moje konto" title="Moje konto">
        <img src="/preview/account-icon.svg" alt="">
      </a>
    </div>`)
    .replace('</head>', `<meta name="robots" content="noindex,nofollow">
<style>
.axi-preview-notice{position:relative;margin-top:90px;padding:20px 6%;background:#fff1bc;color:#211b0d;font:15px/1.5 sans-serif}
.axi-preview-notice p{margin:8px 0}.axi-preview-notice a{color:#211b0d;text-decoration:underline}
.axi-nav-actions{display:flex;align-items:center;gap:10px}
.axi-account-link{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;text-decoration:none;transition:background .2s,filter .2s,transform .2s}
.axi-account-link img{display:block;width:42px;height:42px}
.axi-account-link:hover,.axi-account-link:focus-visible{background:rgba(109,40,217,.2);filter:drop-shadow(0 0 7px rgba(167,139,250,.42));transform:translateY(-1px);outline:none}
@media(max-width:680px){.axi-nav-actions{gap:7px}.axi-account-link{width:40px;height:40px}.axi-account-link img{width:38px;height:38px}}
#cookie-banner{display:none!important}
</style></head>`)
    .replace(/(<body\b[^>]*>)/i, '$1' + notice);
  return html;
}

const headers = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "frame-ancestors 'none'"
};

// Ścisła lista plików: podgląd nigdy nie udostępnia katalogu api, .env ani repozytorium.
const modules = {
  '/preview/order-form.mjs': new URL('../order-form.mjs', import.meta.url),
  '/preview/pricing.mjs': new URL('../pricing.mjs', import.meta.url),
  '/preview/account.mjs': new URL('../account.mjs', import.meta.url)
};

export async function previewResponse(pathname, method, config) {
  if (!isTestKey(config.stripeKey)) return new Response('Podgląd testowy jest wyłączony.', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers });
  const send = (body, type) => new Response(method === 'HEAD' ? null : body, { headers: { ...headers, 'Content-Type': type + '; charset=utf-8' } });
  if (pathname === '/preview') return new Response(null, { status: 307, headers: { ...headers, Location: '/preview/' } });
  if (pathname === '/preview/' || pathname === '/preview/index.html') {
    return send(renderPreviewHtml(await readFile(new URL('../index.html', import.meta.url), 'utf8'), config.siteOrigin), 'text/html');
  }
  if (pathname === '/preview/konto.html') {
    return send(await readFile(new URL('../konto.html', import.meta.url), 'utf8'), 'text/html');
  }
  if (pathname === '/preview/account-icon.svg') {
    return send(await readFile(new URL('../account-icon.svg', import.meta.url), 'utf8'), 'image/svg+xml');
  }
  if (Object.hasOwn(modules, pathname)) return send(await readFile(modules[pathname], 'utf8'), 'text/javascript');
  if (pathname === '/preview/checkout-config.js') {
    return send("window.AXI_PREVIEW_MODE = true;\nwindow.AXI_CHECKOUT_ENDPOINT = window.location.origin + '/preview/checkout-session';\n", 'text/javascript');
  }
  if (pathname === '/preview/supabase-config.js') {
    const publicConfig = isSupabasePublicConfig(config)
      ? { url: config.supabaseUrl, publishableKey: config.supabasePublishableKey }
      : null;
    return send('window.AXI_SUPABASE = ' + JSON.stringify(publicConfig) + ';\n', 'text/javascript');
  }
  if (pathname === '/preview/success') {
    return send(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Test zakończony — AXI3D</title>
<body style="margin:0;padding:10vh 8%;background:#141922;color:#f2f2ed;font:18px/1.7 sans-serif">
<h1>Powrót z płatności testowej</h1><p>To był test — nie pobrano prawdziwych pieniędzy i nie rozpoczynamy realizacji figurki.</p>
<p>Podgląd nie wysyła zgłoszeń ani zdjęć do Basin.</p>
<p>Sama ta strona nie potwierdza zapłaty. Wynik testu można zweryfikować w piaskownicy Stripe.</p>
<a href="/preview/#zamow" style="color:#ffd881">Wróć do formularza testowego</a></body></html>`, 'text/html');
  }
  return new Response('Nie znaleziono.', { status: 404, headers });
}
