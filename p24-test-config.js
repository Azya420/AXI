// Wyłącznie dla ukrytej strony testowej. Produkcyjny formularz nadal używa checkout-config.js i Stripe.
window.AXI_PREVIEW_MODE = true;
window.AXI_P24_TEST_MODE = true;
window.AXI_CHECKOUT_ENDPOINT = 'https://axi-checkout.onrender.com/p24-test/register';

window.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('p24-access-status');
  if (!status) return;
  try {
    const response = await fetch('https://axi-checkout.onrender.com/p24-test/access', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('access rejected');
    const data = await response.json();
    if (data.ok !== true || data.environment !== 'sandbox') throw new Error('invalid response');
    status.textContent = 'Połączenie z sandboxem działa. Formularz nie wysyła zgłoszenia do realizacji.';
  } catch {
    status.textContent = 'Brak połączenia z sandboxem. Sprawdź wdrożenie Render i zmienne P24.';
  }
});
