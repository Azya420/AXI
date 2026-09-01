import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../tracking.js', import.meta.url), 'utf8');

async function setup(consent) {
  const dom = new JSDOM(`<!doctype html><html><head><script id="seed"></script></head><body>
    <div id="cookie-banner"><button id="cookie-decline">Tylko niezbędne</button><button id="cookie-accept">Akceptuję</button></div>
    <button data-cookie-settings>Ustawienia cookies</button>
  </body></html>`, { url: 'https://axi3d.pl/', runScripts: 'outside-only' });
  if (consent) dom.window.localStorage.setItem('cookie-consent-v3', consent);
  dom.window.eval(source);
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  return dom;
}

test('Meta and GA stay disabled until explicit v3 consent', async () => {
  const dom = await setup();
  const { document, localStorage } = dom.window;
  assert.ok(document.getElementById('cookie-banner').classList.contains('active'));
  assert.equal(dom.window.fbq, undefined);
  assert.equal(dom.window.gtag, undefined);
  document.getElementById('cookie-decline').click();
  assert.equal(localStorage.getItem('cookie-consent-v3'), 'declined');
  assert.equal(document.querySelector('script[src*="facebook"]'), null);
  assert.equal(document.querySelector('script[src*="googletagmanager"]'), null);
  dom.window.close();
});

test('accepting consent loads both trackers and initializes the requested Pixel', async () => {
  const dom = await setup();
  const { document, localStorage } = dom.window;
  document.getElementById('cookie-accept').click();
  assert.equal(localStorage.getItem('cookie-consent-v3'), 'accepted');
  assert.match(document.querySelector('script[src*="facebook"]')?.src || '', /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(document.querySelector('script[src*="googletagmanager"]')?.src || '', /G-M3L9ZPRGMB/);
  assert.equal(dom.window.AXI_TRACKING.metaPixelId, '1665983241581980');
  const calls = dom.window.fbq.queue.map(call => Array.from(call));
  assert.equal(JSON.stringify(calls.slice(0, 2)), JSON.stringify([['init', '1665983241581980'], ['track', 'PageView']]));
  assert.equal(dom.window.AXI_TRACKING.trackMeta('Lead', { value: 98, currency: 'PLN' }, { eventID: 'fixture-lead' }), true);
  assert.equal(JSON.stringify(Array.from(dom.window.fbq.queue.at(-1))), JSON.stringify(['track', 'Lead', { value: 98, currency: 'PLN' }, { eventID: 'fixture-lead' }]));
  dom.window.close();
});

test('stored marketing consent enables trackers on the next page', async () => {
  const dom = await setup('accepted');
  assert.equal(typeof dom.window.gtag, 'function');
  assert.equal(typeof dom.window.fbq, 'function');
  assert.ok(!dom.window.document.getElementById('cookie-banner').classList.contains('active'));
  dom.window.document.querySelector('[data-cookie-settings]').click();
  assert.ok(dom.window.document.getElementById('cookie-banner').classList.contains('active'));
  dom.window.close();
});

test('a visitor can reopen settings and accept after previously declining', async () => {
  const dom = await setup('declined');
  const { document, localStorage } = dom.window;
  document.querySelector('[data-cookie-settings]').click();
  assert.ok(document.getElementById('cookie-banner').classList.contains('active'));
  document.getElementById('cookie-accept').click();
  assert.equal(localStorage.getItem('cookie-consent-v3'), 'accepted');
  assert.equal(typeof dom.window.fbq, 'function');
  dom.window.close();
});
