import { verifyStripePaymentDetails } from './checkout.mjs';

const MAX_BODY_BYTES = 4096;
const SESSION_ID = /^cs_test_[A-Za-z0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status, body, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function supabaseHeaders(key, extras = {}) {
  const headers = { apikey: key };
  // Nowe klucze sb_secret_* są kluczami API, nie JWT. Stary service_role
  // pozostaje obsługiwany podczas migracji istniejącego projektu.
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  return { ...headers, ...extras };
}

async function supabaseJson(url, options, supabaseFetch) {
  const response = await supabaseFetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  let body = null;
  try { body = await response.json(); } catch { /* Pusta odpowiedź jest poprawna dla części zapisów. */ }
  return { response, body };
}

async function authenticatedUser(request, config, supabaseFetch) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9._-]{20,})$/);
  if (!match) return null;
  const { response, body } = await supabaseJson(config.supabaseUrl + '/auth/v1/user', {
    method: 'GET',
    headers: { apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + match[1] }
  }, supabaseFetch);
  if (!response.ok || !UUID.test(body?.id || '') || !normalizedEmail(body?.email)) return null;
  return { id: body.id, email: normalizedEmail(body.email) };
}

function verifiedPreviewPayment(payment) {
  return payment.paid && payment.preview && payment.livemode === false &&
    SESSION_ID.test(payment.transactionId || '') && UUID.test(payment.orderId || '') &&
    normalizedEmail(payment.customerEmail) && Number.isInteger(payment.amountTotal) && payment.amountTotal >= 0;
}

async function existingOrder(config, orderNumber, supabaseFetch) {
  const query = new URLSearchParams({
    order_number: 'eq.' + orderNumber,
    select: 'id,order_number,user_id,customer_email,payment_reference'
  });
  const { response, body } = await supabaseJson(config.supabaseUrl + '/rest/v1/orders?' + query, {
    method: 'GET', headers: supabaseHeaders(config.supabaseSecretKey, { Accept: 'application/json' })
  }, supabaseFetch);
  if (!response.ok || !Array.isArray(body)) throw new Error('Supabase order lookup failed');
  return body[0] || null;
}

async function saveOrder(config, payment, user, supabaseFetch) {
  const current = await existingOrder(config, payment.orderId, supabaseFetch);
  const paymentEmail = normalizedEmail(payment.customerEmail);
  if (current?.user_id && current.user_id !== user.id) return { conflict: true };
  if (current && normalizedEmail(current.customer_email) !== paymentEmail) return { conflict: true };
  if (current?.payment_reference && current.payment_reference !== payment.transactionId) return { conflict: true };

  const record = {
    order_number: payment.orderId,
    user_id: user.id,
    customer_email: paymentEmail,
    customer_name: payment.customerName,
    title: 'Figurka na zamówienie',
    status: 'paid',
    status_message: 'Płatność testowa została potwierdzona.',
    amount_total: payment.amountTotal,
    currency: payment.currency,
    payment_provider: 'stripe_test',
    payment_reference: payment.transactionId,
    delivery_method: payment.deliveryMethod,
    delivery_destination: payment.deliveryDestination,
    ordered_at: payment.createdAt || new Date().toISOString()
  };
  const target = current
    ? config.supabaseUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(current.id)
    : config.supabaseUrl + '/rest/v1/orders';
  const { response, body } = await supabaseJson(target, {
    method: current ? 'PATCH' : 'POST',
    headers: supabaseHeaders(config.supabaseSecretKey, {
      'Content-Type': 'application/json', Prefer: 'return=representation'
    }),
    body: JSON.stringify(record)
  }, supabaseFetch);
  if (response.status === 409 && !current) {
    const raced = await existingOrder(config, payment.orderId, supabaseFetch);
    if (raced?.user_id === user.id && raced.payment_reference === payment.transactionId) return raced;
  }
  if (!response.ok || !Array.isArray(body) || !body[0]) throw new Error('Supabase order save failed');
  return body[0];
}

async function rememberCustomer(config, payment, user, supabaseFetch) {
  const profile = {
    customer_name: payment.customerName,
    phone: payment.phone,
    delivery_method: payment.deliveryMethod,
    delivery_destination: payment.deliveryDestination,
    saved_data_at: new Date().toISOString()
  };
  const { response } = await supabaseJson(config.supabaseUrl + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id), {
    method: 'PATCH',
    headers: supabaseHeaders(config.supabaseSecretKey, {
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    }),
    body: JSON.stringify(profile)
  }, supabaseFetch);
  if (!response.ok) throw new Error('Supabase profile save failed');
}

export async function handlePreviewOrderAccount(request, config, stripeFetch = fetch, supabaseFetch = fetch) {
  const origin = request.headers.get('Origin');
  if (origin !== config.backendOrigin) return json(403, { error: 'Niedozwolone źródło zapytania.' });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store', Vary: 'Origin'
    } });
  }
  if (request.method !== 'POST') return json(405, { error: 'Niedozwolona metoda.' }, origin);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json(415, { error: 'Wymagany format JSON.' }, origin);
  if (!config.stripeKey || !config.supabaseUrl || !config.supabasePublishableKey) {
    return json(503, { error: 'System kont nie jest jeszcze skonfigurowany.' }, origin);
  }

  let body;
  try { body = await readJson(request); } catch (error) {
    return json(error?.status === 413 ? 413 : 400, { error: 'Nieprawidłowe dane zapytania.' }, origin);
  }
  if (!['inspect', 'claim'].includes(body?.action) || !SESSION_ID.test(body?.sessionId || '')) {
    return json(400, { error: 'Nieprawidłowa sesja płatności.' }, origin);
  }

  let payment;
  try {
    payment = await verifyStripePaymentDetails(body.sessionId, { ...config, preview: true }, stripeFetch);
  } catch {
    return json(502, { error: 'Nie udało się potwierdzić płatności.' }, origin);
  }
  if (!verifiedPreviewPayment(payment)) return json(409, { error: 'Płatność testowa nie została potwierdzona.' }, origin);

  if (body.action === 'inspect') {
    return json(200, {
      paid: true,
      orderNumber: payment.orderId,
      customerEmail: normalizedEmail(payment.customerEmail),
      customerName: payment.customerName,
      amount: payment.amountTotal,
      currency: payment.currency
    }, origin);
  }

  if (!config.supabaseSecretKey || config.supabaseSecretKey === config.supabasePublishableKey) {
    return json(503, { error: 'Automatyczne przypisywanie zamówień nie jest jeszcze skonfigurowane.' }, origin);
  }
  let user;
  try { user = await authenticatedUser(request, config, supabaseFetch); } catch { user = null; }
  if (!user) return json(401, { error: 'Zaloguj się ponownie, aby przypisać zamówienie.' }, origin);
  if (user.email !== normalizedEmail(payment.customerEmail)) {
    return json(403, { error: 'E-mail konta musi być taki sam jak e-mail podany w zamówieniu.' }, origin);
  }

  try {
    const order = await saveOrder(config, payment, user, supabaseFetch);
    if (order?.conflict) return json(409, { error: 'To zamówienie jest już przypisane do innego konta.' }, origin);
    if (body.rememberData === true) await rememberCustomer(config, payment, user, supabaseFetch);
    return json(200, { claimed: true, orderNumber: payment.orderId, remembered: body.rememberData === true }, origin);
  } catch {
    return json(503, { error: 'Nie udało się teraz przypisać zamówienia. Spróbuj ponownie za chwilę.' }, origin);
  }
}
