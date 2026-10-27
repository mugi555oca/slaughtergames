// Weekly-Terminfinder: Termin vorschlagen, abstimmen (dabei / maybe / raus),
// sehen wie sich der Tisch fuellt. Nur fuer Mitglieder (Locations sind privat).
import { initShell, $, $$, esc, icon, supabase, loadPeople, lockHtml, openSheet, confirmSheet, toast, busy } from './app.js';
import { FORMATS } from '../tournament-app/js/t-shared.js';
import { loadLocations, locationsListHtml, locSheet, locTitle } from './locations.js';

const main = $('#tMain');
const focusId = new URLSearchParams(location.search).get('id');
const m = await initShell({ tab: 'chat', title: 'Weekly-Termine', back: '/chat.html' });

const FMT = [['', 'Format offen'], ['highlander', 'Highländer'], ...FORMATS];
const fmtName = k => (FMT.find(f => f[0] === (k || '')) || [k, k])[1];
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dayLabel = iso => { const d = new Date(iso + 'T12:00:00'); return `${DAYS[d.getDay()]} ${d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}`; };
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function nextThursday(){
  const d = new Date(); d.setHours(12);
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7));
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// gleiche Logik wie public.table_status() in der DB
function tableStatus(n){
  if(n <= 0) return 'Noch is keiner dabei.';
  if(n < 4) return `Noch ${4 - n} bis Highländer, ${8 - n} bis zum Draft.`;
  if(n <= 5) return `Reicht für Highländer – noch ${8 - n} für an Draft.`;
  if(n === 6) return 'Noch 2 für an perfekten 8er-Tisch!';
  if(n === 7) return 'Nur mehr oaner fehlt für an 8er!';
  if(n === 8) return 'Tisch is voll – 8 Leit, perfekt! 🎉';
  if(n === 9) return 'Oida, 9 – oaner zu viel. Noch wer für 10?';
  if(n === 10) return '10 Leit – passt wieder! 👌';
  if(n === 11) return '11 – oaner fehlt für 12.';
  if(n === 12) return '12 – volles Haus! 🔥';
  return `${n} Leit – des wird a Gmetzel.`;
}
const tone = n => [8, 10, 12].includes(n) ? 'ok' : n >= 4 ? 'gold' : '';

let people, locations = [], meetups = [], votes = [];


async function start(){
  people = await loadPeople();
  await load();
  let t = null;
  const reload = () => { clearTimeout(t); t = setTimeout(load, 300); };
  supabase.channel('termine')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetups' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetup_votes' }, reload)
    .subscribe();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) load(); });

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `${icon('plus')}Termin`;
  fab.addEventListener('click', () => editSheet());
  document.body.appendChild(fab);
}

async function load(){
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [l, mt] = await Promise.all([
    loadLocations(),
    supabase.from('meetups').select('*').gte('date', since).order('date').order('time'),
  ]);
  locations = l;
  meetups = mt.data || [];
  const ids = meetups.map(x => x.id);
  votes = ids.length ? ((await supabase.from('meetup_votes').select('*').in('meetup_id', ids)).data || []) : [];
  render();
}

const who = uid => people.byId.get(uid) || { real: 'Wer', avatar: '/icons/icon-192.png' };
const locOf = id => locations.find(x => x.id === id);

function card(mt){
  const vs = votes.filter(v => v.meetup_id === mt.id);
  const inn = vs.filter(v => v.vote === 'in'), maybe = vs.filter(v => v.vote === 'maybe'), out = vs.filter(v => v.vote === 'out');
  const mine = vs.find(v => v.user_id === m.user.id)?.vote;
  const n = inn.length;
  const loc = locOf(mt.location_id);
  const past = mt.date < todayIso();
  const cancelled = mt.status === 'cancelled';
  const canEdit = mt.created_by === m.user.id || m.isAdmin;
  const pct = Math.min(100, n / 12 * 100);
  const avatars = (list, faded) => list.map(v => `<img class="avatar xs" src="${esc(who(v.user_id).avatar)}" alt="${esc(who(v.user_id).real)}" title="${esc(who(v.user_id).real)}" style="${faded ? 'opacity:.55' : ''}">`).join('');
  return `<article class="meet ${mt.id === focusId ? 'focus' : ''} ${past || cancelled ? 'past' : ''}" id="m-${mt.id}">
    <div class="row between">
      <div><div class="meet-day">${dayLabel(mt.date)}<span>${esc(mt.time)}</span></div></div>
      <div class="row" style="gap:6px">${mt.format_key ? `<span class="chip ${mt.format_key === 'highlander' ? 'gold' : ''}">${esc(fmtName(mt.format_key))}</span>` : ''}
        ${cancelled ? '<span class="chip">abgesagt</span>' : past ? '<span class="chip">vorbei</span>' : ''}
        ${canEdit && !past ? `<button class="icon-btn" data-edit="${mt.id}" aria-label="Bearbeiten" style="width:34px;height:34px">${icon('edit')}</button>` : ''}</div>
    </div>
    <button class="meet-loc" data-loc="${mt.location_id || ''}" data-maps="${!loc && mt.location_text ? esc(mt.location_text) : ''}">
      <span class="pin">📍</span><span class="grow"><b>${esc(loc ? locTitle(loc, people) : mt.location_text || 'TBD')}</b>${loc ? `<span class="small muted" style="display:block">${esc(loc.address)}</span>` : !mt.location_text ? '<span class="small muted" style="display:block">Ort wird noch ausgemacht</span>' : ''}</span>${loc || mt.location_text ? icon('chev', 'chev') : ''}
    </button>
    ${mt.note ? `<p class="small" style="margin:8px 2px 0">${esc(mt.note)}</p>` : ''}
    <div class="meet-bar"><i style="width:${pct}%" class="${tone(n)}"></i>${[4, 8, 10, 12].map(k => `<b style="left:${k / 12 * 100}%"></b>`).join('')}</div>
    <div class="row between small" style="margin-top:6px"><b>${n} dabei${maybe.length ? ` · ${maybe.length} maybe` : ''}</b><span class="muted">Ziel 8</span></div>
    <p class="small ${tone(n) === 'ok' ? 'okc' : ''}" style="margin:4px 0 0;font-weight:600">${esc(tableStatus(n))}</p>
    ${vs.length ? `<div class="meet-people">${avatars(inn)}${avatars(maybe, true)}${out.length ? `<span class="tiny faint" style="margin-left:6px">${out.length} raus</span>` : ''}</div>` : ''}
    ${!past && !cancelled ? `<div class="vote-row">
      <button data-vote="in" data-m="${mt.id}" class="${mine === 'in' ? 'on in' : ''}">✅ Dabei</button>
      <button data-vote="maybe" data-m="${mt.id}" class="${mine === 'maybe' ? 'on maybe' : ''}">🤷 Maybe</button>
      <button data-vote="out" data-m="${mt.id}" class="${mine === 'out' ? 'on out' : ''}">❌ Raus</button>
    </div>` : ''}
    <div class="row between tiny faint" style="margin-top:10px"><span>von ${esc(who(mt.created_by).name || who(mt.created_by).real)}</span>
      ${!cancelled && n >= 4 && !mt.tournament_id ? `<a class="btn xs" href="/tournament-app/new.html?meetup=${mt.id}">Weekly starten</a>` : ''}
      ${mt.tournament_id ? `<a class="btn xs ghost" href="/tournament-app/round.html?tournament=${mt.tournament_id}">Zum Weekly</a>` : ''}</div>
  </article>`;
}

function render(){
  const upcoming = meetups.filter(x => x.date >= todayIso());
  const past = meetups.filter(x => x.date < todayIso()).reverse();
  main.innerHTML = `<h1 class="page-title">Termine</h1>
    ${upcoming.length ? upcoming.map(card).join('') : `<div class="card empty">${icon('calendar')}<h3>Kein Termin offen</h3><p>Schlag den nächsten Donnerstag vor – unten rechts.</p></div>`}
    ${past.length ? `<div class="section-head mt-l"><h2>Letzte Woche</h2></div>${past.map(card).join('')}` : ''}
    <div class="section-head mt-l"><h2>Spiellocations</h2></div>
    ${locationsListHtml(locations, people)}`;

  main.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', () => vote(b.dataset.m, b.dataset.vote)));
  main.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => {
    if(b.dataset.loc) locSheet(locOf(b.dataset.loc), people);
    else if(b.dataset.maps) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.dataset.maps), '_blank', 'noopener');
  }));
  main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editSheet(meetups.find(x => x.id === b.dataset.edit))));
  if(focusId && !render.scrolled){ render.scrolled = true; document.getElementById(`m-${focusId}`)?.scrollIntoView({ block: 'center' }); }
}

async function vote(id, v){
  const cur = votes.find(x => x.meetup_id === id && x.user_id === m.user.id);
  if(cur?.vote === v){
    await supabase.from('meetup_votes').delete().eq('meetup_id', id).eq('user_id', m.user.id);
  } else {
    const { error } = await supabase.from('meetup_votes').upsert({ meetup_id: id, user_id: m.user.id, vote: v, updated_at: new Date().toISOString() });
    if(error){ toast(error.message, 'err'); return; }
    if(navigator.vibrate) navigator.vibrate(12);
  }
  await load();
}

function editSheet(mt = null){
  const myLoc = locations.find(l => l.owner_slug && l.owner_slug === m.profile?.slug);
  const locSel = mt ? (mt.location_id || (mt.location_text ? '__text' : '')) : (myLoc?.id || '');
  const s = openSheet(`<h3>${mt ? 'Termin bearbeiten' : 'Weekly vorschlagen'}</h3>
    <form id="mForm">
      <div class="row" style="gap:10px">
        <div class="field grow"><label for="mDate">Datum</label><input id="mDate" type="date" required value="${esc(mt?.date || nextThursday())}"></div>
        <div class="field" style="width:120px"><label for="mTime">Uhrzeit</label><input id="mTime" type="time" required value="${esc(mt?.time || '18:30')}"></div>
      </div>
      <div class="field"><label for="mLoc">Wo?</label><select id="mLoc">
        <option value="" ${locSel === '' ? 'selected' : ''}>TBD – wird noch ausgemacht</option>
        ${locations.map(l => `<option value="${l.id}" ${locSel === l.id ? 'selected' : ''}>${esc(locTitle(l, people))}${l.id === myLoc?.id ? ' (bei dir)' : ''}</option>`).join('')}
        <option value="__text" ${locSel === '__text' ? 'selected' : ''}>✏️ Andere Location eintippen…</option></select>
        <input id="mLocText" class="mt" maxlength="200" placeholder="z. B. Café Ritter, Ottakringer Str. 117" value="${esc(mt?.location_text || '')}" ${locSel === '__text' ? '' : 'hidden'}></div>
      <div class="field"><label for="mFmt">Format</label><select id="mFmt">${FMT.map(([k, n]) => `<option value="${k}" ${(mt?.format_key || '') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <span class="hint">Bei 4–5 Leuten spielen wir Highländer.</span></div>
      <div class="field"><label for="mNote">Notiz (optional)</label><input id="mNote" maxlength="300" value="${esc(mt?.note || '')}" placeholder="z. B. Pizza wird bestellt"></div>
      <button class="btn block" type="submit">${mt ? 'Speichern' : 'Vorschlagen'}</button>
      ${mt ? '<button type="button" class="btn block danger mt" id="mCancel">Termin absagen</button>' : ''}
    </form>`);
  const locIn = s.el.querySelector('#mLoc'), locText = s.el.querySelector('#mLocText');
  locIn.addEventListener('change', () => { locText.hidden = locIn.value !== '__text'; if(!locText.hidden) locText.focus(); });
  s.el.querySelector('#mForm').addEventListener('submit', async e => {
    e.preventDefault();
    const freeLoc = locIn.value === '__text' ? locText.value.trim() : '';
    if(locIn.value === '__text' && !freeLoc){ toast('Wo genau? Location eintippen oder TBD wählen.', 'err'); locText.focus(); return; }
    busy(e.submitter, true, 'Speichere…');
    const row = { date: s.el.querySelector('#mDate').value, time: s.el.querySelector('#mTime').value,
      location_id: locIn.value && locIn.value !== '__text' ? locIn.value : null, location_text: freeLoc || null, format_key: s.el.querySelector('#mFmt').value || null,
      note: s.el.querySelector('#mNote').value.trim() || null };
    const { error } = mt
      ? await supabase.from('meetups').update(row).eq('id', mt.id)
      : await supabase.from('meetups').insert({ ...row, created_by: m.user.id });
    if(error){ busy(e.submitter, false); toast(error.message, 'err'); return; }
    s.close(); toast(mt ? 'Gespeichert.' : 'Termin steht – alle kriegen Bescheid. 🃏', 'ok'); await load();
  });
  s.el.querySelector('#mCancel')?.addEventListener('click', async () => {
    s.close();
    if(!await confirmSheet('Termin absagen?', 'Der Termin bleibt sichtbar, aber als abgesagt.', 'Absagen', true)) return;
    const { error } = await supabase.from('meetups').update({ status: 'cancelled' }).eq('id', mt.id);
    if(error) toast(error.message, 'err'); else load();
  });
}

// Start erst am Ende: vorher waeren die Helfer weiter unten noch nicht definiert
if(!m.user) main.innerHTML = `<h1 class="page-title">Termine</h1>` + lockHtml('Nur für Mitglieder', 'Einloggen, um Weekly-Termine zu sehen und abzustimmen.');
else if(!m.isMember) main.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>';
else await start();
