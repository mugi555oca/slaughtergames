// Turnierseite (round.html?tournament=ID): Runde, Tabelle, Verlauf.
// Eine Seite fuer alle: Gaeste sehen nur zu, Mitglieder tragen in laufenden
// Turnieren ein und losen aus, der Admin darf auch abgeschlossene aendern.
// Die Grenze setzt die Datenbank (RLS), die UI blendet nur passend aus.
import { initShell, $, $$, esc, icon, supabase, loadPeople, personForName, openSheet, confirmSheet, toast, busy } from '/js/app.js';
import {
  getTournamentBundle, buildStandings, correctMatchResult, generateNextRound, finalizeCurrentRound,
  finishTournament, setPlayerDropped, reopenTournament, resetRoundsAfter, formatPct, standingsToCsvRows,
} from './tournament.js';
import { formatLabel, flip, outcome, myPlayerIds } from './t-shared.js';

const tid = new URLSearchParams(location.search).get('tournament');
const m = await initShell({ tab: 'turniere', title: 'Turnier', back: '/tournament-app/dashboard.html' });
const people = await loadPeople();

let B = null;            // Bundle
let viewRound = null;    // angezeigte Runde
let mine = new Set();

const RESULT_LABEL = { 'ID': 'ID', 'BYE': 'BYE', 'pending': '–' };


async function load(){
  try{
    B = await getTournamentBundle(tid);
  }catch(err){
    $('#tHead').innerHTML = `<div class="empty"><h3>Turnier nicht gefunden</h3><p>${esc(err.message)}</p></div>`;
    return;
  }
  mine = myPlayerIds(B.players, m.profile?.slug);
  const cur = Number(B.tournament.current_round) || 0;
  if(viewRound === null || viewRound > cur) viewRound = cur;
  render();
}

const canEdit = () => m.isAdmin || (m.isMember && B.tournament.status === 'active');
const playerById = id => B.players.find(p => p.id === id);
const personOf = pl => pl?.slug ? people.bySlug.get(pl.slug) : personForName(people, pl?.name);
const avatarOf = pl => personOf(pl)?.avatar || '/icons/icon-192.png';
const nameOf = pl => pl ? (personOf(pl)?.real || pl.name) : '?';

function render(){
  const t = B.tournament;
  const cur = Number(t.current_round) || 0;
  const live = t.status === 'active';
  document.title = `${t.name} – Turnier`;
  document.querySelector('.app-bar .title').textContent = t.name;

  $('#tHead').innerHTML = `
    <div class="row wrap" style="gap:6px">
      ${live ? `<span class="chip live">LIVE · Runde ${cur}/${t.rounds_total}</span>` : '<span class="chip done">Beendet</span>'}
      <span class="chip">${esc(formatLabel(t.format_key))}${t.edi_code ? ' · ' + esc(t.edi_code) : ''}</span>
      <span class="chip">${B.players.filter(p => !p.dropped).length} Spieler</span>
    </div>
    <h1 style="font-size:24px;margin:10px 2px 0">${esc(t.name)}</h1>
    <p class="small muted" style="margin:2px 2px 0">${new Date(t.created_at).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>`;

  renderMine();
  renderRound();
  renderTable();
  renderHistory();
  renderActions();
  renderAdmin();
}

// ---------------------------------------------------------------
// Deine Partie
// ---------------------------------------------------------------
function renderMine(){
  const host = $('#mine');
  const t = B.tournament;
  const cur = Number(t.current_round) || 0;
  const match = B.matches.find(x => x.round_no === cur && (mine.has(x.player_a_id) || mine.has(x.player_b_id)));
  if(!match || t.status !== 'active' || !m.user){ host.innerHTML = ''; return; }

  if(match.is_bye){
    host.innerHTML = `<div class="match-card mine mt"><div class="match-head"><span>Deine Partie · Runde ${cur}</span></div>
      <b>Bye</b> – diese Runde hast du frei (zählt als 2:0-Sieg).</div>`;
    return;
  }
  const iAmA = mine.has(match.player_a_id);
  const opp = playerById(iAmA ? match.player_b_id : match.player_a_id);
  const myRes = match.result === 'pending' ? null : (iAmA ? match.result : flip(match.result));
  const pad = ['2:0', '2:1', '1:1', '1:2', '0:2', 'ID'];
  const sub = r => ({ '2:0': 'Sieg', '2:1': 'Sieg', '1:1': 'Remis', '1:2': 'Niederlage', '0:2': 'Niederlage', 'ID': 'Intentional Draw' }[r]);

  host.innerHTML = `<div class="match-card mine mt">
    <div class="match-head"><span>Deine Partie · Runde ${cur} · Tisch ${match.table_no ?? '?'}</span>
      ${myRes ? '<span class="chip ok">eingetragen</span>' : '<span class="chip gold">offen</span>'}</div>
    <div class="row" style="gap:10px;margin-bottom:12px">
      <img class="avatar" src="${esc(avatarOf(opp))}" alt="">
      <div class="grow"><div class="small muted">Gegner</div><div style="font-weight:700">${esc(nameOf(opp))}</div></div>
      ${myRes ? `<div style="font-size:26px;font-weight:800">${esc(myRes)}</div>` : ''}
    </div>
    <div class="small muted mb">${myRes ? 'Falsch? Einfach neu tippen:' : 'Ergebnis aus deiner Sicht eintragen:'}</div>
    <div class="result-pad">${pad.map(r => `<button type="button" data-my="${r}" class="${myRes === r ? 'on' : ''}">${r}<small>${sub(r)}</small></button>`).join('')}</div>
  </div>`;
  host.querySelectorAll('[data-my]').forEach(b => b.addEventListener('click', async () => {
    const r = iAmA ? b.dataset.my : flip(b.dataset.my);
    await saveResult(match, r);
  }));
}

async function saveResult(match, result){
  try{
    const res = await correctMatchResult(match.id, result);
    toast(res.changed ? 'Ergebnis gespeichert.' : 'Unverändert.', 'ok');
    if(navigator.vibrate) navigator.vibrate(15);
    await load();
  }catch(err){
    toast(/row-level|permission|policy/i.test(err.message) ? 'Keine Berechtigung – das Turnier ist abgeschlossen.' : err.message, 'err');
  }
}

// ---------------------------------------------------------------
// Runde
// ---------------------------------------------------------------
function matchCard(x, editable){
  const a = playerById(x.player_a_id), b = playerById(x.player_b_id);
  const o = outcome(x.result);
  const isMine = mine.has(x.player_a_id) || mine.has(x.player_b_id);
  const nameHtml = (pl, won) => `<span class="nm" style="${won ? 'color:var(--text)' : o ? 'color:var(--muted)' : ''}">${esc(nameOf(pl))}</span>`;
  if(x.is_bye){
    return `<div class="match-card ${isMine ? 'mine' : ''}"><div class="match-head"><span>Tisch ${x.table_no ?? ''}</span><span>Bye</span></div>
      <div class="vs"><div class="p"><img class="avatar sm" src="${esc(avatarOf(a))}" alt="">${nameHtml(a, true)}</div><span class="score">BYE</span><div class="p b"></div></div></div>`;
  }
  return `<div class="match-card ${isMine ? 'mine' : ''}">
    <div class="match-head"><span>Tisch ${x.table_no ?? ''}</span>${x.result === 'pending' ? '<span class="gold">offen</span>' : ''}</div>
    <div class="vs">
      <div class="p"><img class="avatar sm" src="${esc(avatarOf(a))}" alt="">${nameHtml(a, o === 'A')}</div>
      <button type="button" class="score ${x.result === 'pending' ? 'pending' : ''}" data-match="${x.id}" ${editable ? '' : 'disabled'}>
        ${x.result === 'pending' ? (editable ? 'Eintragen' : 'offen') : esc(RESULT_LABEL[x.result] || x.result)}</button>
      <div class="p b"><img class="avatar sm" src="${esc(avatarOf(b))}" alt="">${nameHtml(b, o === 'B')}</div>
    </div></div>`;
}

function renderRound(){
  const host = $('#vRound');
  const cur = Number(B.tournament.current_round) || 0;
  if(cur === 0){ host.innerHTML = `<div class="card empty">${icon('swords')}<h3>Noch keine Runde</h3><p>Runde 1 unten auslosen.</p></div>`; return; }
  const matches = B.matches.filter(x => x.round_no === viewRound);
  const open = matches.filter(x => x.result === 'pending').length;
  const editable = canEdit();
  host.innerHTML = `
    ${cur > 1 ? `<div class="seg mb">${Array.from({ length: cur }, (_, i) => i + 1).map(n =>
      `<button data-r="${n}" class="${n === viewRound ? 'on' : ''}">R${n}</button>`).join('')}</div>` : ''}
    <div class="row between small muted mb" style="margin:0 2px 8px"><span>Runde ${viewRound}</span>
      <span>${open ? `${open} offen` : 'alle Ergebnisse da'}</span></div>
    ${matches.map(x => matchCard(x, editable)).join('')}`;
  host.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => { viewRound = Number(b.dataset.r); renderRound(); }));
  host.querySelectorAll('[data-match]').forEach(b => b.addEventListener('click', () => resultSheet(B.matches.find(x => x.id === b.dataset.match))));
}

function resultSheet(x){
  const a = playerById(x.player_a_id), b = playerById(x.player_b_id);
  const main = ['2:0', '2:1', '1:1', '1:2', '0:2', 'ID'];
  const more = ['1:0', '0:0', '0:1'];
  const finished = B.tournament.status === 'finished';
  const s = openSheet(`<h3>Runde ${x.round_no} · Tisch ${x.table_no ?? ''}</h3>
    ${finished ? '<p class="small gold mb">Abgeschlossenes Turnier – Standings und Ranking werden neu berechnet.</p>' : ''}
    <div class="vs mb" style="grid-template-columns:1fr auto 1fr">
      <div class="p"><img class="avatar sm" src="${esc(avatarOf(a))}" alt=""><span class="nm">${esc(nameOf(a))}</span></div>
      <span class="muted small">vs</span>
      <div class="p b"><img class="avatar sm" src="${esc(avatarOf(b))}" alt=""><span class="nm">${esc(nameOf(b))}</span></div>
    </div>
    <div class="result-pad">${main.map(r => `<button data-r="${r}" class="${x.result === r ? 'on' : ''}">${r}</button>`).join('')}</div>
    <div class="result-pad mt">${more.map(r => `<button data-r="${r}" class="${x.result === r ? 'on' : ''}" style="height:44px;font-size:15px">${r}</button>`).join('')}</div>
    <p class="hint center mt">Links steht immer ${esc(nameOf(a))}.</p>
    <button class="btn block ghost mt" data-close>Abbrechen</button>`);
  s.el.querySelectorAll('[data-r]').forEach(btn => btn.addEventListener('click', async () => {
    s.close();
    await saveResult(x, btn.dataset.r);
  }));
}

// ---------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------
function renderTable(){
  const cur = Number(B.tournament.current_round) || 0;
  const st = buildStandings(B.players, B.matches, cur);
  const editable = canEdit() && B.tournament.status === 'active';
  $('#vTable').innerHTML = `<div class="rank-list">${st.map((s, i) => {
    const pl = playerById(s.id);
    return `<div class="rank-row" ${editable ? `data-pl="${s.id}" style="cursor:pointer"` : ''}>
      <span class="rank-no">${i + 1}</span>
      <img class="avatar sm" src="${esc(avatarOf(pl))}" alt="">
      <span class="who"><span class="title">${esc(nameOf(pl))}${s.dropped ? ' <span class="chip" style="height:20px;font-size:11px">drop</span>' : ''}</span>
        <span class="sub">${s.wins}-${s.losses}-${s.draws} · OMW ${formatPct(s.omw)} · GW ${formatPct(s.gw)}</span></span>
      <span class="pts">${s.matchPoints}<small>Punkte</small></span>
    </div>`;
  }).join('')}</div>
  <p class="hint mt">Tiebreaker: Punkte, OMW%, GW%, OGW% (MW/GW mindestens 33 %).</p>`;
  $$('#vTable [data-pl]').forEach(row => row.addEventListener('click', async () => {
    const pl = playerById(row.dataset.pl);
    const ok = await confirmSheet(pl.dropped ? 'Spieler wieder aufnehmen?' : 'Spieler droppen?',
      pl.dropped ? `${nameOf(pl)} wird ab der nächsten Runde wieder gepaart.` : `${nameOf(pl)} wird ab der nächsten Runde nicht mehr gepaart.`,
      pl.dropped ? 'Wieder aufnehmen' : 'Droppen', !pl.dropped);
    if(!ok) return;
    try{ await setPlayerDropped(pl.id, !pl.dropped); await load(); }catch(err){ toast(err.message, 'err'); }
  }));
}

// ---------------------------------------------------------------
// Verlauf
// ---------------------------------------------------------------
function renderHistory(){
  const cur = Number(B.tournament.current_round) || 0;
  if(!cur){ $('#vHistory').innerHTML = '<div class="empty">Noch nichts gespielt.</div>'; return; }
  let html = '';
  for(let r = 1; r <= cur; r++){
    const ms = B.matches.filter(x => x.round_no === r);
    html += `<div class="section-head" style="margin-top:${r > 1 ? 18 : 0}px"><h2>Runde ${r}</h2></div><div class="list">${ms.map(x => {
      const a = playerById(x.player_a_id), b = playerById(x.player_b_id);
      const o = outcome(x.result);
      return `<div class="list-item" style="min-height:48px">
        <span class="faint small" style="width:20px">${x.table_no ?? ''}</span>
        <span class="grow small" style="${o === 'A' ? 'font-weight:700' : ''}">${esc(nameOf(a))}</span>
        <b style="font-variant-numeric:tabular-nums">${esc(x.result === 'pending' ? '–' : x.result)}</b>
        <span class="grow small" style="text-align:right;${o === 'B' ? 'font-weight:700' : ''}">${x.is_bye ? '' : esc(nameOf(b))}</span>
      </div>`;
    }).join('')}</div>`;
  }
  $('#vHistory').innerHTML = html;
}

// ---------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------
function renderActions(){
  const host = $('#actions');
  const t = B.tournament;
  const cur = Number(t.current_round) || 0;
  const total = Number(t.rounds_total) || 0;
  const open = B.matches.filter(x => x.round_no === cur && x.result === 'pending').length;
  let main = '';

  if(t.status === 'active' && m.isMember){
    if(cur === 0) main = `<button class="btn block" id="nextBtn">Runde 1 auslosen</button>`;
    else if(open) main = `<div class="card small muted center">Noch ${open} Ergebnis${open === 1 ? '' : 'se'} offen – danach geht's weiter.</div>`;
    else if(cur < total) main = `<button class="btn block" id="nextBtn">${icon('refresh')} Runde ${cur + 1} auslosen</button>`;
    else main = `<button class="btn block gold" id="finishBtn">${icon('trophy')} Turnier abschließen</button>`;
  }
  host.innerHTML = `${main}
    <div class="btn-row mt">
      <button class="btn ghost sm" id="shareBtn">${icon('share')} Teilen</button>
      <button class="btn ghost sm" id="csvBtn">${icon('download')} CSV</button>
    </div>`;

  $('#nextBtn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    let finalMode = 'swiss';
    if(cur + 1 === total && total === 3){
      finalMode = await new Promise(resolve => {
        let picked = null;
        const s = openSheet(`<h3>Finalrunde – wie paaren?</h3><div class="stack">
          <button class="btn block" data-m="swiss">Standard Swiss</button>
          <button class="btn block ghost" data-m="bracket">Bracket-Pairing</button>
          <p class="hint">Bracket: Platz 1 gegen 2, 3 gegen 4 … nach dem Stand nach Runde 2.</p></div>`,
          { onClose: () => resolve(picked) });
        s.el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { picked = b.dataset.m; s.close(); });
      });
      if(!finalMode) return;
    }
    busy(btn, true, 'Lose aus…');
    try{
      if(cur > 0) await finalizeCurrentRound(tid);
      const gen = await generateNextRound(tid, { finalRoundMode: finalMode });
      toast(`Runde ${gen.roundNo} ausgelost${gen.rematchCount ? ` – ${gen.rematchCount} Rematch(es) unvermeidbar` : ''}.`, 'ok');
      viewRound = gen.roundNo;
      await load();
      showView('round');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }catch(err){ toast(err.message, 'err'); busy(btn, false); }
  });

  $('#finishBtn')?.addEventListener('click', async e => {
    if(!await confirmSheet('Turnier abschließen?', 'Danach kann nur noch der Admin Ergebnisse ändern.', 'Abschließen')) return;
    busy(e.currentTarget, true, 'Schließe ab…');
    try{ await finishTournament(tid); toast('Turnier abgeschlossen. GG!', 'ok'); await load(); showView('table'); }
    catch(err){ toast(err.message, 'err'); }
  });

  $('#shareBtn').addEventListener('click', async () => {
    const url = `${location.origin}/tournament-app/round.html?tournament=${tid}`;
    if(navigator.share){ try{ await navigator.share({ title: t.name, url }); }catch{} }
    else { await navigator.clipboard?.writeText(url); toast('Link kopiert.'); }
  });
  $('#csvBtn').addEventListener('click', () => {
    const rows = standingsToCsvRows(buildStandings(B.players, B.matches, cur));
    const csv = rows.map(r => r.map(c => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${t.name.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
  });
}

// ---------------------------------------------------------------
// Admin / Owner
// ---------------------------------------------------------------
function renderAdmin(){
  const host = $('#admin');
  const t = B.tournament;
  const cur = Number(t.current_round) || 0;
  const isOwner = m.user && t.owner_id === m.user.id;
  if(!m.isAdmin && !(isOwner && t.status === 'active')){ host.innerHTML = ''; return; }

  host.innerHTML = `<details class="details"><summary>${icon('shield')} ${m.isAdmin ? 'Admin' : 'Turnier verwalten'}</summary><div class="body stack">
    ${m.isAdmin && t.status === 'finished' ? `<p class="small muted">Als Admin kannst du oben direkt Ergebnisse ändern – Standings und Ranking werden neu berechnet.</p>
      <button class="btn ghost" id="reopenBtn">Turnier wieder öffnen</button>` : ''}
    ${m.isAdmin && cur > 1 ? `<div class="row" style="gap:8px"><select class="input grow" id="resetSel">${Array.from({ length: cur - 1 }, (_, i) =>
      `<option value="${i + 1}">nach Runde ${i + 1}</option>`).join('')}</select>
      <button class="btn danger" id="resetBtn">Neu auslosen</button></div>
      <p class="hint">Löscht alle späteren Runden samt Ergebnissen, damit mit korrigierten Ergebnissen neu ausgelost werden kann.</p>` : ''}
    <button class="btn danger" id="delBtn">${icon('trash')} Turnier löschen</button>
  </div></details>`;
  host.querySelectorAll('summary svg').forEach(s => { s.style.cssText = 'width:18px;height:18px;margin-right:6px;vertical-align:-3px'; });

  $('#reopenBtn')?.addEventListener('click', async () => {
    if(!await confirmSheet('Wieder öffnen?', 'Das Turnier wird wieder aktiv – alle Mitglieder können dann wieder eintragen.', 'Öffnen')) return;
    try{ await reopenTournament(tid); toast('Turnier ist wieder offen.', 'ok'); await load(); }catch(err){ toast(err.message, 'err'); }
  });
  $('#resetBtn')?.addEventListener('click', async () => {
    const keep = Number($('#resetSel').value);
    if(!await confirmSheet(`Runden nach ${keep} löschen?`, `Runde ${keep + 1} bis ${cur} und deren Ergebnisse werden gelöscht. Nicht rückgängig zu machen.`, 'Löschen', true)) return;
    try{ const r = await resetRoundsAfter(tid, keep); toast(`${r.removedRounds} Runde(n) gelöscht.`, 'ok'); viewRound = keep; await load(); }catch(err){ toast(err.message, 'err'); }
  });
  $('#delBtn').addEventListener('click', async () => {
    if(!await confirmSheet('Turnier löschen?', `„${t.name}“ wird mit allen Runden und Ergebnissen endgültig gelöscht.`, 'Endgültig löschen', true)) return;
    const { error } = await supabase.from('tournaments').delete().eq('id', tid);
    if(error){ toast(error.message, 'err'); return; }
    location.replace('/tournament-app/dashboard.html');
  });
}

// ---------------------------------------------------------------
// Tabs + Live
// ---------------------------------------------------------------
function showView(v){
  $$('.seg[role=tablist] button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#vRound').hidden = v !== 'round';
  $('#vTable').hidden = v !== 'table';
  $('#vHistory').hidden = v !== 'history';
}
function setupTabs(){
  $$('.seg[role=tablist] button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  if(location.hash === '#verlauf') showView('history');
  else if(B?.tournament.status === 'finished') showView('table');
}

function subscribe(){
  let timer = null;
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 350); };
  supabase.channel('t-' + tid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tid}` }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, reload)
    .subscribe();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) load(); });
}

// ---------------------------------------------------------------
// Start (am Ende, damit alle Funktionen/Konstanten initialisiert sind)
// ---------------------------------------------------------------
if(!tid){
  $('#tHead').innerHTML = '<div class="empty">Kein Turnier gewählt.</div>';
} else {
  await load();
  setupTabs();
  subscribe();
}
