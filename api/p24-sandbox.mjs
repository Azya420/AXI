import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { validateOrder } from './checkout.mjs';
import { PRICING_VERSION, AUTOMATIC_DISCOUNT_PERCENT, BULK_MIN_FIGURINES, getPrice, getItemSubtotal, getDeliveryOption } from '../pricing.mjs';

const MAX_BODY_BYTES = 8192;
const SESSION_ID = /^axitest\.([0-9a-f-]{36})\.(\d{2,9})\.([0-9a-f]{24})$/i;
const verifiedSessions = new Map();

export const P24_SANDBOX_API = 'https://sandbox.przelewy24.pl/api/v1';
export const P24_SANDBOX_GATEWAY = 'https://sandbox.przelewy24.pl/trnRequest/';

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

function corsHeaders(request, config, methods = 'GET, POST, OPTIONS') {
  const origin = request.headers.get('Origin');
  if (!config.allowedOrigins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function configured(config) {
  return Number.isSafeInteger(config.p24?.merchantId) && config.p24.merchantId > 0 &&
    Number.isSafeInteger(config.p24?.posId) && config.p24.posId > 0 &&
    typeof config.p24?.apiKey === 'string' && config.p24.apiKey.length > 0 &&
    typeof config.p24?.crc === 'string' && config.p24.crc.length > 0;
}

function auth(config) {
  return 'Basic ' + Buffer.from(config.p24.posId + ':' + config.p24.apiKey).toString('base64');
}

export function p24Sign(value) {
  return createHash('sha384').update(JSON.stringify(value), 'utf8').digest('hex');
}

function sessionSignature(orderId, amount, crc) {
  return createHmac('sha256', crc).update('axi-p24-sandbox:' + orderId + ':' + amount).digest('hex').slice(0, 24);
}

export function createP24SessionId(orderId, amount, crc) {
  return 'axitest.' + orderId + '.' + amount + '.' + sessionSignature(orderId, amount, crc);
}

export function parseP24SessionId(sessionId, crc) {
  const match = SESSION_ID.exec(sessionId || '');
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isSafeInteger(amount) || amount < 1) return null;
  const expected = Buffer.from(sessionSignature(match[1], amount, crc));
  const actual = Buffer.from(match[3].toLowerCase());
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { orderId: match[1], amount };
}

async function readJsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
    const error = new Error('Wymagany format JSON.');
    error.status = 415;
    throw error;
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Brak danych zapytania.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      const error = new Error('Zapytanie jest za duże.');
      error.status = 413;
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Nieprawidłowe dane zapytania.'); error.status = 400; throw error; }
}

async function p24Json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return {}; }
}

export async function handleP24TestAccess(request, config, p24Fetch = fetch) {
  const headers = corsHeaders(request, config, 'GET, OPTIONS');
  if (!headers) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return json(405, { error: 'Niedozwolona metoda.' }, headers);
  if (!configured(config)) return json(503, { error: 'Sandbox Przelewy24 nie jest skonfigurowany.' }, headers);
  try {
    const response = await p24Fetch(P24_SANDBOX_API + '/testAccess', {
      headers: { Authorization: auth(config) }, signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    if (!response.ok || result.data !== true) return json(502, { error: 'Przelewy24 odrzuciło dane dostępowe sandboxa.' }, headers);
    return json(200, { ok: true, environment: 'sandbox' }, headers);
  } catch {
    return json(502, { error: 'Nie udało się połączyć z sandboxem Przelewy24.' }, headers);
  }
}

export async function handleP24Register(request, config, p24Fetch = fetch) {
  const headers = corsHeaders(request, config);
  if (!headers) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' }, headers);
  if (!configured(config)) return json(503, { error: 'Sandbox Przelewy24 nie jest skonfigurowany.' }, headers);

  let body;
  try { body = await readJsonBody(request); }
  catch (error) { return json(error.status || 400, { error: error.message }, headers); }
  if (body?.pricingVersion !== PRICING_VERSION) return json(409, {
    error: 'Cennik został zaktualizowany. Odśwież stronę testową.', code: 'pricing_changed'
  }, headers);

  let order;
  try { order = validateOrder(body); }
  catch { return json(400, { error: 'Sprawdź dane formularza przed przejściem do płatności.' }, headers); }
  if (order.email.length > 50) return json(400, { error: 'W teście P24 adres e-mail może mieć maksymalnie 50 znaków.' }, headers);
  if (order.promotionCode) return json(400, { error: 'Kody promocyjne nie są obsługiwane na testowej stronie Przelewy24.' }, headers);

  const subtotal = order.items.reduce((sum, item) => sum + getItemSubtotal(item.size, item.copies, order.items.length), 0);
  const delivery = getDeliveryOption(order.deliveryMethod);
  const amount = subtotal + delivery.amount;
  const regularSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).regularAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
  const saleSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).saleAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
  const sessionId = createP24SessionId(order.orderId, amount, config.p24.crc);
  const returnUrl = config.backendOrigin + '/p24-test/return?sessionId=' + encodeURIComponent(sessionId);
  const statusUrl = config.backendOrigin + '/p24-test/notification';
  const currency = 'PLN';
  const payload = {
    merchantId: config.p24.merchantId,
    posId: config.p24.posId,
    sessionId,
    amount,
    currency,
    description: 'TEST AXI3D - zamowienie ' + order.orderId.slice(0, 8),
    email: order.email,
    country: 'PL',
    language: 'pl',
    urlReturn: returnUrl,
    urlStatus: statusUrl,
    waitForResult: true,
    shipping: delivery.amount,
    encoding: 'UTF-8',
    sign: p24Sign({ sessionId, merchantId: config.p24.merchantId, amount, currency, crc: config.p24.crc })
  };

  try {
    const response = await p24Fetch(P24_SANDBOX_API + '/transaction/register', {
      method: 'POST',
      headers: { Authorization: auth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    const token = result?.data?.token;
    if (!response.ok || !/^[A-Za-z0-9-]{10,100}$/.test(token || '')) {
      config.reportP24Error?.({ event: 'p24_register_rejected', status: response.status });
      return json(502, { error: 'Przelewy24 nie przyjęło transakcji testowej. Sprawdź konfigurację sandboxa.' }, headers);
    }
    verifiedSessions.set(sessionId, { verified: false, updatedAt: Date.now() });
    return json(200, {
      url: P24_SANDBOX_GATEWAY + token,
      checkoutVersion: 'p24-sandbox-v1',
      pricingVersion: PRICING_VERSION,
      regularSubtotal,
      saleSubtotal,
      automaticDiscount: regularSubtotal - saleSubtotal,
      bulkDiscount: saleSubtotal - subtotal,
      bulkPricing: order.items.length >= BULK_MIN_FIGURINES,
      subtotal,
      deliveryMethod: order.deliveryMethod,
      shippingAmount: delivery.amount,
      discount: 0,
      total: amount,
      currency: 'pln',
      promotionCode: '',
      automaticDiscountPercent: AUTOMATIC_DISCOUNT_PERCENT
    }, headers);
  } catch {
    config.reportP24Error?.({ event: 'p24_register_unavailable' });
    return json(502, { error: 'Nie udało się połączyć z sandboxem Przelewy24.' }, headers);
  }
}

export async function handleP24Notification(request, config, p24Fetch = fetch) {
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' });
  if (!configured(config)) return json(503, { error: 'Sandbox Przelewy24 nie jest skonfigurowany.' });
  let notification;
  try { notification = await readJsonBody(request); }
  catch (error) { return json(error.status || 400, { error: error.message }); }

  const parsed = parseP24SessionId(notification.sessionId, config.p24.crc);
  const fieldsValid = parsed && notification.merchantId === config.p24.merchantId &&
    notification.posId === config.p24.posId && notification.amount === parsed.amount &&
    notification.originAmount === parsed.amount && notification.currency === 'PLN' &&
    Number.isSafeInteger(notification.orderId) && notification.orderId > 0 &&
    Number.isSafeInteger(notification.methodId) && typeof notification.statement === 'string';
  if (!fieldsValid) return json(400, { error: 'Nieprawidłowe dane notyfikacji.' });
  const expectedSign = p24Sign({
    merchantId: notification.merchantId,
    posId: notification.posId,
    sessionId: notification.sessionId,
    amount: notification.amount,
    originAmount: notification.originAmount,
    currency: notification.currency,
    orderId: notification.orderId,
    methodId: notification.methodId,
    statement: notification.statement,
    crc: config.p24.crc
  });
  const expected = Buffer.from(expectedSign);
  const received = Buffer.from(typeof notification.sign === 'string' ? notification.sign.toLowerCase() : '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return json(400, { error: 'Nieprawidłowy podpis notyfikacji.' });

  const verifyPayload = {
    merchantId: config.p24.merchantId,
    posId: config.p24.posId,
    sessionId: notification.sessionId,
    amount: notification.amount,
    currency: notification.currency,
    orderId: notification.orderId,
    sign: p24Sign({
      sessionId: notification.sessionId,
      orderId: notification.orderId,
      amount: notification.amount,
      currency: notification.currency,
      crc: config.p24.crc
    })
  };
  try {
    const response = await p24Fetch(P24_SANDBOX_API + '/transaction/verify', {
      method: 'PUT',
      headers: { Authorization: auth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyPayload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    if (!response.ok || result?.data?.status !== 'success') {
      config.reportP24Error?.({ event: 'p24_verify_rejected', status: response.status });
      return json(502, { error: 'Weryfikacja transakcji nie powiodła się.' });
    }
    verifiedSessions.set(notification.sessionId, { verified: true, orderId: notification.orderId, updatedAt: Date.now() });
    return json(200, { ok: true });
  } catch {
    config.reportP24Error?.({ event: 'p24_verify_unavailable' });
    return json(502, { error: 'Weryfikacja transakcji nie powiodła się.' });
  }
}

export async function handleP24Status(request, config, p24Fetch = fetch) {
  const headers = corsHeaders(request, config, 'GET, OPTIONS');
  if (!headers) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') return json(405, { error: 'Niedozwolona metoda.' }, headers);
  if (!configured(config)) return json(503, { error: 'Sandbox Przelewy24 nie jest skonfigurowany.' }, headers);
  const sessionId = new URL(request.url).searchParams.get('sessionId') || '';
  if (!parseP24SessionId(sessionId, config.p24.crc)) return json(400, { error: 'Nieprawidłowy identyfikator transakcji.' }, headers);
  try {
    const response = await p24Fetch(P24_SANDBOX_API + '/transaction/by/sessionId/' + encodeURIComponent(sessionId), {
      headers: { Authorization: auth(config) }, signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    if (!response.ok || result?.data?.sessionId !== sessionId) return json(502, { error: 'Nie udało się odczytać statusu transakcji.' }, headers);
    const status = Number(result.data.status);
    const labels = { 0: 'pending', 1: 'advance', 2: 'paid', 3: 'returned' };
    return json(200, {
      status: labels[status] || 'unknown',
      verified: verifiedSessions.get(sessionId)?.verified === true,
      amount: result.data.amount,
      currency: result.data.currency
    }, headers);
  } catch {
    return json(502, { error: 'Nie udało się odczytać statusu transakcji.' }, headers);
  }
}

export function p24ReturnLocation(request, config) {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || '';
  const valid = configured(config) && parseP24SessionId(sessionId, config.p24.crc);
  return config.siteOrigin + '/p24-test-result.html' + (valid ? '?sessionId=' + encodeURIComponent(sessionId) : '?error=invalid_session');
}
