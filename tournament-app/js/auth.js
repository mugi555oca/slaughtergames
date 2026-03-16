import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

export async function getSessionUser(){
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export async function requireAuthOrRedirect(){
  const user = await getSessionUser();
  if(!user){ window.location.href = './login.html'; return null; }
  return user;
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
        window.location.href = './dashboard.html';
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
