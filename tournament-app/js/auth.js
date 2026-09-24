import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

export async function getSessionUser(){
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export async function requireAuthOrRedirect(){
  const user = await getSessionUser();
  if(!user){
    // Ziel merken, damit man nach dem Login nicht im Dashboard landet.
    const next = location.pathname.split('/').pop() + location.search;
    window.location.href = `./login.html?next=${encodeURIComponent(next)}`;
    return null;
  }
  return user;
}

// Nur seiteninterne Ziele zulassen - kein offener Redirect.
export function safeNext(fallback = './dashboard.html'){
  const raw = new URLSearchParams(location.search).get('next');
  if(!raw) return fallback;
  if(/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('/')) return fallback;
  return './' + raw.replace(/^\.\//, '');
}

export async function register(email, password, displayName){
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || '' } }
  });
  if(error) throw error;
  return data;
}

export async function login(emailOrLogin, password){
  let email = emailOrLogin.trim();
  if(!email.includes('@')) email = `${email}@slaughtergames.local`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}

export async function logout(){
  const { error } = await supabase.auth.signOut();
  if(error) throw error;
}

export function bindAuthUI(){
  const loginForm = $('loginForm');
  const msg = $('authMsg');

  if(loginForm){
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try{
        await login($('loginEmail').value.trim(), $('loginPassword').value);
        window.location.href = safeNext();
      }catch(err){ msg.textContent = err.message; }
    });
  }

  const logoutBtn = $('logoutBtn');
  if(logoutBtn){
    logoutBtn.addEventListener('click', async () => {
      await logout();
      window.location.href = './login.html';
    });
  }
}
