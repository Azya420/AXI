import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

const config = window.AXI_SUPABASE;
function validConfig(value) {
  try { return value?.url && new URL(value.url).hostname.endsWith('.supabase.co') && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value.publishableKey); } catch { return false; }
}
function fill(id, value) {
  const input = document.getElementById(id);
  if (input && !input.value.trim() && value) input.value = value;
}

if (validConfig(config)) {
  const supabase = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    fill('email', session.user.email);
    const { data: profile } = await supabase.from('profiles')
      .select('customer_name,phone,delivery_method,delivery_destination,saved_data_at')
      .eq('id', session.user.id).maybeSingle();
    if (profile?.saved_data_at) {
      fill('name', profile.customer_name);
      fill('phone', profile.phone);
      const radioValue = profile.delivery_method === 'address' ? 'Na adres' : profile.delivery_method === 'locker' ? 'Paczkomat InPost' : '';
      const radio = radioValue && document.querySelector(`input[name="dostawa"][value="${radioValue}"]`);
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
      if (profile.delivery_method === 'locker') {
        fill('paczkomat-hidden', profile.delivery_destination);
        const status = document.getElementById('paczkomat-status');
        if (status && profile.delivery_destination) status.textContent = 'Zapamiętany paczkomat: ' + profile.delivery_destination;
      } else if (profile.delivery_method === 'address' && profile.delivery_destination) {
        const parts = profile.delivery_destination.split(',').map(part => part.trim());
        if (parts.length >= 3) {
          fill('ulica', parts.slice(0, -2).join(', '));
          fill('kod', parts.at(-2));
          fill('miasto', parts.at(-1));
        }
      }
    }
  }
}
