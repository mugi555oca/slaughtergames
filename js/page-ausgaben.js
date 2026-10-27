// Ausgaben-Splitter (wie Splitwise) fuer ein Slaughter-Games-Event.
// Nur eingetragene Teilnehmer sehen und buchen; der Admin pflegt die
// Teilnehmerliste. Abrechnung = Salden mit moeglichst wenigen Ueberweisungen.
import { initShell, $, $$, esc, icon, supabase, loadPeople, lockHtml, openSheet, confirmSheet, toast, busy, timeAgo } from './app.js';
import { SUPABASE_URL } from '../tournament-app/js/config.js';

const main = $('#aMain');
const m = await initShell({ tab: 'chat', title: 'Ausgaben-Splitter', back: '/chat.html' });
const eur = c => (c / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
const parseCents = v => {
  const n = Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

let people, events = [], ev = null, members = [], expenses = [], shares = [], payments = [], view = 'list';


async function start(){
  people = await loadPeople();
  const { data } = await supabase.from('split_events').select('*').order('created_at', { ascending: false });
  events = data || [];
  if(!events.length){
    main.innerHTML = `<h1 class="page-title">Ausgaben</h1><div class="card empty">${icon('users')}<h3>Du bist bei keinem Event eingetragen</h3>
      <p>Die Teilnehmer legt Mugi fest – nur wer mitfährt, zahlt mit.</p></div>`;
    if(m.isAdmin) main.insertAdjacentHTML('beforeend', '<button class="btn block mt" id="newEvent">Neues Event anlegen</button>');
    $('#newEvent')?.addEventListener('click', newEvent);
    return;
  }
  const want = new URLSearchParams(location.search).get('event');
  ev = events.find(e => e.id === want) || events[0];
  await load();
}

async function load(){
  const [mem, ex, pay] = await Promise.all([
    supabase.from('split_members').select('user_id').eq('event_id', ev.id),
    supabase.from('split_expenses').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }),
    supabase.from('split_payments').select('*').eq('event_id', ev.id).order('created_at', { ascending: false }),
  ]);
  members = (mem.data || []).map(x => x.user_id);
  expenses = ex.data || [];
  payments = pay.data || [];
  const ids = expenses.map(e => e.id);
  shares = ids.length ? ((await supabase.from('split_shares').select('*').in('expense_id', ids)).data || []) : [];
  render();
}

const who = uid => { const p = people.byId.get(uid); return p ? { ...p, real: p.name } : { real: 'Unbekannt', avatar: '/icons/icon-192.png' }; };
const name = uid => uid === m.user.id ? 'Du' : who(uid).real;

function balances(){
  const b = Object.fromEntries(members.map(u => [u, 0]));
  for(const e of expenses) b[e.paid_by] = (b[e.paid_by] || 0) + e.amount_cents;
  for(const s of shares) b[s.user_id] = (b[s.user_id] || 0) - s.share_cents;
  for(const p of payments){ b[p.from_user] = (b[p.from_user] || 0) + p.amount_cents; b[p.to_user] = (b[p.to_user] || 0) - p.amount_cents; }
  return b;
}

// Wenige Ueberweisungen: groessten Schuldner an groessten Glaeubiger, bis alles 0 ist
function settle(b){
  const debt = Object.entries(b).filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v })).sort((a, c) => c.v - a.v);
  const cred = Object.entries(b).filter(([, v]) => v > 0).map(([u, v]) => ({ u, v })).sort((a, c) => c.v - a.v);
  const out = [];
  while(debt.length && cred.length){
    const d = debt[0], c = cred[0];
    const x = Math.min(d.v, c.v);
    if(x > 0) out.push({ from: d.u, to: c.u, cents: x });
    d.v -= x; c.v -= x;
    if(d.v === 0) debt.shift();
    if(c.v === 0) cred.shift();
    debt.sort((a, e) => e.v - a.v); cred.sort((a, e) => e.v - a.v);
  }
  return out;
}

function render(){
  const b = balances();
  const mine = b[m.user.id] ?? null;
  const total = expenses.reduce((s, e) => s + e.amount_cents, 0);
  const inEvent = members.includes(m.user.id);
  const canBook = !ev.closed && (inEvent || m.isAdmin);

  main.innerHTML = `
    ${events.length > 1 ? `<div class="seg mb">${events.map(e => `<a href="?event=${e.id}" class="${e.id === ev.id ? 'on' : ''}">${esc(e.name)}</a>`).join('')}</div>` : ''}
    <div class="card hero">
      <div class="row between"><span class="chip ${ev.closed ? '' : 'gold'}">${ev.closed ? 'Abgeschlossen' : esc(ev.name)}</span>
        ${m.isAdmin ? `<button class="btn xs ghost" id="adminBtn">${icon('settings')} Verwalten</button>` : ''}</div>
      ${mine !== null ? `<div class="small muted mt">Dein Saldo</div>
        <div style="font-size:34px;font-weight:800;color:${mine > 0 ? '#7ee2a8' : mine < 0 ? '#ff8a80' : 'var(--text)'}">${mine > 0 ? '+' : ''}${eur(mine)}</div>
        <div class="small muted">${mine > 0 ? 'bekommst du noch' : mine < 0 ? 'schuldest du noch' : 'alles ausgeglichen'}</div>` : '<p class="small muted mt">Du bist bei diesem Event nicht eingetragen.</p>'}
      <div class="row mt" style="gap:18px"><span class="small"><b>${eur(total)}</b> <span class="muted">gesamt</span></span>
        <span class="small"><b>${members.length}</b> <span class="muted">Teilnehmer</span></span>
        <span class="small"><b>${expenses.length}</b> <span class="muted">Ausgaben</span></span></div>
    </div>
    <div class="seg mt" id="viewSeg">
      <button data-v="list" class="${view === 'list' ? 'on' : ''}">Ausgaben</button>
      <button data-v="bal" class="${view === 'bal' ? 'on' : ''}">Salden</button>
      <button data-v="settle" class="${view === 'settle' ? 'on' : ''}">Abrechnen</button>
    </div>
    <div class="mt" id="view"></div>`;
  $$('#viewSeg button').forEach(x => x.addEventListener('click', () => { view = x.dataset.v; render(); }));
  $('#adminBtn')?.addEventListener('click', adminSheet);

  const host = $('#view');
  if(view === 'list'){
    host.innerHTML = expenses.length ? `<div class="list">${expenses.map(e => {
      const n = shares.filter(s => s.expense_id === e.id).length;
      const myShare = shares.find(s => s.expense_id === e.id && s.user_id === m.user.id)?.share_cents || 0;
      return `<button class="list-item" data-ex="${e.id}">
        <img class="avatar sm" src="${esc(who(e.paid_by).avatar)}" alt="">
        <div class="grow"><div class="title ellipsis">${esc(e.description)}</div>
          <div class="sub">${esc(name(e.paid_by))} ${e.paid_by === m.user.id ? 'hast' : 'hat'} bezahlt · für ${n} · ${esc(timeAgo(e.created_at))}</div></div>
        <div style="text-align:right;flex:0 0 auto"><b>${eur(e.amount_cents)}</b>
          ${myShare ? `<div class="tiny" style="color:${e.paid_by === m.user.id ? '#7ee2a8' : '#ff8a80'}">dein Anteil ${eur(myShare)}</div>` : ''}</div>
      </button>`;
    }).join('')}</div>` : `<div class="card empty">${icon('plus')}<h3>Noch keine Ausgaben</h3><p>Getränke, Essen, Sprit, Unterkunft – einfach eintragen.</p></div>`;
    host.querySelectorAll('[data-ex]').forEach(x => x.addEventListener('click', () => detail(expenses.find(e => e.id === x.dataset.ex))));
  }
  if(view === 'bal'){
    const rows = Object.entries(b).sort((x, y) => y[1] - x[1]);
    host.innerHTML = `<div class="rank-list">${rows.map(([u, v]) => `<div class="rank-row">
      <img class="avatar sm" src="${esc(who(u).avatar)}" alt="">
      <span class="who"><span class="title">${esc(name(u))}</span><span class="sub">${v > 0 ? 'bekommt' : v < 0 ? 'zahlt' : 'ausgeglichen'}</span></span>
      <span class="pts" style="color:${v > 0 ? '#7ee2a8' : v < 0 ? '#ff8a80' : 'var(--muted)'}">${v > 0 ? '+' : ''}${eur(v)}</span></div>`).join('')}</div>`;
  }
  if(view === 'settle'){
    const tr = settle(b);
    host.innerHTML = `${tr.length ? `<p class="small muted mb">${tr.length} Überweisung${tr.length === 1 ? '' : 'en'} und alle sind quitt:</p>
      <div class="list">${tr.map((t, i) => {
        const allowed = !ev.closed && (m.isAdmin || [t.from, t.to].includes(m.user.id));
        return `<div class="list-item">
          <img class="avatar sm" src="${esc(who(t.from).avatar)}" alt="">
          <div class="grow"><div class="title">${esc(name(t.from))} → ${esc(name(t.to))}</div><div class="sub">${eur(t.cents)}</div></div>
          ${allowed ? `<button class="btn xs ok" data-pay="${i}">${icon('check')} Bezahlt</button>` : ''}
        </div>`;
      }).join('')}</div>` : `<div class="card empty">${icon('check')}<h3>Alles ausgeglichen</h3><p>Niemand schuldet niemandem etwas.</p></div>`}
      ${payments.length ? `<div class="section-head mt-l"><h2>Bereits bezahlt</h2></div><div class="list">${payments.map(p => `<div class="list-item">
        <div class="grow"><div class="title small">${esc(name(p.from_user))} → ${esc(name(p.to_user))}</div><div class="sub">${esc(timeAgo(p.created_at))}</div></div>
        <b class="small">${eur(p.amount_cents)}</b>
        ${(p.created_by === m.user.id || m.isAdmin) && !ev.closed ? `<button class="btn xs ghost" data-undo="${p.id}">Rückgängig</button>` : ''}</div>`).join('')}</div>` : ''}`;
    host.querySelectorAll('[data-pay]').forEach(x => x.addEventListener('click', async () => {
      const t = tr[Number(x.dataset.pay)];
      if(!await confirmSheet('Als bezahlt markieren?', `${name(t.from)} hat ${name(t.to)} ${eur(t.cents)} überwiesen?`, 'Ja, bezahlt')) return;
      const { error } = await supabase.from('split_payments').insert({ event_id: ev.id, from_user: t.from, to_user: t.to, amount_cents: t.cents, created_by: m.user.id });
      if(error) toast(error.message, 'err'); else { toast('Eingetragen.', 'ok'); await load(); }
    }));
    host.querySelectorAll('[data-undo]').forEach(x => x.addEventListener('click', async () => {
      const { error } = await supabase.from('split_payments').delete().eq('id', x.dataset.undo);
      if(error) toast(error.message, 'err'); else await load();
    }));
  }

  document.querySelector('.fab')?.remove();
  if(canBook){
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.innerHTML = `${icon('plus')}Ausgabe`;
    fab.addEventListener('click', addExpense);
    document.body.appendChild(fab);
  }
}

function addExpense(){
  const sel = new Set(members);
  const payer = members.includes(m.user.id) ? m.user.id : members[0];
  const s = openSheet(`<h3>Neue Ausgabe</h3>
    <form id="exForm">
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="field" style="width:130px"><label for="exAmt">Betrag (€)</label><input id="exAmt" inputmode="decimal" placeholder="0,00" required autocomplete="off"></div>
        <div class="field grow"><label for="exDesc">Wofür?</label><input id="exDesc" maxlength="120" placeholder="z. B. Bier & Chips" required></div>
      </div>
      <div class="field"><label for="exPayer">Bezahlt von</label><select id="exPayer">${members.map(u => `<option value="${u}" ${u === payer ? 'selected' : ''}>${esc(who(u).real)}${u === m.user.id ? ' (du)' : ''}</option>`).join('')}</select></div>
      <div class="row between mb"><span class="label">Aufteilen auf</span>
        <span class="row" style="gap:6px"><button type="button" class="btn xs ghost" id="exAll">Alle</button><button type="button" class="btn xs ghost" id="exNone">Keiner</button></span></div>
      <div class="pick-grid" id="exWho"></div>
      <p class="small mt" id="exPer" style="font-weight:700"></p>
      <button class="btn block mt" type="submit">Speichern</button>
    </form>`);
  const paint = () => {
    s.el.querySelector('#exWho').innerHTML = members.map(u => `<button type="button" class="pick ${sel.has(u) ? 'on' : ''}" data-u="${u}">
      <img class="avatar" src="${esc(who(u).avatar)}" alt=""><span>${esc(who(u).real)}</span></button>`).join('');
    const c = parseCents(s.el.querySelector('#exAmt').value);
    s.el.querySelector('#exPer').textContent = sel.size && c > 0 ? `${sel.size} Personen · je ${eur(Math.floor(c / sel.size))}${c % sel.size ? ' (+1 Cent für manche)' : ''}` : `${sel.size} Personen`;
  };
  paint();
  s.el.querySelector('#exAmt').addEventListener('input', paint);
  s.el.querySelector('#exWho').addEventListener('click', e => {
    const b = e.target.closest('[data-u]'); if(!b) return;
    sel.has(b.dataset.u) ? sel.delete(b.dataset.u) : sel.add(b.dataset.u); paint();
  });
  s.el.querySelector('#exAll').onclick = () => { members.forEach(u => sel.add(u)); paint(); };
  s.el.querySelector('#exNone').onclick = () => { sel.clear(); paint(); };
  s.el.querySelector('#exForm').addEventListener('submit', async e => {
    e.preventDefault();
    const cents = parseCents(s.el.querySelector('#exAmt').value);
    if(!(cents > 0)){ toast('Betrag prüfen.', 'err'); return; }
    if(!sel.size){ toast('Mindestens eine Person auswählen.', 'err'); return; }
    busy(e.submitter, true, 'Speichere…');
    const { error } = await supabase.rpc('split_add_expense', {
      p_event: ev.id, p_paid_by: s.el.querySelector('#exPayer').value, p_amount_cents: cents,
      p_description: s.el.querySelector('#exDesc').value, p_users: [...sel],
    });
    if(error){ busy(e.submitter, false); toast(error.message, 'err'); return; }
    s.close(); toast('Ausgabe gespeichert.', 'ok'); view = 'list'; await load();
  });
  setTimeout(() => s.el.querySelector('#exAmt').focus(), 250);
}

function detail(e){
  const sh = shares.filter(x => x.expense_id === e.id).sort((a, b) => who(a.user_id).real.localeCompare(who(b.user_id).real, 'de'));
  const canDel = !ev.closed && (m.isAdmin || e.created_by === m.user.id || e.paid_by === m.user.id);
  const s = openSheet(`<h3>${esc(e.description)}</h3>
    <p class="muted mb">${esc(name(e.paid_by))} ${e.paid_by === m.user.id ? 'hast' : 'hat'} <b style="color:var(--text)">${eur(e.amount_cents)}</b> bezahlt · ${new Date(e.created_at).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}</p>
    <div class="list">${sh.map(x => `<div class="list-item" style="min-height:48px"><img class="avatar xs" src="${esc(who(x.user_id).avatar)}" alt="">
      <span class="grow small">${esc(name(x.user_id))}</span><b class="small">${eur(x.share_cents)}</b></div>`).join('')}</div>
    <div class="btn-row mt">${canDel ? `<button class="btn danger" data-del>${icon('trash')} Löschen</button>` : ''}<button class="btn ghost" data-close>Schließen</button></div>`);
  s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    s.close();
    if(!await confirmSheet('Ausgabe löschen?', `„${e.description}“ (${eur(e.amount_cents)}) wird entfernt.`, 'Löschen', true)) return;
    const { error } = await supabase.from('split_expenses').delete().eq('id', e.id);
    if(error) toast(error.message, 'err'); else { toast('Gelöscht.', 'ok'); await load(); }
  });
}

// ---------- Admin: Teilnehmer, Abschluss, neues Event ----------
async function adminSheet(){
  const all = [...people.byId.values()].filter(p => p.slug).sort((a, b) => a.real.localeCompare(b.real, 'de'));
  const sel = new Set(members);
  const s = openSheet(`<h3>${esc(ev.name)} verwalten</h3>
    <div class="label mb">Wer fährt mit und zahlt mit?</div>
    <div class="pick-grid" id="admWho"></div>
    <button class="btn block mt" id="admSave">Teilnehmer speichern</button>
    <div class="btn-row mt"><button class="btn ghost" id="admClose">${ev.closed ? 'Wieder öffnen' : 'Abrechnung abschließen'}</button>
      <button class="btn ghost" id="admNew">Neues Event</button></div>`);
  // Spieler ohne Login (z. B. neu im Stamm) - Login wird beim Antippen angelegt
  const noLogin = people.list.filter(p => !p.id && p.active !== false).sort((a, b) => a.real.localeCompare(b.real, 'de'));
  const paint = () => {
    s.el.querySelector('#admWho').innerHTML = all.map(p => `<button type="button" class="pick ${sel.has(p.id) ? 'on' : ''}" data-u="${p.id}">
      <img class="avatar" src="${esc(p.avatar)}" alt=""><span>${esc(p.real)}</span></button>`).join('')
      + noLogin.map(p => `<button type="button" class="pick" data-slug="${esc(p.slug)}" style="border-style:dashed">
      <img class="avatar" src="${esc(p.avatar)}" alt="" style="opacity:.6"><span>${esc(p.real)}<br><span class="tiny faint">ohne Login</span></span></button>`).join('');
  };
  paint();
  s.el.querySelector('#admWho').addEventListener('click', async e => {
    const nb = e.target.closest('[data-slug]');
    if(nb){
      const p = noLogin.find(x => x.slug === nb.dataset.slug);
      if(!await confirmSheet(`Login für ${p.real} anlegen?`, `${p.real} braucht einen Login, um mitzuzahlen: Name „${p.real}“, Passwort „timewalk“. Danach ist er gleich ausgewählt.`, 'Anlegen')) return;
      try{
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: 'create', sgName: p.name, realName: p.real, slug: p.slug }) });
        const j = await res.json();
        if(!res.ok) throw new Error(j.error || 'Fehler');
        noLogin.splice(noLogin.indexOf(p), 1);
        all.push({ ...p, id: j.userId });
        all.sort((a, b) => a.real.localeCompare(b.real, 'de'));
        sel.add(j.userId);
        paint();
        toast(`Login für ${p.real} angelegt (${p.real} / timewalk). Jetzt „Teilnehmer speichern“.`, 'ok');
      }catch(err){ toast(err.message, 'err'); }
      return;
    }
    const b = e.target.closest('[data-u]'); if(!b) return;
    sel.has(b.dataset.u) ? sel.delete(b.dataset.u) : sel.add(b.dataset.u); paint();
  });
  s.el.querySelector('#admSave').onclick = async () => {
    const add = [...sel].filter(u => !members.includes(u));
    const rem = members.filter(u => !sel.has(u));
    const used = new Set([...expenses.map(e => e.paid_by), ...shares.map(x => x.user_id)]);
    const blocked = rem.filter(u => used.has(u));
    if(blocked.length){ toast(`${blocked.map(u => who(u).real).join(', ')} hat schon Buchungen – erst die löschen.`, 'err'); return; }
    if(add.length){ const { error } = await supabase.from('split_members').insert(add.map(u => ({ event_id: ev.id, user_id: u }))); if(error) return toast(error.message, 'err'); }
    if(rem.length){ const { error } = await supabase.from('split_members').delete().eq('event_id', ev.id).in('user_id', rem); if(error) return toast(error.message, 'err'); }
    s.close(); toast('Teilnehmer gespeichert.', 'ok'); await load();
  };
  s.el.querySelector('#admClose').onclick = async () => {
    const { error } = await supabase.from('split_events').update({ closed: !ev.closed }).eq('id', ev.id);
    if(error) return toast(error.message, 'err');
    ev.closed = !ev.closed; s.close(); render();
  };
  s.el.querySelector('#admNew').onclick = () => { s.close(); newEvent(); };
}

async function newEvent(){
  const nameStr = prompt('Name des Events:', 'Slaughter Games 8');
  if(!nameStr) return;
  const { data, error } = await supabase.from('split_events').insert({ name: nameStr.trim(), sg: Number((nameStr.match(/\d+/) || [])[0]) || null }).select('*').single();
  if(error) return toast(error.message, 'err');
  await supabase.from('split_members').insert({ event_id: data.id, user_id: m.user.id });
  location.href = `/ausgaben.html?event=${data.id}`;
}

// Start erst am Ende: vorher waeren die Helfer weiter unten noch nicht definiert
if(!m.user) main.innerHTML = lockHtml('Nur für Mitglieder', 'Einloggen, um Ausgaben einzutragen.');
else if(!m.isMember) main.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>';
else await start();
