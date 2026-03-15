import { requireAuthOrRedirect } from './auth.js';
import { getTournamentBundle } from './tournament.js';

function qParam(name){ return new URLSearchParams(window.location.search).get(name); }
function $(id){ return document.getElementById(id); }

function resultLabel(m){
  if(m.result === 'pending') return '<span class="badge">offen</span>';
  return `<span class="badge">${m.result}</span>`;
}

async function init(){
  const user = await requireAuthOrRedirect();
  if(!user) return;

  const tournamentId = qParam('tournament');
  if(!tournamentId) return;

  $('toRoundLink').href = `./round.html?tournament=${tournamentId}`;

  const bundle = await getTournamentBundle(tournamentId);
  const nameById = Object.fromEntries(bundle.players.map(p => [p.id, p.name]));
  $('bTitle').textContent = `${bundle.tournament.name} – Pairings`;

  const rounds = new Map();
  for(const m of bundle.matches){
    if(!rounds.has(m.round_no)) rounds.set(m.round_no, []);
    rounds.get(m.round_no).push(m);
  }

  const host = $('roundLadder');
  host.innerHTML = '';

  const allMatches = bundle.matches.length;
  $('bKpiRounds').textContent = `Runden: ${rounds.size}`;
  $('bKpiMatches').textContent = `Matches: ${allMatches}`;

  if(rounds.size === 0){
    host.innerHTML = '<p class="muted">Noch keine Runde generiert.</p>';
    return;
  }

  [...rounds.keys()].sort((a,b)=>a-b).forEach(rn => {
    const card = document.createElement('div');
    card.className = 'card';
    const matches = rounds.get(rn).sort((a,b)=>(a.table_no||0)-(b.table_no||0));

    const rows = matches.map(m => {
      const a = nameById[m.player_a_id] || '-';
      const b = m.is_bye ? 'BYE' : (nameById[m.player_b_id] || '-');
      return `<tr><td>${m.table_no ?? ''}</td><td>${a}</td><td>${b}</td><td>${resultLabel(m)}</td></tr>`;
    }).join('');

    card.innerHTML = `
      <h3>Runde ${rn}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tisch</th><th>Spieler A</th><th>Spieler B</th><th>Ergebnis</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    host.appendChild(card);
  });
}

init();
