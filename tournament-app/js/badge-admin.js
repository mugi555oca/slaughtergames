// Abzeichen-Verwaltung im Admin-Cockpit.
// Schreiben ist per RLS auf app_admins beschraenkt - die UI blendet sich fuer
// alle anderen aus, die Datenbank setzt es durch.
import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

const ICON_KEYS = [
  ['', '– kein Icon –'],
  ['crown','Krone'], ['mic','Mikrofon'], ['quill','Federkiel'], ['chefhat','Kochmütze'],
  ['flame','Flamme'], ['cocktail','Cocktail'], ['quiz','Sprechblase ?'], ['table','Tabelle'],
  ['moon','Mond'], ['brokensword','Zerbrochenes Schwert'], ['hourglass','Sanduhr'], ['sock','Socke'],
  ['candle','Kerze'], ['lantern','Laterne'], ['sneeze','Stinkwolke'], ['punt','Fuß + Ball'],
  ['spikeball','Spikeball-Netz'],
];
const EVENTS = ['', 'SG1', 'SG2', 'SG3', 'SG4', 'SG5', 'SG6', 'SG7'];

let badges = [];
let players = [];          // [{slug, name}]
let awards = [];

function msg(id, text, isError){
  const el = $(id);
  el.textContent = text || '';
  el.style.color = isError ? '#ff8a80' : '';
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function icon(key){
  return key ? `<svg class="badge-icon"><use href="#badge-${esc(key)}"/></svg>` : '<span class="muted">–</span>';
}

async function injectSprite(){
  if(document.getElementById('badgeSprite')) return;
  try{
    const res = await fetch('../badges.svg', { cache:'force-cache' });
    const host = document.createElement('div');
    host.id = 'badgeSprite';
    host.style.display = 'none';
    host.innerHTML = await res.text();
    document.body.appendChild(host);
  }catch{}
}

async function loadPlayers(){
  try{
    const res = await fetch('./player_profiles.json', { cache:'no-store' });
    const arr = await res.json();
    players = arr.map(p => ({ slug: p.slug, name: p.name })).sort((a,b)=>a.name.localeCompare(b.name,'de'));
  }catch{ players = []; }
}

async function loadAll(){
  const [{ data: b, error: be }, { data: a, error: ae }] = await Promise.all([
    supabase.from('badges').select('*').order('sort_order'),
    supabase.from('player_badges').select('*'),
  ]);
  if(be) throw be;
  if(ae) throw ae;
  badges = b || [];
  awards = a || [];
}

function nameOf(slug){ return players.find(p => p.slug === slug)?.name || slug; }

function renderBadges(){
  const counts = {};
  for(const a of awards) counts[a.badge_code] = (counts[a.badge_code] || 0) + 1;

  $('badgeList').innerHTML = badges.map(b => `
    <tr>
      <td>${icon(b.icon_key)}</td>
      <td><b>${esc(b.code)}</b></td>
      <td>${esc(b.name)}</td>
      <td class="muted">${esc(b.description || '')}</td>
      <td>${counts[b.code] || 0}×</td>
      <td><button class="danger" data-del-badge="${esc(b.code)}">Löschen</button></td>
    </tr>`).join('');

  $('aBadge').innerHTML = badges.map(b =>
    `<option value="${esc(b.code)}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
}

function renderAwards(){
  const rows = [...awards].sort((x, y) =>
    nameOf(x.slug).localeCompare(nameOf(y.slug), 'de') || String(x.sg||'').localeCompare(String(y.sg||'')));
  $('awardList').innerHTML = rows.map(a => {
    const b = badges.find(x => x.code === a.badge_code);
    return `<tr>
      <td>${esc(nameOf(a.slug))}</td>
      <td>${icon(b?.icon_key)} ${esc(b?.name || a.badge_code)}</td>
      <td>${esc(a.sg || '–')}</td>
      <td><button class="danger" data-del-award="${esc(a.id)}">Entfernen</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">Noch nichts vergeben.</td></tr>';
}

async function refresh(){
  await loadAll();
  renderBadges();
  renderAwards();
}

export async function initBadgeAdmin(user){
  // Admin? Die Policy nutzt die E-Mail aus dem JWT.
  const { data: adminRows } = await supabase
    .from('app_admins').select('email').ilike('email', user.email || '');
  const isAdmin = Array.isArray(adminRows) && adminRows.length > 0;

  if(!isAdmin){ $('noAdminHint').hidden = false; return; }
  $('badgeAdmin').hidden = false;

  await injectSprite();
  await loadPlayers();

  $('bIcon').innerHTML = ICON_KEYS.map(([k, label]) =>
    `<option value="${k}">${label}</option>`).join('');
  $('aPlayer').innerHTML = players.map(p =>
    `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('');
  $('aEvent').innerHTML = EVENTS.map(e =>
    `<option value="${e}">${e || 'ohne Event'}</option>`).join('');

  await refresh();

  $('badgeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('bCode').value.trim();
    if(!code) return;
    try{
      const { error } = await supabase.from('badges').insert({
        code,
        name: $('bName').value.trim(),
        description: $('bDesc').value.trim() || null,
        icon_key: $('bIcon').value || null,
        sort_order: 200 + badges.length,
      });
      if(error) throw error;
      $('badgeForm').reset();
      msg('badgeMsg', `Abzeichen "${code}" angelegt.`);
      await refresh();
    }catch(err){ msg('badgeMsg', err.message, true); }
  });

  $('awardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try{
      const { error } = await supabase.from('player_badges').insert({
        slug: $('aPlayer').value,
        badge_code: $('aBadge').value,
        sg: $('aEvent').value || null,
      });
      if(error) throw error;
      msg('awardMsg', 'Zugeordnet.');
      await refresh();
    }catch(err){ msg('awardMsg', err.message, true); }
  });

  $('badgeAdmin').addEventListener('click', async (e) => {
    const delBadge = e.target.getAttribute?.('data-del-badge');
    const delAward = e.target.getAttribute?.('data-del-award');

    if(delBadge){
      const used = awards.filter(a => a.badge_code === delBadge).length;
      const warn = used
        ? `Das Abzeichen ist ${used}× vergeben. Alle Zuordnungen werden mitgelöscht.\n\n`
        : '';
      if(!confirm(`${warn}Abzeichen "${delBadge}" wirklich löschen?`)) return;
      try{
        const { error } = await supabase.from('badges').delete().eq('code', delBadge);
        if(error) throw error;
        msg('badgeMsg', 'Abzeichen gelöscht.');
        await refresh();
      }catch(err){ msg('badgeMsg', err.message, true); }
    }

    if(delAward){
      try{
        const { error } = await supabase.from('player_badges').delete().eq('id', delAward);
        if(error) throw error;
        msg('awardMsg', 'Zuordnung entfernt.');
        await refresh();
      }catch(err){ msg('awardMsg', err.message, true); }
    }
  });
}
