import { handleP24Status, parseP24SessionId } from './p24-sandbox.mjs';

const MAX_BODY_BYTES = 4096;
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

function validPrivateConfig(config) {
  return Boolean(config?.supabaseUrl && config?.supabasePublishableKey && config?.supabaseSecretKey &&
    config.supabaseSecretKey !== config.supabasePublishableKey);
}

function supabaseHeaders(key, extras = {}) {
  const headers = { apikey: key };
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

async function orderByPaymentReference(config, sessionId, supabaseFetch) {
  const query = new URLSearchParams({
    payment_reference: 'eq.' + sessionId,
    select: 'id,order_number,user_id,customer_email,customer_name,customer_phone,status,amount_total,currency,payment_provider,payment_reference,delivery_method,delivery_destination,ordered_at'
  });
  const { response, body } = await supabaseJson(config.supabaseUrl + '/rest/v1/orders?' + query, {
    method: 'GET', headers: supabaseHeaders(config.supabaseSecretKey, { Accept: 'application/json' })
  }, supabaseFetch);
  if (!response.ok || !Array.isArray(body)) throw new Error('Supabase order lookup failed');
  return body[0] || null;
}

async function writeOrder(config, target, method, record, supabaseFetch) {
  return supabaseJson(target, {
    method,
    headers: supabaseHeaders(config.supabaseSecretKey, {
      'Content-Type': 'application/json', Prefer: 'return=representation'
    }),
    body: JSON.stringify(record)
  }, supabaseFetch);
}

export async function savePendingP24Order(prepared, config, supabaseFetch = fetch) {
  if (!validPrivateConfig(config)) throw new Error('Supabase private configuration missing');
  const { sessionId, order, amount, currency, environment } = prepared || {};
  const parsed = parseP24SessionId(sessionId, config.p24?.crc);
  if (!parsed || parsed.orderId !== order?.orderId || parsed.amount !== amount || environment !== 'sandbox') {
    throw new Error('Invalid P24 order');
  }
  const existing = await orderByPaymentReference(config, sessionId, supabaseFetch);
  if (existing?.user_id || (existing && existing.order_number !== order.orderId)) throw new Error('Order conflict');
  const record = {
    order_number: order.orderId,
    user_id: null,
    customer_email: normalizedEmail(order.email),
    customer_name: order.customerName,
    customer_phone: order.phone,
    title: 'Figurka na zamówienie',
    status: 'new',
    status_message: 'Oczekuje na potwierdzenie płatności testowej.',
    amount_total: amount,
    currency,
    payment_provider: 'przelewy24_sandbox',
    payment_reference: sessionId,
    delivery_method: order.deliveryMethod,
    delivery_destination: order.deliveryDestination
  };
  const target = existing
    ? config.supabaseUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(existing.id)
    : config.supabaseUrl + '/rest/v1/orders';
  const { response, body } = await writeOrder(config, target, existing ? 'PATCH' : 'POST', record, supabaseFetch);
  if (!response.ok || !Array.isArray(body) || !body[0]) throw new Error('Supabase pending order save failed');
  return body[0];
}

export async function markP24OrderPaid(sessionId, config, supabaseFetch = fetch) {
  if (!validPrivateConfig(config)) throw new Error('Supabase private configuration missing');
  const existing = await orderByPaymentReference(config, sessionId, supabaseFetch);
  if (!existing) throw new Error('Pending order missing');
  if (existing.status === 'paid') return existing;
  const { response, body } = await writeOrder(
    config,
    config.supabaseUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(existing.id),
    'PATCH',
    { status: 'paid', status_message: 'Płatność testowa Przelewy24 została potwierdzona.' },
    supabaseFetch
  );
  if (!response.ok || !Array.isArray(body) || !body[0]) throw new Error('Supabase paid order update failed');
  return body[0];
}

async function verifiedP24Order(sessionId, config, p24Config, p24Fetch, supabaseFetch) {
  const parsed = parseP24SessionId(sessionId, p24Config?.p24?.crc);
  if (!parsed) return { invalid: true };
  const statusRequest = new Request(config.backendOrigin + '/preview/p24/status?sessionId=' + encodeURIComponent(sessionId), {
    method: 'GET', headers: { Origin: config.backendOrigin }
  });
  const statusResponse = await handleP24Status(statusRequest, p24Config, p24Fetch);
  let status = {};
  try { status = await statusResponse.json(); } catch { /* Obsłużone niżej. */ }
  if (!statusResponse.ok) throw new Error('P24 status unavailable');
  if (status.status !== 'paid' || status.verified !== true || status.amount !== parsed.amount || status.currency !== 'PLN') {
    return { pending: true };
  }
  const order = await markP24OrderPaid(sessionId, config, supabaseFetch);
  if (order.order_number !== parsed.orderId || order.amount_total !== parsed.amount || order.payment_provider !== 'przelewy24_sandbox') {
    throw new Error('Stored order mismatch');
  }
  return { order };
}

async function claimOrder(config, order, user, supabaseFetch) {
  if (order.user_id && order.user_id !== user.id) return { conflict: true };
  if (normalizedEmail(order.customer_email) !== user.email) return { emailMismatch: true };
  if (order.user_id === user.id) return order;
  const { response, body } = await writeOrder(
    config,
    config.supabaseUrl + '/rest/v1/orders?id=eq.' + encodeURIComponent(order.id),
    'PATCH',
    { user_id: user.id, status: 'paid', status_message: 'Płatność testowa Przelewy24 została potwierdzona.' },
    supabaseFetch
  );
  if (!response.ok || !Array.isArray(body) || !body[0]) throw new Error('Supabase order claim failed');
  return body[0];
}

async function rememberCustomer(config, order, user, supabaseFetch) {
  const profile = {
    customer_name: order.customer_name,
    phone: order.customer_phone,
    delivery_method: order.delivery_method,
    delivery_destination: order.delivery_destination,
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

export async function handlePreviewOrderAccount(request, config, p24Config, p24Fetch = fetch, supabaseFetch = fetch) {
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
  if (!validPrivateConfig(config)) return json(503, { error: 'System kont nie jest jeszcze skonfigurowany.' }, origin);

  let body;
  try { body = await readJson(request); } catch (error) {
    return json(error?.status === 413 ? 413 : 400, { error: 'Nieprawidłowe dane zapytania.' }, origin);
  }
  if (!['inspect', 'claim'].includes(body?.action) || !parseP24SessionId(body?.sessionId, p24Config?.p24?.crc)) {
    return json(400, { error: 'Nieprawidłowa sesja płatności Przelewy24.' }, origin);
  }

  let verified;
  try { verified = await verifiedP24Order(body.sessionId, config, p24Config, p24Fetch, supabaseFetch); }
  catch { return json(502, { error: 'Nie udało się potwierdzić płatności Przelewy24.' }, origin); }
  if (verified.invalid) return json(400, { error: 'Nieprawidłowa sesja płatności Przelewy24.' }, origin);
  if (verified.pending) return json(409, { error: 'Płatność testowa Przelewy24 nie została jeszcze potwierdzona.' }, origin);
  const order = verified.order;

  if (body.action === 'inspect') {
    return json(200, {
      paid: true,
      orderNumber: order.order_number,
      customerEmail: normalizedEmail(order.customer_email),
      customerName: order.customer_name,
      amount: order.amount_total,
      currency: order.currency
    }, origin);
  }

  let user;
  try { user = await authenticatedUser(request, config, supabaseFetch); } catch { user = null; }
  if (!user) return json(401, { error: 'Zaloguj się ponownie, aby przypisać zamówienie.' }, origin);
  if (user.email !== normalizedEmail(order.customer_email)) {
    return json(403, { error: 'E-mail konta musi być taki sam jak e-mail podany w zamówieniu.' }, origin);
  }

  try {
    const claimed = await claimOrder(config, order, user, supabaseFetch);
    if (claimed?.conflict) return json(409, { error: 'To zamówienie jest już przypisane do innego konta.' }, origin);
    if (claimed?.emailMismatch) return json(403, { error: 'E-mail konta musi być taki sam jak e-mail podany w zamówieniu.' }, origin);
    if (body.rememberData === true) await rememberCustomer(config, order, user, supabaseFetch);
    return json(200, { claimed: true, orderNumber: order.order_number, remembered: body.rememberData === true }, origin);
  } catch {
    return json(503, { error: 'Nie udało się teraz przypisać zamówienia. Spróbuj ponownie za chwilę.' }, origin);
  }
}
