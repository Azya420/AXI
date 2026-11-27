import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

const config = window.AXI_SUPABASE;
const byId = id => document.getElementById(id);
const elements = {
  paymentSpinner: byId('payment-spinner'), paymentTitle: byId('payment-title'), paymentMessage: byId('payment-message'),
  orderSummary: byId('order-summary'), orderNumber: byId('order-number'), orderAmount: byId('order-amount'), paymentActions: byId('payment-actions'),
  accountCard: byId('account-card'), accountStatus: byId('account-status'), authArea: byId('auth-area'), successActions: byId('success-actions'),
  registerTab: byId('register-tab'), loginTab: byId('login-tab'), registerPanel: byId('register-panel'), loginPanel: byId('login-panel'),
  registerForm: byId('register-form'), loginForm: byId('login-form')
};
const sessionId = new URLSearchParams(location.search).get('session_id') || '';
let order = null;
let supabase = null;

function validConfig(value) {
  try { return value?.url && new URL(value.url).hostname.endsWith('.supabase.co') && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value.publishableKey); } catch { return false; }
}
function setStatus(message, type = '') {
  elements.accountStatus.textContent = message;
  elements.accountStatus.className = 'status' + (type ? ' ' + type : '');
  elements.accountStatus.hidden = !message;
}
function setBusy(form, busy) {
  for (const control of form.elements) control.disabled = busy || control.readOnly;
}
function showTab(name) {
  const register = name === 'register';
  elements.registerTab.setAttribute('aria-selected', String(register));
  elements.loginTab.setAttribute('aria-selected', String(!register));
  elements.registerPanel.hidden = !register;
  elements.loginPanel.hidden = register;
  setStatus('');
}
function passwordError(password) {
  if (password.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
  if (!/[a-z]/.test(password)) return 'Hasło musi zawierać małą literę.';
  if (!/[A-Z]/.test(password)) return 'Hasło musi zawierać wielką literę.';
  if (!/[0-9]/.test(password)) return 'Hasło musi zawierać cyfrę.';
  return '';
}
function friendlyError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.';
  if (message.includes('user already registered')) return 'Konto z tym adresem już istnieje. Wybierz „Mam już konto”.';
  if (message.includes('rate limit') || message.includes('too many')) return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  return 'Nie udało się wykonać tej operacji. Spróbuj ponownie.';
}
async function api(body, accessToken = '') {
  const response = await fetch('/preview/order-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Nie udało się wykonać operacji.');
  return data;
}
async function claim(session, rememberData) {
  setStatus('Przypisujemy zamówienie do konta…');
  const result = await api({ action: 'claim', sessionId, rememberData }, session.access_token);
  elements.authArea.hidden = true;
  elements.successActions.hidden = false;
  setStatus(result.remembered ? 'Zamówienie przypisano do konta, a dane zapisano na przyszłość.' : 'Zamówienie przypisano do konta.', 'success');
}
async function inspectPayment() {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('Brakuje prawidłowego identyfikatora płatności testowej.');
  order = await api({ action: 'inspect', sessionId });
  elements.paymentSpinner.hidden = true;
  elements.paymentTitle.textContent = 'Zamówienie zostało przyjęte';
  elements.paymentMessage.textContent = 'Płatność testowa została potwierdzona. Teraz możesz dodać zamówienie do konta klienta.';
  elements.orderNumber.textContent = order.orderNumber;
  elements.orderAmount.textContent = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: order.currency }).format(order.amount / 100);
  elements.orderSummary.hidden = false;
  elements.registerForm.elements.email.value = order.customerEmail;
  elements.loginForm.elements.email.value = order.customerEmail;
  elements.accountCard.hidden = false;
}

elements.registerTab.addEventListener('click', () => showTab('register'));
elements.loginTab.addEventListener('click', () => showTab('login'));

elements.registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.elements.password.value;
  const error = passwordError(password);
  if (error) return setStatus(error, 'error');
  if (password !== form.elements['password-confirm'].value) return setStatus('Wpisane hasła nie są takie same.', 'error');
  setBusy(form, true); setStatus('Tworzymy konto…');
  try {
    const { data, error: signUpError } = await supabase.auth.signUp({ email: order.customerEmail, password });
    if (signUpError) throw signUpError;
    if (!data.session) throw new Error('Konto utworzono, ale automatyczne logowanie jest wyłączone. Zaloguj się w drugiej zakładce.');
    await claim(data.session, form.elements.remember.checked);
  } catch (error) { setStatus(error.message.startsWith('Konto utworzono') ? error.message : friendlyError(error), 'error'); }
  finally { setBusy(form, false); }
});

elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true); setStatus('Logujemy i przypisujemy zamówienie…');
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: order.customerEmail, password: form.elements.password.value });
    if (error) throw error;
    await claim(data.session, form.elements.remember.checked);
  } catch (error) { setStatus(error.message?.startsWith('Nie udało') || error.message?.startsWith('E-mail') ? error.message : friendlyError(error), 'error'); }
  finally { setBusy(form, false); }
});

try {
  await inspectPayment();
  if (!validConfig(config)) throw new Error('System kont nie jest jeszcze skonfigurowany na serwerze testowym.');
  supabase = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    elements.authArea.hidden = true;
    try { await claim(session, true); }
    catch (error) {
      elements.authArea.hidden = false;
      setStatus(error.message + ' Wyloguj się w panelu konta i zaloguj adresem użytym w tym zamówieniu.', 'error');
    }
  }
} catch (error) {
  elements.paymentSpinner.hidden = true;
  elements.paymentTitle.textContent = 'Nie udało się potwierdzić zamówienia';
  elements.paymentMessage.textContent = error.message || 'Spróbuj odświeżyć stronę za chwilę.';
  elements.paymentActions.hidden = false;
}
