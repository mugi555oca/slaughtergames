// SG-Spielerstamm im Admin-Cockpit: neue Spieler anlegen, alte ausblenden.
// Schreiben ist per RLS auf app_admins beschraenkt.
import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function msg(text, isError){
  const el = $('rosterMsg');
  el.textContent = text || '';
  el.style.color = isError ? '#ff8a80' : '';
}

// "Jörg Müller" -> "joerg-mueller"
export function slugify(s){
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

let roster = [];

async function load(){
  const { data, error } = await supabase.from('roster').select('*').order('name');
  if(error) throw error;
  roster = data || [];
}

function render(){
  const active = roster.filter(r => r.active).length;
  $('rosterCount').textContent = `${active} aktiv, ${roster.length - active} ausgeblendet`;
  $('rosterList').innerHTML = roster.map(r => `
    <tr${r.active ? '' : ' style="opacity:.5"'}>
      <td><a href="../player-profile.html?slug=${encodeURIComponent(r.slug)}" target="_blank">${esc(r.name)}</a></td>
      <td>${esc(r.real_name || '')}</td>
      <td class="muted">${esc(r.slug)}</td>
      <td>
        <button class="${r.active ? 'secondary' : 'success'}" data-toggle="${esc(r.slug)}">
          ${r.active ? 'Ausblenden' : 'Wieder aktiv'}
        </button>
      </td>
    </tr>`).join('');
}

async function refresh(){ await load(); render(); }

export async function initRosterAdmin(isAdmin){
  if(!isAdmin) return;
  $('rosterAdmin').hidden = false;
  await refresh();

  // Slug-Vorschau beim Tippen
  const preview = () => {
    const base = slugify($('rName').value ? ($('rReal').value || $('rName').value) : '');
    $('rSlugPreview').textContent = base ? `Profil-Adresse: player-profile.html?slug=${base}` : '';
  };
  $('rName').addEventListener('input', preview);
  $('rReal').addEventListener('input', preview);

  $('rosterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('rName').value.trim();
    const real = $('rReal').value.trim();
    if(!name){ msg('Der SG-Name fehlt.', true); return; }

    if(roster.some(r => r.name.toLowerCase() === name.toLowerCase())){
      msg(`"${name}" gibt es schon.`, true);
      return;
    }

    // Eindeutiger Slug: bei Kollision -2, -3, ...
    const base = slugify(real || name) || 'spieler';
    const taken = new Set(roster.map(r => r.slug));
    let slug = base, n = 2;
    while(taken.has(slug)) slug = `${base}-${n++}`;

    try{
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from('roster').insert({
        slug, name, real_name: real || null, created_by: auth?.user?.id || null,
      });
      if(error) throw error;
      $('rosterForm').reset();
      $('rSlugPreview').textContent = '';
      msg(`"${name}" angelegt - steht ab sofort in der Spielerauswahl beim Turnier.`);
      await refresh();
    }catch(err){ msg(err.message, true); }
  });

  $('rosterList').addEventListener('click', async (e) => {
    const slug = e.target.getAttribute?.('data-toggle');
    if(!slug) return;
    const r = roster.find(x => x.slug === slug);
    if(!r) return;
    try{
      const { error } = await supabase.from('roster').update({ active: !r.active }).eq('slug', slug);
      if(error) throw error;
      msg(r.active ? `"${r.name}" ausgeblendet.` : `"${r.name}" wieder aktiv.`);
      await refresh();
    }catch(err){ msg(err.message, true); }
  });
}
