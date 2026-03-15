import { getTournamentBundle, getLiveStandings, formatPct } from './tournament.js';
import { supabase } from './supabase-client.js';

function qParam(name){ return new URLSearchParams(window.location.search).get(name); }
function $(id){ return document.getElementById(id); }
function recordOf(s){ return `${s.wins}-${s.losses}-${s.draws}`; }

async function render(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  const standings = await getLiveStandings(tournamentId);

  $('sTitle').textContent = `${bundle.tournament.name} – Spectator`;
  $('toBracket').href = `./bracket.html?tournament=${tournamentId}`;

  $('sMeta').textContent = `Aktuelle Runde: ${bundle.tournament.current_round}/${bundle.tournament.rounds_total} · Status: ${bundle.tournament.status}`;

  const body = $('sStandings');
  body.innerHTML = standings.map((s, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${s.name}</td>
      <td>${recordOf(s)}</td>
      <td>${s.matchPoints}</td>
      <td>${formatPct(s.omw)}</td>
      <td>${formatPct(s.gw)}</td>
      <td>${formatPct(s.ogw)}</td>
    </tr>
  `).join('');
}

async function init(){
  const tournamentId = qParam('tournament');
  if(!tournamentId){ $('sMeta').textContent = 'Kein Turnier gewählt.'; return; }

  await render(tournamentId);

  supabase
    .channel(`spectator-${tournamentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, async () => {
      await render(tournamentId);
    })
    .subscribe();
}

init();
