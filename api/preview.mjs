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
.axi-nav-actions{display:flex;align-items:center;gap:10px}
.axi-account-link{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;text-decoration:none;transition:background .2s,filter .2s,transform .2s}
.axi-account-link img{display:block;width:42px;height:42px}
.axi-account-link:hover,.axi-account-link:focus-visible{background:rgba(109,40,217,.2);filter:drop-shadow(0 0 7px rgba(167,139,250,.42));transform:translateY(-1px);outline:none}
@media(max-width:680px){.axi-nav-actions{gap:7px}.axi-account-link{width:40px;height:40px}.axi-account-link img{width:38px;height:38px}}
#cookie-banner{display:none!important}
</style></head>`)
    .replace('</body>', `<script src="/preview/supabase-config.js"></script>
<script type="module" src="/preview/saved-customer.mjs"></script>
</body>`)
  ;
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
  '/preview/account.mjs': new URL('../account.mjs', import.meta.url),
  '/preview/admin.mjs': new URL('../admin.mjs', import.meta.url),
  '/preview/preview-success.mjs': new URL('../preview-success.mjs', import.meta.url),
  '/preview/saved-customer.mjs': new URL('../saved-customer.mjs', import.meta.url)
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
  if (pathname === '/preview/admin.html') {
    return send(await readFile(new URL('../admin.html', import.meta.url), 'utf8'), 'text/html');
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
    return send(await readFile(new URL('../preview-success.html', import.meta.url), 'utf8'), 'text/html');
  }
  return new Response('Nie znaleziono.', { status: 404, headers });
}
