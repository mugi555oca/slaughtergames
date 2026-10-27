// Spiellocations (nur fuer Mitglieder lesbar - RLS). Liste + Detail-Sheet.
import { supabase, esc, icon, openSheet, toast } from './app.js';

export async function loadLocations(){
  const { data } = await supabase.from('play_locations').select('*').eq('active', true).order('sort_order');
  return data || [];
}

// Anzeigename: langer Magic-Name des Gastgebers, sonst der Ortsname
export function locTitle(l, people){
  const o = l?.owner_slug && people?.bySlug.get(l.owner_slug);
  return o ? o.name : (l?.name || '');
}

export function locationsListHtml(locations, people = null){
  return `<div class="list">${locations.map(l => `<button class="list-item" data-loc="${l.id}"><span style="font-size:20px">📍</span>
    <div class="grow"><div class="title">${esc(locTitle(l, people))}</div><div class="sub">${esc(l.address)}${l.bell ? ' · 🔔 ' + esc(l.bell) : ''}</div></div>${icon('chev', 'chev')}</button>`).join('')}</div>`;
}

export function bindLocations(root, locations, people){
  root.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => {
    const l = locations.find(x => x.id === b.dataset.loc);
    if(l) locSheet(l, people);
  }));
}

export function locSheet(l, people){
  const owner = l.owner_slug && people?.bySlug.get(l.owner_slug);
  const s = openSheet(`<h3>📍 ${esc(locTitle(l, people))}</h3>
    <div class="list">
      <div class="list-item"><div class="grow"><div class="sub">Adresse</div><div class="title">${esc(l.address)}</div></div></div>
      ${l.bell ? `<div class="list-item"><div class="grow"><div class="sub">Anläuten / Tür</div><div class="title">🔔 ${esc(l.bell)}</div></div></div>` : ''}
      ${owner ? `<a class="list-item" href="/player-profile.html?slug=${encodeURIComponent(owner.slug)}"><img class="avatar sm" src="${esc(owner.avatar)}" alt=""><div class="grow"><div class="sub">Gastgeber</div><div class="title">${esc(owner.name)}</div></div>${icon('chev', 'chev')}</a>` : ''}
    </div>
    <div class="btn-row mt"><a class="btn" href="${esc(l.maps_url)}" target="_blank" rel="noopener">Google Maps</a>
      <button class="btn ghost" data-copy>Adresse kopieren</button></div>
    <button class="btn block ghost mt" data-close>Schließen</button>`);
  s.el.querySelector('[data-copy]').addEventListener('click', async () => {
    await navigator.clipboard?.writeText(`${l.address}${l.bell ? ' – ' + l.bell : ''}`); toast('Adresse kopiert.');
  });
}
