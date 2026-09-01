import { readFile } from 'node:fs/promises';

export const isTestKey = key => typeof key === 'string' && /^(?:rk|sk)_test_/.test(key);

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
    .replace('</head>', `<meta name="robots" content="noindex,nofollow">
<style>
.axi-preview-notice{position:relative;margin-top:90px;padding:20px 6%;background:#fff1bc;color:#211b0d;font:15px/1.5 sans-serif}
.axi-preview-notice p{margin:8px 0}.axi-preview-notice a{color:#211b0d;text-decoration:underline}
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
  '/preview/pricing.mjs': new URL('../pricing.mjs', import.meta.url)
};

export async function previewResponse(pathname, method, config) {
  if (!isTestKey(config.stripeKey)) return new Response('Podgląd testowy jest wyłączony.', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers });
  const send = (body, type) => new Response(method === 'HEAD' ? null : body, { headers: { ...headers, 'Content-Type': type + '; charset=utf-8' } });
  if (pathname === '/preview') return new Response(null, { status: 307, headers: { ...headers, Location: '/preview/' } });
  if (pathname === '/preview/' || pathname === '/preview/index.html') {
    return send(renderPreviewHtml(await readFile(new URL('../index.html', import.meta.url), 'utf8'), config.siteOrigin), 'text/html');
  }
  if (Object.hasOwn(modules, pathname)) return send(await readFile(modules[pathname], 'utf8'), 'text/javascript');
  if (pathname === '/preview/checkout-config.js') {
    return send("window.AXI_PREVIEW_MODE = true;\nwindow.AXI_CHECKOUT_ENDPOINT = window.location.origin + '/preview/checkout-session';\n", 'text/javascript');
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
