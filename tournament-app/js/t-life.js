// Lifecounter fuer das aktuelle Weekly-Match: geteilter Bildschirm (Gegner oben,
// gedreht), Tippen oben/unten = +1/-1, Leben-Verlauf, Wuerfel, Rundentimer.
// Bildschirm bleibt an (Wake Lock). Springt automatisch auf das neue Match,
// sobald die naechste Runde ausgelost ist.
import { $, esc, icon, supabase, me, loadPeople, personForName, openSheet, toast } from '/js/app.js';
import { countdown, unlockAudio } from '/js/timer.js';

const tid = new URLSearchParams(location.search).get('tournament');
const START = 30;
let m, people, match = null, names = ['Gegner', 'Ich'], avatars = [null, null], roundNo = 0, key = 'sg-life-free';
let st = null;          // { life:[oben,unten], start, game, history:[{t,who,from,to,game}] }
let stopTimer = null;
const pending = [0, 0], pendTimer = [null, null];

unlockAudio();

// ---------- Wake Lock ----------
let lock = null;
async function keepAwake(){
  try{ if('wakeLock' in navigator && !document.hidden) lock = await navigator.wakeLock.request('screen'); }catch{}
}
document.addEventListener('visibilitychange', () => { if(!document.hidden){ keepAwake(); loadMatch(); } });
keepAwake();

// ---------- Zustand ----------
function load(){
  try{ st = JSON.parse(localStorage.getItem(key) || 'null'); }catch{ st = null; }
  if(!st) st = { life: [START, START], start: START, game: 1, history: [] };
}
function save(){ try{ localStorage.setItem(key, JSON.stringify(st)); }catch{} }

function change(who, delta){
  const from = st.life[who];
  st.life[who] += delta;
  st.history.push({ t: Date.now(), who, from, to: st.life[who], game: st.game });
  save();
  pending[who] += delta;
  clearTimeout(pendTimer[who]);
  pendTimer[who] = setTimeout(() => { pending[who] = 0; paint(); }, 1400);
  if(navigator.vibrate) navigator.vibrate(8);
  paint();
}

function paint(){
  for(const who of [0, 1]){
    const el = $(`#p${who}`);
    el.querySelector('.life').textContent = st.life[who];
    el.classList.toggle('dead', st.life[who] <= 0);
    const d = el.querySelector('.delta');
    d.textContent = pending[who] ? (pending[who] > 0 ? '+' : '') + pending[who] : '';
    el.querySelector('.pname').textContent = names[who];
    const av = el.querySelector('.pav');
    av.hidden = !avatars[who];
    if(avatars[who]) av.src = avatars[who];
  }
  $('#gameNo').textContent = `Game ${st.game}`;
}

// ---------- Aktuelles Match finden ----------
async function loadMatch(){
  if(!tid) return;
  const [{ data: t }, { data: players }] = await Promise.all([
    supabase.from('tournaments').select('id,name,current_round,status').eq('id', tid).maybeSingle(),
    supabase.from('players').select('id,name,slug').eq('tournament_id', tid),
  ]);
  if(!t) return;
  $('#tName').textContent = t.name;
  const mineP = (players || []).find(p => p.slug && p.slug === m.profile?.slug);
  const [{ data: ms }, { data: rd }] = await Promise.all([
    supabase.from('matches').select('*').eq('tournament_id', tid).eq('round_no', t.current_round),
    supabase.from('rounds').select('id,timer_ends_at').eq('tournament_id', tid).eq('round_no', t.current_round).maybeSingle(),
  ]);
  const mx = mineP && (ms || []).find(x => x.player_a_id === mineP.id || x.player_b_id === mineP.id);
  const nm = id => { const p = (players || []).find(x => x.id === id); const per = p && ((p.slug && people.bySlug.get(p.slug)) || personForName(people, p.name)); return [per?.real || p?.name || '?', per?.avatar || null]; };

  const newKey = mx ? `sg-life-${mx.id}` : `sg-life-${tid}-r${t.current_round}`;
  if(newKey !== key){
    if(match && mx && mx.id !== match.id) toast(`Runde ${t.current_round}: neues Match, Leben auf ${START}.`, 'ok');
    key = newKey; load();
  }
  match = mx || null; roundNo = t.current_round;
  if(mx && !mx.is_bye){
    const meA = mx.player_a_id === mineP.id;
    const [on, oa] = nm(meA ? mx.player_b_id : mx.player_a_id);
    const [mn, ma] = nm(mineP.id);
    names = [on, mn]; avatars = [oa, ma];
    $('#rLabel').textContent = `Runde ${t.current_round}${t.status === 'finished' ? ' · beendet' : ''}`;
  } else {
    names = mx?.is_bye ? ['Bye', nm(mineP.id)[0]] : ['Spieler 2', 'Spieler 1'];
    avatars = [null, mineP ? nm(mineP.id)[1] : null];
    $('#rLabel').textContent = mx?.is_bye ? `Runde ${t.current_round} · Bye` : 'freies Spiel';
  }
  stopTimer?.(); stopTimer = null;
  if(rd?.timer_ends_at && t.status === 'active'){
    $('#tmr').hidden = false;
    stopTimer = countdown($('#tmr'), rd.timer_ends_at, rd.id, () => toast('⏰ Zeit is aus!', 'err'));
  } else $('#tmr').hidden = true;
  paint();
}

// ---------- Bedienung ----------
function bind(){
  for(const who of [0, 1]){
    const el = $(`#p${who}`);
    el.querySelector('.plus').addEventListener('click', () => change(who, 1));
    el.querySelector('.minus').addEventListener('click', () => change(who, -1));
    // gedrueckt halten = 5er Schritte
    for(const [sel, d] of [['.plus', 5], ['.minus', -5]]){
      let h = null;
      const zone = el.querySelector(sel);
      zone.addEventListener('pointerdown', () => { h = setTimeout(() => { change(who, d - Math.sign(d)); h = 'done'; }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => zone.addEventListener(ev, () => { if(h !== 'done') clearTimeout(h); h = null; }));
    }
  }

  $('#diceBtn').addEventListener('click', () => {
    const s = openSheet(`<h3>Würfeln</h3><div class="dice-out" id="diceOut">🎲</div>
      <div class="btn-row"><button class="btn" data-d="6">W6</button><button class="btn" data-d="20">W20</button><button class="btn ghost" data-d="2">Münze</button></div>
      <button class="btn block ghost mt" data-close>Schließen</button>`);
    s.el.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.dataset.d);
      const out = s.el.querySelector('#diceOut');
      let k = 0;
      const spin = setInterval(() => {
        const v = 1 + Math.floor(Math.random() * n);
        out.textContent = n === 2 ? (v === 1 ? 'Kopf' : 'Zahl') : v;
        if(++k > 10){ clearInterval(spin); if(navigator.vibrate) navigator.vibrate(30); }
      }, 60);
    }));
  });

  $('#histBtn').addEventListener('click', () => {
    const rows = [...st.history].reverse();
    openSheet(`<h3>Leben-Verlauf</h3>${rows.length ? `<div class="list">${rows.map(h => h.mark ? `<div class="list-item" style="min-height:34px;background:var(--bg-2)"><span class="tiny muted" style="font-weight:700">— Game ${h.game} —</span></div>` : `<div class="list-item" style="min-height:42px">
      <span class="tiny faint" style="width:52px">G${h.game} · ${new Date(h.t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="grow small">${esc(names[h.who])}</span>
      <b class="small" style="color:${h.to < h.from ? '#ff8a80' : '#7ee2a8'}">${h.to < h.from ? '' : '+'}${h.to - h.from}</b>
      <span class="small muted" style="width:60px;text-align:right">${h.from} → ${h.to}</span></div>`).join('')}</div>` : '<p class="muted">Noch nix passiert.</p>'}
      <button class="btn block ghost mt" data-close>Schließen</button>`);
  });

  $('#newGameBtn').addEventListener('click', () => {
    const s = openSheet(`<h3>Neues Game</h3>
      <p class="muted mb">Leben zurücksetzen. Der Verlauf bleibt.</p>
      <div class="btn-row">${[20, 30, 40].map(n => `<button class="btn ${n === st.start ? '' : 'ghost'}" data-n="${n}">${n}</button>`).join('')}</div>
      <button class="btn block ghost mt" data-close>Abbrechen</button>`);
    s.el.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
      st.start = Number(b.dataset.n);
      st.game += 1;
      st.life = [st.start, st.start];
      st.history.push({ t: Date.now(), who: 1, from: 0, to: 0, game: st.game, mark: true });
      save(); paint(); s.close();
    }));
  });
}

// ---------- Start ----------
m = await me();
people = await loadPeople().catch(() => ({ bySlug: new Map(), byName: new Map(), byId: new Map() }));
$('#backBtn').href = tid ? `/tournament-app/round.html?tournament=${tid}` : '/tournament-app/dashboard.html';
$('#backBtn').innerHTML = icon('back');
bind();
load();
paint();
await loadMatch();
if(tid){
  supabase.channel('life-' + tid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, () => loadMatch())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `tournament_id=eq.${tid}` }, () => loadMatch())
    .subscribe();
}
