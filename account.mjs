import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

const STATUS_LABELS = Object.freeze({
  new: 'Nowe zlecenie',
  paid: 'Płatność przyjęta',
  in_modeling: 'Tworzenie modelu 3D',
  awaiting_approval: 'Oczekuje na akceptację',
  approved: 'Model zaakceptowany',
  printing: 'Drukowanie',
  finishing: 'Obróbka i kontrola jakości',
  shipped: 'Wysłane',
  completed: 'Zrealizowane',
  cancelled: 'Anulowane'
});

const config = window.AXI_SUPABASE;
const elements = {
  shell: document.querySelector('.auth-shell'),
  authCard: document.querySelector('#auth-card'),
  accountCard: document.querySelector('#account-card'),
  status: document.querySelector('#global-status'),
  loginPanel: document.querySelector('#login-panel'),
  forgotPanel: document.querySelector('#forgot-panel'),
  resetPanel: document.querySelector('#reset-panel'),
  loginForm: document.querySelector('#login-form'),
  forgotForm: document.querySelector('#forgot-form'),
  resetForm: document.querySelector('#reset-form'),
  forgotButton: document.querySelector('#forgot-button'),
  forgotBack: document.querySelector('#forgot-back'),
  logoutButton: document.querySelector('#logout-button'),
  profileMenu: document.querySelector('#profile-menu'),
  profileMenuButton: document.querySelector('#profile-menu-button'),
  profileDropdown: document.querySelector('#profile-dropdown'),
  adminLink: document.querySelector('#admin-link'),
  ordersState: document.querySelector('#orders-state'),
  ordersList: document.querySelector('#orders-list')
};

function isValidPublicConfig(value) {
  if (!value || typeof value.url !== 'string' || typeof value.publishableKey !== 'string') return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && url.pathname === '/' && url.search === '' && url.hash === '' &&
      url.hostname.endsWith('.supabase.co') && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value.publishableKey);
  } catch {
    return false;
  }
}

function setStatus(message = '', type = '') {
  elements.status.textContent = message;
  elements.status.className = `status${type ? ` ${type}` : ''}`;
  elements.status.hidden = !message;
}

function setBusy(form, busy) {
  for (const control of form.elements) control.disabled = busy;
}

function showAuthPanel(name) {
  elements.loginPanel.hidden = name !== 'login';
  elements.forgotPanel.hidden = name !== 'forgot';
  elements.resetPanel.hidden = name !== 'reset';
  setStatus();
}

function setProfileMenu(open) {
  elements.profileMenuButton.setAttribute('aria-expanded', String(open));
  elements.profileDropdown.hidden = !open;
}

function showSignedIn() {
  elements.authCard.hidden = true;
  elements.accountCard.hidden = false;
  elements.profileMenu.hidden = false;
  elements.shell.classList.add('account-view');
}

function showSignedOut() {
  elements.accountCard.hidden = true;
  elements.authCard.hidden = false;
  elements.profileMenu.hidden = true;
  elements.shell.classList.remove('account-view');
  setProfileMenu(false);
  elements.adminLink.hidden = true;
  elements.ordersList.replaceChildren();
  elements.ordersState.textContent = 'Wczytywanie zamówień…';
  elements.ordersState.hidden = false;
  showAuthPanel('login');
}

function appendText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pl-PL', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function renderOrders(orders, history) {
  elements.ordersList.replaceChildren();
  if (!orders.length) {
    elements.ordersState.textContent = 'Nie przypisano jeszcze żadnego zamówienia do tego konta.';
    elements.ordersState.hidden = false;
    return;
  }
  elements.ordersState.hidden = true;
  for (const order of orders) {
    const card = document.createElement('article');
    card.className = 'customer-order';
    const head = document.createElement('div');
    head.className = 'customer-order-head';
    const heading = document.createElement('div');
    appendText(heading, 'p', 'order-number', order.order_number);
    appendText(heading, 'p', 'order-title', order.title);
    head.append(heading);
    appendText(head, 'span', 'order-status', STATUS_LABELS[order.status] || order.status);
    card.append(head);
    appendText(card, 'p', 'order-date', `Data zamówienia: ${formatDate(order.ordered_at)}`);
    if (order.status_message) appendText(card, 'p', 'order-message', order.status_message);

    const entries = history.filter(item => item.order_id === order.id);
    if (entries.length) {
      const timeline = document.createElement('section');
      timeline.className = 'timeline';
      appendText(timeline, 'p', 'timeline-title', 'Historia statusów');
      const list = document.createElement('div');
      list.className = 'timeline-list';
      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        appendText(item, 'span', 'timeline-dot', '');
        const content = document.createElement('div');
        appendText(content, 'strong', '', STATUS_LABELS[entry.status] || entry.status);
        const time = appendText(content, 'time', '', formatDate(entry.created_at, true));
        time.dateTime = entry.created_at;
        if (entry.message) appendText(content, 'span', '', ` · ${entry.message}`);
        item.append(content);
        list.append(item);
      }
      timeline.append(list);
      card.append(timeline);
    }
    elements.ordersList.append(card);
  }
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
  if (message.includes('user already registered')) return 'Konto z tym adresem e-mail już istnieje.';
  if (message.includes('email rate limit')) return 'Wysłano zbyt wiele wiadomości. Spróbuj ponownie później.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  if (message.includes('password')) return 'Hasło nie spełnia wymagań bezpieczeństwa.';
  return 'Nie udało się wykonać tej operacji. Spróbuj ponownie.';
}

if (!isValidPublicConfig(config)) {
  setStatus('Logowanie nie jest jeszcze skonfigurowane na serwerze testowym.', 'error');
  for (const form of [elements.loginForm, elements.forgotForm, elements.resetForm]) {
    for (const control of form.elements) control.disabled = true;
  }
} else {
  const supabase = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit'
    }
  });
  let lastLoadedUserId = null;

  async function loadAccountData(user, force = false) {
    if (!force && lastLoadedUserId === user.id) return;
    lastLoadedUserId = user.id;
    elements.ordersState.textContent = 'Wczytywanie zamówień…';
    elements.ordersState.hidden = false;
    elements.ordersList.replaceChildren();
    elements.adminLink.hidden = true;

    const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profileError) {
      lastLoadedUserId = null;
      elements.ordersState.textContent = ['42P01', 'PGRST205', 'PGRST204'].includes(profileError.code)
        ? 'System historii zamówień nie został jeszcze skonfigurowany.'
        : 'Nie udało się wczytać danych konta.';
      return;
    }
    elements.adminLink.hidden = profile?.role !== 'admin';
    const { data: orders, error: ordersError } = await supabase.from('orders')
      .select('id,order_number,title,status,status_message,ordered_at,updated_at')
      .order('ordered_at', { ascending: false });
    if (ordersError) {
      lastLoadedUserId = null;
      elements.ordersState.textContent = 'Nie udało się wczytać historii zamówień.';
      return;
    }
    if (!orders?.length) return renderOrders([], []);
    const { data: history, error: historyError } = await supabase.from('order_status_history')
      .select('order_id,status,message,created_at')
      .in('order_id', orders.map(order => order.id))
      .order('created_at', { ascending: false });
    if (historyError) {
      lastLoadedUserId = null;
      elements.ordersState.textContent = 'Nie udało się wczytać historii statusów.';
      return;
    }
    renderOrders(orders, history || []);
  }

  function openAccount(user) {
    showSignedIn();
    void loadAccountData(user);
  }

  elements.profileMenuButton.addEventListener('click', event => {
    event.stopPropagation();
    setProfileMenu(elements.profileDropdown.hidden);
  });
  elements.profileDropdown.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', () => setProfileMenu(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setProfileMenu(false);
      elements.profileMenuButton.focus();
    }
  });

  elements.forgotButton.addEventListener('click', () => {
    elements.forgotForm.elements.email.value = elements.loginForm.elements.email.value;
    showAuthPanel('forgot');
  });
  elements.forgotBack.addEventListener('click', () => showAuthPanel('login'));

  elements.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    setStatus();
    setBusy(elements.loginForm, true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: elements.loginForm.elements.email.value.trim(),
        password: elements.loginForm.elements.password.value
      });
      if (error) throw error;
      elements.loginForm.reset();
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      setBusy(elements.loginForm, false);
    }
  });

  elements.forgotForm.addEventListener('submit', async event => {
    event.preventDefault();
    setStatus();
    setBusy(elements.forgotForm, true);
    try {
      const redirectTo = `${window.location.origin}/preview/konto.html?mode=reset`;
      const { error } = await supabase.auth.resetPasswordForEmail(elements.forgotForm.elements.email.value.trim(), { redirectTo });
      if (error) throw error;
      setStatus('Jeśli konto istnieje, wysłaliśmy wiadomość z linkiem do zmiany hasła.', 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      setBusy(elements.forgotForm, false);
    }
  });

  elements.resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    setStatus();
    const password = elements.resetForm.elements.password.value;
    const confirmation = elements.resetForm.elements['password-confirm'].value;
    const validationError = passwordError(password);
    if (validationError) return setStatus(validationError, 'error');
    if (password !== confirmation) return setStatus('Wpisane hasła nie są identyczne.', 'error');
    setBusy(elements.resetForm, true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      elements.resetForm.reset();
      history.replaceState({}, '', '/preview/konto.html');
      setStatus('Hasło zostało zmienione.', 'success');
      const { data } = await supabase.auth.getUser();
      if (data.user) openAccount(data.user);
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      setBusy(elements.resetForm, false);
    }
  });

  elements.logoutButton.addEventListener('click', async () => {
    elements.logoutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    elements.logoutButton.disabled = false;
    if (error) {
      elements.ordersState.textContent = friendlyError(error);
      elements.ordersState.hidden = false;
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      elements.accountCard.hidden = true;
      elements.authCard.hidden = false;
      elements.profileMenu.hidden = true;
      elements.shell.classList.remove('account-view');
      setProfileMenu(false);
      showAuthPanel('reset');
      setStatus('Ustaw nowe hasło do konta.', 'success');
      return;
    }
    if (session?.user) openAccount(session.user);
    else if (event === 'SIGNED_OUT') {
      lastLoadedUserId = null;
      showSignedOut();
    }
  });

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) setStatus(friendlyError(error), 'error');
  else if (session?.user) openAccount(session.user);
  else showSignedOut();
}
