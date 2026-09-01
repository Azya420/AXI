(function(win, doc){
  'use strict';
  var GA_ID = 'G-M3L9ZPRGMB';
  var META_PIXEL_ID = '1665983241581980';
  var CONSENT_KEY = 'cookie-consent-v3';
  var loaded = false;

  function loadGoogleAnalytics(){
    var script = doc.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    doc.head.appendChild(script);
    win.dataLayer = win.dataLayer || [];
    function gtag(){ win.dataLayer.push(arguments); }
    win.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  function loadMetaPixel(){
    if (win.fbq) return;
    var fbq = win.fbq = function(){
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    if (!win._fbq) win._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    var script = doc.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    var firstScript = doc.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else doc.head.appendChild(script);
    fbq('init', META_PIXEL_ID);
    fbq('track', 'PageView');
  }

  function enableTracking(){
    if (loaded) return;
    loaded = true;
    loadGoogleAnalytics();
    loadMetaPixel();
    win.dispatchEvent(new CustomEvent('axi-tracking-ready'));
  }

  function trackMeta(name, parameters, options){
    if (typeof win.fbq !== 'function') return false;
    win.fbq('track', name, parameters || {}, options || {});
    return true;
  }

  win.AXI_TRACKING = {
    consentKey: CONSENT_KEY,
    metaPixelId: META_PIXEL_ID,
    enable: enableTracking,
    trackMeta: trackMeta,
    hasConsent: function(){ return win.localStorage.getItem(CONSENT_KEY) === 'accepted'; }
  };

  doc.addEventListener('DOMContentLoaded', function(){
    var consent = win.localStorage.getItem(CONSENT_KEY);
    var banner = doc.getElementById('cookie-banner');
    doc.querySelectorAll('[data-cookie-settings]').forEach(function(button){
      button.addEventListener('click', function(event){
        event.preventDefault();
        banner?.classList.add('active');
      });
    });
    doc.getElementById('cookie-accept')?.addEventListener('click', function(){
      win.localStorage.setItem(CONSENT_KEY, 'accepted');
      banner.classList.remove('active');
      enableTracking();
    });
    doc.getElementById('cookie-decline')?.addEventListener('click', function(){
      win.localStorage.setItem(CONSENT_KEY, 'declined');
      banner.classList.remove('active');
      if (loaded) win.location.reload();
    });
    if (consent === 'accepted') {
      enableTracking();
      return;
    }
    if (consent === 'declined') return;
    if (!banner) return;
    banner.classList.add('active');
  });
})(window, document);
