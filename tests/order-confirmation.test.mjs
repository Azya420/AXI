import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildOrderEmail, handleStripeWebhook, verifyStripeSignature } from '../api/order-confirmation.mjs';

const orderId = '081d9e64-638e-4a29-882e-39f5212cf96b';
const session = {
  id: 'cs_live_ConfirmationFixture123',
  livemode: true,
  payment_status: 'paid',
  client_reference_id: orderId,
  customer_details: { email: 'jan@example.com' },
  created: 1788703200,
  amount_total: 11449,
  total_details: { amount_shipping: 1649 },
  metadata: {
    order_id: orderId,
    design_count: '1',
    customer_name: 'Jan Kowalski',
    delivery_destination: 'GLI01 — Rynek 1, Gliwice',
    shipping_method: 'locker',
    order_item_1: JSON.stringify({ size: 32, copies: 1, description: 'Rycerz z mieczem' })
  },
  line_items: { data: [{ amount_total: 9800, quantity: 1 }] }
};

function signed(body, secret, timestamp) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(String(timestamp) + '.' + body).digest('hex')}`;
}

test('Stripe signature requires the correct secret and a fresh timestamp', () => {
  const body = Buffer.from('{"id":"evt_test"}');
  const timestamp = 1788703200;
  const signature = signed(body, 'whsec_test', timestamp);
  assert.equal(verifyStripeSignature(body, signature, 'whsec_test', timestamp * 1000), true);
  assert.equal(verifyStripeSignature(body, signature, 'wrong', timestamp * 1000), false);
  assert.equal(verifyStripeSignature(body, signature, 'whsec_test', (timestamp + 301) * 1000), false);
});

test('confirmation contains the approved text and paid order totals', () => {
  const message = buildOrderEmail(session);
  assert.equal(message.to, 'jan@example.com');
  assert.match(message.subject, new RegExp(orderId));
  assert.match(message.text, /Cześć Jan,/);
  assert.match(message.text, /Nazwa\/opis: Rycerz z mieczem/);
  assert.match(message.text, /Wysokość figurki: 32 mm/);
  assert.match(message.text, /Cena: 98,00 zł/);
  assert.match(message.text, /Koszt dostawy: 16,49 zł/);
  assert.match(message.text, /Łącznie zapłacono: 114,49 zł/);
  assert.match(message.text, /w ciągu 3 dni roboczych/);
  assert.match(message.text, /w ciągu 5 dni roboczych/);
  assert.match(message.html, /AXI3D/);
});

test('paid live checkout sends one confirmation with the versioned terms attachment', async () => {
  const event = JSON.stringify({ id: 'evt_ConfirmationFixture123', type: 'checkout.session.completed', data: { object: { id: session.id, metadata: session.metadata } } });
  const timestamp = 1788703200;
  const sent = [];
  const config = {
    stripeKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', siteOrigin: 'https://axi3d.pl',
    smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'kontakt@axi3d.pl', pass: 'fixture', from: 'kontakt@axi3d.pl' }
  };
  const dependencies = {
    now: () => timestamp * 1000,
    stripeFetch: async () => Response.json(session),
    termsFetch: async url => { assert.equal(url, 'https://axi3d.pl/regulamin-2026-09-05.html'); return new Response('<html>Regulamin</html>'); },
    sendMail: async (message, attachment) => sent.push({ message, attachment })
  };
  const raw = Buffer.from(event);
  const result = await handleStripeWebhook(raw, signed(raw, config.webhookSecret, timestamp), config, dependencies);
  assert.deepEqual(result, { status: 200, body: 'Confirmation sent' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].attachment, /Regulamin/);
  const duplicate = await handleStripeWebhook(raw, signed(raw, config.webhookSecret, timestamp), config, dependencies);
  assert.deepEqual(duplicate, { status: 200, body: 'Already processed' });
  assert.equal(sent.length, 1);
});
