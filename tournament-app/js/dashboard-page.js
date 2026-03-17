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

let profileSlugByName = {};

function profileLink(name){
  const slug = profileSlugByName[name];
  if(!slug) return name;
  return `<a href="../player-profile.html?slug=${encodeURIComponent(slug)}">${name}</a>`;
}

function formatLabel(key){
  const map = {
    'aktuelle-edi':'Aktuelle Edi',
    'vintage-cube':'Vintage Cube',
    'legacy-cube':'Legacy Cube',
    'pauper-cube':'Pauper Cube',
    'uncommon-cube':'Uncommon Cube',
    'oldboarder-cube':'Oldboarder Cube',
    'blube':'Blube',
    'multicolor-cube':'Multicolor Cube',
    'other-cube':'Other Cube'
  };
  return map[key] || key;
}

async function loadPlayerProfiles(){
  const res = await fetch('./user_profiles.json', { cache: 'no-store' });
  if(!res.ok) throw new Error('user_profiles.json konnte nicht geladen werden.');
  return await res.json();
}

function buildPlayerSelectors(profiles){
  const container = $('playerSelects');
  container.innerHTML = '';

  const allOptions = [
    ...profiles.map(p => p.full_name),
    ...Array.from({length:5}, (_,g)=>`Gast ${g+1}`)
  ];

  for(let i=1;i<=16;i++){
    const wrap = document.createElement('div');
    wrap.className = 'col-3';

    const select = document.createElement('select');
    select.id = `p${i}`;

    const label = document.createElement('label');
    label.textContent = `Slot ${i}`;
    label.setAttribute('for', select.id);

    wrap.appendChild(label);
    wrap.appendChild(select);
    container.appendChild(wrap);
  }

  const refreshOptions = () => {
    const selected = [];
    for(let i=1;i<=16;i++){
      const v = $(`p${i}`)?.value || '';
      if(v) selected.push(v);
    }

    for(let i=1;i<=16;i++){
      const sel = $(`p${i}`);
      const current = sel.value || '';
      const takenByOthers = new Set(selected.filter(v => v !== current));

      sel.innerHTML = '<option value="">-- kein Spieler --</option>';
      for(const opt of allOptions){
        if(takenByOthers.has(opt)) continue;
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if(opt === current) o.selected = true;
        sel.appendChild(o);
      }
    }
  };

  for(let i=1;i<=16;i++){
    $(`p${i}`).addEventListener('change', refreshOptions);
  }

  refreshOptions();
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
    const formatText = `${formatLabel(t.format_key || 'other-cube')}${t.edi_code ? ` (${t.edi_code})` : ''}`;
    tr.innerHTML = `
      <td>${t.name}<br><span class="helper">${formatText}</span></td>
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
  const formatKey = $('globalFormatFilter').value;
  const ediCode = ($('globalEdiFilter').value || '').trim().toUpperCase();
  const rows = await getGlobalRanking({
    formatKey: formatKey === 'all' ? null : formatKey,
    ediCode: ediCode || null
  });

  const body = $('globalRankBody');
  body.innerHTML = '';

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${profileLink(r.name)}</td>
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
  try{
    const pr = await fetch('./player_profiles.json', { cache:'no-store' });
    const arr = await pr.json();
    profileSlugByName = Object.fromEntries(arr.map(x => [x.name, x.slug]));
  }catch{}

  let currentSeating = [];

  $('tFormat').addEventListener('change', () => {
    const isEdi = $('tFormat').value === 'aktuelle-edi';
    $('tEdiCode').disabled = !isEdi;
    if(!isEdi) $('tEdiCode').value = '';
  });
  $('tFormat').dispatchEvent(new Event('change'));

  $('globalFormatFilter').addEventListener('change', refreshGlobalRanking);
  $('globalEdiFilter').addEventListener('input', refreshGlobalRanking);

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
    msg('Seatings randomisiert. Du kannst direkt Pairing-Modus wählen.');
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

      const formatKey = $('tFormat').value;
      const ediCodeRaw = ($('tEdiCode').value || '').trim().toUpperCase();
      const ediCode = formatKey === 'aktuelle-edi' ? ediCodeRaw : null;
      if(formatKey === 'aktuelle-edi' && !/^[A-Z]{2,5}$/.test(ediCodeRaw)){
        throw new Error('Bei Aktuelle Edi muss ein Kürzel mit 2-5 Buchstaben eingegeben werden.');
      }

      if(!currentSeating.length){
        if(mode === 'cross'){
          currentSeating = selected;
          renderSeatingPreview(currentSeating);
        } else {
          currentSeating = [...selected];
        }
      }

      const t = await createTournament(user.id, {
        name: $('tName').value.trim(),
        roundsTotal,
        avoidRematches: $('tAvoidRematches').checked,
        allowBye: $('tAllowBye').checked,
        playerNames: selected,
        seatingOrder: currentSeating,
        formatKey,
        ediCode
      });

      await generateNextRound(t.id, { firstRoundMode: mode });
      msg(`Turnier erstellt. Runde 1 erzeugt (${mode === 'cross' ? 'Cross Pairings (erste Hälfte vs zweite Hälfte, z. B. 1vs5)' : 'Random Pairings'}).`);
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
