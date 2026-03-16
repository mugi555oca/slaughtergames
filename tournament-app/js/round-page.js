import { requireAuthOrRedirect } from './auth.js';
import {
  getTournamentBundle,
  getRoundMatches,
  submitMatchResult,
  finalizeCurrentRound,
  getLiveStandings,
  formatPct,
  finishTournament,
  setPlayerDropped,
  standingsToCsvRows,
  generateNextRound
} from './tournament.js';

function $(id){ return document.getElementById(id); }
function qParam(name){ return new URLSearchParams(window.location.search).get(name); }

const RESULTS = ['pending','2:0','2:1','1:2','0:2','1:1','1:0','0:1','0:0','ID'];

let currentTournamentId = null;
let playerNameById = {};

function setMsg(text){ $('roundMsg').textContent = text || ''; }
function recordOf(s){ return `${s.wins}-${s.losses}-${s.draws}`; }

function setBusy(button, busy=true, busyLabel='Bitte warten...'){
  if(!button) return;
  if(busy){
    button.dataset.oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if(button.dataset.oldLabel) button.textContent = button.dataset.oldLabel;
  }
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function downloadCsv(filename, rows){
  const csv = rows.map(r => r.map(cell => `"${escapeHtml(String(cell)).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPdfLike(){
  const standings = await getLiveStandings(currentTournamentId);
  const w = window.open('', '_blank');
  if(!w) return;

  const rows = standings.map((s, idx) => `
    <tr>
      <td>${idx+1}</td><td>${s.name}</td><td>${recordOf(s)}</td><td>${s.matchPoints}</td>
      <td>${formatPct(s.omw)}</td><td>${formatPct(s.gw)}</td><td>${formatPct(s.ogw)}</td>
    </tr>`).join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Standings</title>
  <style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left}</style>
  </head><body>
    <h1>Standings Export</h1>
    <table><thead><tr><th>Rank</th><th>Name</th><th>Record</th><th>MP</th><th>OMW%</th><th>GW%</th><th>OGW%</th></tr></thead><tbody>${rows}</tbody></table>
    <script>window.print()</script>
  </body></html>`);
  w.document.close();
}

async function renderStandings(){
  const standings = await getLiveStandings(currentTournamentId);
  const body = $('standingsBody');
  body.innerHTML = '';

  standings.forEach((s, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${s.name} ${s.dropped ? '<span class="badge">dropped</span>' : ''}</td>
      <td>${recordOf(s)}</td>
      <td>${s.matchPoints}</td>
      <td>${formatPct(s.omw)}</td>
      <td>${formatPct(s.gw)}</td>
      <td>${formatPct(s.ogw)}</td>
      <td>
        <button data-drop="${s.id}" data-dropped="${s.dropped ? '1' : '0'}" class="secondary">
          ${s.dropped ? 'Rejoin' : 'Drop'}
        </button>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-drop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.getAttribute('data-drop');
      const isDropped = btn.getAttribute('data-dropped') === '1';
      await setPlayerDropped(pid, !isDropped);
      setMsg(isDropped ? 'Spieler wieder aktiviert.' : 'Spieler gedroppt.');
      await refreshAll();
    });
  });
}

async function renderMatches(roundNo){
  const matches = await getRoundMatches(currentTournamentId, roundNo);
  const body = $('matchesBody');
  body.innerHTML = '';

  for(const m of matches){
    const tr = document.createElement('tr');
    const playerA = playerNameById[m.player_a_id] || '-';
    const playerB = m.is_bye ? 'BYE' : (playerNameById[m.player_b_id] || '-');

    const opts = m.is_bye
      ? '<option value="BYE" selected>BYE</option>'
      : RESULTS.map(r => `<option value="${r}" ${m.result===r?'selected':''}>${r}</option>`).join('');

    tr.innerHTML = `
      <td>${m.table_no ?? ''}</td>
      <td>${playerA}</td>
      <td>${playerB}</td>
      <td><select id="res-${m.id}">${opts}</select></td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll('select[id^="res-"]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.id.replace('res-','');
      try{
        await submitMatchResult(id, sel.value);
        setMsg('Ergebnis automatisch gespeichert.');
        await refreshAll();
      }catch(err){ setMsg(err.message); }
    });
  });
}

async function refreshAll(){
  const bundle = await getTournamentBundle(currentTournamentId);
  const t = bundle.tournament;
  $('title').textContent = `${t.name} – Runde`;
  $('roundNo').textContent = t.current_round || '-';
  $('openBracket').href = `./bracket.html?tournament=${currentTournamentId}`;

  const activePlayers = bundle.players.filter(p => !p.dropped).length;
  const droppedPlayers = bundle.players.filter(p => p.dropped).length;
  $('kpiActivePlayers').textContent = `Aktive: ${activePlayers}`;
  $('kpiDroppedPlayers').textContent = `Dropped: ${droppedPlayers}`;

  playerNameById = Object.fromEntries(bundle.players.map(p => [p.id, p.name]));

  if(t.current_round === 0){
    $('matchesBody').innerHTML = '<tr><td colspan="4">Noch keine Runde erzeugt.</td></tr>';
    $('kpiRoundState').textContent = 'Rundenstatus: noch nicht gestartet';
    $('pairingMeta').textContent = 'Sobald du Runde 1 erzeugst, siehst du hier Pairing-Hinweise.';
  } else {
    const currentMatches = bundle.matches.filter(m => m.round_no === t.current_round);
    const open = currentMatches.filter(m => m.result === 'pending').length;
    $('kpiRoundState').textContent = open > 0 ? `Rundenstatus: ${open} Ergebnis(se) offen` : 'Rundenstatus: vollständig';
    const byes = currentMatches.filter(m => m.is_bye).length;
    $('pairingMeta').textContent = `Runde ${t.current_round}: ${currentMatches.length} Matches, ${byes} Bye(s).`;
    await renderMatches(t.current_round);
  }
  await renderStandings();
}

async function init(){
  const user = await requireAuthOrRedirect();
  if(!user) return;

  currentTournamentId = qParam('tournament');
  if(!currentTournamentId){ setMsg('Kein Turnier gewählt.'); return; }

  $('nextRoundBtn').addEventListener('click', async () => {
    const btn = $('nextRoundBtn');
    setBusy(btn, true, 'Generiere...');
    try{
      const gen = await generateNextRound(currentTournamentId);
      const note = gen.rematchCount > 0
        ? `Runde ${gen.roundNo} erzeugt. Achtung: ${gen.rematchCount} Rematch(es) unvermeidbar (Tisch ${gen.rematchTables.join(', ')}).`
        : `Runde ${gen.roundNo} erzeugt.`;
      setMsg(note);
      await refreshAll();
    }catch(err){ setMsg(err.message); }
    finally{ setBusy(btn, false); }
  });

  $('finalizeRoundBtn').addEventListener('click', async () => {
    const btn = $('finalizeRoundBtn');
    setBusy(btn, true, 'Finalisiere...');
    try{
      await finalizeCurrentRound(currentTournamentId);
      setMsg('Runde finalisiert. Tiebreaker neu berechnet.');
      await refreshAll();
    }catch(err){ setMsg(err.message); }
    finally{ setBusy(btn, false); }
  });

  $('finishTournamentBtn').addEventListener('click', async () => {
    const ok = confirm('Turnier wirklich abschließen? Danach werden keine neuen Runden mehr erzeugt.');
    if(!ok) return;

    const btn = $('finishTournamentBtn');
    setBusy(btn, true, 'Schließe ab...');
    try{
      await finishTournament(currentTournamentId);
      setMsg('Turnier abgeschlossen.');
      await refreshAll();
    }catch(err){ setMsg(err.message); }
    finally{ setBusy(btn, false); }
  });

  $('exportCsvBtn').addEventListener('click', async () => {
    const standings = await getLiveStandings(currentTournamentId);
    const rows = standingsToCsvRows(standings);
    downloadCsv('standings.csv', rows);
  });

  $('exportPdfBtn').addEventListener('click', async () => {
    await exportPdfLike();
  });

  await refreshAll();
}

init();
