import { createHash } from 'node:crypto';
import { MAX_FIGURINES, getPrice } from '../pricing.mjs';

const MAX_BODY_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_SESSION = /^cs_live_[A-Za-z0-9]+$/;
const TEST_SESSION = /^cs_test_[A-Za-z0-9]+$/;

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

export function stripeParameters(order, siteOrigin, preview = false) {
  const params = new URLSearchParams({
    mode: 'payment', customer_email: order.email, client_reference_id: order.orderId,
    // Pozostałe ustawienia zachowują zasady pięciu linków AXI3D (30.08.2026).
    // Stripe sprawdza wpisany kod i oblicza rabat dopiero w Checkout.
    'automatic_tax[enabled]': 'false', allow_promotion_codes: 'true',
    'invoice_creation[enabled]': 'false', billing_address_collection: 'auto',
    customer_creation: 'if_required',
    success_url: siteOrigin + (preview ? '/preview/success' : '/dziekujemy.html?session_id={CHECKOUT_SESSION_ID}'),
    cancel_url: siteOrigin + (preview ? '/preview/#zamow' : '/#zamow'),
    'metadata[order_id]': order.orderId,
    'payment_intent_data[metadata][order_id]': order.orderId,
    'metadata[figurine_count]': String(order.items.length)
  });
  if (preview) params.set('metadata[preview]', 'true');
  // payment_method_collection dotyczy wyłącznie subskrypcji. Dla dodatnich
  // kwot w mode: payment Stripe standardowo wymaga metody płatności.
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

async function readJsonBody(request) {
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      const error = new Error('Payload too large');
      error.status = 413;
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function verifyStripePayment(sessionId, config, stripeFetch = fetch) {
  const validSession = config.preview ? TEST_SESSION.test(sessionId || '') : LIVE_SESSION.test(sessionId || '');
  if (!validSession) throw new Error('Invalid Stripe session');
  const response = await stripeFetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId) + '?expand[]=line_items',
    {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + config.stripeKey },
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!response.ok) throw new Error('Stripe unavailable');
  const session = await response.json();
  if (session.id !== sessionId) throw new Error('Stripe session mismatch');
  const amountTotal = Number.isInteger(session.amount_total) ? session.amount_total : null;
  const items = Array.isArray(session.line_items?.data)
    ? session.line_items.data.map((line, index) => {
        const quantity = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1;
        const lineTotal = Number.isInteger(line.amount_total) ? line.amount_total : 0;
        return {
          item_id: 'axi-figurine-' + (index + 1),
          item_name: typeof line.description === 'string' && line.description ? line.description : 'Personalizowana figurka',
          price: lineTotal / quantity / 100,
          quantity
        };
      })
    : [];
  return {
    paid: session.payment_status === 'paid',
    transactionId: session.id,
    orderId: typeof session.client_reference_id === 'string' ? session.client_reference_id : null,
    value: amountTotal === null ? null : amountTotal / 100,
    currency: typeof session.currency === 'string' ? session.currency.toUpperCase() : 'PLN',
    items
  };
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

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error?.status === 413) return json(413, { error: 'Zapytanie jest za duże.' });
    return json(400, { error: 'Nieprawidłowe dane zapytania.' });
  }

  if (body?.action === 'verify_payment') {
    try {
      const payment = await verifyStripePayment(body.sessionId, config, stripeFetch);
      return json(200, payment);
    } catch {
      return json(502, { error: 'Nie udało się potwierdzić płatności.' });
    }
  }

  let order;
  try {
    order = validateOrder(body);
  } catch {
    return json(400, { error: 'Sprawdź adres e-mail, liczbę figurek i ich rozmiary.' });
  }
  const params = stripeParameters(order, config.siteOrigin, config.preview === true);
  const digest = createHash('sha256').update(params.toString()).digest('hex');
  let diagnostic = { event: 'stripe_transport_error' };
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
    diagnostic = { event: response.ok ? 'stripe_invalid_response' : 'stripe_http_error', status: response.status };
    const requestId = response.headers.get('request-id');
    if (/^req_[A-Za-z0-9]{1,100}$/.test(requestId || '')) diagnostic.requestId = requestId;
    if (!response.ok) throw new Error('Stripe unavailable');
    const session = await response.json();
    if (config.preview && session.livemode !== false) throw new Error('Preview requires sandbox');
    // Nie ujawniamy klientowi kluczy ani szczegółów błędów konta Stripe.
    if (!session.url || new URL(session.url).hostname !== 'checkout.stripe.com' || !session.url.startsWith('https://')) throw new Error('Stripe unavailable');
    return json(200, { url: session.url });
  } catch {
    // Tylko kontrolowane pola diagnostyczne. Nigdy error.message Stripe,
    // treść odpowiedzi, dane zamówienia ani Authorization (mogą zawierać klucz).
    try { config.reportStripeError?.(diagnostic); } catch { /* Log nie blokuje odpowiedzi. */ }
    return json(502, { error: 'Nie udało się przygotować płatności. Spróbuj ponownie za chwilę.' });
  }
}