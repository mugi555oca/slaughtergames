// Turniere-Tab: laufende und abgeschlossene Drafts, "Deine Partie", Ranking.
import { initShell, $, esc, icon, supabase, loadPeople, personForName } from '/js/app.js';
import { getGlobalRanking } from './tournament.js';
import { FORMATS, formatLabel, flip } from './t-shared.js';

const m = await initShell({ tab: 'turniere', title: 'Turniere' });
if(m.isMember) $('#newBtn').hidden = false;

const people = await loadPeople();
const { data: tournaments, error } = await supabase.from('tournaments')
  .select('id,name,status,current_round,rounds_total,format_key,edi_code,created_at').order('created_at', { ascending: false });
if(error){ $('#done').innerHTML = `<div class="empty">${esc(error.message)}</div>`; throw error; }

const live = tournaments.filter(t => t.status === 'active');
const done = tournaments.filter(t => t.status !== 'active');

const item = t => `<a class="list-item" href="/tournament-app/round.html?tournament=${t.id}">
  ${t.status === 'active' ? '<span class="chip live" style="padding:0 8px">LIVE</span>' : `<span class="faint small" style="width:44px;text-align:center;line-height:1.1">${new Date(t.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}<br>${new Date(t.created_at).getFullYear()}</span>`}
  <div class="grow"><div class="title ellipsis">${esc(t.name)}</div>
  <div class="sub">${esc(formatLabel(t.format_key))}${t.edi_code ? ' · ' + esc(t.edi_code) : ''}${t.status === 'active' ? ` · Runde ${t.current_round}/${t.rounds_total}` : ''}</div></div>
  <span class="trail" data-winner="${t.id}"></span>${icon('chev', 'chev')}
</a>`;

if(live.length){ $('#liveSec').hidden = false; $('#live').innerHTML = live.map(item).join(''); }
$('#done').innerHTML = done.map(item).join('') || `<div class="empty">${icon('swords')}<h3>Noch keine Turniere</h3></div>`;

// Sieger der abgeschlossenen Turniere (Snapshot der letzten Runde)
if(done.length){
  const { data: stats } = await supabase.from('player_round_stats')
    .select('tournament_id,player_id,round_no,match_points,omw,gw,ogw').in('tournament_id', done.map(t => t.id));
  const { data: players } = await supabase.from('players').select('id,name,slug').in('tournament_id', done.map(t => t.id));
  for(const t of done){
    const rows = (stats || []).filter(s => s.tournament_id === t.id && s.round_no === t.current_round)
      .sort((a, b) => b.match_points - a.match_points || b.omw - a.omw || b.gw - a.gw || b.ogw - a.ogw);
    const w = players?.find(p => p.id === rows[0]?.player_id);
    if(!w) continue;
    const p = (w.slug && people.bySlug.get(w.slug)) || personForName(people, w.name);
    const el = document.querySelector(`[data-winner="${t.id}"]`);
    if(el) el.innerHTML = `<img class="avatar xs" src="${esc(p?.avatar || '/icons/icon-192.png')}" alt="" title="Sieger: ${esc(p?.real || w.name)}">`;
  }
}

// ---------- Deine Partie in laufenden Turnieren ----------
if(m.profile?.slug && live.length){
  const { data: myPlayers } = await supabase.from('players').select('id,tournament_id').eq('slug', m.profile.slug).in('tournament_id', live.map(t => t.id));
  const cards = [];
  for(const pl of myPlayers || []){
    const t = live.find(x => x.id === pl.tournament_id);
    const { data: ms } = await supabase.from('matches').select('*').eq('tournament_id', t.id).eq('round_no', t.current_round)
      .or(`player_a_id.eq.${pl.id},player_b_id.eq.${pl.id}`);
    const x = ms?.[0];
    if(!x) continue;
    let oppName = 'Bye';
    if(!x.is_bye){
      const oppId = x.player_a_id === pl.id ? x.player_b_id : x.player_a_id;
      const { data: opp } = await supabase.from('players').select('name,slug').eq('id', oppId).single();
      const p = (opp?.slug && people.bySlug.get(opp.slug)) || personForName(people, opp?.name);
      oppName = p?.real || opp?.name || '?';
    }
    const res = x.result === 'pending' ? null : (x.player_a_id === pl.id ? x.result : flip(x.result));
    cards.push(`<a class="match-card mine" href="/tournament-app/round.html?tournament=${t.id}" style="display:block">
      <div class="match-head"><span>${esc(t.name)} · Runde ${t.current_round}</span>${res ? '<span class="chip ok">eingetragen</span>' : x.is_bye ? '' : '<span class="chip gold">Ergebnis eintragen</span>'}</div>
      <div class="row"><div class="grow"><div class="small muted">${x.is_bye ? 'Diese Runde' : `Tisch ${x.table_no ?? '?'} gegen`}</div>
      <div style="font-weight:700;font-size:17px">${esc(oppName)}</div></div>
      ${res ? `<b style="font-size:22px">${esc(res)}</b>` : icon('chev', 'chev')}</div></a>`);
  }
  if(cards.length) $('#mine').innerHTML = `<div class="section-head mt"><h2>Deine Partie</h2></div>${cards.join('')}`;
}

// ---------- Ranking ueber alle App-Turniere ----------
$('#fmtFilter').innerHTML = `<option value="">Alle Formate</option>` + FORMATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
async function paintGlobal(){
  $('#global').innerHTML = '<div class="spinner"></div>';
  const rows = await getGlobalRanking({ formatKey: $('#fmtFilter').value || null });
  $('#global').innerHTML = rows.map((r, i) => {
    const p = personForName(people, r.name);
    return `<a class="rank-row" ${p ? `href="/player-profile.html?slug=${encodeURIComponent(p.slug)}"` : ''}>
      <span class="rank-no">${i + 1}</span><img class="avatar sm" src="${esc(p?.avatar || '/icons/icon-192.png')}" alt="">
      <span class="who"><span class="title">${esc(p?.real || r.name)}</span><span class="sub">${r.totalTournaments} Turniere</span></span>
      <span class="pts">${r.totalMatchPoints}<small>Punkte</small></span></a>`;
  }).join('') || '<div class="empty">Keine Daten.</div>';
}
let painted = false;
$('#globalBox').addEventListener('toggle', () => { if($('#globalBox').open && !painted){ painted = true; paintGlobal(); } });
$('#fmtFilter').addEventListener('change', paintGlobal);
