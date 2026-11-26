// Wyłącznie dla ukrytej strony z techniczną, prawdziwą płatnością 1,50 zł.
window.AXI_PREVIEW_MODE = true;
window.AXI_P24_TEST_MODE = true;
window.AXI_P24_TEST_SUBMIT = true;
window.AXI_P24_LIVE_TEST_MODE = true;
window.AXI_CHECKOUT_ENDPOINT = 'https://axi-checkout.onrender.com/p24-live-test/register';

window.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('p24-access-status');
  if (!status) return;
  try {
    const response = await fetch('https://axi-checkout.onrender.com/p24-live-test/access', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('access rejected');
    const data = await response.json();
    if (data.ok !== true || data.environment !== 'production') throw new Error('invalid response');
    status.textContent = 'Połączenie produkcyjne działa. Zapłacisz prawdziwe 1,50 zł; zgłoszenie będzie oznaczone TEST LIVE — NIE REALIZOWAĆ.';
  } catch {
    status.textContent = 'Brak połączenia produkcyjnego. Nie rozpoczynaj płatności — sprawdź wdrożenie Render i zmienne P24_LIVE.';
  }
});
