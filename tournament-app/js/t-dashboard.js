// Turniere-Tab: laufende und abgeschlossene Drafts, "Deine Partie", Ranking.
import { initShell, $, $$, esc, icon, supabase, loadPeople, personForName, openSheet, counters } from '/js/app.js';
import { formatLabel, flip } from './t-shared.js';
import { loadWeekly, weeklyRanking, formatsOf, renderPerformance, fmtNum } from '/js/weekly.js';
import { loadLocations, locationsListHtml, bindLocations } from '/js/locations.js';

const m = await initShell({ tab: 'turniere', title: 'Weekly Turniere' });
if(m.isMember) $('#newBtn').hidden = false;

// Alles Unabhaengige gleichzeitig starten statt nacheinander
// Die Turnierliste kommt vom Server, das Ranking zuerst aus dem Handy-Speicher -
// keins wartet aufs andere.
const weeklyP = loadWeekly();
const people = await loadPeople();
let live = [];
const listP = supabase.from('tournaments').select('id,name,status,current_round,rounds_total,format_key,edi_code,created_at')
  .order('created_at', { ascending: false }).then(({ data: tournaments, error }) => {
    if(error){ $('#done').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    live = tournaments.filter(t => t.status === 'active');
    const done = tournaments.filter(t => t.status !== 'active');
    if(live.length){ $('#liveSec').hidden = false; $('#live').innerHTML = live.map(item).join(''); }
    $('#done').innerHTML = done.map(item).join('') || `<div class="empty">${icon('swords')}<h3>Noch keine Weeklys</h3></div>`;
    myMatches();
  });

const item = t => `<a class="list-item" href="/tournament-app/round.html?tournament=${t.id}">
  ${t.status === 'active' ? '<span class="chip live" style="padding:0 8px">LIVE</span>' : `<span class="faint small" style="width:44px;text-align:center;line-height:1.1">${new Date(t.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}<br>${new Date(t.created_at).getFullYear()}</span>`}
  <div class="grow"><div class="title ellipsis">${esc(t.name)}</div>
  <div class="sub">${esc(formatLabel(t.format_key))}${t.edi_code ? ' · ' + esc(t.edi_code) : ''}${t.status === 'active' ? (t.current_round ? ` · Runde ${t.current_round}/${t.rounds_total}` : ' · Draft-Phase') : ''}</div></div>
  <span class="trail" data-winner="${t.id}"></span>${icon('chev', 'chev')}
</a>`;

// ---------- Deine Partie in laufenden Turnieren (2 Abfragen fuer alle) ----------
async function myMatches(){
  if(!m.profile?.slug || !live.length) return;
  const ids = live.map(t => t.id);
  const [{ data: pls }, { data: ms }] = await Promise.all([
    supabase.from('players').select('id,tournament_id,name,slug').in('tournament_id', ids),
    supabase.from('matches').select('*').in('tournament_id', ids),
  ]);
  const cards = [];
  for(const t of live){
    const me = (pls || []).find(p => p.tournament_id === t.id && p.slug === m.profile.slug);
    if(!me) continue;
    const x = (ms || []).find(z => z.tournament_id === t.id && z.round_no === t.current_round && (z.player_a_id === me.id || z.player_b_id === me.id));
    if(!x) continue;
    let oppName = 'Bye';
    if(!x.is_bye){
      const opp = (pls || []).find(p => p.id === (x.player_a_id === me.id ? x.player_b_id : x.player_a_id));
      const p = (opp?.slug && people.bySlug.get(opp.slug)) || personForName(people, opp?.name);
      oppName = opp?.name || p?.name || '?';
    }
    const res = x.result === 'pending' ? null : (x.player_a_id === me.id ? x.result : flip(x.result));
    cards.push(`<a class="match-card mine" href="/tournament-app/round.html?tournament=${t.id}" style="display:block">
      <div class="match-head"><span>${esc(t.name)} · Runde ${t.current_round}</span>${res ? '<span class="chip ok">eingetragen</span>' : x.is_bye ? '' : '<span class="chip gold">Ergebnis eintragen</span>'}</div>
      <div class="row"><div class="grow"><div class="small muted">${x.is_bye ? 'Diese Runde' : `Tisch ${x.table_no ?? '?'} gegen`}</div>
      <div style="font-weight:700;font-size:17px">${esc(oppName)}</div></div>
      ${res ? `<b style="font-size:22px">${esc(res)}</b>` : icon('chev', 'chev')}</div></a>`);
  }
  if(cards.length) $('#mine').innerHTML = `<div class="section-head mt"><h2>Deine Partie</h2></div>${cards.join('')}`;
}

// ---------- Termine + Spiellocations (nur Mitglieder) ----------
async function meetAndLocations(){
  if(!m.isMember) return;
  $('#meetCard').hidden = false;
  const [c, locs] = await Promise.all([counters(), loadLocations()]);
  let nx = c.next_meetup;
  if(c.failed){
    // Rueckfall, falls die Sammelabfrage scheitert
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const { data } = await supabase.from('meetups').select('id,date,time,location_id,location_text').eq('status', 'open').gte('date', today).order('date').limit(1);
    if(data?.[0]){
      const { count } = await supabase.from('meetup_votes').select('user_id', { count: 'exact', head: true }).eq('meetup_id', data[0].id).eq('vote', 'in');
      nx = { ...data[0], in: count || 0, location: locs.find(l => l.id === data[0].location_id)?.name || data[0].location_text || 'TBD' };
    }
  }
  if(nx){
    const d = new Date(nx.date + 'T12:00:00');
    $('#meetCard').href = `/termine.html?id=${nx.id}`;
    $('#meetSub').textContent = `${['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()]} ${d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}, ${nx.time} · ${nx.location || '?'} · ${nx.in}/8 dabei`;
  } else {
    $('#meetSub').textContent = 'Noch kein Termin – schlag einen vor!';
  }
  if(locs.length){
    $('#locSec').hidden = false;
    $('#locList').innerHTML = locationsListHtml(locs, people);
    bindLocations($('#locList'), locs, people);
  }
}

meetAndLocations();

// ---------- Weekly Ranking ----------
const weekly = await weeklyP;

// Sieger der abgeschlossenen Weeklys (aus derselben Rechnung wie das Ranking)
listP.then(() => { for(const e of weekly.events){
  const w = e.rows[0];
  const el = document.querySelector(`[data-winner="${e.id}"]`);
  if(el && w) el.innerHTML = `<img class="avatar xs" src="${esc(w.person?.avatar || '/icons/icon-192.png')}" alt="" title="Sieger: ${esc(w.name)}">`;
} });

let mode = 'score', fmt = null;
const fmts = formatsOf(weekly);
$('#rankFmt').hidden = fmts.length < 2;
$('#rankFmt').innerHTML = ['', ...fmts].map(f => `<button data-f="${f}" class="${f ? '' : 'on'}">${f ? esc(formatLabel(f)) : 'Alle Formate'}</button>`).join('');

function paintRank(){
  const rows = weeklyRanking(weekly, fmt)
    .sort((a, b) => (b[mode] - a[mode]) || (b.points - a.points));
  const val = r => mode === 'points' ? `${r.points}<small>Punkte</small>`
    : mode === 'avg' ? `${fmtNum(r.avg)}<small>Ø / Runde</small>` : `${fmtNum(r.score)}<small>Wertung</small>`;
  $('#weeklyRank').innerHTML = rows.map((r, i) => `
    <a class="rank-row" ${r.person?.slug ? `href="/player-profile.html?slug=${encodeURIComponent(r.person.slug)}#weekly"` : ''}>
      <span class="rank-no">${i + 1}</span>
      <img class="avatar sm" src="${esc(r.person?.avatar || '/icons/icon-192.png')}" alt="">
      <span class="who"><span class="title">${esc(r.person?.name || r.name)}</span>
        <span class="sub">${r.n} Weekly${r.n === 1 ? '' : 's'} · ${r.rounds} Runden${r.wins ? ` · 🏆 ${r.wins}` : ''}</span></span>
      <span class="pts">${val(r)}</span>
    </a>`).join('') || '<div class="empty">Noch keine abgeschlossenen Weeklys.</div>';
}
paintRank();
$$('#rankMode button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.m; $$('#rankMode button').forEach(x => x.classList.toggle('on', x === b)); paintRank();
}));
$('#rankFmt').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if(!b) return;
  fmt = b.dataset.f || null; $$('#rankFmt button').forEach(x => x.classList.toggle('on', x === b)); paintRank();
});
$('#rankInfo').addEventListener('click', () => openSheet(`<h3>Drei Wertungen</h3><div class="stack">
  <div class="card"><b>Punkte</b><p class="small muted mt">Alle Match-Punkte zusammen (Sieg 3, Remis 1). Wer oft kommt, sammelt viel.</p></div>
  <div class="card"><b>Ø / Runde</b><p class="small muted mt">Punkte geteilt durch gespielte Runden – reine Spielstärke, egal wie oft du dabei warst. Maximum 3,00.</p></div>
  <div class="card"><b>Wertung</b><p class="small muted mt">Wie das Eternal Ranking: Punkte ÷ √(2·n·N / (n+N)), n = deine Weeklys, N = alle Weeklys. Liegt zwischen „Gesamtpunkte“ und „Schnitt“ – Teilnahme zählt, aber Leistung auch.</p></div>
</div><button class="btn block ghost mt" data-close>Schließen</button>`));

if(m.profile?.slug && weekly.events.some(e => e.rows.some(r => r.key === m.profile.slug))){
  $('#perfSec').hidden = false;
  $('#perfLink').href = `/player-profile.html?slug=${encodeURIComponent(m.profile.slug)}#weekly`;
  renderPerformance($('#perf'), weekly, m.profile.slug);
}
