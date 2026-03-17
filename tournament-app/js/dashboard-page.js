import { bindAuthUI, requireAuthOrRedirect } from './auth.js';
import { createTournament, generateNextRound, listTournaments, getGlobalRanking } from './tournament.js';

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

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

async function loadPlayerProfiles(){
  const res = await fetch('./user_profiles.json', { cache: 'no-store' });
  if(!res.ok) throw new Error('user_profiles.json konnte nicht geladen werden.');
  return await res.json();
}

function buildPlayerSelectors(profiles){
  const container = $('playerSelects');
  container.innerHTML = '';

  for(let i=1;i<=16;i++){
    const wrap = document.createElement('div');
    wrap.className = 'col-3';

    const select = document.createElement('select');
    select.id = `p${i}`;
    select.innerHTML = [
      '<option value="">-- kein Spieler --</option>',
      ...profiles.map(p => `<option value="${p.full_name}">${p.full_name}</option>`),
      ...Array.from({length:5}, (_,g)=>`<option value="Gast ${g+1}">Gast ${g+1}</option>`)
    ].join('');

    const label = document.createElement('label');
    label.textContent = `Slot ${i}`;
    label.setAttribute('for', select.id);

    wrap.appendChild(label);
    wrap.appendChild(select);
    container.appendChild(wrap);
  }
}

function selectedPlayers(){
  const vals = [];
  for(let i=1;i<=16;i++){
    const v = $(`p${i}`)?.value?.trim();
    if(v) vals.push(v);
  }
  const seen = new Set();
  for(const n of vals){
    const key = n.toLowerCase();
    if(seen.has(key)) throw new Error(`Doppelter Spielername: ${n}`);
    seen.add(key);
  }
  return vals;
}

function renderSeatingPreview(order){
  const host = $('seatingPreview');
  host.innerHTML = '';
  order.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    host.appendChild(li);
  });
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

async function refreshGlobalRanking(){
  const rows = await getGlobalRanking();
  const body = $('globalRankBody');
  body.innerHTML = '';

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${r.name}</td>
      <td>${r.totalMatchPoints}</td>
      <td>${r.totalTournaments}</td>
    `;
    body.appendChild(tr);
  });

  const labels = rows.map(r => r.name);
  const data = rows.map(r => r.totalMatchPoints);
  const canvas = $('rankingChart');
  const ctx = canvas.getContext('2d');
  if(window._rankingChart) window._rankingChart.destroy();
  window._rankingChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Total Match Points', data }] },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

async function init(){
  bindAuthUI();
  const user = await requireAuthOrRedirect();
  if(!user) return;

  const profiles = await loadPlayerProfiles();
  buildPlayerSelectors(profiles);

  let currentSeating = [];

  $('fillTestData').addEventListener('click', () => {
    for(let i=1;i<=8;i++){
      const el = $(`p${i}`);
      if(el) el.selectedIndex = i;
    }
  });

  const makeSeating = () => {
    const names = selectedPlayers();
    if(names.length < 4 || names.length > 16) throw new Error('Es müssen 4-16 Spieler ausgewählt sein.');
    currentSeating = shuffle(names);
    renderSeatingPreview(currentSeating);
    msg('Seatings randomisiert. Du kannst neu würfeln oder direkt Pairing-Modus wählen.');
  };

  $('buildSeatingBtn').addEventListener('click', () => {
    try{ makeSeating(); }catch(err){ msg(err.message); }
  });

  const createAndPair = async (mode, btn) => {
    setBusy(btn, true, 'Erstelle...');
    try{
      const roundsTotal = Number($('tRounds').value);
      if(roundsTotal < 1 || roundsTotal > 15) throw new Error('Rundenzahl muss 1-15 sein.');

      const selected = selectedPlayers();
      if(selected.length < 4 || selected.length > 16) throw new Error('Es müssen 4-16 Spieler ausgewählt sein.');

      if(!currentSeating.length){
        if(mode === 'cross'){
          // direct cross without seating click -> use slot order as input
          currentSeating = selected;
          renderSeatingPreview(currentSeating);
        } else {
          // random mode without seating click -> random pairings from randomized player list
          currentSeating = [...selected];
        }
      }

      const t = await createTournament(user.id, {
        name: $('tName').value.trim(),
        roundsTotal,
        avoidRematches: $('tAvoidRematches').checked,
        allowBye: $('tAllowBye').checked,
        playerNames: selected,
        seatingOrder: currentSeating
      });

      await generateNextRound(t.id, { firstRoundMode: mode });
      msg(`Turnier erstellt. Runde 1 erzeugt (${mode === 'cross' ? 'Cross Pairings 1vs4/2vs5...' : 'Random Pairings'}).`);
      window.location.href = `./round.html?tournament=${t.id}`;
    }catch(err){ msg(err.message); }
    finally{ setBusy(btn, false); }
  };

  $('createRandomBtn').addEventListener('click', async () => {
    await createAndPair('random', $('createRandomBtn'));
  });

  $('createCrossBtn').addEventListener('click', async () => {
    await createAndPair('cross', $('createCrossBtn'));
  });

  await refreshTable();
  await refreshGlobalRanking();
}

init();
