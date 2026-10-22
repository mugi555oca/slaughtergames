// Neues Weekly anlegen (nur Mitglieder): 1 Spieler -> 2 Sitzordnung -> 3 Start.
import { initShell, $, $$, esc, supabase, loadPeople, busy, requireLogin } from '/js/app.js';
import { createTournament, generateNextRound } from './tournament.js';
import { FORMATS } from './t-shared.js';

await initShell({ tab: 'turniere', title: 'Neues Weekly', back: '/tournament-app/dashboard.html' });
const m = await requireLogin();
if(m && !m.isMember){ document.querySelector('main').innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>'; }
if(!m?.isMember) throw new Error('kein Mitglied');

const people = await loadPeople();
const { data: roster } = await supabase.from('roster').select('slug,name,real_name').eq('active', true);
const guests = Array.from({ length: 5 }, (_, i) => ({ name: `Gast ${i + 1}`, guest: true }));
const players = (roster || []).map(r => ({ name: r.name, real: r.real_name || r.name, avatar: people.bySlug.get(r.slug)?.avatar }))
  .sort((a, b) => a.real.localeCompare(b.real, 'de')).concat(guests.map(g => ({ ...g, real: g.name })));

const today = new Date();
const weekday = today.toLocaleDateString('de-AT', { weekday: 'long' });
$('#tName').value = `${weekday[0].toUpperCase() + weekday.slice(1)}sdraft ${today.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
$('#tFormat').innerHTML = FORMATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
$('#tFormat').addEventListener('change', () => { $('#ediField').hidden = $('#tFormat').value !== 'aktuelle-edi'; });

const picked = [];          // Auswahl
let seating = [];           // Sitzordnung beim Draft (Platz 1..n)
let swapFrom = null;
let mode = 'random';

// Ich selbst bin meistens dabei
const meName = (roster || []).find(r => r.slug === m.profile?.slug)?.name;
const meetupId = new URLSearchParams(location.search).get('meetup');
if(meetupId){
  // Aus dem Terminfinder: alle mit "dabei" vorauswaehlen, Format uebernehmen
  const [{ data: mt }, { data: vs }] = await Promise.all([
    supabase.from('meetups').select('*').eq('id', meetupId).maybeSingle(),
    supabase.from('meetup_votes').select('user_id').eq('meetup_id', meetupId).eq('vote', 'in'),
  ]);
  for(const v of vs || []){
    const slug = people.byId.get(v.user_id)?.slug;
    const r = (roster || []).find(x => x.slug === slug);
    if(r && !picked.includes(r.name)) picked.push(r.name);
  }
  if(mt?.format_key && mt.format_key !== 'highlander' && FORMATS.some(f => f[0] === mt.format_key)) $('#tFormat').value = mt.format_key;
} else if(meName) picked.push(meName);

function paint(){
  $('#picker').innerHTML = players.map(p => `<button type="button" class="pick ${picked.includes(p.name) ? 'on' : ''}" data-name="${esc(p.name)}">
    ${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<span class="avatar" style="display:grid;place-items:center;font-size:12px">G</span>'}
    <span>${esc(p.real)}</span></button>`).join('');
  $('#pickCount').textContent = `${picked.length} gewählt`;
  $('#pickCount').className = `chip ${picked.length >= 4 && picked.length <= 16 ? 'ok' : ''}`;
}
paint();
$('#tFormat').dispatchEvent(new Event('change'));

$('#picker').addEventListener('click', e => {
  const b = e.target.closest('[data-name]');
  if(!b) return;
  const n = b.dataset.name;
  const i = picked.indexOf(n);
  if(i >= 0) picked.splice(i, 1); else picked.push(n);
  paint();
});

const real = n => players.find(p => p.name === n)?.real || n;
const avatarOf = n => players.find(p => p.name === n)?.avatar;
const msg = t => { $('#newMsg').textContent = t || ''; if(t) window.scrollTo({ top: 0, behavior: 'smooth' }); };

function step(n){
  ['#step1', '#step2', '#step3'].forEach((id, i) => { $(id).hidden = i + 1 !== n; });
  $$('#steps span').forEach((sp, i) => { sp.classList.toggle('on', i + 1 === n); sp.classList.toggle('done', i + 1 < n); });
  msg('');
  window.scrollTo({ top: 0 });
}

function shuffle(){
  seating = [...picked];
  for(let i = seating.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [seating[i], seating[j]] = [seating[j], seating[i]]; }
  swapFrom = null;
}

// Runder Tisch: Plaetze im Uhrzeigersinn, Platz 1 oben
function paintTable(){
  const n = seating.length;
  $('#table').innerHTML = `<div class="dt-center">Draft-Tisch<br><span>${n} Plätze</span></div>` + seating.map((name, i) => {
    const ang = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = 50 + 40 * Math.cos(ang), y = 50 + 40 * Math.sin(ang);
    const av = avatarOf(name);
    return `<button type="button" class="seat ${swapFrom === i ? 'on' : ''}" data-i="${i}" style="left:${x}%;top:${y}%">
      ${av ? `<img src="${esc(av)}" alt="">` : '<span class="g">G</span>'}<b>${i + 1}</b><em>${esc(real(name))}</em></button>`;
  }).join('');
  $('#seatList').innerHTML = seating.map(nm => `<li>${esc(real(nm))}</li>`).join('');
}

$('#table').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if(!b) return;
  const i = Number(b.dataset.i);
  if(swapFrom === null) swapFrom = i;
  else { if(swapFrom !== i) [seating[swapFrom], seating[i]] = [seating[i], seating[swapFrom]]; swapFrom = null; }
  paintTable();
});
$('#shuffleBtn').addEventListener('click', () => { shuffle(); paintTable(); });

function paintStart(){
  const n = seating.length, half = Math.floor(n / 2);
  $('#byeBox').hidden = n % 2 === 0;
  $('#modeHint').textContent = mode === 'cross'
    ? `Jeder spielt gegen den, der beim Draft gegenüber saß: Platz 1 gegen ${half + 1}, 2 gegen ${half + 2} …`
    : 'Die Paarungen der ersten Runde werden zufällig ausgelost.';
  $('#pairPreview').hidden = mode !== 'cross';
  if(mode === 'cross') $('#pairPreview').innerHTML = Array.from({ length: half }, (_, i) => `<div class="list-item" style="min-height:46px">
    <span class="faint small" style="width:22px">T${i + 1}</span><span class="grow small">${i + 1}. ${esc(real(seating[i]))}</span>
    <span class="muted small">vs</span><span class="grow small" style="text-align:right">${esc(real(seating[i + half]))} (${i + half + 1}.)</span></div>`).join('')
    + (n % 2 ? `<div class="list-item small muted">${esc(real(seating[n - 1]))}: Bye</div>` : '');
}

$('#toStep2').addEventListener('click', () => {
  const rounds = Number($('#tRounds').value);
  if(picked.length < 4 || picked.length > 16) return msg('Bitte 4–16 Spieler wählen.');
  if(!(rounds >= 1 && rounds <= 15)) return msg('Runden: 1–15.');
  if($('#tFormat').value === 'aktuelle-edi' && !/^[A-Z]{2,5}$/.test($('#tEdi').value.trim().toUpperCase())) return msg('Edition-Kürzel mit 2–5 Buchstaben angeben.');
  // neu mischen, wenn sich die Auswahl geaendert hat
  if(seating.length !== picked.length || seating.some(nm => !picked.includes(nm))) shuffle();
  paintTable(); step(2);
});
$('#back1').addEventListener('click', () => step(1));
$('#toStep3').addEventListener('click', () => { paintStart(); step(3); });
$('#back2').addEventListener('click', () => step(2));

$$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
  paintStart();
}));

$('#createBtn').addEventListener('click', async () => {
  const formatKey = $('#tFormat').value;
  const edi = $('#tEdi').value.trim().toUpperCase();
  const btn = $('#createBtn');
  busy(btn, true, 'Starte…');
  try{
    const t = await createTournament(m.user.id, {
      name: $('#tName').value.trim(), roundsTotal: Number($('#tRounds').value),
      avoidRematches: true, allowBye: $('#tBye').checked,
      playerNames: [...seating], seatingOrder: [...seating], formatKey, ediCode: formatKey === 'aktuelle-edi' ? edi : null,
    });
    await generateNextRound(t.id, { firstRoundMode: mode });
    if(meetupId) await supabase.from('meetups').update({ tournament_id: t.id }).eq('id', meetupId);
    location.replace(`/tournament-app/round.html?tournament=${t.id}`);
  }catch(err){
    msg(err.message);
    busy(btn, false);
  }
});
