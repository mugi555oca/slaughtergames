// Uebersicht aller Spielerprofile (spieler.html).
// Turnierfakten aus player_profiles.json, Bild/Beschreibung aus der DB.
import { supabase } from './supabase-client.js';

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function init(){
  const host = document.getElementById('playersGrid');

  let profiles = [];
  try{
    const res = await fetch('./tournament-app/player_profiles.json', { cache:'no-store' });
    profiles = await res.json();
  }catch{
    host.innerHTML = '<p class="muted">Profile konnten nicht geladen werden.</p>';
    return;
  }

  // Selbst gepflegte Felder dazuladen - schlaegt das fehl, bleibt die JSON.
  let editable = {};
  try{
    const { data } = await supabase.from('profiles').select('slug,display_name,description,avatar_url');
    for(const row of data || []) if(row.slug) editable[row.slug] = row;
  }catch{}

  // Meiste Teilnahmen zuerst, dann alphabetisch.
  const sorted = [...profiles].sort((a, b) =>
    (b.participations?.length || 0) - (a.participations?.length || 0) ||
    a.name.localeCompare(b.name, 'de'));

  host.innerHTML = sorted.map(p => {
    const e = editable[p.slug] || {};
    const img = e.avatar_url || p.profileImage || 'main_logo.png';
    const parts = p.participations || [];
    const axes = (p.axes || []).length;
    return `
      <a class="player-card" href="player-profile.html?slug=${encodeURIComponent(p.slug)}">
        <img class="player-img" src="${esc(img)}" alt="${esc(p.name)}"
             onerror="this.src='main_logo.png'">
        <span class="player-name">${esc(p.name)}</span>
        <span class="player-real">${esc(e.display_name || p.realName || '')}</span>
        <span class="player-meta">
          <span title="Teilnahmen">${parts.length}&times; dabei</span>
          ${axes ? `<span title="gewonnene Äxte">&#129683; ${axes}</span>` : ''}
        </span>
      </a>`;
  }).join('');

  // Eingeloggt? Dann direkt aufs eigene Profil verweisen.
  try{
    const { data: auth } = await supabase.auth.getUser();
    if(auth?.user){
      const { data: mine } = await supabase
        .from('profiles').select('slug').eq('id', auth.user.id).maybeSingle();
      if(mine?.slug){
        const card = host.querySelector(`a[href$="slug=${encodeURIComponent(mine.slug)}"]`);
        if(card) card.classList.add('player-card-own');
      }
    }
  }catch{}
}

init();
