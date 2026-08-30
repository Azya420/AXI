import { createHash } from 'node:crypto';
import { MAX_FIGURINES, getPrice } from '../pricing.mjs';

const MAX_BODY_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateOrder(order) {
  if (!order || typeof order !== 'object' || !UUID.test(order.orderId || '')) throw new Error('Nieprawidłowy numer zamówienia.');
  if (typeof order.email !== 'string' || order.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) throw new Error('Podaj poprawny adres e-mail.');
  if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > MAX_FIGURINES) throw new Error('Nieprawidłowa liczba figurek.');
  const items = order.items.map(item => {
    if (!item || !getPrice(item.size)) throw new Error('Nieprawidłowy rozmiar figurki.');
    return { size: item.size };
  });
  return { orderId: order.orderId, email: order.email, items };
}

export function stripeParameters(order, siteOrigin) {
  const params = new URLSearchParams({
    mode: 'payment', customer_email: order.email, client_reference_id: order.orderId,
    // Potwierdzone ustawienia pięciu linków AXI3D (30.08.2026).
    'automatic_tax[enabled]': 'false', allow_promotion_codes: 'false',
    'invoice_creation[enabled]': 'false', billing_address_collection: 'auto',
    customer_creation: 'if_required', payment_method_collection: 'if_required',
    success_url: siteOrigin + '/dziekujemy.html', cancel_url: siteOrigin + '/#zamow',
    'metadata[order_id]': order.orderId,
    'payment_intent_data[metadata][order_id]': order.orderId,
    'metadata[figurine_count]': String(order.items.length)
  });
  // Kwoty pochodzą wyłącznie ze wspólnego cennika na serwerze.
  // Nigdy nie przyjmujemy ceny ani ilości z kodu przeglądarki.
  order.items.forEach((item, index) => {
    const prefix = 'line_items[' + index + ']';
    params.set(prefix + '[quantity]', '1');
    params.set(prefix + '[price_data][currency]', 'pln');
    params.set(prefix + '[price_data][unit_amount]', String(getPrice(item.size).amount));
    params.set(prefix + '[price_data][product_data][name]', 'Figurka ' + (index + 1) + ' — ' + item.size + ' mm');
  });
  return params;
}

export async function handleCheckout(request, config, stripeFetch = fetch) {
  const origin = request.headers.get('Origin');
  const allowed = config.allowedOrigins.includes(origin);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (!allowed) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' });
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json(415, { error: 'Wymagany format JSON.' });
  if (!config.stripeKey) return json(503, { error: 'Płatności nie są jeszcze skonfigurowane.' });
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return json(413, { error: 'Zapytanie jest za duże.' });
  let order;
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return json(413, { error: 'Zapytanie jest za duże.' }); }
      chunks.push(Buffer.from(value));
    }
    order = validateOrder(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return json(400, { error: 'Sprawdź adres e-mail, liczbę figurek i ich rozmiary.' });
  }
  const params = stripeParameters(order, config.siteOrigin);
  const digest = createHash('sha256').update(params.toString()).digest('hex');
  try {
    const response = await stripeFetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': 'axi-' + digest
      },
      body: params,
      signal: AbortSignal.timeout(15000)
    });
    const session = await response.json();
    // Nie ujawniamy klientowi kluczy ani szczegółów błędów konta Stripe.
    if (!response.ok || !session.url || new URL(session.url).hostname !== 'checkout.stripe.com' || !session.url.startsWith('https://')) throw new Error('Stripe unavailable');
    return json(200, { url: session.url });
  } catch {
    return json(502, { error: 'Nie udało się przygotować płatności. Spróbuj ponownie za chwilę.' });
  }
}
