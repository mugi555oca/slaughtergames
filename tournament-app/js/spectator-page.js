import { getTournamentBundle, getLiveStandings, formatPct } from './tournament.js';
import { supabase } from './supabase-client.js';

function qParam(name){ return new URLSearchParams(window.location.search).get(name); }
function $(id){ return document.getElementById(id); }
function recordOf(s){ return `${s.wins}-${s.losses}-${s.draws}`; }

let profileSlugByName = {};

function profileLink(name){
  const slug = profileSlugByName[name];
  if(!slug) return name;
  return `<a href="../player-profile.html?slug=${encodeURIComponent(slug)}">${name}</a>`;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderRounds(bundle){
  const host = $('sRounds');
  if(!host) return;

  const nameById = Object.fromEntries(bundle.players.map(p => [p.id, p.name]));
  const currentRound = Number(bundle.tournament.current_round) || 0;
  const isFinished = bundle.tournament.status === 'finished';

  const rounds = new Map();
  for(const m of bundle.matches){
    if(!rounds.has(m.round_no)) rounds.set(m.round_no, []);
    rounds.get(m.round_no).push(m);
  }

  host.innerHTML = '';
  if(rounds.size === 0){
    host.innerHTML = '<p class="muted">Noch keine Runde generiert.</p>';
    return;
  }

  // Laeuft das Turnier, steht die aktuelle Runde oben - das ist das, was man
  // live sehen will. Ist es vorbei, liest man die Historie von Runde 1 an.
  const order = [...rounds.keys()].sort((a, b) => a - b);
  if(!isFinished && currentRound > 0){
    order.sort((a, b) => (b === currentRound) - (a === currentRound) || a - b);
  }

  for(const rn of order){
    const matches = rounds.get(rn).sort((a, b) => (a.table_no || 0) - (b.table_no || 0));
    const open = matches.filter(m => m.result === 'pending').length;
    const isCurrent = !isFinished && rn === currentRound;

    const rows = matches.map(m => {
      const a = nameById[m.player_a_id] || '-';
      const b = m.is_bye ? 'BYE' : (nameById[m.player_b_id] || '-');
      const res = m.result === 'pending'
        ? '<span class="badge">offen</span>'
        : `<span class="badge">${m.result}</span>`;
      return `<tr><td>${m.table_no ?? ''}</td><td>${profileLink(a)}</td><td>${m.is_bye ? b : profileLink(b)}</td><td>${res}</td></tr>`;
    }).join('');

    const label = isCurrent
      ? (open > 0
          ? `<span class="badge" style="background:#2f855a;color:#fff">läuft · ${open} offen</span>`
          : '<span class="badge" style="background:#2f855a;color:#fff">läuft · alle Ergebnisse da</span>')
      : (open > 0 ? '<span class="badge">unvollständig</span>' : '');

    const block = document.createElement('div');
    block.className = 'card';
    if(isCurrent) block.style.border = '2px solid var(--ok, #2f855a)';
    block.innerHTML = `
      <h3 style="display:flex;align-items:center;gap:10px">Runde ${rn} ${label}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tisch</th><th>Spieler A</th><th>Spieler B</th><th>Ergebnis</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    host.appendChild(block);
  }
}

function renderStandings(standings, isFinished){
  const body = $('sStandings');
  body.innerHTML = standings.map((s, idx) => {
    const medal = isFinished && idx < 3 ? `${MEDALS[idx]} ` : '';
    const weight = isFinished && idx < 3 ? ' style="font-weight:bold"' : '';
    return `
      <tr${weight}>
        <td>${medal}${idx + 1}</td>
        <td>${profileLink(s.name)}</td>
        <td>${recordOf(s)}</td>
        <td>${s.matchPoints}</td>
        <td>${formatPct(s.omw)}</td>
        <td>${formatPct(s.gw)}</td>
        <td>${formatPct(s.ogw)}</td>
      </tr>`;
  }).join('');
}

async function render(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  if(!bundle.tournament) throw new Error('Turnier nicht gefunden oder nicht sichtbar.');

  const standings = await getLiveStandings(tournamentId);
  const t = bundle.tournament;
  const isFinished = t.status === 'finished';
  const currentRound = Number(t.current_round) || 0;
  const openNow = bundle.matches.filter(m => m.round_no === currentRound && m.result === 'pending').length;

  $('sTitle').textContent = `${t.name} – Spectator`;
  $('toBracket').href = `./bracket.html?tournament=${tournamentId}`;

  $('sStatus').textContent = isFinished ? 'Turnier beendet' : 'Live';
  $('sStatus').style.background = isFinished ? '' : '#2f855a';
  $('sStatus').style.color = isFinished ? '' : '#fff';
  $('sProgress').textContent = `Runde ${currentRound}/${t.rounds_total}`;
  $('sOpen').textContent = isFinished
    ? `${standings.length} Spieler`
    : (openNow > 0 ? `${openNow} Ergebnis(se) offen` : 'Runde vollständig');

  // Live: die Runden fuehren, Tabelle darunter.
  // Beendet: Pairings als Historie, darunter der Endstand.
  $('sRoundsTitle').textContent = isFinished ? 'Pairings' : 'Runden';
  $('sStandingsTitle').textContent = isFinished ? 'Endstand' : 'Live Standings';
  $('sMeta').textContent = isFinished
    ? `Abgeschlossen nach ${currentRound} Runden · Sieger: ${standings[0]?.name ?? '-'}`
    : `Aktuelle Runde: ${currentRound}/${t.rounds_total} · wird automatisch aktualisiert`;

  renderStandings(standings, isFinished);
  renderRounds(bundle);
}

async function init(){
  try{
    const pr = await fetch('./player_profiles.json', { cache:'no-store' });
    const arr = await pr.json();
    profileSlugByName = Object.fromEntries(arr.map(x => [x.name, x.slug]));
  }catch{}

  const tournamentId = qParam('tournament');
  if(!tournamentId){ $('sMeta').textContent = 'Kein Turnier gewählt.'; return; }

  // Die Lesepolicies verlangen eine angemeldete Session. Ohne Login liefert
  // Supabase stillschweigend leere Listen - das sah bisher wie eine kaputte
  // Seite aus. Deshalb hier explizit melden statt leer zu bleiben.
  const { data: authData } = await supabase.auth.getUser();
  if(!authData?.user){
    $('sMeta').innerHTML = 'Nicht angemeldet &ndash; die Spectator-Ansicht braucht derzeit einen Login. '
      + '<a href="./login.html">Zum Login</a>';
    $('sRounds').innerHTML = '';
    return;
  }

  try{
    await render(tournamentId);
  }catch(err){
    $('sMeta').textContent = `Konnte das Turnier nicht laden: ${err.message}`;
    return;
  }

  const refresh = async () => {
    try{
      await render(tournamentId);
    }catch(err){
      $('sMeta').textContent = `Aktualisierung fehlgeschlagen: ${err.message}`;
    }
  };

  supabase
    .channel(`spectator-${tournamentId}`)
    // Ergebnisse
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, refresh)
    // neue Runden
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `tournament_id=eq.${tournamentId}` }, refresh)
    // Statuswechsel (aktiv -> beendet), damit die Ansicht auf Endstand umschaltet
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, refresh)
    .subscribe();
}

init();
