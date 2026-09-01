import { createHash } from 'node:crypto';
import { MAX_FIGURINES, PRICING_VERSION, AUTOMATIC_DISCOUNT_PERCENT, BULK_MIN_FIGURINES, getPrice, getDeliveryOption } from '../pricing.mjs';

const MAX_BODY_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_SESSION = /^cs_live_[A-Za-z0-9]+$/;
const TEST_SESSION = /^cs_test_[A-Za-z0-9]+$/;
export const TERMS_VERSION = '2026-08-30';

export function validateOrder(order) {
  if (!order || typeof order !== 'object' || !UUID.test(order.orderId || '')) throw new Error('Nieprawidłowy numer zamówienia.');
  if (order.termsAccepted !== true) throw new Error('Zaakceptuj regulamin przed przejściem do płatności.');
  if (typeof order.email !== 'string' || order.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)) throw new Error('Podaj poprawny adres e-mail.');
  if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > MAX_FIGURINES) throw new Error('Nieprawidłowa liczba figurek.');
  const items = order.items.map(item => {
    if (!item || !getPrice(item.size)) throw new Error('Nieprawidłowy rozmiar figurki.');
    return { size: item.size };
  });
  const deliveryMethod = order.deliveryMethod;
  if (!getDeliveryOption(deliveryMethod)) throw new Error('Nieprawidłowy sposób dostawy.');
  if (order.promotionCode !== undefined && typeof order.promotionCode !== 'string') throw new Error('Nieprawidłowy kod promocyjny.');
  const promotionCode = (order.promotionCode || '').trim().toUpperCase();
  if (promotionCode && !/^[A-Z0-9-]{1,500}$/.test(promotionCode)) throw new Error('Nieprawidłowy kod promocyjny.');
  return { orderId: order.orderId, email: order.email, items, deliveryMethod, promotionCode, termsAccepted: true };
}

export function stripeParameters(order, siteOrigin, preview = false, promotionId = null) {
  const delivery = getDeliveryOption(order.deliveryMethod);
  const params = new URLSearchParams({
    mode: 'payment', customer_email: order.email, client_reference_id: order.orderId,
    // Pozostałe ustawienia zachowują zasady pięciu linków AXI3D (30.08.2026).
    // Kod jest wpisywany na AXI3D; Stripe weryfikuje go i oblicza kwotę.
    'automatic_tax[enabled]': 'false',
    'invoice_creation[enabled]': 'false', billing_address_collection: 'auto',
    customer_creation: 'if_required',
    success_url: siteOrigin + (preview ? '/preview/success' : '/dziekujemy.html?session_id={CHECKOUT_SESSION_ID}'),
    cancel_url: siteOrigin + (preview ? '/preview/#zamow' : '/#zamow'),
    'metadata[order_id]': order.orderId,
    'payment_intent_data[metadata][order_id]': order.orderId,
    'metadata[figurine_count]': String(order.items.length),
    'metadata[terms_accepted]': 'true',
    'metadata[terms_version]': TERMS_VERSION,
    'metadata[pricing_version]': PRICING_VERSION,
    'metadata[automatic_discount_percent]': String(AUTOMATIC_DISCOUNT_PERCENT),
    'metadata[bulk_pricing_applied]': String(order.items.length >= BULK_MIN_FIGURINES),
    'metadata[shipping_method]': order.deliveryMethod,
    'metadata[shipping_amount]': String(delivery.amount),
    'metadata[regular_subtotal]': String(order.items.reduce((sum, item) => sum + getPrice(item.size).regularAmount, 0)),
    'payment_intent_data[metadata][pricing_version]': PRICING_VERSION,
    'payment_intent_data[metadata][automatic_discount_percent]': String(AUTOMATIC_DISCOUNT_PERCENT),
    'payment_intent_data[metadata][bulk_pricing_applied]': String(order.items.length >= BULK_MIN_FIGURINES),
    'payment_intent_data[metadata][shipping_method]': order.deliveryMethod,
    'payment_intent_data[metadata][shipping_amount]': String(delivery.amount),
    'payment_intent_data[metadata][terms_accepted]': 'true',
    'payment_intent_data[metadata][terms_version]': TERMS_VERSION
  });
  params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(delivery.amount));
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'pln');
  params.set('shipping_options[0][shipping_rate_data][display_name]', delivery.displayName);
  // Nie łączymy discounts z allow_promotion_codes. Kod nie jest edytowany w Stripe.
  if (promotionId) {
    params.set('discounts[0][promotion_code]', promotionId);
    params.set('metadata[promotion_code]', order.promotionCode);
  } else params.set('allow_promotion_codes', 'false');
  if (preview) params.set('metadata[preview]', 'true');
  // payment_method_collection dotyczy wyłącznie subskrypcji. Dla dodatnich
  // kwot w mode: payment Stripe standardowo wymaga metody płatności.
  // Kwoty pochodzą wyłącznie ze wspólnego cennika na serwerze.
  // Nigdy nie przyjmujemy ceny ani ilości z kodu przeglądarki.
  order.items.forEach((item, index) => {
    const prefix = 'line_items[' + index + ']';
    params.set(prefix + '[quantity]', '1');
    params.set(prefix + '[price_data][currency]', 'pln');
    params.set(prefix + '[price_data][unit_amount]', String(getPrice(item.size, order.items.length).amount));
    params.set(prefix + '[price_data][product_data][name]', 'Figurka ' + (index + 1) + ' — ' + item.size + ' mm' + (order.items.length >= BULK_MIN_FIGURINES ? ' — cena 3+' : ''));
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
  if (body?.termsAccepted !== true) return json(400, { error: 'Zaakceptuj regulamin przed przejściem do płatności.', code: 'terms_required' });
  try {
    order = validateOrder(body);
  } catch {
    return json(400, { error: 'Sprawdź adres e-mail, liczbę figurek, rozmiary i kod promocyjny.' });
  }
  // Stara otwarta karta nie może kupować według innej ceny niż wyświetlona.
  if (body.pricingVersion !== PRICING_VERSION) return json(409, {
    error: 'Cennik został zaktualizowany. Odśwież stronę przed złożeniem zamówienia.', code: 'pricing_changed'
  });
  let diagnostic = { event: 'stripe_transport_error' };
  const report = () => { try { config.reportStripeError?.(diagnostic); } catch { /* Log nie blokuje odpowiedzi. */ } };
  const identifyResponse = (response, stage) => {
    diagnostic = { event: response.ok ? 'stripe_invalid_response' : 'stripe_http_error', status: response.status };
    if (stage) diagnostic.stage = stage;
    const requestId = response.headers.get('request-id');
    if (/^req_[A-Za-z0-9]{1,100}$/.test(requestId || '')) diagnostic.requestId = requestId;
  };
  try {
    let promotionId = null;
    if (order.promotionCode) {
      diagnostic.stage = 'promotion_lookup';
      const query = new URLSearchParams({ code: order.promotionCode, active: 'true', limit: '100' });
      const lookup = await stripeFetch('https://api.stripe.com/v1/promotion_codes?' + query, {
        method: 'GET', headers: { Authorization: 'Bearer ' + config.stripeKey }, signal: AbortSignal.timeout(15000)
      });
      identifyResponse(lookup, 'promotion_lookup');
      if (!lookup.ok) {
        report();
        return json(503, { error: 'Nie można teraz sprawdzić kodu promocyjnego. Spróbuj ponownie później lub usuń kod, aby zamówić bez dodatkowego rabatu z kodu.', code: 'promotion_codes_unavailable' });
      }
      const result = await lookup.json();
      if (!Array.isArray(result.data)) throw new Error('Invalid promotion response');
      // Bez kont klientów nie przypisujemy kodów zastrzeżonych dla konkretnego Customer.
      // Pozostałe warunki (termin, limit, minimum, produkty) sprawdzi Stripe przy tworzeniu sesji.
      const promotion = result.data.find(item => item.active === true &&
        typeof item.code === 'string' && item.code.toUpperCase() === order.promotionCode &&
        !item.customer && !item.customer_account && /^promo_[A-Za-z0-9]+$/.test(item.id || ''));
      if (!promotion) return json(400, { error: 'Kod jest nieprawidłowy, nieaktywny lub niedostępny dla tego zamówienia.', code: 'invalid_promotion_code' });
      promotionId = promotion.id;
    }
    const params = stripeParameters(order, config.siteOrigin, config.preview === true, promotionId);
    const digest = createHash('sha256').update(params.toString()).digest('hex');
    diagnostic = { event: 'stripe_transport_error' };
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
    identifyResponse(response);
    if (promotionId && response.status === 400) {
      report();
      return json(400, { error: 'Tego kodu nie można zastosować do zamówienia. Sprawdź jego ważność i warunki.', code: 'invalid_promotion_code' });
    }
    if (!response.ok) throw new Error('Stripe unavailable');
    const session = await response.json();
    if (config.preview && session.livemode !== false) throw new Error('Preview requires sandbox');
    // Nie ujawniamy klientowi kluczy ani szczegółów błędów konta Stripe.
    if (!session.url || new URL(session.url).hostname !== 'checkout.stripe.com' || !session.url.startsWith('https://')) throw new Error('Stripe unavailable');
    const subtotal = order.items.reduce((sum, item) => sum + getPrice(item.size, order.items.length).amount, 0);
    const delivery = getDeliveryOption(order.deliveryMethod);
    const total = session.amount_total;
    const discount = session.total_details?.amount_discount;
    const shippingAmount = session.total_details?.amount_shipping;
    if (session.currency !== 'pln' || session.amount_subtotal !== subtotal ||
        shippingAmount !== delivery.amount || !Number.isInteger(total) || !Number.isInteger(discount) ||
        discount < 0 || total < delivery.amount || total + discount !== subtotal + delivery.amount ||
        (!promotionId && discount !== 0)) throw new Error('Invalid totals');
    if (promotionId && discount === 0) return json(400, { error: 'Ten kod nie obniża ceny wybranych figurek.', code: 'invalid_promotion_code' });
    const regularSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).regularAmount, 0);
    const saleSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).saleAmount, 0);
    return json(200, { url: session.url, checkoutVersion: 3, pricingVersion: PRICING_VERSION,
      regularSubtotal, saleSubtotal, automaticDiscount: regularSubtotal - saleSubtotal,
      bulkDiscount: saleSubtotal - subtotal, bulkPricing: order.items.length >= BULK_MIN_FIGURINES,
      subtotal, deliveryMethod: order.deliveryMethod, shippingAmount, discount, total, currency: 'pln', promotionCode: order.promotionCode });
  } catch {
    // Tylko kontrolowane pola diagnostyczne. Nigdy error.message Stripe,
    // treść odpowiedzi, dane zamówienia ani Authorization (mogą zawierać klucz).
    report();
    return json(502, { error: 'Nie udało się przygotować płatności. Spróbuj ponownie za chwilę.' });
  }
}
