(() => {
  const statusBox = document.getElementById('payment-status');
  const details = document.getElementById('payment-details');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId') || '';
  if (!/^axitest\.[0-9a-f-]{36}\.\d{2,9}\.[0-9a-f]{24}$/i.test(sessionId)) {
    statusBox.className = 'status error';
    statusBox.textContent = 'Nieprawidłowy identyfikator transakcji testowej.';
    return;
  }
  let attempts = 0;
  const check = async () => {
    attempts += 1;
    try {
      const response = await fetch('https://axi-checkout.onrender.com/p24-test/status?sessionId=' + encodeURIComponent(sessionId), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('status unavailable');
      const data = await response.json();
      if (data.status === 'paid' && data.verified === true) {
        statusBox.className = 'status ok';
        statusBox.textContent = 'Sukces: płatność testowa została opłacona i zweryfikowana przez backend.';
        details.textContent = 'Kwota testowa: ' + (data.amount / 100).toFixed(2).replace('.', ',') + ' ' + data.currency;
        return;
      }
      if (data.status === 'returned') {
        statusBox.className = 'status error';
        statusBox.textContent = 'Transakcja testowa została zwrócona.';
        return;
      }
      statusBox.className = 'status wait';
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
