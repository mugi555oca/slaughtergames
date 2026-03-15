import { bindAuthUI, requireAuthOrRedirect } from './auth.js';
import { createTournament, listTournaments } from './tournament.js';

const TEST_PLAYERS = ['Anna','Benedikt','Clara','David','Elena','Fabian','Greta','Hannes'];

function $(id){ return document.getElementById(id); }
function msg(text){ $('createMsg').textContent = text || ''; }

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

async function refreshTable(){
  const rows = await listTournaments();
  const body = $('tournamentsTable');
  body.innerHTML = '';

  for(const t of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.name}</td>
      <td>${t.status}</td>
      <td>${t.current_round}/${t.rounds_total}</td>
      <td>
        <a href="./round.html?tournament=${t.id}"><button>Öffnen</button></a>
        <a href="./spectator.html?tournament=${t.id}"><button class="secondary">Spectator</button></a>
      </td>
    `;
    body.appendChild(tr);
  }
}

function parseNames(raw){
  const names = raw
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const seen = new Set();
  for(const n of names){
    const key = n.toLowerCase();
    if(seen.has(key)) throw new Error(`Doppelter Spielername erkannt: ${n}`);
    seen.add(key);
  }
  return names;
}

async function init(){
  bindAuthUI();
  const user = await requireAuthOrRedirect();
  if(!user) return;

  $('fillTestData').addEventListener('click', () => {
    $('tPlayerCount').value = 8;
    $('tPlayers').value = TEST_PLAYERS.join('\n');
  });

  $('createTournamentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    setBusy(submitBtn, true, 'Erstelle...');
    try{
      const roundsTotal = Number($('tRounds').value);
      const playerCount = Number($('tPlayerCount').value);
      const names = parseNames($('tPlayers').value);

      if(names.length !== playerCount) throw new Error(`Du hast ${names.length} Namen eingetragen, erwartet werden ${playerCount}.`);
      if(playerCount < 4 || playerCount > 16) throw new Error('Spieleranzahl muss 4-16 sein.');
      if(roundsTotal < 1 || roundsTotal > 15) throw new Error('Rundenzahl muss 1-15 sein.');

      const t = await createTournament(user.id, {
        name: $('tName').value.trim(),
        roundsTotal,
        avoidRematches: $('tAvoidRematches').checked,
        allowBye: $('tAllowBye').checked,
        playerNames: names
      });

      msg('Turnier erstellt.');
      window.location.href = `./round.html?tournament=${t.id}`;
    }catch(err){
      msg(err.message);
    } finally {
      setBusy(submitBtn, false);
    }
  });

  await refreshTable();
}

init();
