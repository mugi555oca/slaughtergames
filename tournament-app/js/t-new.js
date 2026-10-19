// Neues Turnier anlegen (nur Mitglieder).
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

const picked = [];          // Reihenfolge = Sitzordnung
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
  $('#seating').innerHTML = picked.map(n => `<li>${esc(players.find(p => p.name === n)?.real || n)}</li>`).join('');
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

$$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
  $('#seatBox').hidden = mode !== 'cross';
}));
$('#shuffleBtn').addEventListener('click', () => {
  for(let i = picked.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [picked[i], picked[j]] = [picked[j], picked[i]]; }
  paint();
});

$('#newForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#newMsg');
  msg.textContent = '';
  const rounds = Number($('#tRounds').value);
  const formatKey = $('#tFormat').value;
  const edi = $('#tEdi').value.trim().toUpperCase();
  if(picked.length < 4 || picked.length > 16){ msg.textContent = 'Bitte 4–16 Spieler wählen.'; return; }
  if(!(rounds >= 1 && rounds <= 15)){ msg.textContent = 'Runden: 1–15.'; return; }
  if(formatKey === 'aktuelle-edi' && !/^[A-Z]{2,5}$/.test(edi)){ msg.textContent = 'Edition-Kürzel mit 2–5 Buchstaben angeben.'; return; }

  const btn = $('#createBtn');
  busy(btn, true, 'Starte…');
  try{
    const t = await createTournament(m.user.id, {
      name: $('#tName').value.trim(), roundsTotal: rounds,
      avoidRematches: $('#tAvoid').checked, allowBye: $('#tBye').checked,
      playerNames: [...picked], seatingOrder: [...picked], formatKey, ediCode: formatKey === 'aktuelle-edi' ? edi : null,
    });
    await generateNextRound(t.id, { firstRoundMode: mode });
    if(meetupId) await supabase.from('meetups').update({ tournament_id: t.id }).eq('id', meetupId);
    location.replace(`/tournament-app/round.html?tournament=${t.id}`);
  }catch(err){
    msg.textContent = err.message;
    busy(btn, false);
  }
});
