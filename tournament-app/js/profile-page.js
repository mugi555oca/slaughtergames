import { bindAuthUI, requireAuthOrRedirect } from './auth.js';
import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

async function init(){
  bindAuthUI();
  const user = await requireAuthOrRedirect();
  if(!user) return;

  $('mailText').textContent = `E-Mail: ${user.email}`;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  $('displayName').value = profile?.display_name || '';

  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('displayName').value.trim();
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, display_name: displayName }, { onConflict: 'id' });

    $('profileMsg').textContent = error ? error.message : 'Profil gespeichert.';
  });
}

init();
