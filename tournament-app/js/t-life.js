// Lifecounter fuer das aktuelle Weekly-Match.
//   Bildschirm geteilt (Gegner oben, gedreht), Tippen oben/unten = +1/-1,
//   gedrueckt halten = 5er-Schritte, Mini-Verlauf neben der Zahl.
//   Axt-Wurf entscheidet, wer beginnt; GO uebergibt den Zug (Zugnummer im Verlauf).
//   Leben <= 0 -> Totenkopf, Game werten; Spielstand 1:0 ... direkt als Ergebnis eintragen.
//   Bildschirm bleibt an (Wake Lock), springt automatisch aufs neue Match.
import { $, $$, esc, icon, supabase, me, loadPeople, personForName, openSheet, confirmSheet, toast } from '/js/app.js';
import { correctMatchResult } from './tournament.js';
import { countdown, unlockAudio } from '/js/timer.js';

const tid = new URLSearchParams(location.search).get('tournament');
let m, people, match = null, mineId = null, names = ['Gegner', 'Ich'], avatars = [null, null], key = 'sg-life-free';
let st = null;
let stopTimer = null;
const pending = [0, 0], pendTimer = [null, null];
const OPP = 0, ME = 1;

unlockAudio();

// ---------- Wake Lock ----------
async function keepAwake(){
  try{ if('wakeLock' in navigator && !document.hidden) await navigator.wakeLock.request('screen'); }catch{}
}
document.addEventListener('visibilitychange', () => { if(!document.hidden){ keepAwake(); loadMatch(); } });
keepAwake();

// ---------- Zustand ----------
// history: { t, who, from, to, game, turn }  |  { t, kind:'game', game, loser }  |  { t, kind:'start', game, who }
function fresh(start = 30){
  return { life: [start, start], start, game: 1, wins: [0, 0], active: null, turn: 0, history: [], axeShown: false };
}
function load(){
  try{ st = JSON.parse(localStorage.getItem(key) || 'null'); }catch{ st = null; }
  if(!st || !st.wins) st = fresh(st?.start || 30);
}
function save(){ try{ localStorage.setItem(key, JSON.stringify(st)); }catch{} }

function change(who, delta){
  const from = st.life[who];
  st.life[who] += delta;
  st.history.push({ t: Date.now(), who, from, to: st.life[who], game: st.game, turn: st.turn });
  save();
  pending[who] += delta;
  clearTimeout(pendTimer[who]);
  pendTimer[who] = setTimeout(() => { pending[who] = 0; paint(); }, 1400);
  if(navigator.vibrate) navigator.vibrate(8);
  paint();
}

// Aufeinanderfolgende Aenderungen im selben Zug zusammenfassen (fuer die Mini-Liste)
function recent(who){
  const out = [];
  for(const h of st.history.filter(x => x.who === who && x.game === st.game && !x.kind)){
    const last = out[out.length - 1];
    if(last && last.turn === h.turn && h.t - last.t < 8000){ last.delta += h.to - h.from; last.to = h.to; last.t = h.t; }
    else out.push({ delta: h.to - h.from, to: h.to, turn: h.turn, t: h.t });
  }
  return out.filter(x => x.delta).slice(-5).reverse();
}

function paint(){
  for(const who of [OPP, ME]){
    const el = $(`#p${who}`);
    el.querySelector('.life').textContent = st.life[who];
    el.classList.toggle('dead', st.life[who] <= 0);
    el.classList.toggle('active', st.active === who);
    const d = el.querySelector('.delta');
    d.textContent = pending[who] ? (pending[who] > 0 ? '+' : '') + pending[who] : '';
    el.querySelector('.pname').textContent = names[who];
    const av = el.querySelector('.pav');
    av.hidden = !avatars[who];
    if(avatars[who]) av.src = avatars[who];
    el.querySelector('.mini').innerHTML = recent(who).map(r =>
      `<span class="${r.delta < 0 ? 'neg' : 'pos'}">${r.delta > 0 ? '+' : ''}${r.delta}<i>${r.turn ? 'Z' + r.turn : ''}</i></span>`).join('');
    el.querySelector('.go').disabled = st.active !== who;
    el.querySelector('.skull').hidden = st.life[who] > 0;
    el.querySelector('.turnTag').textContent = st.active === who ? (st.turn ? `Zug ${st.turn} · du bist dran` : 'beginnt') : '';
  }
  $('#score').innerHTML = `<b>${st.wins[ME]}</b>:<b>${st.wins[OPP]}</b><small>G${st.game}</small>`;
  $('#axeStart').hidden = st.active !== null;
}

// ---------- Axt-Wurf: wer beginnt ----------
const AXE_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="29" y="6" width="6" height="54" rx="2" fill="#8b5a2b"/>
  <path d="M30 14C18 8 8 12 4 22c6-2 12-1 16 3 2 2 3 5 3 8 4-2 7-6 7-10z" fill="#cfd6dd" stroke="#6b7480" stroke-width="1.5"/>
  <path d="M34 14c12-6 22-2 26 8-6-2-12-1-16 3-2 2-3 5-3 8-4-2-7-6-7-10z" fill="#cfd6dd" stroke="#6b7480" stroke-width="1.5"/>
  <rect x="27" y="12" width="10" height="6" rx="1.5" fill="#5a3a1b"/></svg>`;
const BLOOD_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true"><g fill="#a30d0d">
  <circle cx="60" cy="60" r="22"/><circle cx="30" cy="48" r="9"/><circle cx="92" cy="70" r="11"/><circle cx="74" cy="28" r="7"/>
  <circle cx="44" cy="92" r="8"/><circle cx="18" cy="76" r="4"/><circle cx="104" cy="40" r="5"/><circle cx="86" cy="100" r="4"/>
  <path d="M60 60L14 30l4-3zM60 60l50-18 1 4zM60 60l-12 54-4-1z"/></g></svg>`;

function throwAxe(){
  if(st.active !== null) return;
  const who = Math.random() < 0.5 ? OPP : ME;
  const layer = $('#axeLayer');
  layer.innerHTML = `<div class="blood">${BLOOD_SVG}</div><div class="axe">${AXE_SVG}</div>`;
  const axe = layer.querySelector('.axe'), blood = layer.querySelector('.blood');
  const H = window.innerHeight;
  const targetY = (who === ME ? 0.9 : 0.1) * H;      // am aeusseren Rand, damit die Zahl frei bleibt
  const targetX = window.innerWidth * (0.3 + Math.random() * 0.4);
  const startX = window.innerWidth / 2, startY = H / 2;
  axe.style.left = blood.style.left = '0px'; axe.style.top = blood.style.top = '0px';
  const spins = 3 + Math.floor(Math.random() * 2);
  const endRot = spins * 360 + (who === ME ? 160 : -20) + (Math.random() * 30 - 15);
  const anim = axe.animate([
    { transform: `translate(${startX}px,${startY}px) translate(-50%,-50%) rotate(0deg) scale(.6)` },
    { transform: `translate(${startX}px,${H * 0.05}px) translate(-50%,-50%) rotate(${endRot * 0.55}deg) scale(1.3)`, offset: 0.55 },
    { transform: `translate(${targetX}px,${targetY}px) translate(-50%,-50%) rotate(${endRot}deg) scale(1.05)` },
  ], { duration: 1500, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'forwards' });
  if(navigator.vibrate) navigator.vibrate(20);
  anim.onfinish = () => {
    if(navigator.vibrate) navigator.vibrate([60, 40, 120]);
    blood.style.transform = `translate(${targetX}px,${targetY}px) translate(-50%,-50%)`;
    blood.classList.add('splat');
    axe.classList.add('stuck');
    st.active = who; st.turn = 1;
    st.history.push({ t: Date.now(), kind: 'start', game: st.game, who });
    save(); paint();
    toast(`🪓 ${names[who]} beginnt!`, 'ok');
  };
}

function passTurn(who){
  if(st.active !== who) return;
  st.active = who === ME ? OPP : ME;
  st.turn += 1;
  save(); paint();
  $('#axeLayer').classList.add('fade');
  if(navigator.vibrate) navigator.vibrate(15);
}

// ---------- Games ----------
function gameLost(loser){
  const winner = loser === ME ? OPP : ME;
  st.wins[winner] += 1;
  st.history.push({ t: Date.now(), kind: 'game', game: st.game, loser, turn: st.turn });
  const done = st.wins[winner] >= 2;
  st.game += 1;
  st.life = [st.start, st.start];
  st.active = done ? null : loser;            // Verlierer beginnt das naechste Game
  st.turn = done ? 0 : 1;
  pending[0] = pending[1] = 0;
  $('#axeLayer').innerHTML = ''; $('#axeLayer').classList.remove('fade');
  save(); paint();
  if(done) setTimeout(resultSheet, 400);
  else toast(`💀 Game an ${names[winner]} · ${names[loser]} beginnt Game ${st.game}`, 'ok');
}

function resultFor(){
  // Ergebnis aus Sicht von Spieler A des Matches
  const meA = match && match.player_a_id === mineId;
  const a = meA ? st.wins[ME] : st.wins[OPP];
  const b = meA ? st.wins[OPP] : st.wins[ME];
  return `${a}:${b}`;
}

function resultSheet(){
  const res = resultFor();
  const valid = ['2:0', '2:1', '1:2', '0:2', '1:1', '1:0', '0:1', '0:0'].includes(res);
  const canSubmit = match && !match.is_bye && m.isMember && valid;
  const s = openSheet(`<h3>Spielstand</h3>
    <div class="score-edit">
      <div><div class="small muted">${esc(names[ME])}</div><div class="row" style="gap:8px;justify-content:center"><button class="btn xs ghost" data-w="1,-1">−</button><b>${st.wins[ME]}</b><button class="btn xs ghost" data-w="1,1">+</button></div></div>
      <span class="muted">:</span>
      <div><div class="small muted">${esc(names[OPP])}</div><div class="row" style="gap:8px;justify-content:center"><button class="btn xs ghost" data-w="0,-1">−</button><b>${st.wins[OPP]}</b><button class="btn xs ghost" data-w="0,1">+</button></div></div>
    </div>
    ${canSubmit ? `<button class="btn block mt" id="sendRes">Ergebnis ${esc(st.wins[ME] + ':' + st.wins[OPP])} eintragen</button>` : ''}
    <div class="btn-row mt"><button class="btn ghost" id="newGame">Neues Game</button><button class="btn ghost" id="axeAgain">🪓 Neu auswerfen</button></div>
    <div class="label mt">Startleben</div>
    <div class="btn-row">${[20, 30, 40].map(n => `<button class="btn sm ${n === st.start ? '' : 'ghost'}" data-n="${n}">${n}</button>`).join('')}</div>
    <button class="btn block danger mt" id="resetAll">Match zurücksetzen</button>`);
  s.el.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => {
    const [who, d] = b.dataset.w.split(',').map(Number);
    st.wins[who] = Math.max(0, Math.min(2, st.wins[who] + d)); save(); paint(); s.close(); resultSheet();
  }));
  s.el.querySelector('#sendRes')?.addEventListener('click', async () => {
    try{
      await correctMatchResult(match.id, resultFor());
      s.close(); toast(`Ergebnis ${st.wins[ME]}:${st.wins[OPP]} eingetragen ✔`, 'ok');
    }catch(err){ toast(/row-level|policy/i.test(err.message) ? 'Keine Berechtigung (Weekly abgeschlossen?).' : err.message, 'err'); }
  });
  s.el.querySelector('#newGame').addEventListener('click', () => {
    st.game += 1; st.life = [st.start, st.start]; st.active = null; st.turn = 0;
    st.history.push({ t: Date.now(), kind: 'game', game: st.game - 1, loser: null });
    $('#axeLayer').innerHTML = ''; save(); paint(); s.close();
  });
  s.el.querySelector('#axeAgain').addEventListener('click', () => {
    st.active = null; st.turn = 0; $('#axeLayer').innerHTML = ''; $('#axeLayer').classList.remove('fade'); save(); paint(); s.close();
  });
  s.el.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    st.start = Number(b.dataset.n); st.life = [st.start, st.start]; save(); paint(); s.close();
  }));
  s.el.querySelector('#resetAll').addEventListener('click', async () => {
    s.close();
    if(!await confirmSheet('Match zurücksetzen?', 'Leben, Spielstand und Verlauf werden gelöscht.', 'Zurücksetzen', true)) return;
    st = fresh(st.start); $('#axeLayer').innerHTML = ''; save(); paint();
  });
}

function historySheet(){
  // aufeinanderfolgende Tipper desselben Spielers im selben Zug zusammenfassen
  const merged = [];
  for(const h of st.history){
    const last = merged[merged.length - 1];
    if(!h.kind && last && !last.kind && last.who === h.who && last.turn === h.turn && last.game === h.game && h.t - last.t < 8000){
      last.to = h.to; last.t = h.t;
    } else merged.push({ ...h });
  }
  const rows = merged.filter(h => h.kind || h.to !== h.from).reverse();
  const line = h => {
    if(h.kind === 'start') return `<div class="list-item" style="min-height:38px;background:var(--bg-2)"><span class="small">🪓 Game ${h.game}: <b>${esc(names[h.who])}</b> beginnt</span></div>`;
    if(h.kind === 'game') return `<div class="list-item" style="min-height:38px;background:var(--bg-2)"><span class="small">${h.loser == null ? '↺' : '💀'} Game ${h.game}${h.loser == null ? ' abgebrochen' : `: <b>${esc(names[h.loser])}</b> verliert${h.turn ? ` in Zug ${h.turn}` : ''}`}</span></div>`;
    return `<div class="list-item" style="min-height:40px">
      <span class="tiny faint" style="width:66px">G${h.game}${h.turn ? ' · Z' + h.turn : ''}<br>${new Date(h.t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="grow small">${esc(names[h.who])}</span>
      <b class="small" style="color:${h.to < h.from ? '#ff8a80' : '#7ee2a8'}">${h.to < h.from ? '' : '+'}${h.to - h.from}</b>
      <span class="small muted" style="width:60px;text-align:right">${h.from} → ${h.to}</span></div>`;
  };
  openSheet(`<h3>Verlauf</h3>${rows.length ? `<div class="list">${rows.map(line).join('')}</div>` : '<p class="muted">Noch nix passiert.</p>'}
    <button class="btn block ghost mt" data-close>Schließen</button>`);
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
  mineId = mineP?.id || null;
  const [{ data: ms }, { data: rd }] = await Promise.all([
    supabase.from('matches').select('*').eq('tournament_id', tid).eq('round_no', t.current_round),
    supabase.from('rounds').select('id,timer_ends_at').eq('tournament_id', tid).eq('round_no', t.current_round).maybeSingle(),
  ]);
  const mx = mineP && (ms || []).find(x => x.player_a_id === mineP.id || x.player_b_id === mineP.id);
  const nm = id => { const p = (players || []).find(x => x.id === id); const per = p && ((p.slug && people.bySlug.get(p.slug)) || personForName(people, p.name)); return [per?.real || p?.name || '?', per?.avatar || null]; };

  const newKey = mx ? `sg-life-${mx.id}` : `sg-life-${tid}-r${t.current_round}`;
  if(newKey !== key){
    if(match && mx && mx.id !== match.id) toast(`Runde ${t.current_round}: neues Match!`, 'ok');
    key = newKey; load(); $('#axeLayer').innerHTML = '';
  }
  match = mx || null;
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
  for(const who of [OPP, ME]){
    const el = $(`#p${who}`);
    el.querySelector('.plus').addEventListener('click', () => change(who, 1));
    el.querySelector('.minus').addEventListener('click', () => change(who, -1));
    for(const [sel, d] of [['.plus', 5], ['.minus', -5]]){
      let h = null;
      const zone = el.querySelector(sel);
      zone.addEventListener('pointerdown', () => { h = setTimeout(() => { change(who, d - Math.sign(d)); h = 'done'; }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => zone.addEventListener(ev, () => { if(h !== 'done') clearTimeout(h); h = null; }));
    }
    el.querySelector('.go').addEventListener('click', () => passTurn(who));
    el.querySelector('.skull').addEventListener('click', async () => {
      if(await confirmSheet(`Game ${st.game} verloren?`, `${names[who]} hat 0 Leben – Game an ${names[who === ME ? OPP : ME]}.`, 'Game werten')) gameLost(who);
    });
  }
  $('#axeStart').addEventListener('click', throwAxe);
  $('#score').addEventListener('click', resultSheet);
  $('#histBtn').addEventListener('click', historySheet);
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
}

// ---------- Start ----------
m = await me();
people = await loadPeople().catch(() => ({ bySlug: new Map(), byName: new Map(), byId: new Map() }));
$('#backBtn').href = tid ? `/tournament-app/round.html?tournament=${tid}` : '/tournament-app/dashboard.html';
$('#backBtn').innerHTML = icon('back');
$('#axeStart').innerHTML = AXE_SVG;
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
