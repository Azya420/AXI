import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { validateOrder } from './checkout.mjs';
import { PRICING_VERSION, AUTOMATIC_DISCOUNT_PERCENT, BULK_MIN_FIGURINES, getPrice, getItemSubtotal, getDeliveryOption } from '../pricing.mjs';

const MAX_BODY_BYTES = 8192;
const SESSION_ID = /^(axitest|axip24)\.([0-9a-f-]{36})\.(\d{2,9})\.([0-9a-f]{24})$/i;
const verifiedSessions = new Map();

export const P24_SANDBOX_API = 'https://sandbox.przelewy24.pl/api/v1';
export const P24_SANDBOX_GATEWAY = 'https://sandbox.przelewy24.pl/trnRequest/';
export const P24_PRODUCTION_API = 'https://secure.przelewy24.pl/api/v1';
export const P24_PRODUCTION_GATEWAY = 'https://secure.przelewy24.pl/trnRequest/';

const apiBase = config => config.p24ApiBase || P24_SANDBOX_API;
const gatewayBase = config => config.p24GatewayBase || P24_SANDBOX_GATEWAY;
const environmentName = config => config.p24Environment || 'sandbox';

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

function sessionSignature(prefix, orderId, amount, crc) {
  const namespace = prefix === 'axitest' ? 'axi-p24-sandbox' : prefix;
  return createHmac('sha256', crc).update(namespace + ':' + orderId + ':' + amount).digest('hex').slice(0, 24);
}

export function createP24SessionId(orderId, amount, crc, prefix = 'axitest') {
  if (!['axitest', 'axip24'].includes(prefix)) throw new Error('Invalid P24 session prefix');
  return prefix + '.' + orderId + '.' + amount + '.' + sessionSignature(prefix, orderId, amount, crc);
}

export function parseP24SessionId(sessionId, crc) {
  const match = SESSION_ID.exec(sessionId || '');
  if (!match) return null;
  const amount = Number(match[3]);
  if (!Number.isSafeInteger(amount) || amount < 1) return null;
  const expected = Buffer.from(sessionSignature(match[1].toLowerCase(), match[2], amount, crc));
  const actual = Buffer.from(match[4].toLowerCase());
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { orderId: match[2], amount };
}

function promotionError(message, status = 400, code = 'invalid_promotion_code') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function promotionAmounts(order, subtotal, shippingAmount, config, stripeFetch) {
  if (!order.promotionCode) return { promotionCode: '', discount: 0, shippingAmount };
  if (!config.stripeKey) throw promotionError(
    'Nie można teraz sprawdzić kodu promocyjnego. Spróbuj ponownie później lub usuń kod, aby zamówić bez dodatkowego rabatu.',
    503,
    'promotion_codes_unavailable'
  );
  let lookup;
  try {
    const query = new URLSearchParams({ code: order.promotionCode, active: 'true', limit: '100' });
    query.append('expand[0]', 'data.promotion.coupon');
    lookup = await stripeFetch('https://api.stripe.com/v1/promotion_codes?' + query, {
      method: 'GET', headers: { Authorization: 'Bearer ' + config.stripeKey }, signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw promotionError(
      'Nie można teraz sprawdzić kodu promocyjnego. Spróbuj ponownie później lub usuń kod, aby zamówić bez dodatkowego rabatu.',
      503,
      'promotion_codes_unavailable'
    );
  }
  if (!lookup.ok) throw promotionError(
    'Nie można teraz sprawdzić kodu promocyjnego. Spróbuj ponownie później lub usuń kod, aby zamówić bez dodatkowego rabatu.',
    503,
    'promotion_codes_unavailable'
  );
  const result = await p24Json(lookup);
  const promotion = Array.isArray(result.data) ? result.data.find(item => item?.active === true &&
    typeof item.code === 'string' && item.code.toUpperCase() === order.promotionCode &&
    !item.customer && !item.customer_account) : null;
  const coupon = promotion?.promotion?.coupon;
  const restrictions = promotion?.restrictions || {};
  const now = Math.floor(Date.now() / 1000);
  const unavailable = !promotion || !coupon || coupon.valid === false ||
    (Number.isSafeInteger(promotion.expires_at) && promotion.expires_at <= now) ||
    (Number.isSafeInteger(promotion.max_redemptions) && Number(promotion.times_redeemed) >= promotion.max_redemptions) ||
    (Number.isSafeInteger(coupon.redeem_by) && coupon.redeem_by <= now) ||
    (Number.isSafeInteger(coupon.max_redemptions) && Number(coupon.times_redeemed) >= coupon.max_redemptions) ||
    restrictions.first_time_transaction === true ||
    (Number.isSafeInteger(restrictions.minimum_amount) && restrictions.minimum_amount > subtotal) ||
    (restrictions.minimum_amount_currency && restrictions.minimum_amount_currency.toLowerCase() !== 'pln') ||
    (Array.isArray(coupon.applies_to?.products) && coupon.applies_to.products.length > 0);
  if (unavailable) throw promotionError('Kod jest nieprawidłowy, nieaktywny lub niedostępny dla tego zamówienia.');

  let discount = 0;
  if (Number.isFinite(coupon.percent_off) && coupon.percent_off > 0 && coupon.percent_off <= 100) {
    discount = Math.round(subtotal * coupon.percent_off / 100);
  } else if (Number.isSafeInteger(coupon.amount_off) && coupon.amount_off > 0 &&
      String(coupon.currency || '').toLowerCase() === 'pln') {
    discount = Math.min(subtotal, coupon.amount_off);
  } else {
    throw promotionError('Tego kodu nie można zastosować do zamówienia. Sprawdź jego ważność i warunki.');
  }
  if (discount <= 0) throw promotionError('Ten kod nie obniża ceny wybranych figurek.');

  const configuredShippingDiscount = Number(coupon.metadata?.shipping_discount_percent);
  if (Number.isInteger(configuredShippingDiscount) && configuredShippingDiscount > 0 &&
      configuredShippingDiscount <= 100 && coupon.percent_off === configuredShippingDiscount) {
    shippingAmount = Math.round(shippingAmount * (100 - configuredShippingDiscount) / 100);
  }
  return {
    promotionCode: order.promotionCode,
    promotionId: promotion.id,
    singleUse: promotion.max_redemptions === 1 || coupon.max_redemptions === 1,
    discount,
    shippingAmount
  };
}

async function deactivateSingleUsePromotion(order, config, stripeFetch) {
  if (!order?.singleUsePromotionId || !config.stripeKey) return;
  const response = await stripeFetch('https://api.stripe.com/v1/promotion_codes/' + encodeURIComponent(order.singleUsePromotionId), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.stripeKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ active: 'false' }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Promotion code deactivation failed');
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
  if (!configured(config)) return json(503, { error: 'Przelewy24 nie jest skonfigurowane dla wybranego środowiska.' }, headers);
  try {
    const response = await p24Fetch(apiBase(config) + '/testAccess', {
      headers: { Authorization: auth(config) }, signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    if (!response.ok || result.data !== true) return json(502, { error: 'Przelewy24 odrzuciło dane dostępowe.' }, headers);
    return json(200, { ok: true, environment: environmentName(config) }, headers);
  } catch {
    return json(502, { error: 'Nie udało się połączyć z Przelewy24.' }, headers);
  }
}

export async function handleP24Register(request, config, p24Fetch = fetch) {
  const headers = corsHeaders(request, config);
  if (!headers) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' }, headers);
  if (!configured(config)) return json(503, { error: 'Przelewy24 nie jest skonfigurowane dla wybranego środowiska.' }, headers);

  let body;
  try { body = await readJsonBody(request); }
  catch (error) { return json(error.status || 400, { error: error.message }, headers); }
  if (body?.pricingVersion !== PRICING_VERSION) return json(409, {
    error: 'Cennik został zaktualizowany. Odśwież stronę testową.', code: 'pricing_changed'
  }, headers);

  let order;
  try { order = validateOrder(body); }
  catch { return json(400, { error: 'Sprawdź dane formularza przed przejściem do płatności.' }, headers); }
  if (order.email.length > 50) return json(400, { error: 'Adres e-mail może mieć maksymalnie 50 znaków.' }, headers);
  if (config.p24EnablePromotions !== true && order.promotionCode) return json(400, { error: 'Kody promocyjne nie są obsługiwane na testowej stronie Przelewy24.' }, headers);

  const subtotal = order.items.reduce((sum, item) => sum + getItemSubtotal(item.size, item.copies, order.items.length), 0);
  const delivery = getDeliveryOption(order.deliveryMethod);
  const fixedAmount = Number.isSafeInteger(config.p24FixedAmount) && config.p24FixedAmount > 0 ? config.p24FixedAmount : null;
  let promotion = { promotionCode: '', discount: 0, shippingAmount: delivery.amount };
  if (!fixedAmount) {
    try { promotion = await promotionAmounts(order, subtotal, delivery.amount, config, p24Fetch); }
    catch (error) { return json(error.status || 400, { error: error.message, code: error.code }, headers); }
    if (promotion.singleUse === true && typeof promotion.promotionId === 'string') {
      order.singleUsePromotionId = promotion.promotionId;
    }
  }
  const amount = fixedAmount || subtotal + promotion.shippingAmount - promotion.discount;
  if (!Number.isSafeInteger(amount) || amount < 1) return json(400, {
    error: 'Kod obniża wartość zamówienia do zera. Skontaktuj się z nami, aby dokończyć zamówienie.',
    code: 'zero_total'
  }, headers);
  const regularSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).regularAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
  const saleSubtotal = order.items.reduce((sum, item) => sum + getPrice(item.size).saleAmount + (item.copies - 1) * getPrice(item.size).additionalCopyAmount, 0);
  const sessionId = createP24SessionId(order.orderId, amount, config.p24.crc, config.p24SessionPrefix || 'axitest');
  const returnUrl = config.backendOrigin + (config.p24ReturnPath || '/p24-test/return') + '?sessionId=' + encodeURIComponent(sessionId);
  const statusUrl = config.backendOrigin + (config.p24NotificationPath || '/p24-test/notification');
  const currency = 'PLN';
  const payload = {
    merchantId: config.p24.merchantId,
    posId: config.p24.posId,
    sessionId,
    amount,
    currency,
    description: (config.p24Description || 'TEST AXI3D') + ' - ' + order.orderId.slice(0, 8),
    email: order.email,
    client: order.customerName.slice(0, 40),
    address: order.deliveryDestination.slice(0, 80),
    country: 'PL',
    language: 'pl',
    urlReturn: returnUrl,
    urlStatus: statusUrl,
    waitForResult: true,
    encoding: 'UTF-8',
    sign: p24Sign({ sessionId, merchantId: config.p24.merchantId, amount, currency, crc: config.p24.crc })
  };
  if (!fixedAmount) payload.shipping = promotion.shippingAmount;

  try {
    await config.onP24Prepared?.({ sessionId, order, amount, currency, environment: environmentName(config) });
  } catch {
    config.reportP24Error?.({ event: 'p24_order_storage_failed' });
    return json(503, { error: 'Nie udało się bezpiecznie zapisać zamówienia przed płatnością. Spróbuj ponownie.' }, headers);
  }

  try {
    const response = await p24Fetch(apiBase(config) + '/transaction/register', {
      method: 'POST',
      headers: { Authorization: auth(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    const token = result?.data?.token;
    if (!response.ok || !/^[A-Za-z0-9-]{10,100}$/.test(token || '')) {
      config.reportP24Error?.({ event: 'p24_register_rejected', status: response.status });
      return json(502, { error: 'Przelewy24 nie przyjęło transakcji. Spróbuj ponownie za chwilę.' }, headers);
    }
    verifiedSessions.set(sessionId, { verified: false, order, updatedAt: Date.now() });
    return json(200, {
      url: gatewayBase(config) + token,
      checkoutVersion: config.p24CheckoutVersion || 'p24-sandbox-v1',
      pricingVersion: PRICING_VERSION,
      regularSubtotal,
      saleSubtotal,
      automaticDiscount: regularSubtotal - saleSubtotal,
      bulkDiscount: saleSubtotal - subtotal,
      bulkPricing: order.items.length >= BULK_MIN_FIGURINES,
      subtotal,
      deliveryMethod: order.deliveryMethod,
      shippingAmount: fixedAmount ? 0 : promotion.shippingAmount,
      discount: fixedAmount ? 0 : promotion.discount,
      total: amount,
      currency: 'pln',
      promotionCode: fixedAmount ? '' : promotion.promotionCode,
      automaticDiscountPercent: AUTOMATIC_DISCOUNT_PERCENT,
      technicalTestAmount: fixedAmount
    }, headers);
  } catch {
    config.reportP24Error?.({ event: 'p24_register_unavailable' });
    return json(502, { error: 'Nie udało się połączyć z Przelewy24.' }, headers);
  }
}

export async function handleP24Notification(request, config, p24Fetch = fetch) {
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' });
  if (!configured(config)) return json(503, { error: 'Przelewy24 nie jest skonfigurowane dla wybranego środowiska.' });
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
    const response = await p24Fetch(apiBase(config) + '/transaction/verify', {
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
    const current = verifiedSessions.get(notification.sessionId) || {};
    verifiedSessions.set(notification.sessionId, { ...current, verified: true, orderId: notification.orderId, updatedAt: Date.now() });
    try { await deactivateSingleUsePromotion(current.order, config, p24Fetch); }
    catch { config.reportP24Error?.({ event: 'p24_promotion_deactivation_failed' }); }
    try { await config.onP24Verified?.({ notification, parsed, order: current.order, p24Fetch }); }
    catch { config.reportP24Error?.({ event: 'p24_confirmation_failed' }); }
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
  if (!configured(config)) return json(503, { error: 'Przelewy24 nie jest skonfigurowane dla wybranego środowiska.' }, headers);
  const sessionId = new URL(request.url).searchParams.get('sessionId') || '';
  if (!parseP24SessionId(sessionId, config.p24.crc)) return json(400, { error: 'Nieprawidłowy identyfikator transakcji.' }, headers);
  try {
    const response = await p24Fetch(apiBase(config) + '/transaction/by/sessionId/' + encodeURIComponent(sessionId), {
      headers: { Authorization: auth(config) }, signal: AbortSignal.timeout(15000)
    });
    const result = await p24Json(response);
    if (!response.ok || result?.data?.sessionId !== sessionId) return json(502, { error: 'Nie udało się odczytać statusu transakcji.' }, headers);
    const status = Number(result.data.status);
    const labels = { 0: 'pending', 1: 'advance', 2: 'paid', 3: 'returned' };
    let stored = verifiedSessions.get(sessionId);
    if (status === 2 && stored?.verified !== true && Number.isSafeInteger(result.data.orderId) && result.data.orderId > 0 &&
        result.data.amount === parseP24SessionId(sessionId, config.p24.crc)?.amount && result.data.currency === 'PLN') {
      const recoveryPayload = {
        merchantId: config.p24.merchantId,
        posId: config.p24.posId,
        sessionId,
        amount: result.data.amount,
        currency: result.data.currency,
        orderId: result.data.orderId,
        sign: p24Sign({ sessionId, orderId: result.data.orderId, amount: result.data.amount, currency: result.data.currency, crc: config.p24.crc })
      };
      try {
        const recoveryResponse = await p24Fetch(apiBase(config) + '/transaction/verify', {
          method: 'PUT',
          headers: { Authorization: auth(config), 'Content-Type': 'application/json' },
          body: JSON.stringify(recoveryPayload),
          signal: AbortSignal.timeout(15000)
        });
        const recoveryResult = await p24Json(recoveryResponse);
        if (recoveryResponse.ok && recoveryResult?.data?.status === 'success') {
          stored = { ...(stored || {}), verified: true, orderId: result.data.orderId, updatedAt: Date.now() };
          verifiedSessions.set(sessionId, stored);
        }
      } catch {
        config.reportP24Error?.({ event: 'p24_status_recovery_failed' });
      }
    }
    const order = stored?.order;
    const body = {
      status: labels[status] || 'unknown',
      verified: stored?.verified === true,
      amount: result.data.amount,
      currency: result.data.currency
    };
    if (config.p24IncludeOrderData === true) Object.assign(body, {
      transactionId: Number.isSafeInteger(result.data.orderId) ? 'p24-' + result.data.orderId : sessionId,
      orderId: parseP24SessionId(sessionId, config.p24.crc)?.orderId || null,
      items: order?.items?.map((item, index) => ({
        item_id: 'axi-figurine-' + (index + 1),
        item_name: 'Personalizowana figurka ' + item.size + ' mm',
        price: getItemSubtotal(item.size, item.copies, order.items.length) / 100,
        quantity: item.copies
      })) || []
    });
    return json(200, body, headers);
  } catch {
    return json(502, { error: 'Nie udało się odczytać statusu transakcji.' }, headers);
  }
}

export function p24ReturnLocation(request, config) {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || '';
  const valid = configured(config) && parseP24SessionId(sessionId, config.p24.crc);
  return config.siteOrigin + (config.p24ResultPath || '/p24-test-result.html') + (valid ? '?sessionId=' + encodeURIComponent(sessionId) : '?error=invalid_session');
}
