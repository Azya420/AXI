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

const elements = {
  loading: document.querySelector('#loading-state'),
  signedOut: document.querySelector('#signed-out-state'),
  forbidden: document.querySelector('#forbidden-state'),
  setup: document.querySelector('#setup-state'),
  panel: document.querySelector('#admin-panel'),
  status: document.querySelector('#admin-status'),
  form: document.querySelector('#order-form'),
  editorTitle: document.querySelector('#editor-title'),
  saveButton: document.querySelector('#save-button'),
  cancelEdit: document.querySelector('#cancel-edit'),
  accountSelect: document.querySelector('#account-select'),
  statusSelect: document.querySelector('#status-select'),
  search: document.querySelector('#order-search'),
  count: document.querySelector('#order-count'),
  list: document.querySelector('#orders-list')
};

let profiles = [];
let orders = [];
let editingId = null;

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

function showState(name) {
  elements.loading.hidden = name !== 'loading';
  elements.signedOut.hidden = name !== 'signedOut';
  elements.forbidden.hidden = name !== 'forbidden';
  elements.setup.hidden = name !== 'setup';
  elements.panel.hidden = name !== 'panel';
}

function setStatus(message = '', type = '') {
  elements.status.textContent = message;
  elements.status.className = `status-box${type ? ` ${type}` : ''}`;
  elements.status.hidden = !message;
}

function setBusy(busy) {
  for (const control of elements.form.elements) control.disabled = busy;
}

function friendlyError(error) {
  if (error?.code === '23505') return 'Zlecenie o takim numerze już istnieje.';
  if (['42P01', 'PGRST205', 'PGRST204'].includes(error?.code)) return 'Baza zamówień nie jest jeszcze skonfigurowana.';
  if (error?.code === '42501') return 'Brak uprawnień do wykonania tej operacji.';
  return 'Nie udało się zapisać zmian. Spróbuj ponownie.';
}

function isSetupError(error) {
  return ['42P01', 'PGRST205', 'PGRST204'].includes(error?.code);
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pl-PL', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function dateInputValue(value = new Date()) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function appendText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function profileEmail(userId) {
  return profiles.find(profile => profile.id === userId)?.email || 'Nieprzypisane';
}

function populateSelects() {
  elements.statusSelect.replaceChildren();
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    elements.statusSelect.add(new Option(label, value));
  }
  elements.accountSelect.replaceChildren(new Option('Nieprzypisane', ''));
  for (const profile of profiles) {
    const suffix = profile.role === 'admin' ? ' · administrator' : '';
    elements.accountSelect.add(new Option(profile.email + suffix, profile.id));
  }
}

function renderOrders() {
  const query = elements.search.value.trim().toLocaleLowerCase('pl');
  const filtered = orders.filter(order => [order.order_number, order.customer_email, order.customer_name, order.title, profileEmail(order.user_id)]
    .some(value => String(value || '').toLocaleLowerCase('pl').includes(query)));
  elements.count.textContent = `${filtered.length} z ${orders.length}`;
  elements.list.replaceChildren();
  if (!filtered.length) {
    appendText(elements.list, 'div', 'empty', orders.length ? 'Brak zleceń pasujących do wyszukiwania.' : 'Nie dodano jeszcze żadnego zlecenia.');
    return;
  }
  for (const order of filtered) {
    const card = document.createElement('article');
    card.className = 'order-card';
    const top = document.createElement('div');
    top.className = 'order-card-top';
    const heading = document.createElement('div');
    appendText(heading, 'p', 'order-number', order.order_number);
    appendText(heading, 'p', 'order-title', order.title);
    top.append(heading);
    appendText(top, 'span', 'status-pill', STATUS_LABELS[order.status] || order.status);
    card.append(top);

    const meta = document.createElement('div');
    meta.className = 'order-meta';
    appendText(meta, 'span', '', `Klient: ${order.customer_name || '—'}`);
    appendText(meta, 'span', '', `E-mail: ${order.customer_email}`);
    appendText(meta, 'span', '', `Konto: ${profileEmail(order.user_id)}`);
    appendText(meta, 'span', '', `Data: ${formatDate(order.ordered_at)}`);
    card.append(meta);
    if (order.status_message) appendText(card, 'p', 'order-message', order.status_message);
    const actions = document.createElement('div');
    actions.className = 'order-actions';
    const edit = appendText(actions, 'button', 'button button-secondary', 'Edytuj');
    edit.type = 'button';
    edit.addEventListener('click', () => startEditing(order.id));
    card.append(actions);
    elements.list.append(card);
  }
}

function resetEditor() {
  editingId = null;
  elements.form.reset();
  elements.form.elements.title.value = 'Figurka na zamówienie';
  elements.form.elements.ordered_at.value = dateInputValue();
  elements.form.elements.status.value = 'new';
  elements.editorTitle.textContent = 'Dodaj zlecenie';
  elements.saveButton.textContent = 'Dodaj zlecenie';
  elements.cancelEdit.hidden = true;
}

function startEditing(orderId) {
  const order = orders.find(item => item.id === orderId);
  if (!order) return;
  editingId = order.id;
  elements.form.elements.order_number.value = order.order_number;
  elements.form.elements.ordered_at.value = dateInputValue(order.ordered_at);
  elements.form.elements.title.value = order.title;
  elements.form.elements.customer_name.value = order.customer_name;
  elements.form.elements.customer_email.value = order.customer_email;
  elements.form.elements.user_id.value = order.user_id || '';
  elements.form.elements.status.value = order.status;
  elements.form.elements.status_message.value = order.status_message;
  elements.editorTitle.textContent = `Edytuj ${order.order_number}`;
  elements.saveButton.textContent = 'Zapisz zmiany';
  elements.cancelEdit.hidden = false;
  elements.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function orderPayload() {
  const form = elements.form.elements;
  return {
    order_number: form.order_number.value.trim(),
    ordered_at: new Date(`${form.ordered_at.value}T12:00:00`).toISOString(),
    title: form.title.value.trim(),
    customer_name: form.customer_name.value.trim(),
    customer_email: form.customer_email.value.trim().toLocaleLowerCase('pl'),
    user_id: form.user_id.value || null,
    status: form.status.value,
    status_message: form.status_message.value.trim()
  };
}

if (!isValidPublicConfig(window.AXI_SUPABASE)) {
  showState('setup');
} else {
  const supabase = createClient(window.AXI_SUPABASE.url, window.AXI_SUPABASE.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  async function loadAdmin() {
    showState('loading');
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) return showState('signedOut');
    const { data: profile, error: profileError } = await supabase.from('profiles').select('id,email,role').eq('id', session.user.id).maybeSingle();
    if (profileError) return showState(isSetupError(profileError) ? 'setup' : 'forbidden');
    if (!profile || profile.role !== 'admin') return showState('forbidden');

    const [profilesResult, ordersResult] = await Promise.all([
      supabase.from('profiles').select('id,email,role,created_at').order('email', { ascending: true }),
      supabase.from('orders').select('id,order_number,user_id,customer_email,customer_name,title,status,status_message,ordered_at,created_at,updated_at').order('ordered_at', { ascending: false })
    ]);
    if (profilesResult.error || ordersResult.error) {
      const error = profilesResult.error || ordersResult.error;
      if (isSetupError(error)) return showState('setup');
      showState('panel');
      return setStatus(friendlyError(error), 'error');
    }
    profiles = profilesResult.data || [];
    orders = ordersResult.data || [];
    populateSelects();
    resetEditor();
    renderOrders();
    showState('panel');
  }

  elements.accountSelect.addEventListener('change', () => {
    const selected = profiles.find(profile => profile.id === elements.accountSelect.value);
    if (selected) elements.form.elements.customer_email.value = selected.email;
  });
  elements.search.addEventListener('input', renderOrders);
  elements.cancelEdit.addEventListener('click', resetEditor);
  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    setStatus();
    setBusy(true);
    try {
      const payload = orderPayload();
      const query = editingId
        ? supabase.from('orders').update(payload).eq('id', editingId)
        : supabase.from('orders').insert(payload);
      const { error } = await query.select('id').single();
      if (error) throw error;
      const message = editingId ? 'Zmiany zostały zapisane.' : 'Zlecenie zostało dodane.';
      const { data, error: refreshError } = await supabase.from('orders').select('id,order_number,user_id,customer_email,customer_name,title,status,status_message,ordered_at,created_at,updated_at').order('ordered_at', { ascending: false });
      if (refreshError) throw refreshError;
      orders = data || [];
      resetEditor();
      renderOrders();
      setStatus(message, 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      setBusy(false);
    }
  });

  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') showState('signedOut');
  });
  await loadAdmin();
}
