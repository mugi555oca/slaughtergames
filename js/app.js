// App-Shell und gemeinsame Helfer fuer alle Seiten.
//
//   import { initShell, me, ... } from '/js/app.js';
//   await initShell({ tab: 'home' });
//
// initShell baut obere Leiste + Tab-Leiste, registriert den Service Worker
// und haelt die Zaehler (Chat ungelesen, Benachrichtigungen) aktuell.
import { supabase } from './supabase.js';
import { ensurePush, enablePush } from './push.js';

export { supabase };

// Fehler auf den Geraeten mitschreiben (Tabelle client_errors), max. 5 pro Seite
let reported = 0;
function reportError(message, stack){
  if(reported++ >= 5) return;
  supabase.from('client_errors').insert({
    page: location.pathname + location.search, message: String(message || '').slice(0, 1900),
    stack: String(stack || '').slice(0, 5900), user_agent: navigator.userAgent.slice(0, 300),
    version: (() => { try{ return localStorage.getItem('sg-version'); }catch{ return null; } })(),
  }).then(() => {}, () => {});
}
window.addEventListener('error', e => reportError(e.message, e.error?.stack || `${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => reportError(e.reason?.message || e.reason, e.reason?.stack));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ---------------------------------------------------------------
// Icons (Strichstil, 24er Raster)
// ---------------------------------------------------------------
const P = {
  home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  trophy:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a4 4 0 0 1-4 4M7 5H4v2a4 4 0 0 0 4 4"/>',
  swords:'<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4M7 17l-3 3M3 19l2 2"/>',
  chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  chev:'<path d="m9 18 6-6-6-6"/>',
  chevL:'<path d="m15 18-6-6 6-6"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  images:'<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M3 17V5a2 2 0 0 1 2-2h12"/><path d="m21 17-4-4-6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  upload:'<path d="M12 15V3M7 8l5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  camera:'<path d="M14.5 4h-5L7.5 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  shirt:'<path d="M20.4 6.6 16 3a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.2 1.3l1.8 2.8a1 1 0 0 0 1.3.3L8 10v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V10l1.5 1a1 1 0 0 0 1.3-.3l1.8-2.8a1 1 0 0 0-.2-1.3Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  dice:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  share:'<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  axe:'<path d="m14 12-8.5 8.5a2.1 2.1 0 0 1-3-3L11 9"/><path d="M15 13 9 7l4-4c3 0 7 2 8 6Z"/>',
  crown:'<path d="m2 7 4.5 4L12 4l5.5 7L22 7l-2 12H4Z"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  reply:'<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  phone:'<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  star:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
export function icon(name, cls = ''){
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------------------------------------------------------------
// Session / eigenes Profil
// ---------------------------------------------------------------
let mePromise = null;
const ME_KEY = 'sg-me';
const PEOPLE_KEY = 'sg-people';
const lsGet = k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch{ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
export function clearLocalCache(){ try{ localStorage.removeItem(ME_KEY); localStorage.removeItem(PEOPLE_KEY); }catch{} }

// Eigenes Profil + Admin-Status. Kommt sofort aus dem Handy-Speicher und wird
// im Hintergrund aufgefrischt; force = immer frisch vom Server.
export function me(force = false){
  if(force) mePromise = null;
  if(!mePromise){
    mePromise = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || null;
      if(!user){ clearLocalCache(); return { user: null, profile: null, isAdmin: false, isMember: false }; }
      const fresh = Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('app_admins').select('email').ilike('email', user.email || ''),
      ]).then(([{ data: profile, error }, { data: adminRows }]) => {
        if(error) throw error;
        const v = { uid: user.id, profile, isAdmin: Array.isArray(adminRows) && adminRows.length > 0 };
        lsSet(ME_KEY, v);
        return v;
      });
      const cached = lsGet(ME_KEY);
      const v = !force && cached?.uid === user.id ? (fresh.catch(() => {}), cached) : await fresh;
      return { user, profile: v.profile, isAdmin: v.isAdmin, isMember: Boolean(v.profile?.slug) || v.isAdmin };
    })();
  }
  return mePromise;
}

export function loginUrl(next){
  const target = next ?? (location.pathname + location.search);
  return `/login.html?next=${encodeURIComponent(target)}`;
}

export async function requireLogin(){
  const m = await me();
  if(!m.user){ location.replace(loginUrl()); return null; }
  return m;
}

export function lockHtml(title = 'Nur für Mitglieder', text = 'Melde dich an, um das zu sehen.'){
  return `<div class="lock">${icon('lock')}<h3>${esc(title)}</h3><p>${esc(text)}</p>
    <a class="btn" href="${esc(loginUrl())}">Einloggen</a></div>`;
}

// ---------------------------------------------------------------
// Personen (Profile + SG-Stamm + Standardbilder)
// ---------------------------------------------------------------
let peoplePromise = null;

function initialsAvatar(name){
  const parts = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const ini = ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  let h = 0; for(const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${h} 45% 28%)"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${ini}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
export { initialsAvatar };

function buildPeople({ profiles = [], roster = [], statics = [] }){
  const staticBySlug = new Map(statics.map(p => [p.slug, p]));
  const rosterBySlug = new Map(roster.map(r => [r.slug, r]));
  const bySlug = new Map(), byId = new Map(), byName = new Map();
  const slugs = new Set([...rosterBySlug.keys(), ...staticBySlug.keys()]);
  for(const pr of profiles) if(pr.slug) slugs.add(pr.slug);
  for(const slug of slugs){
    const r = rosterBySlug.get(slug);
    const st = staticBySlug.get(slug);
    const pr = profiles.find(x => x.slug === slug);
    const name = r?.name || st?.name || pr?.display_name || slug;
    const real = r?.real_name || st?.realName || pr?.display_name || name;
    const person = {
      slug, id: pr?.id || null, name, real,
      display: pr?.display_name || real,
      avatar: pr?.avatar_url || (st?.profileImage ? '/' + st.profileImage.replace(/\.png$/, '.webp') : initialsAvatar(real)),
      active: r ? r.active : true,
      profile: pr || null, static: st || null,
    };
    bySlug.set(slug, person);
    if(person.id) byId.set(person.id, person);
    byName.set(name.toLowerCase(), person);
  }
  // Profile ohne slug (z. B. reine Admin-Accounts)
  for(const pr of profiles){
    if(byId.has(pr.id)) continue;
    byId.set(pr.id, { slug: null, id: pr.id, name: pr.display_name || 'Mitglied', real: pr.display_name || 'Mitglied',
      display: pr.display_name || 'Mitglied', avatar: pr.avatar_url || initialsAvatar(pr.display_name), profile: pr });
  }
  return { bySlug, byId, byName, list: [...bySlug.values()] };
}

async function fetchPeopleRaw(){
  const [profilesRes, rosterRes, statics] = await Promise.all([
    supabase.from('profiles').select('id,slug,display_name,avatar_url,description,favourite_card,favourite_card_print'),
    supabase.from('roster').select('slug,name,real_name,active'),
    fetch('/tournament-app/player_profiles.json').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  if(profilesRes.error) throw profilesRes.error;
  const raw = { profiles: profilesRes.data || [], roster: rosterRes.data || [], statics: statics || [] };
  lsSet(PEOPLE_KEY, raw);
  return raw;
}

// Alle Personen. Sofort aus dem Handy-Speicher, frisch im Hintergrund.
export function loadPeople(){
  if(!peoplePromise){
    const cached = lsGet(PEOPLE_KEY);
    const fresh = fetchPeopleRaw();
    peoplePromise = cached ? (fresh.catch(() => {}), Promise.resolve(buildPeople(cached))) : fresh.then(buildPeople);
  }
  return peoplePromise;
}

// Zaehler fuer Glocke, Chat, Pool-Guthaben, naechsten Termin - eine Abfrage.
let countersPromise = null;
export function counters(force = false){
  if(force || !countersPromise){
    countersPromise = supabase.rpc('app_counters').then(r => {
      if(r.error){ reportError('app_counters: ' + r.error.message, r.error.details); return { failed: true }; }
      return r.data || {};
    }).catch(err => { reportError('app_counters: ' + err.message, err.stack); return { failed: true }; });
  }
  return countersPromise;
}

export function personForName(people, name){
  return people.byName.get(String(name || '').toLowerCase()) || null;
}

// ---------------------------------------------------------------
// UI-Helfer
// ---------------------------------------------------------------
export function toast(text, kind = ''){
  let host = $('.toast-host');
  if(!host){ host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

export function openSheet(html, { onClose } = {}){
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.innerHTML = html;
  document.body.append(back, sheet);
  document.body.style.overflow = 'hidden';
  const close = () => {
    back.remove(); sheet.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = e => { if(e.key === 'Escape') close(); };
  back.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  sheet.addEventListener('click', e => { if(e.target.closest('[data-close]')) close(); });
  return { el: sheet, close };
}

export function confirmSheet(title, text, okLabel = 'OK', danger = false){
  return new Promise(resolve => {
    let done = false;
    const s = openSheet(`<h3>${esc(title)}</h3><p class="muted mb">${esc(text)}</p>
      <div class="btn-row"><button class="btn ghost" data-close>Abbrechen</button>
      <button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(okLabel)}</button></div>`,
      { onClose: () => { if(!done) resolve(false); } });
    s.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; s.close(); resolve(true); });
  });
}

export function busy(btn, on, label = 'Moment…'){
  if(!btn) return;
  if(on){ btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label; }
  else { btn.disabled = false; if(btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
export function timeAgo(iso){
  const s = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if(a < 60) return 'gerade eben';
  if(a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if(a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if(a < 604800) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTime(iso){ return new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }); }
export function fmtDay(iso){
  const d = new Date(iso); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if(d.toDateString() === today.toDateString()) return 'Heute';
  if(d.toDateString() === y.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'long' });
}

// Bild im Browser verkleinern (Uploads)
export function resizeImage(file, maxSide, quality = 0.85, square = false){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if(square){ const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side; }
      const scale = Math.min(1, maxSide / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      c.toBlob(b => b ? resolve({ blob: b, width: c.width, height: c.height }) : reject(new Error('Bild konnte nicht verarbeitet werden.')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Datei ist kein lesbares Bild.')); };
    img.src = url;
  });
}

// ---------------------------------------------------------------
// Shell
// ---------------------------------------------------------------
const TABS = [
  { key: 'home',     href: '/',                              label: 'Home',     icon: 'home' },
  { key: 'ranking',  href: '/ranking.html',                  label: 'Ranking',  icon: 'trophy' },
  { key: 'turniere', href: '/tournament-app/dashboard.html', label: 'Weekly', icon: 'swords' },
  { key: 'chat',     href: '/chat.html',                     label: 'Chat',     icon: 'chat' },
  { key: 'profil',   href: '/profil.html',                   label: 'Profil',   icon: 'user' },
];

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; document.dispatchEvent(new Event('sg:installable')); });
export function canInstall(){ return Boolean(deferredInstall); }
export async function promptInstall(){
  if(!deferredInstall) return false;
  deferredInstall.prompt();
  const res = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  return res?.outcome === 'accepted';
}
export function isStandalone(){
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  if(location.hostname === 'localhost' && !localStorage.getItem('sg-sw-dev')) return;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // Neue Version liegt bereit -> beim naechsten Seitenwechsel aktiv (skipWaiting im SW)
    reg.addEventListener('updatefound', () => {});
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
}

export async function initShell(opts = {}){
  const { tab = '', title = '', back = null, actions = '', hideTabs = false } = opts;
  registerSW();

  const bar = document.createElement('header');
  bar.className = 'app-bar';
  const left = back
    ? `<a class="icon-btn" href="${esc(back)}" data-back aria-label="Zurück">${icon('back')}</a>`
    : `<a href="/" aria-label="Startseite"><img src="/icons/logo-160.webp" alt="" width="34" height="34" style="width:34px;height:34px;object-fit:contain"></a>`;
  bar.innerHTML = `<div class="app-bar-inner">
      ${left}
      <div class="brand"><span class="title ${title ? '' : 'display'}">${esc(title || 'Slaughter Games')}</span></div>
      ${actions}
      <button class="icon-btn" id="bellBtn" aria-label="Benachrichtigungen" hidden>${icon('bell')}<span class="dot-badge" id="bellCount" hidden></span></button>
    </div>`;
  document.body.prepend(bar);

  const backLink = bar.querySelector('[data-back]');
  if(backLink){
    backLink.addEventListener('click', e => {
      // Innerhalb der App lieber echte Historie, damit Scrollposition bleibt
      if(document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1){
        e.preventDefault(); history.back();
      }
    });
  }

  if(!hideTabs){
    const nav = document.createElement('nav');
    nav.className = 'tab-bar';
    nav.setAttribute('aria-label', 'Hauptnavigation');
    nav.innerHTML = `<div class="tab-bar-inner">${TABS.map(t => `
      <a class="tab ${t.key === tab ? 'active' : ''}" href="${t.href}" data-tab="${t.key}" ${t.key === tab ? 'aria-current="page"' : ''}>
        ${icon(t.icon)}<span>${t.label}</span>${t.key === 'chat' ? '<span class="dot-badge" id="chatCount" hidden></span>' : ''}
      </a>`).join('')}</div>`;
    document.body.appendChild(nav);
  }

  const m = await me();
  if(m.user){
    loadPeople().then(people => {
      const mine = people?.byId.get(m.user.id);
      const profTab = $('.tab[data-tab="profil"]');
      if(profTab && mine?.avatar && profTab.querySelector('svg')){
        profTab.querySelector('svg').outerHTML = `<img class="tab-avatar" src="${esc(mine.avatar)}" alt="">`;
      }
    }).catch(() => {});
    setupBell(m);
    if(tab !== 'chat') refreshChatBadge(m);
    if(m.isMember) autoPush(m);
  }
  return m;
}

// ---------------------------------------------------------------
// Benachrichtigungen (Glocke)
// ---------------------------------------------------------------
async function setupBell(m){
  const btn = $('#bellBtn');
  if(!btn) return;
  btn.hidden = false;
  const countEl = $('#bellCount');
  let unread = 0;
  const paint = () => { countEl.hidden = unread === 0; countEl.textContent = unread > 9 ? '9+' : String(unread); };

  unread = Number((await counters()).notifications || 0); paint();

  supabase.channel('notif-' + m.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${m.user.id}` }, payload => {
      unread++; paint();
      toast(`${payload.new.title}${payload.new.body ? ' – ' + payload.new.body : ''}`);
    })
    .subscribe();

  btn.addEventListener('click', async () => {
    const s = openSheet(`<div class="row between mb"><h3 style="margin:0">Benachrichtigungen</h3>
        <button class="btn link" data-readall>Alle gelesen</button></div>
        <div id="notifList"><div class="spinner"></div></div>
        <p class="hint center mt"><a href="/profil.html#push" class="btn link">Push-Einstellungen</a></p>`);
    const { data } = await supabase.from('notifications').select('*')
      .eq('user_id', m.user.id).order('created_at', { ascending: false }).limit(40);
    const host = s.el.querySelector('#notifList');
    host.innerHTML = data?.length ? `<div class="list">${data.map(n => `
      <a class="list-item" href="${esc(n.url || '#')}" data-id="${n.id}" style="${n.read_at ? '' : 'background:rgba(214,42,42,.08)'}">
        <div class="grow"><div class="title">${esc(n.title)}</div>
        <div class="sub">${esc(n.body || '')}</div></div>
        <div class="trail tiny">${esc(timeAgo(n.created_at))}</div>
      </a>`).join('')}</div>`
      : `<div class="empty">${icon('bell')}<h3>Noch nichts da</h3><p>Hier landen Paarungen und Ergebnisse deiner Turniere.</p></div>`;
    host.addEventListener('click', e => {
      const a = e.target.closest('a[data-id]');
      if(a) supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.id).then(() => {});
    });
    s.el.querySelector('[data-readall]').addEventListener('click', async () => {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', m.user.id).is('read_at', null);
      unread = 0; paint();
      host.querySelectorAll('a[data-id]').forEach(a => a.style.background = '');
    });
  });
}

export async function refreshChatBadge(m){
  const el = $('#chatCount');
  if(!el || !m?.isMember) return;
  const n = Number((await counters()).chat_unread || 0);
  el.hidden = n === 0;
  el.textContent = n > 99 ? '99+' : String(n);
}

// Push automatisch: schon erlaubt -> still anmelden; noch nie gefragt ->
// einmal freundlich nachfragen (Browser verlangen dafuer einen Tipp).
async function autoPush(m){
  let state;
  try{ state = await ensurePush(m.user.id); }catch{ return; }
  if(state !== 'default') return;
  let last = 0;
  try{ last = Number(localStorage.getItem('sg-push-asked') || 0); }catch{}
  if(Date.now() - last < 3 * 86400000) return;
  setTimeout(() => {
    const s = openSheet(`<div class="center">${icon('bell')}</div>
      <h3 class="center">Push-Nachrichten einschalten</h3>
      <p class="muted center mb">Neue Paarung, Ergebnis eingetragen, Chat – direkt aufs Handy. Abschalten jederzeit im Profil.</p>
      <div class="stack"><button class="btn block" data-on>Einschalten</button><button class="btn block ghost" data-close>Später</button></div>`,
      { onClose: () => { try{ localStorage.setItem('sg-push-asked', String(Date.now())); }catch{} } });
    const svg = s.el.querySelector('svg'); svg.style.cssText = 'width:40px;height:40px;color:var(--blood-2);margin:0 auto 8px';
    s.el.querySelector('[data-on]').addEventListener('click', async () => {
      try{ await enablePush(m.user.id); toast('Push ist an.', 'ok'); }
      catch(err){ toast(err.message, 'err'); }
      s.close();
    });
  }, 1200);
}
