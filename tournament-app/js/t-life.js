// Lifecounter
//   Weekly (?tournament=ID): laeuft auf dem aktuellen Match, 20 Leben, Ergebnis eintragbar.
//   Frei (aus dem Tools-Tab): 20 (normal) oder 30 (Commander) waehlen, Namen antippbar.
//   Geteilter Bildschirm (Gegner oben, gedreht). Tippen oben (gruen) / unten (rot) = +1/-1,
//   gedrueckt halten = 5er. Verlauf rechts, nach Zuegen gegliedert. Axt-Wurf: wer beginnt.
//   GO (oder "Go" sagen) gibt den Zug weiter. Gift (10 = tot), Energie, Aufgeben.
//   Rundentimer des Weeklys + Spielzeit seit dem Axt-Wurf. Bildschirm bleibt an.
import { $, esc, icon, supabase, me, loadPeople, personForName, openSheet, confirmSheet, toast } from '/js/app.js';
import { correctMatchResult } from './tournament.js';
import { countdown, unlockAudio, fmtLeft } from '/js/timer.js';
import { startGo, stopGo, LEVELS } from '/js/voice-go.js';

const tid = new URLSearchParams(location.search).get('tournament');
const WEEKLY_LIFE = 20;
const MERGE_MS = 2500;                 // Tipper innerhalb dieser Zeit = ein Eintrag
let m, people, match = null, mineId = null, names = ['Gegner', 'Ich'], avatars = [null, null];
let key = tid ? 'sg-life-' + tid : 'sg-life-free';
let st = null, stopTimer = null, clock = null;
const pending = [0, 0], pendTimer = [null, null];
const OPP = 0, ME = 1;

unlockAudio();

// ---------- Wake Lock ----------
async function keepAwake(){ try{ if('wakeLock' in navigator && !document.hidden) await navigator.wakeLock.request('screen'); }catch{} }
document.addEventListener('visibilitychange', () => { if(!document.hidden){ keepAwake(); if(tid) loadMatch(); } });
keepAwake();

// ---------- Zustand ----------
// log: { t, who, delta, to, turn, game, kind:'life'|'poison'|'energy' } | { t, kind:'go'|'start'|'game', ... }
function fresh(start){
  return { start, life: [start, start], poison: [0, 0], energy: [0, 0], game: 1, wins: [0, 0],
           active: null, turn: 0, log: [], startedAt: null, names: null };
}
function load(){
  try{ st = JSON.parse(localStorage.getItem(key) || 'null'); }catch{ st = null; }
  if(st && !st.log) st = null;                 // alte Version verwerfen
}
function save(){ try{ localStorage.setItem(key, JSON.stringify(st)); }catch{} }

function bump(who, delta, kind = 'life'){
  if(kind === 'life') st.life[who] += delta;
  else if(kind === 'poison') st.poison[who] = Math.max(0, st.poison[who] + delta);
  else st.energy[who] = Math.max(0, st.energy[who] + delta);
  const to = kind === 'life' ? st.life[who] : kind === 'poison' ? st.poison[who] : st.energy[who];
  const last = st.log[st.log.length - 1];
  if(last && last.kind === kind && last.who === who && last.turn === st.turn && last.game === st.game && Date.now() - last.t < MERGE_MS){
    last.delta += delta; last.to = to; last.t = Date.now();
    if(!last.delta) st.log.pop();
  } else st.log.push({ t: Date.now(), kind, who, delta, to, turn: st.turn, game: st.game });
  save();
  if(kind === 'life'){
    pending[who] += delta;
    clearTimeout(pendTimer[who]);
    pendTimer[who] = setTimeout(() => { pending[who] = 0; paint(); }, 1400);
  }
  if(navigator.vibrate) navigator.vibrate(8);
  paint();
}

const dead = who => st.life[who] <= 0 || st.poison[who] >= 10;

function historyHtml(who){
  // neueste oben, je Zug ein Abschnitt
  const items = st.log.filter(h => h.game === st.game && h.who === who && ['life', 'poison', 'energy'].includes(h.kind));
  let html = '', lastTurn = null;
  for(const h of [...items].reverse()){
    if(h.turn !== lastTurn){ html += `<div class="hz">Zug ${h.turn || '–'}</div>`; lastTurn = h.turn; }
    const sym = h.kind === 'poison' ? '🧪' : h.kind === 'energy' ? '⚡' : '';
    html += `<div class="he ${h.delta < 0 ? 'neg' : 'pos'}">${sym}${h.delta > 0 ? '+' : ''}${h.delta}<i>${h.to}</i></div>`;
  }
  return html;
}

function paint(){
  for(const who of [OPP, ME]){
    const el = $(`#p${who}`);
    el.querySelector('.life').textContent = st.life[who];
    el.classList.toggle('dead', dead(who));
    el.classList.toggle('active', st.active === who);
    el.querySelector('.delta').textContent = pending[who] ? (pending[who] > 0 ? '+' : '') + pending[who] : '';
    el.querySelector('.pname').textContent = names[who];
    const av = el.querySelector('.pav');
    av.hidden = !avatars[who];
    if(avatars[who]) av.src = avatars[who];
    el.querySelector('.hist').innerHTML = historyHtml(who);
    el.querySelector('.go').disabled = st.active !== who;
    el.querySelector('.skull').hidden = !dead(who);
    el.querySelector('.turnTag').textContent = st.active === who ? `Zug ${st.turn} · am Zug` : '';
    el.querySelector('[data-c="poison"] b').textContent = st.poison[who];
    el.querySelector('[data-c="energy"] b').textContent = st.energy[who];
    el.querySelector('[data-c="poison"]').classList.toggle('hot', st.poison[who] >= 7);
  }
  $('#score').innerHTML = `<b>${st.wins[ME]}</b>:<b>${st.wins[OPP]}</b><small>G${st.game}</small>`;
  $('#axeStart').hidden = st.active !== null;
}

// ---------- Spielzeit seit dem Axt-Wurf ----------
function startClock(){
  clearInterval(clock);
  const el = $('#playClock');
  const tick = () => {
    el.hidden = !st?.startedAt;
    if(st?.startedAt) el.textContent = '⏱ ' + fmtLeft(-(Date.now() - st.startedAt)).replace('+', '');
  };
  tick(); clock = setInterval(tick, 1000);
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
  layer.classList.remove('fade');
  layer.innerHTML = `<div class="blood">${BLOOD_SVG}</div><div class="axe">${AXE_SVG}</div>`;
  const axe = layer.querySelector('.axe'), blood = layer.querySelector('.blood');
  const H = window.innerHeight, W = window.innerWidth;
  const targetY = (who === ME ? 0.9 : 0.1) * H;
  const targetX = W * (0.25 + Math.random() * 0.35);
  const spins = 3 + Math.floor(Math.random() * 2);
  const endRot = spins * 360 + (who === ME ? 160 : -20) + (Math.random() * 30 - 15);
  const anim = axe.animate([
    { transform: `translate(${W / 2}px,${H / 2}px) translate(-50%,-50%) rotate(0deg) scale(.6)` },
    { transform: `translate(${W / 2}px,${H * 0.05}px) translate(-50%,-50%) rotate(${endRot * 0.55}deg) scale(1.3)`, offset: 0.55 },
    { transform: `translate(${targetX}px,${targetY}px) translate(-50%,-50%) rotate(${endRot}deg) scale(1.05)` },
  ], { duration: 1500, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'forwards' });
  // Falls die Animation nicht zu Ende laeuft (Bildschirm aus, Hintergrund): trotzdem entscheiden
  let decided = false;
  const finish = () => {
    if(decided) return; decided = true;
    if(navigator.vibrate) navigator.vibrate([60, 40, 120]);
    blood.style.transform = `translate(${targetX}px,${targetY}px) translate(-50%,-50%)`;
    blood.classList.add('splat');
    st.active = who; st.turn = 1;
    if(!st.startedAt) st.startedAt = Date.now();
    st.log.push({ t: Date.now(), kind: 'start', game: st.game, who });
    save(); paint(); startClock();
    toast(`🪓 ${names[who]} beginnt!`, 'ok');
  };
  anim.onfinish = finish;
  setTimeout(() => { try{ anim.finish(); }catch{} finish(); }, 1800);
}

function passTurn(who = st.active){
  if(who === null || st.active !== who) return;
  st.active = who === ME ? OPP : ME;
  st.turn += 1;
  st.log.push({ t: Date.now(), kind: 'go', game: st.game, turn: st.turn });
  save(); paint();
  $('#axeLayer').classList.add('fade');
  if(navigator.vibrate) navigator.vibrate(15);
}

// ---------- Sprachsteuerung: "Go" (lautlos, am Geraet) ----------
let listening = false;
async function voiceToggle(){
  if(listening){ listening = false; await stopGo(); paintMic(); toast('🎙️ aus'); return; }
  let level = 'normal'; try{ level = localStorage.getItem('sg-go-level') || 'normal'; }catch{}
  const s = openSheet(`<h3>🎙️ Zug mit „Go“ weitergeben</h3>
    <p class="muted mb">Sag laut und deutlich <b>„Go“</b> – wie ein Tipp auf GO. Läuft lautlos und nur auf deinem Handy.</p>
    <div class="label mb">Wer darf auslösen?</div>
    <div class="stack">${Object.entries(LEVELS).map(([k, v]) => `<button class="btn block ${k === level ? '' : 'ghost'}" data-l="${k}">${v.label}</button>`).join('')}</div>
    <p class="hint mt">Beim ersten Mal wird das Sprachmodell geladen (ca. 6 MB) und das Handy fragt nach dem Mikrofon.</p>`);
  s.el.querySelectorAll('[data-l]').forEach(btn => btn.addEventListener('click', async () => {
    const lv = btn.dataset.l;
    try{ localStorage.setItem('sg-go-level', lv); }catch{}
    s.close();
    toast('🎙️ Lade Sprachmodell …');
    try{
      await startGo(() => {
        if(st.active === null) return;
        passTurn();
        $('#micBtn').classList.add('hit'); setTimeout(() => $('#micBtn').classList.remove('hit'), 600);
      }, lv);
      listening = true; paintMic();
      toast('🎙️ Bereit – sag „Go“.', 'ok');
    }catch(err){
      listening = false; paintMic();
      toast(/denied|NotAllowed|Permission/i.test(err.name + err.message) ? 'Mikrofon nicht erlaubt.' : err.message, 'err');
    }
  }));
}
function paintMic(){ $('#micBtn').classList.toggle('on', listening); }

// ---------- Games ----------
function gameLost(loser, how = 'tot'){
  const winner = loser === ME ? OPP : ME;
  st.wins[winner] += 1;
  st.log.push({ t: Date.now(), kind: 'game', game: st.game, loser, turn: st.turn, how });
  const done = st.wins[winner] >= 2;
  st.game += 1;
  st.life = [st.start, st.start]; st.poison = [0, 0]; st.energy = [0, 0];
  st.active = done ? null : loser;            // Verlierer beginnt das naechste Game
  st.turn = done ? 0 : 1;
  pending[0] = pending[1] = 0;
  $('#axeLayer').innerHTML = '';
  save(); paint();
  if(done) setTimeout(resultSheet, 400);
  else toast(`💀 Game an ${names[winner]} · ${names[loser]} beginnt Game ${st.game}`, 'ok');
}

function resultFor(){
  const meA = match && match.player_a_id === mineId;
  return meA ? `${st.wins[ME]}:${st.wins[OPP]}` : `${st.wins[OPP]}:${st.wins[ME]}`;
}

function resultSheet(){
  const valid = ['2:0', '2:1', '1:2', '0:2', '1:1', '1:0', '0:1', '0:0'].includes(resultFor());
  const canSubmit = tid && match && !match.is_bye && m.isMember && valid;
  const s = openSheet(`<h3>Spielstand</h3>
    <div class="score-edit">
      <div><div class="small muted">${esc(names[ME])}</div><div class="row" style="gap:8px;justify-content:center"><button class="btn xs ghost" data-w="1,-1">−</button><b>${st.wins[ME]}</b><button class="btn xs ghost" data-w="1,1">+</button></div></div>
      <span class="muted">:</span>
      <div><div class="small muted">${esc(names[OPP])}</div><div class="row" style="gap:8px;justify-content:center"><button class="btn xs ghost" data-w="0,-1">−</button><b>${st.wins[OPP]}</b><button class="btn xs ghost" data-w="0,1">+</button></div></div>
    </div>
    ${canSubmit ? `<button class="btn block mt" id="sendRes">Ergebnis ${esc(st.wins[ME] + ':' + st.wins[OPP])} eintragen</button>` : ''}
    <div class="btn-row mt"><button class="btn ghost" id="newGame">Neues Game</button><button class="btn ghost" id="axeAgain">🪓 Neu auswerfen</button></div>
    <div class="label mt">Startleben</div>
    <div class="btn-row">${[20, 30, 40].map(n => `<button class="btn sm ${n === st.start ? '' : 'ghost'}" data-n="${n}">${n}${n === 30 ? ' Commander' : ''}</button>`).join('')}</div>
    <button class="btn block danger mt" id="resetAll">Match zurücksetzen</button>`);
  s.el.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => {
    const [who, d] = b.dataset.w.split(',').map(Number);
    st.wins[who] = Math.max(0, Math.min(2, st.wins[who] + d)); save(); paint(); s.close(); resultSheet();
  }));
  s.el.querySelector('#sendRes')?.addEventListener('click', async () => {
    try{ await correctMatchResult(match.id, resultFor()); s.close(); toast(`Ergebnis ${st.wins[ME]}:${st.wins[OPP]} eingetragen ✔`, 'ok'); }
    catch(err){ toast(/row-level|policy/i.test(err.message) ? 'Keine Berechtigung (Weekly abgeschlossen?).' : err.message, 'err'); }
  });
  s.el.querySelector('#newGame').addEventListener('click', () => {
    st.log.push({ t: Date.now(), kind: 'game', game: st.game, loser: null });
    st.game += 1; st.life = [st.start, st.start]; st.poison = [0, 0]; st.energy = [0, 0]; st.active = null; st.turn = 0;
    $('#axeLayer').innerHTML = ''; save(); paint(); s.close();
  });
  s.el.querySelector('#axeAgain').addEventListener('click', () => {
    st.active = null; st.turn = 0; $('#axeLayer').innerHTML = ''; save(); paint(); s.close();
  });
  s.el.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    st.start = Number(b.dataset.n); st.life = [st.start, st.start]; save(); paint(); s.close();
  }));
  s.el.querySelector('#resetAll').addEventListener('click', async () => {
    s.close();
    if(!await confirmSheet('Match zurücksetzen?', 'Leben, Spielstand, Verlauf und Spielzeit werden gelöscht.', 'Zurücksetzen', true)) return;
    if(tid){ st = fresh(WEEKLY_LIFE); save(); $('#axeLayer').innerHTML = ''; paint(); startClock(); }
    else { localStorage.removeItem(key); location.reload(); }
  });
}

function fullHistorySheet(){
  const rows = [...st.log].reverse();
  const line = h => {
    if(h.kind === 'go') return `<div class="list-item" style="min-height:26px;padding:4px 14px;background:var(--bg-2)"><span class="tiny muted">— Zug ${h.turn} (G${h.game}) —</span></div>`;
    if(h.kind === 'start') return `<div class="list-item" style="min-height:36px;background:var(--bg-2)"><span class="small">🪓 Game ${h.game}: <b>${esc(names[h.who])}</b> beginnt</span></div>`;
    if(h.kind === 'game') return `<div class="list-item" style="min-height:36px;background:var(--bg-2)"><span class="small">${h.loser == null ? '↺' : h.how === 'aufgegeben' ? '🏳️' : '💀'} Game ${h.game}${h.loser == null ? ' abgebrochen' : `: <b>${esc(names[h.loser])}</b> ${h.how === 'aufgegeben' ? 'gibt auf' : 'verliert'}${h.turn ? ` in Zug ${h.turn}` : ''}`}</span></div>`;
    const sym = h.kind === 'poison' ? '🧪 ' : h.kind === 'energy' ? '⚡ ' : '';
    return `<div class="list-item" style="min-height:36px">
      <span class="tiny faint" style="width:60px">G${h.game} · Z${h.turn || '–'}<br>${new Date(h.t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span class="grow small">${esc(names[h.who])}</span>
      <b class="small" style="color:${h.delta < 0 ? '#ff8a80' : '#7ee2a8'}">${sym}${h.delta > 0 ? '+' : ''}${h.delta}</b>
      <span class="small muted" style="width:34px;text-align:right">${h.to}</span></div>`;
  };
  openSheet(`<h3>Ganzer Verlauf</h3>${rows.length ? `<div class="list">${rows.map(line).join('')}</div>` : '<p class="muted">Noch nix passiert.</p>'}
    <button class="btn block ghost mt" data-close>Schließen</button>`);
}

// ---------- Aktuelles Weekly-Match ----------
async function loadMatch(){
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
  const nm = id => { const p = (players || []).find(x => x.id === id); const per = p && ((p.slug && people.bySlug.get(p.slug)) || personForName(people, p.name)); return [p?.name || '?', per?.avatar || null]; };

  const newKey = mx ? `sg-life-${mx.id}` : `sg-life-${tid}-r${t.current_round}`;
  if(newKey !== key || !st || !st.log){
    if(match && mx && mx.id !== match.id) toast(`Runde ${t.current_round}: neues Match!`, 'ok');
    key = newKey; load(); if(!st){ st = fresh(WEEKLY_LIFE); save(); }
    $('#axeLayer').innerHTML = ''; startClock();
  }
  match = mx || null;
  if(mx && !mx.is_bye){
    const meA = mx.player_a_id === mineP.id;
    const [on, oa] = nm(meA ? mx.player_b_id : mx.player_a_id);
    const [mn, ma] = nm(mineP.id);
    names = [on, mn]; avatars = [oa, ma];
    $('#rLabel').textContent = t.current_round ? `Runde ${t.current_round}${t.status === 'finished' ? ' · beendet' : ''}` : 'Draft-Phase';
  } else {
    names = mx?.is_bye ? ['Bye', nm(mineP.id)[0]] : ['Spieler 2', 'Spieler 1'];
    avatars = [null, mineP ? nm(mineP.id)[1] : null];
    $('#rLabel').textContent = mx?.is_bye ? `Runde ${t.current_round} · Bye` : (t.current_round ? 'freies Spiel' : 'Draft-Phase');
  }
  stopTimer?.(); stopTimer = null;
  if(rd?.timer_ends_at && t.status === 'active'){
    $('#tmr').hidden = false;
    stopTimer = countdown($('#tmr'), rd.timer_ends_at, rd.id, () => toast('⏰ Zeit is aus!', 'err'));
  } else $('#tmr').hidden = true;
  paint();
}

// ---------- Freies Spiel (Tools) ----------
function myIdentity(){
  const p = m.user ? people.byId.get(m.user.id) : null;
  return p ? [p.name, p.avatar] : ['Ich', null];
}
function freeStart(){
  load();
  const [myName, myAv] = myIdentity();
  if(st){
    names = [st.names?.[0] || 'Gegner', myName];
    avatars = [st.avatars?.[0] || null, myAv];
    paint(); startClock(); return;
  }
  names = ['Gegner', myName]; avatars = [null, myAv];
  st = fresh(20); paint();
  const s = openSheet(`<h3>Neues Spiel</h3><p class="muted mb">Mit wie vielen Leben startet ihr?</p>
    <div class="stack"><button class="btn block" data-n="20">20 Leben · normal</button>
    <button class="btn block ghost" data-n="30">30 Leben · Commander</button></div>`);
  s.el.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    st = fresh(Number(b.dataset.n)); st.names = names; st.avatars = avatars; save(); s.close(); paint(); startClock();
    pickOpponent();
  }));
}

function pickOpponent(){
  const list = people.list ? people.list.filter(p => p.active !== false && p.id !== m.user?.id).sort((a, b) => a.name.localeCompare(b.name, 'de')) : [];
  const s = openSheet(`<h3>Gegen wen?</h3>
    <div class="row" style="gap:8px"><input class="input grow" id="oppFree" placeholder="Name eintippen" maxlength="40"><button class="btn sm" id="oppOk">OK</button></div>
    ${list.length ? `<div class="label mt mb">oder aus den Spielerprofilen</div><div class="pick-grid">${list.map(p => `<button type="button" class="pick" data-slug="${esc(p.slug)}"><img class="avatar" src="${esc(p.avatar)}" alt=""><span>${esc(p.name)}</span></button>`).join('')}</div>` : ''}`);
  const set = (n, av) => { names[OPP] = n; avatars[OPP] = av; st.names = names; st.avatars = avatars; save(); paint(); s.close(); };
  s.el.querySelector('#oppOk').addEventListener('click', () => { const n = s.el.querySelector('#oppFree').value.trim(); if(n) set(n.slice(0, 40), null); });
  s.el.querySelectorAll('[data-slug]').forEach(b => b.addEventListener('click', () => { const p = people.bySlug.get(b.dataset.slug); set(p.name, p.avatar); }));
}

// ---------- Bedienung ----------
function bind(){
  for(const who of [OPP, ME]){
    const el = $(`#p${who}`);
    el.querySelector('.plus').addEventListener('click', () => bump(who, 1));
    el.querySelector('.minus').addEventListener('click', () => bump(who, -1));
    for(const [sel, d] of [['.plus', 5], ['.minus', -5]]){
      let h = null;
      const zone = el.querySelector(sel);
      zone.addEventListener('pointerdown', () => { h = setTimeout(() => { bump(who, d - Math.sign(d)); h = 'done'; }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => zone.addEventListener(ev, () => { if(h !== 'done') clearTimeout(h); h = null; }));
    }
    el.querySelector('.go').addEventListener('click', () => passTurn(who));
    el.querySelector('.skull').addEventListener('click', async () => {
      if(await confirmSheet(`Game ${st.game} verloren?`, `${names[who]} ist tot – Game an ${names[who === ME ? OPP : ME]}.`, 'Game werten')) gameLost(who);
    });
    el.querySelector('.concede').addEventListener('click', async () => {
      if(await confirmSheet(`${names[who]} gibt auf?`, `Game ${st.game} geht an ${names[who === ME ? OPP : ME]}.`, '🏳️ Aufgeben', true)) gameLost(who, 'aufgegeben');
    });
    el.querySelectorAll('[data-c] button').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      bump(who, Number(b.dataset.d), b.closest('[data-c]').dataset.c);
    }));
    if(!tid && who === OPP) el.querySelector('.pname').addEventListener('click', pickOpponent);
  }
  $('#axeStart').addEventListener('click', throwAxe);
  $('#score').addEventListener('click', resultSheet);
  $('#histBtn').addEventListener('click', fullHistorySheet);
  $('#micBtn').addEventListener('click', voiceToggle);
  $('#diceBtn').addEventListener('click', diceSheet);
}

// ---------- Wuerfel & Muenze (animiert) ----------
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const d6Html = v => `<div class="d6">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[v].includes(i + 1) ? 'on' : ''}"></i>`).join('')}</div>`;
const d20Html = v => `<div class="d20"><svg viewBox="0 0 100 100"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" /><polygon points="50,22 76,66 24,66" class="in"/></svg><b>${v}</b></div>`;
const coinHtml = () => `<div class="coin"><div class="face front">🪓<small>Kopf</small></div><div class="face back">20<small>Zahl</small></div></div>`;

function diceSheet(){
  const s = openSheet(`<h3>Würfeln</h3><div class="dice-stage" id="diceStage">${d6Html(6)}</div><p class="center dice-res" id="diceRes">&nbsp;</p>
    <div class="btn-row"><button class="btn" data-d="6">W6</button><button class="btn" data-d="20">W20</button><button class="btn ghost" data-d="2">Münze</button></div>
    <button class="btn block ghost mt" data-close>Schließen</button>`);
  const stage = s.el.querySelector('#diceStage'), res = s.el.querySelector('#diceRes');
  s.el.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.d);
    const v = 1 + Math.floor(Math.random() * n);
    res.innerHTML = '&nbsp;';
    if(n === 2){
      stage.innerHTML = coinHtml();
      const coin = stage.querySelector('.coin');
      const turns = 6 + Math.floor(Math.random() * 3);
      const endY = turns * 360 + (v === 1 ? 0 : 180);
      const anim = coin.animate([
        { transform: 'translateY(0) rotateY(0deg) scale(1)' },
        { transform: `translateY(-120px) rotateY(${endY / 2}deg) scale(1.25)`, offset: .5 },
        { transform: `translateY(0) rotateY(${endY}deg) scale(1)` },
      ], { duration: 1300, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
      let shown = false;
      const done = () => { if(shown) return; shown = true; res.textContent = v === 1 ? '🪓 Kopf' : '20 Zahl'; if(navigator.vibrate) navigator.vibrate(30); };
      anim.onfinish = done;
      setTimeout(() => { try{ anim.finish(); }catch{} done(); }, 1450);
      return;
    }
    const html = n === 6 ? d6Html : d20Html;
    let k = 0;
    stage.innerHTML = html(1 + Math.floor(Math.random() * n));
    const die = () => stage.firstElementChild;
    die().animate([
      { transform: 'translate(-90px,-60px) rotate(0deg) scale(.7)' },
      { transform: 'translate(40px,10px) rotate(380deg) scale(1.1)', offset: .45 },
      { transform: 'translate(-15px,-12px) rotate(560deg) scale(.95)', offset: .75 },
      { transform: 'translate(0,0) rotate(720deg) scale(1)' },
    ], { duration: 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
    const spin = setInterval(() => {
      if(++k > 12){ clearInterval(spin); stage.innerHTML = html(v); res.textContent = String(v); if(navigator.vibrate) navigator.vibrate(30); return; }
      const keep = die().getAnimations()[0];
      const t = keep?.currentTime;
      stage.innerHTML = html(1 + Math.floor(Math.random() * n));
      if(keep && t != null){
        const a2 = die().animate(keep.effect.getKeyframes(), { duration: 1000, easing: 'cubic-bezier(.2,.7,.3,1)' });
        a2.currentTime = t;
      }
    }, 75);
  }));
}

// ---------- Start ----------
m = await me();
people = await loadPeople().catch(() => ({ bySlug: new Map(), byName: new Map(), byId: new Map() }));
$('#backBtn').href = tid ? `/tournament-app/round.html?tournament=${tid}` : '/chat.html';
$('#backBtn').innerHTML = icon('back');
$('#axeStart').innerHTML = AXE_SVG;
bind();
if(tid){
  st = fresh(WEEKLY_LIFE); paint();
  await loadMatch();
  supabase.channel('life-' + tid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, () => loadMatch())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `tournament_id=eq.${tid}` }, () => loadMatch())
    .subscribe();
} else {
  $('#tName').textContent = 'Freies Spiel';
  $('#rLabel').textContent = 'Gegner antippen zum Wählen';
  freeStart();
}
