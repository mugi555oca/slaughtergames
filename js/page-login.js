import { initShell, $, supabase, busy } from './app.js';

// Nur seiteninterne Ziele zulassen - kein offener Redirect.
function safeNext(){
  const raw = new URLSearchParams(location.search).get('next') || '/';
  if(!raw.startsWith('/') || raw.startsWith('//') || /^\/\\/.test(raw)) return '/';
  return raw;
}

const m = await initShell({ tab: 'profil', title: 'Login', back: '/' });
if(m.user) location.replace(safeNext());

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter;
  busy(btn, true, 'Einloggen…');
  $('#loginMsg').textContent = '';
  let email = $('#loginName').value.trim();
  if(!email.includes('@')) email = `${email.toLowerCase()}@slaughtergames.local`;
  const { error } = await supabase.auth.signInWithPassword({ email, password: $('#loginPw').value });
  if(error){
    busy(btn, false);
    $('#loginMsg').textContent = error.message === 'Invalid login credentials'
      ? 'Name oder Passwort stimmt nicht.' : error.message;
    return;
  }
  location.replace(safeNext());
});
