import { bindAuthUI, requireAuthOrRedirect } from './auth.js';
import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

const MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_PX = 512;

let currentUser = null;
let currentProfile = null;
let fallbackImage = '../main_logo.png';

function setMsg(id, text, isError){
  const el = $(id);
  el.textContent = text || '';
  el.style.color = isError ? '#ff8a80' : '';
}

function setBusy(btn, busy, label){
  if(!btn) return;
  if(busy){ btn.dataset.old = btn.textContent; btn.disabled = true; btn.textContent = label; }
  else { btn.disabled = false; if(btn.dataset.old) btn.textContent = btn.dataset.old; }
}

// Quadratisch zuschneiden und auf AVATAR_PX verkleinern - spart Upload und
// sorgt dafuer, dass die runden Bilder auf der Profilseite nicht verzerren.
function squareResize(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(AVATAR_PX, side);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Bild konnte nicht verarbeitet werden.')), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Datei ist kein lesbares Bild.')); };
    img.src = url;
  });
}

async function loadFallbackImage(slug){
  try{
    const res = await fetch('./player_profiles.json', { cache: 'no-store' });
    const arr = await res.json();
    const hit = arr.find(x => x.slug === slug);
    if(hit?.profileImage) fallbackImage = `../${hit.profileImage}`;
  }catch{}
}

function renderAvatar(){
  $('avatarPreview').src = currentProfile?.avatar_url || fallbackImage;
  $('avatarResetBtn').disabled = !currentProfile?.avatar_url;
}

async function saveProfile(patch){
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: currentUser.id, ...patch }, { onConflict: 'id' })
    .select('*')
    .single();
  if(error) throw error;
  currentProfile = data;
  return data;
}

async function init(){
  bindAuthUI();
  currentUser = await requireAuthOrRedirect();
  if(!currentUser) return;

  $('mailText').textContent = `Angemeldet als ${currentUser.email}`;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();
  if(error){ setMsg('profileMsg', error.message, true); return; }
  currentProfile = profile || { id: currentUser.id };

  if(currentProfile.slug){
    $('publicLink').href = `../player-profile.html?slug=${encodeURIComponent(currentProfile.slug)}`;
    await loadFallbackImage(currentProfile.slug);
  }else{
    $('publicLink').style.display = 'none';
  }

  $('displayName').value = currentProfile.display_name || '';
  $('description').value = currentProfile.description || '';
  $('favouriteCard').value = currentProfile.favourite_card || '';
  renderAvatar();

  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('profileForm').querySelector('button[type=submit]');
    setBusy(btn, true, 'Speichere...');
    try{
      await saveProfile({
        display_name: $('displayName').value.trim(),
        description: $('description').value.trim() || null,
        favourite_card: $('favouriteCard').value.trim() || null,
      });
      setMsg('profileMsg', 'Profil gespeichert.');
    }catch(err){
      setMsg('profileMsg', err.message, true);
    }finally{ setBusy(btn, false); }
  });

  $('avatarUploadBtn').addEventListener('click', async () => {
    const file = $('avatarFile').files?.[0];
    if(!file){ setMsg('avatarMsg', 'Bitte zuerst eine Datei auswählen.', true); return; }
    if(file.size > MAX_BYTES){ setMsg('avatarMsg', 'Datei ist größer als 5 MB.', true); return; }

    const btn = $('avatarUploadBtn');
    setBusy(btn, true, 'Lade hoch...');
    try{
      const blob = await squareResize(file);
      // Pfad muss mit der eigenen User-ID beginnen - so ist es in der
      // Storage-Policy erlaubt. Zeitstempel bricht den CDN-Cache.
      const path = `${currentUser.id}/avatar_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if(upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const oldUrl = currentProfile?.avatar_url;
      await saveProfile({ avatar_url: pub.publicUrl });

      // Vorgaenger wegräumen, damit der Bucket nicht zuwächst.
      if(oldUrl){
        const marker = '/avatars/';
        const idx = oldUrl.indexOf(marker);
        if(idx >= 0) await supabase.storage.from('avatars').remove([oldUrl.slice(idx + marker.length)]);
      }

      $('avatarFile').value = '';
      renderAvatar();
      setMsg('avatarMsg', 'Profilbild aktualisiert.');
    }catch(err){
      setMsg('avatarMsg', err.message, true);
    }finally{ setBusy(btn, false); }
  });

  $('avatarResetBtn').addEventListener('click', async () => {
    const btn = $('avatarResetBtn');
    setBusy(btn, true, 'Setze zurück...');
    try{
      const oldUrl = currentProfile?.avatar_url;
      await saveProfile({ avatar_url: null });
      if(oldUrl){
        const marker = '/avatars/';
        const idx = oldUrl.indexOf(marker);
        if(idx >= 0) await supabase.storage.from('avatars').remove([oldUrl.slice(idx + marker.length)]);
      }
      renderAvatar();
      setMsg('avatarMsg', 'Zurück auf das Standardbild.');
    }catch(err){
      setMsg('avatarMsg', err.message, true);
    }finally{ setBusy(btn, false); }
  });
}

init();
