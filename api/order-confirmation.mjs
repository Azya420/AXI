import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import tls from 'node:tls';
import { getDeliveryOption, getItemSubtotal } from '../pricing.mjs';
import { TERMS_VERSION } from './checkout.mjs';

const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_TERMS_BYTES = 500_000;
const processedEvents = new Set();

function safeEqualHex(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left || '') || !/^[0-9a-f]{64}$/i.test(right || '')) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, now = Date.now()) {
  if (!Buffer.isBuffer(rawBody) || !secret || typeof signatureHeader !== 'string') return false;
  const parts = signatureHeader.split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(String(timestamp)).update('.').update(rawBody).digest('hex');
  return signatures.some(signature => safeEqualHex(signature, expected));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function money(amount) {
  return (amount / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

function orderDate(timestamp) {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(timestamp * 1000));
}

function allocateAmounts(amounts, target) {
  const sourceTotal = amounts.reduce((sum, amount) => sum + amount, 0);
  if (sourceTotal === target) return amounts;
  if (sourceTotal <= 0) return amounts.map((_, index) => index === 0 ? target : 0);
  const exact = amounts.map(amount => amount * target / sourceTotal);
  const result = exact.map(Math.floor);
  let remainder = target - result.reduce((sum, amount) => sum + amount, 0);
  exact.map((amount, index) => ({ index, fraction: amount - result[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(entry => { if (remainder-- > 0) result[entry.index] += 1; });
  return result;
}

function readItems(metadata) {
  const count = Number(metadata.design_count);
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new Error('Invalid item count');
  return Array.from({ length: count }, (_, index) => {
    const item = JSON.parse(metadata['order_item_' + (index + 1)] || 'null');
    if (!item || !Number.isInteger(item.size) || !Number.isSafeInteger(item.copies) || item.copies < 1) throw new Error('Invalid item metadata');
    return { size: item.size, copies: item.copies, description: typeof item.description === 'string' && item.description ? item.description : 'Brak opisu' };
  });
}

function projectAmounts(session, items, figurinesTotal) {
  const lines = Array.isArray(session.line_items?.data) ? session.line_items.data : [];
  let lineIndex = 0;
  const raw = items.map(item => {
    let amount = Number(lines[lineIndex++]?.amount_total);
    if (!Number.isInteger(amount) || amount < 0) amount = getItemSubtotal(item.size, item.copies, items.length);
    if (item.copies > 1) {
      const copyAmount = Number(lines[lineIndex++]?.amount_total);
      amount += Number.isInteger(copyAmount) && copyAmount >= 0 ? copyAmount : 0;
    }
    return amount;
  });
  return allocateAmounts(raw, figurinesTotal);
}

export function buildOrderEmail(session) {
  const metadata = session.metadata || {};
  const items = readItems(metadata);
  const orderId = session.client_reference_id || metadata.order_id;
  const delivery = getDeliveryOption(metadata.shipping_method);
  const shippingAmount = Number(session.total_details?.amount_shipping);
  const total = Number(session.amount_total);
  if (!orderId || !delivery || !Number.isInteger(shippingAmount) || shippingAmount !== delivery.amount || !Number.isInteger(total) || total < shippingAmount) throw new Error('Invalid order totals');
  const figurinesTotal = total - shippingAmount;
  const amounts = projectAmounts(session, items, figurinesTotal);
  const customerName = metadata.customer_name || 'Kliencie';
  const firstName = customerName.trim().split(/\s+/)[0] || 'Kliencie';
  const destinationLabel = metadata.shipping_method === 'locker' ? 'Paczkomat' : 'Adres';
  const destination = metadata.delivery_destination;
  const email = session.customer_details?.email || session.customer_email;
  if (!email || !destination || !Number.isSafeInteger(session.created)) throw new Error('Missing confirmation data');

  const projectsText = items.map((item, index) => [
    'Projekt ' + (index + 1),
    'Nazwa/opis: ' + item.description,
    'Wysokość figurki: ' + item.size + ' mm',
    'Liczba identycznych wydruków: ' + item.copies,
    'Cena: ' + money(amounts[index])
  ].join('\n')).join('\n\n');
  const text = `Cześć ${firstName},

dziękujemy za złożenie i opłacenie zamówienia w AXI3D. Poniżej znajdziesz jego podsumowanie.

ZAMÓWIENIE #${orderId}
Data zawarcia umowy: ${orderDate(session.created)}

TWOJE PROJEKTY

${projectsText}

DOSTAWA

Sposób dostawy: ${delivery.displayName}
${destinationLabel}: ${destination}
Koszt dostawy: ${money(shippingAmount)}

PODSUMOWANIE

Figurki: ${money(figurinesTotal)}
Dostawa: ${money(shippingAmount)}
Łącznie zapłacono: ${money(total)}

CO DALEJ?

Przygotujemy model poglądowy postaci i prześlemy go do akceptacji w ciągu 3 dni roboczych.

Od momentu przesłania modelu masz 3 dni na przekazanie uwag. Zamówienie obejmuje jedną bezpłatną rundę poprawek. Jeśli nie otrzymamy odpowiedzi w tym terminie, figurka zostanie wydrukowana w przedstawionej formie.

Po akceptacji modelu, upływie terminu na odpowiedź albo zakończeniu bezpłatnej rundy poprawek figurka będzie gotowa do wysyłki w ciągu 5 dni roboczych.

W załączniku znajdziesz regulamin obowiązujący w dniu złożenia zamówienia. Zachowaj tę wiadomość jako potwierdzenie zawarcia umowy.

Masz pytania dotyczące zamówienia? Napisz na kontakt@axi3d.pl lub zadzwoń pod numer 517 703 886.

Pozdrawiamy
AXI3D`;

  const projectsHtml = items.map((item, index) => `<div style="padding:16px 0;border-bottom:1px solid #eadff2">
    <h3 style="margin:0 0 10px;color:#542077">Projekt ${index + 1}</h3>
    <p style="margin:4px 0"><strong>Nazwa/opis:</strong> ${escapeHtml(item.description)}</p>
    <p style="margin:4px 0"><strong>Wysokość figurki:</strong> ${item.size} mm</p>
    <p style="margin:4px 0"><strong>Liczba identycznych wydruków:</strong> ${item.copies}</p>
    <p style="margin:4px 0"><strong>Cena:</strong> ${escapeHtml(money(amounts[index]))}</p>
  </div>`).join('');
  const sectionTitle = title => `<h2 style="font-size:16px;letter-spacing:.08em;margin:28px 0 8px;color:#542077">${title}</h2>`;
  const html = `<!doctype html><html lang="pl"><body style="margin:0;background:#f5f1f8;font-family:Arial,sans-serif;color:#24172d">
  <div style="max-width:640px;margin:0 auto;padding:24px 14px"><div style="background:#fff;border-radius:14px;padding:30px;box-shadow:0 8px 30px rgba(45,20,65,.08)">
    <div style="font-size:28px;font-weight:800;color:#542077;margin-bottom:24px">AXI3D</div>
    <p>Cześć ${escapeHtml(firstName)},</p>
    <p>dziękujemy za złożenie i opłacenie zamówienia w AXI3D. Poniżej znajdziesz jego podsumowanie.</p>
    ${sectionTitle('ZAMÓWIENIE #' + escapeHtml(orderId))}
    <p><strong>Data zawarcia umowy:</strong> ${escapeHtml(orderDate(session.created))}</p>
    ${sectionTitle('TWOJE PROJEKTY')}${projectsHtml}
    ${sectionTitle('DOSTAWA')}
    <p><strong>Sposób dostawy:</strong> ${escapeHtml(delivery.displayName)}<br><strong>${destinationLabel}:</strong> ${escapeHtml(destination)}<br><strong>Koszt dostawy:</strong> ${escapeHtml(money(shippingAmount))}</p>
    ${sectionTitle('PODSUMOWANIE')}
    <div style="background:#f5f1f8;border-left:4px solid #542077;padding:14px 16px;border-radius:6px">
      Figurki: ${escapeHtml(money(figurinesTotal))}<br>Dostawa: ${escapeHtml(money(shippingAmount))}<br><strong>Łącznie zapłacono: ${escapeHtml(money(total))}</strong>
    </div>
    ${sectionTitle('CO DALEJ?')}
    <p>Przygotujemy model poglądowy postaci i prześlemy go do akceptacji w ciągu 3 dni roboczych.</p>
    <p>Od momentu przesłania modelu masz 3 dni na przekazanie uwag. Zamówienie obejmuje jedną bezpłatną rundę poprawek. Jeśli nie otrzymamy odpowiedzi w tym terminie, figurka zostanie wydrukowana w przedstawionej formie.</p>
    <p>Po akceptacji modelu, upływie terminu na odpowiedź albo zakończeniu bezpłatnej rundy poprawek figurka będzie gotowa do wysyłki w ciągu 5 dni roboczych.</p>
    <p>W załączniku znajdziesz regulamin obowiązujący w dniu złożenia zamówienia. Zachowaj tę wiadomość jako potwierdzenie zawarcia umowy.</p>
    <p>Masz pytania dotyczące zamówienia? Napisz na <a href="mailto:kontakt@axi3d.pl" style="color:#542077">kontakt@axi3d.pl</a> lub zadzwoń pod numer 517 703 886.</p>
    <p style="margin-top:28px">Pozdrawiamy<br><strong>AXI3D</strong></p>
  </div></div></body></html>`;
  return { to: email, subject: 'Potwierdzenie zamówienia AXI3D — #' + orderId, text, html };
}

function base64Lines(value) {
  return Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodedHeader(value) {
  return '=?UTF-8?B?' + Buffer.from(value).toString('base64') + '?=';
}

class SmtpResponses {
  constructor(socket) {
    this.queue = [];
    this.waiters = [];
    this.current = [];
    this.buffer = '';
    socket.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline + 1).replace(/\r?\n$/, '');
        this.buffer = this.buffer.slice(newline + 1);
        this.current.push(line);
        if (/^\d{3} /.test(line)) {
          const response = { code: Number(line.slice(0, 3)), text: this.current.join('\n') };
          this.current = [];
          const waiter = this.waiters.shift();
          if (waiter) waiter.resolve(response); else this.queue.push(response);
        }
      }
    });
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }
  fail(error) {
    this.waiters.splice(0).forEach(waiter => waiter.reject(error));
  }
  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

export async function sendSmtpMail(message, attachment, smtp) {
  if (smtp.secure !== true) throw new Error('Only secure SMTP is supported');
  const socket = tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host, rejectUnauthorized: true });
  socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP timeout')));
  const responses = new SmtpResponses(socket);
  await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
  const expect = async (command, code) => {
    if (command !== null) socket.write(command + '\r\n');
    const response = await responses.next();
    if (response.code !== code) throw new Error('SMTP rejected request: ' + response.code);
  };
  try {
    await expect(null, 220);
    await expect('EHLO axi3d.pl', 250);
    await expect('AUTH LOGIN', 334);
    await expect(Buffer.from(smtp.user).toString('base64'), 334);
    await expect(Buffer.from(smtp.pass).toString('base64'), 235);
    await expect('MAIL FROM:<' + smtp.from + '>', 250);
    await expect('RCPT TO:<' + message.to + '>', 250);
    await expect('DATA', 354);
    const mixed = 'axi-mixed-' + randomUUID();
    const alternative = 'axi-alt-' + randomUUID();
    const mime = [
      'From: ' + encodedHeader('AXI3D') + ' <' + smtp.from + '>',
      'To: <' + message.to + '>',
      'Subject: ' + encodedHeader(message.subject),
      'Date: ' + new Date().toUTCString(),
      'Message-ID: <' + randomUUID() + '@axi3d.pl>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + mixed + '"', '',
      '--' + mixed,
      'Content-Type: multipart/alternative; boundary="' + alternative + '"', '',
      '--' + alternative,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64', '', base64Lines(message.text), '',
      '--' + alternative,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64', '', base64Lines(message.html), '',
      '--' + alternative + '--', '',
      '--' + mixed,
      'Content-Type: text/html; charset=UTF-8; name="Regulamin-AXI3D-' + TERMS_VERSION + '.html"',
      'Content-Disposition: attachment; filename="Regulamin-AXI3D-' + TERMS_VERSION + '.html"',
      'Content-Transfer-Encoding: base64', '', base64Lines(attachment), '',
      '--' + mixed + '--', ''
    ].join('\r\n').replace(/^\./gm, '..');
    socket.write(mime + '\r\n.\r\n');
    const sent = await responses.next();
    if (sent.code !== 250) throw new Error('SMTP rejected message: ' + sent.code);
    await expect('QUIT', 221);
  } finally {
    socket.end();
  }
}

async function fetchTerms(siteOrigin, termsFetch) {
  const response = await termsFetch(siteOrigin + '/regulamin-' + TERMS_VERSION + '.html', { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Terms unavailable');
  const content = await response.text();
  if (!content || Buffer.byteLength(content) > MAX_TERMS_BYTES) throw new Error('Invalid terms attachment');
  return content;
}

export async function handleStripeWebhook(rawBody, signatureHeader, config, dependencies = {}) {
  if (!config.webhookSecret || !config.stripeKey || !config.smtp?.pass) return { status: 503, body: 'Webhook not configured' };
  if (!verifyStripeSignature(rawBody, signatureHeader, config.webhookSecret, dependencies.now?.() ?? Date.now())) return { status: 400, body: 'Invalid signature' };
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { status: 400, body: 'Invalid payload' }; }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return { status: 200, body: 'Ignored' };
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id || '') || processedEvents.has(event.id)) return { status: 200, body: 'Already processed' };
  const eventSession = event.data?.object;
  if (!/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(eventSession?.id || '') || eventSession?.metadata?.preview === 'true') return { status: 200, body: 'Ignored' };
  const stripeFetch = dependencies.stripeFetch || fetch;
  const response = await stripeFetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(eventSession.id) + '?expand[]=line_items', {
    headers: { Authorization: 'Bearer ' + config.stripeKey }, signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error('Stripe session unavailable');
  const session = await response.json();
  if (session.id !== eventSession.id || session.payment_status !== 'paid' || session.livemode !== true) return { status: 200, body: 'Payment not eligible' };
  const message = buildOrderEmail(session);
  const attachment = await fetchTerms(config.siteOrigin, dependencies.termsFetch || fetch);
  await (dependencies.sendMail || sendSmtpMail)(message, attachment, config.smtp);
  processedEvents.add(event.id);
  if (processedEvents.size > 1000) processedEvents.delete(processedEvents.values().next().value);
  return { status: 200, body: 'Confirmation sent' };
}
