(() => {
  const statusBox = document.getElementById('payment-status');
  const details = document.getElementById('payment-details');
  const title = document.getElementById('result-title');
  const message = document.getElementById('result-message');
  const livePaymentTest = window.AXI_P24_LIVE_RESULT === true;
  const statusEndpoint = window.AXI_P24_STATUS_ENDPOINT || 'https://axi-checkout.onrender.com/p24-test/status';
  const expectedAmount = Number.isSafeInteger(window.AXI_P24_EXPECTED_AMOUNT) ? window.AXI_P24_EXPECTED_AMOUNT : null;
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId') || '';
  if (!/^axitest\.[0-9a-f-]{36}\.\d{2,9}\.[0-9a-f]{24}$/i.test(sessionId)) {
    title.textContent = 'Nie udało się potwierdzić zamówienia';
    message.textContent = 'Wróć do formularza testowego i spróbuj ponownie.';
    statusBox.className = 'status error';
    statusBox.textContent = 'Nieprawidłowy identyfikator transakcji testowej.';
    return;
  }
  let attempts = 0;
  const check = async () => {
    attempts += 1;
    try {
      const response = await fetch(statusEndpoint + '?sessionId=' + encodeURIComponent(sessionId), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('status unavailable');
      const data = await response.json();
      if (data.status === 'paid' && data.verified === true) {
        if (expectedAmount !== null && data.amount !== expectedAmount) throw new Error('unexpected amount');
        title.textContent = 'Dziękujemy za zamówienie!';
        message.textContent = livePaymentTest
          ? 'Zgłoszenie testowe zostało wysłane, a prawdziwa płatność 1,50 zł została poprawnie zakończona i zweryfikowana.'
          : 'Zgłoszenie testowe zostało wysłane, a płatność w sandboxie Przelewy24 została poprawnie zakończona.';
        statusBox.className = 'status ok';
        statusBox.textContent = 'Płatność testowa została opłacona i zweryfikowana.';
        details.textContent = 'Kwota testowa: ' + (data.amount / 100).toFixed(2).replace('.', ',') + ' ' + data.currency;
        return;
      }
      if (data.status === 'returned') {
        title.textContent = 'Płatność została zwrócona';
        message.textContent = 'Testowe zamówienie nie zostało potwierdzone.';
        statusBox.className = 'status error';
        statusBox.textContent = 'Transakcja testowa została zwrócona.';
        return;
      }
      statusBox.className = 'status wait';
      title.textContent = 'Sprawdzamy płatność…';
      statusBox.textContent = data.status === 'paid'
        ? 'Płatność dotarła. Czekamy jeszcze na potwierdzenie weryfikacji…'
        : 'Płatność nie jest jeszcze potwierdzona. Ponawiam sprawdzenie…';
      if (attempts < 12) setTimeout(check, 2500);
      else statusBox.textContent = 'Status nie został jeszcze potwierdzony. Odśwież stronę za chwilę.';
    } catch {
      statusBox.className = 'status error';
      statusBox.textContent = 'Nie udało się sprawdzić statusu. Sprawdź wdrożenie backendu na Renderze.';
    }
  };
  check();
})();
