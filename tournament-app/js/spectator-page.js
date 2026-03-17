import { getTournamentBundle, getLiveStandings, formatPct } from './tournament.js';
import { supabase } from './supabase-client.js';

function qParam(name){ return new URLSearchParams(window.location.search).get(name); }
function $(id){ return document.getElementById(id); }
function recordOf(s){ return `${s.wins}-${s.losses}-${s.draws}`; }

function renderRounds(bundle){
  const nameById = Object.fromEntries(bundle.players.map(p => [p.id, p.name]));
  const rounds = new Map();
  for(const m of bundle.matches){
    if(!rounds.has(m.round_no)) rounds.set(m.round_no, []);
    rounds.get(m.round_no).push(m);
  }

  const host = $('sRounds');
  host.innerHTML = '';

  if(rounds.size === 0){
    host.innerHTML = '<p class="muted">Noch keine Runde generiert.</p>';
    return;
  }

  [...rounds.keys()].sort((a,b)=>a-b).forEach(rn => {
    const matches = rounds.get(rn).sort((a,b)=>(a.table_no||0)-(b.table_no||0));
    const rows = matches.map(m => {
      const a = nameById[m.player_a_id] || '-';
      const b = m.is_bye ? 'BYE' : (nameById[m.player_b_id] || '-');
      const res = m.result === 'pending' ? '<span class="badge">offen</span>' : `<span class="badge">${m.result}</span>`;
      return `<tr><td>${m.table_no ?? ''}</td><td>${a}</td><td>${b}</td><td>${res}</td></tr>`;
    }).join('');

    const block = document.createElement('div');
    block.className = 'card';
    block.innerHTML = `
      <h3>Runde ${rn}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tisch</th><th>Spieler A</th><th>Spieler B</th><th>Ergebnis</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    host.appendChild(block);
  });
}

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

  renderRounds(bundle);
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
