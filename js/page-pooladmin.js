// Boosterpool-Verwaltung (Frido + Admin). Alles per RLS auf is_pool_admin()
// beschraenkt. Handy-tauglich: ein Tab pro Vorgang, Formular oben, Liste drunter.
import { initShell, $, $$, esc, icon, supabase, loadPeople, toast, busy, confirmSheet, openSheet } from './app.js';
import { loadPool, eur, parseCents } from './pool.js';

const main = $('#aMain');
const m = await initShell({ tab: 'chat', title: 'Boosterpool verwalten', back: '/boosterpool.html' });
let P, people, tab = (location.hash || '#draft').slice(1);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dt = d => new Date(d + 'T12:00:00').toLocaleDateString('de-AT');
const TABS = [['draft', '🃏 Draft'], ['einzahlung', '💶 Einzahlung'], ['einkauf', '📦 Einkauf'], ['verkauf', '💰 Verkauf'],
  ['lager', '🔧 Lager'], ['konten', '👥 Konten'], ['setup', '⚙️ Einstellungen']];


async function reload(){
  [P, people] = await Promise.all([loadPool(), loadPeople()]);
  if(!P.isPoolAdmin){ main.innerHTML = '<div class="card muted">Nur Frido und der Admin dürfen den Boosterpool verwalten.</div>'; return; }
  render();
}

const accName = id => P.accounts.find(a => a.id === id)?.name || '?';
const lotOpts = (sel, onlyStock = true) => P.lots.filter(l => !onlyStock || l.stock > 0 || l.id === sel)
  .map(l => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${esc(l.set_name)}${l.stock != null ? ` · ${l.stock} übrig` : ''}${l.perDraft ? ` · ${eur(l.perDraft)}/Draft` : ''}</option>`).join('');
const accOpts = sel => P.accounts.filter(a => a.active).map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const del = (table, id, what) => async () => {
  if(!await confirmSheet(`${what} löschen?`, 'Das ändert Guthaben bzw. Lager sofort für alle.', 'Löschen', true)) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if(error) toast(error.message, 'err'); else { toast('Gelöscht.', 'ok'); reload(); }
};

function render(){
  main.innerHTML = `<div class="stat-row">
      <div class="stat"><b style="font-size:17px">${eur(P.totals.account)}</b><span>Konto</span></div>
      <div class="stat"><b style="font-size:17px">${eur(P.totals.stockValue)}</b><span>Lager</span></div>
      <div class="stat"><b style="font-size:17px;color:${Math.abs(P.totals.delta) > 500 ? '#ff8a80' : 'var(--text)'}">${eur(P.totals.delta)}</b><span>Kontrolle</span></div>
    </div>
    <p class="hint mt">Kontrolle = Konto + Lagerwert − alle Guthaben. Nahe 0 = alles stimmt.</p>
    <div class="seg mt" id="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mt" id="body"></div>`;
  $$('#tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; history.replaceState(null, '', '#' + tab); render(); }));
  $('#tabs .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  ({ draft, einzahlung, einkauf, verkauf, lager, konten, setup }[tab] || draft)($('#body'));
}

// ---------- Draft abrechnen ----------
async function draft(host){
  const lot = P.inStock.find(l => l.perDraft);
  const sel = new Set();
  host.innerHTML = `<form class="card" id="dForm">
      <div class="row" style="gap:10px">
        <div class="field grow"><label>Datum</label><input id="dDate" type="date" value="${today()}" required></div>
        <div class="field" style="width:96px"><label>Booster</label><input id="dB" type="number" min="1" value="3" inputmode="numeric"></div>
      </div>
      <div class="field"><label>Set / Los</label><select id="dLot">${lotOpts(lot?.id)}</select></div>
      <div class="field"><label>Aus wessen Lager</label><input id="dHolder" value="Frido"></div>
      <div class="row between mb"><span class="label">Wer hat gedraftet?</span><button type="button" class="btn xs ghost" id="dFromWeekly">Aus Weekly übernehmen</button></div>
      <div class="pick-grid" id="dWho"></div>
      <p class="small mt" id="dSum" style="font-weight:700"></p>
      <button class="btn block mt" type="submit">Abrechnen</button>
    </form>
    <div class="section-head mt-l"><h2>Letzte Drafts</h2></div><div class="list" id="dList"></div>`;
  const price = () => {
    const l = P.lots.find(x => x.id === $('#dLot').value);
    return l?.perBooster ? Math.round(l.perBooster * Number($('#dB').value || 0)) : 0;
  };
  const paint = () => {
    $('#dWho').innerHTML = P.accounts.filter(a => a.active).map(a => {
      const av = a.slug && people.bySlug.get(a.slug)?.avatar;
      return `<button type="button" class="pick ${sel.has(a.id) ? 'on' : ''}" data-a="${a.id}">
        ${av ? `<img class="avatar" src="${esc(av)}" alt="">` : `<span class="avatar" style="display:grid;place-items:center">${esc(a.name[0])}</span>`}
        <span>${esc(a.name)}<br><span class="tiny ${a.balance < price() ? '' : 'faint'}" style="${a.balance < price() ? 'color:#ff8a80' : ''}">${eur(a.balance)}</span></span></button>`;
    }).join('');
    const l = P.lots.find(x => x.id === $('#dLot').value);
    const need = sel.size * Number($('#dB').value || 0);
    $('#dSum').textContent = `${sel.size} Spieler × ${eur(price())} = ${eur(sel.size * price())}${l?.stock != null ? ` · Lager danach: ${l.stock - need} Booster` : ''}`;
  };
  paint();
  ['#dLot', '#dB'].forEach(s => $(s).addEventListener('input', paint));
  $('#dWho').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if(!b) return; sel.has(b.dataset.a) ? sel.delete(b.dataset.a) : sel.add(b.dataset.a); paint(); });

  $('#dFromWeekly').addEventListener('click', async () => {
    const { data: ts } = await supabase.from('tournaments').select('id,name,created_at').order('created_at', { ascending: false }).limit(8);
    const s = openSheet(`<h3>Welches Weekly?</h3><div class="list">${(ts || []).map(t => `<button class="list-item" data-t="${t.id}"><div class="grow"><div class="title">${esc(t.name)}</div><div class="sub">${new Date(t.created_at).toLocaleDateString('de-AT')}</div></div></button>`).join('')}</div>`);
    s.el.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', async () => {
      const { data: pl } = await supabase.from('players').select('slug,name').eq('tournament_id', b.dataset.t);
      const t = ts.find(x => x.id === b.dataset.t);
      sel.clear();
      const missing = [];
      for(const p of pl || []){
        const acc = P.accounts.find(a => a.slug && a.slug === p.slug);
        acc ? sel.add(acc.id) : missing.push(p.name);
      }
      $('#dDate').value = t.created_at.slice(0, 10);
      $('#dForm').dataset.tournament = t.id;
      s.close(); paint();
      if(missing.length) toast(`Ohne Pool-Konto: ${missing.join(', ')}`, 'err');
    }));
  });

  $('#dForm').addEventListener('submit', async e => {
    e.preventDefault();
    if(!sel.size){ toast('Wer hat gedraftet?', 'err'); return; }
    const l = P.lots.find(x => x.id === $('#dLot').value);
    if(!l) return;
    busy(e.submitter, true, 'Buche…');
    const batch = crypto.randomUUID();
    const rows = [...sel].map(id => ({ batch_id: batch, date: $('#dDate').value, account_id: id, lot_id: l.id, set_name: l.set_name,
      boosters: Number($('#dB').value), amount_cents: price(), holder: $('#dHolder').value.trim() || null,
      tournament_id: $('#dForm').dataset.tournament || null }));
    const { error } = await supabase.from('pool_drafts').insert(rows);
    if(error){ busy(e.submitter, false); toast(error.message, 'err'); return; }
    toast(`${rows.length} Spieler abgerechnet – alle kriegen Bescheid.`, 'ok'); reload();
  });

  const batches = [...new Map(P.drafts.map(d => [d.batch_id, d])).values()].slice(0, 15);
  $('#dList').innerHTML = batches.map(b => {
    const rows = P.drafts.filter(d => d.batch_id === b.batch_id);
    return `<div class="list-item"><div class="grow"><div class="title small">${dt(b.date)} · ${esc(b.set_name || '')}</div>
      <div class="sub">${rows.length} Spieler: ${esc(rows.map(r => accName(r.account_id)).join(', '))}</div></div>
      <button class="btn xs danger" data-batch="${b.batch_id}">${icon('trash')}</button></div>`;
  }).join('');
  $$('#dList [data-batch]').forEach(x => x.addEventListener('click', async () => {
    if(!await confirmSheet('Ganzen Draft löschen?', 'Alle Abbuchungen dieses Abends werden zurückgenommen.', 'Löschen', true)) return;
    const { error } = await supabase.from('pool_drafts').delete().eq('batch_id', x.dataset.batch);
    if(error) toast(error.message, 'err'); else reload();
  }));
}

// ---------- Einzahlung ----------
function einzahlung(host){
  host.innerHTML = `<form class="card" id="eForm">
      <div class="row" style="gap:10px"><div class="field grow"><label>Wer</label><select id="eAcc">${accOpts()}</select></div>
        <div class="field" style="width:120px"><label>Betrag €</label><input id="eAmt" inputmode="decimal" placeholder="50" required></div></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Datum</label><input id="eDate" type="date" value="${today()}"></div>
        <div class="field" style="width:140px"><label>Status</label><select id="eSt"><option>bestätigt</option><option>offen</option><option>bar</option></select></div></div>
      <div class="field"><label>Notiz</label><input id="eNote" placeholder="optional, z. B. Auszahlung (negativer Betrag)"></div>
      <button class="btn block" type="submit">Buchen</button></form>
    <div class="section-head mt-l"><h2>Einzahlungen</h2></div><div class="list">${P.deposits.slice(0, 40).map(d => `<div class="list-item" style="min-height:52px">
      <div class="grow"><div class="title small">${esc(accName(d.account_id))} · ${eur(d.amount_cents)}</div><div class="sub">${dt(d.date)}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
      <button class="chip ${d.status === 'bestätigt' ? 'ok' : 'gold'}" data-st="${d.id}" style="cursor:pointer">${esc(d.status)}</button>
      <button class="btn xs danger" data-del="${d.id}">${icon('trash')}</button></div>`).join('')}</div>`;
  $('#eForm').addEventListener('submit', async e => {
    e.preventDefault();
    const c = parseCents($('#eAmt').value);
    if(!c){ toast('Betrag prüfen.', 'err'); return; }
    const { error } = await supabase.from('pool_deposits').insert({ account_id: $('#eAcc').value, amount_cents: c, date: $('#eDate').value, status: $('#eSt').value, note: $('#eNote').value.trim() || null });
    if(error) toast(error.message, 'err'); else { toast('Gebucht.', 'ok'); reload(); }
  });
  $$('[data-st]').forEach(b => b.addEventListener('click', async () => {
    const d = P.deposits.find(x => x.id === b.dataset.st);
    const next = d.status === 'bestätigt' ? 'offen' : 'bestätigt';
    const { error } = await supabase.from('pool_deposits').update({ status: next }).eq('id', d.id);
    if(error) toast(error.message, 'err'); else reload();
  }));
  $$('[data-del]').forEach(b => b.addEventListener('click', del('pool_deposits', b.dataset.del, 'Einzahlung')));
}

// ---------- Einkauf ----------
function einkauf(host){
  host.innerHTML = `<form class="card" id="kForm">
      <div class="field"><label>Set</label><input id="kSet" required placeholder="z. B. Aetherdrift"></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Preis gesamt €</label><input id="kCost" inputmode="decimal" required></div>
        <div class="field" style="width:90px"><label>Displays</label><input id="kDisp" type="number" min="0" step="0.5" value="6"></div>
        <div class="field" style="width:90px"><label>Booster/D.</label><input id="kPer" type="number" min="1" value="30"></div></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Gekauft am</label><input id="kDate" type="date" value="${today()}"></div>
        <div class="field grow"><label>Quelle</label><input id="kSrc" placeholder="game-island.eu"></div></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Status</label><select id="kDel"><option>bestellt</option><option>geliefert</option></select></div>
        <div class="field grow"><label>Lagerort</label><input id="kSto" value="Frido"></div></div>
      <p class="small" id="kCalc" style="font-weight:700"></p>
      <button class="btn block" type="submit">Einkauf speichern</button></form>
    <div class="section-head mt-l"><h2>Einkäufe</h2></div><div class="list">${P.lots.map(l => `<button class="list-item" data-lot="${l.id}">
      <div class="grow"><div class="title small">${esc(l.set_name)} · ${eur(l.cost_cents)}</div>
        <div class="sub">${dt(l.purchased_on)} · ${l.boosters ?? '–'} Booster · ${l.stock ?? '–'} übrig · ${esc(l.storage || '')}</div></div>
      <span class="chip ${l.delivery === 'geliefert' ? 'ok' : 'gold'}">${esc(l.delivery)}</span></button>`).join('')}</div>`;
  const calc = () => {
    const c = parseCents($('#kCost').value), b = Number($('#kDisp').value) * Number($('#kPer').value);
    $('#kCalc').textContent = c > 0 && b ? `${b} Booster · ${eur(Math.round(c / b))} pro Booster · ${eur(Math.round(c / b * 3))} pro Draft` : '';
  };
  ['#kCost', '#kDisp', '#kPer'].forEach(s => $(s).addEventListener('input', calc));
  $('#kForm').addEventListener('submit', async e => {
    e.preventDefault();
    const c = parseCents($('#kCost').value);
    if(!(c >= 0)){ toast('Preis prüfen.', 'err'); return; }
    const { error } = await supabase.from('pool_lots').insert({ set_name: $('#kSet').value.trim(), cost_cents: c,
      displays: Number($('#kDisp').value) || null, boosters: Math.round(Number($('#kDisp').value) * Number($('#kPer').value)) || null,
      purchased_on: $('#kDate').value, source: $('#kSrc').value.trim() || null, delivery: $('#kDel').value,
      delivered_on: $('#kDel').value === 'geliefert' ? $('#kDate').value : null, storage: $('#kSto').value.trim() || null });
    if(error) toast(error.message, 'err'); else { toast('Einkauf gespeichert.', 'ok'); reload(); }
  });
  $$('[data-lot]').forEach(b => b.addEventListener('click', () => editLot(P.lots.find(l => l.id === b.dataset.lot))));
}

function editLot(l){
  const s = openSheet(`<h3>${esc(l.set_name)}</h3><form id="lf">
    <div class="row" style="gap:10px"><div class="field grow"><label>Status</label><select id="lDel"><option ${l.delivery === 'bestellt' ? 'selected' : ''}>bestellt</option><option ${l.delivery === 'geliefert' ? 'selected' : ''}>geliefert</option></select></div>
      <div class="field grow"><label>Geliefert am</label><input id="lOn" type="date" value="${esc(l.delivered_on || '')}"></div></div>
    <div class="field"><label>Lagerort</label><input id="lSto" value="${esc(l.storage || '')}" placeholder="z. B. Frido 120 · Vinc 12"></div>
    <div class="row" style="gap:10px"><div class="field grow"><label>Preis €</label><input id="lCost" inputmode="decimal" value="${(l.cost_cents / 100).toFixed(2).replace('.', ',')}"></div>
      <div class="field grow"><label>Booster gesamt</label><input id="lB" type="number" value="${l.boosters ?? ''}"></div></div>
    <div class="btn-row"><button class="btn" type="submit">Speichern</button><button type="button" class="btn danger" id="lDelBtn">${icon('trash')}</button></div></form>`);
  s.el.querySelector('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('pool_lots').update({ delivery: s.el.querySelector('#lDel').value,
      delivered_on: s.el.querySelector('#lOn').value || null, storage: s.el.querySelector('#lSto').value.trim() || null,
      cost_cents: parseCents(s.el.querySelector('#lCost').value) || 0, boosters: s.el.querySelector('#lB').value === '' ? null : Number(s.el.querySelector('#lB').value) }).eq('id', l.id);
    if(error) toast(error.message, 'err'); else { s.close(); toast('Gespeichert.', 'ok'); reload(); }
  });
  s.el.querySelector('#lDelBtn').addEventListener('click', () => { s.close(); del('pool_lots', l.id, 'Einkauf')(); });
}

// ---------- Verkauf ----------
function verkauf(host){
  host.innerHTML = `<form class="card" id="vForm">
      <div class="field"><label>Was</label><select id="vLot"><option value="">– anderes (frei) –</option>${lotOpts(null)}</select></div>
      <div class="row" style="gap:10px"><div class="field" style="width:100px"><label>Booster</label><input id="vB" type="number" min="0" value="0"></div>
        <div class="field grow"><label>Betrag €</label><input id="vAmt" inputmode="decimal" required></div></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Datum</label><input id="vDate" type="date" value="${today()}"></div>
        <div class="field grow"><label>Notiz</label><input id="vNote" placeholder="z. B. SG7"></div></div>
      <button class="btn block" type="submit">Verkauf buchen</button></form>
    <div class="section-head mt-l"><h2>Verkäufe</h2></div><div class="list">${P.sales.map(x => `<div class="list-item" style="min-height:52px">
      <div class="grow"><div class="title small">${esc(x.set_name || '')} · ${x.boosters} Booster</div><div class="sub">${dt(x.date)}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
      <b class="small">${eur(x.amount_cents)}</b><button class="btn xs danger" data-del="${x.id}">${icon('trash')}</button></div>`).join('')}</div>`;
  const fill = () => { const l = P.lots.find(x => x.id === $('#vLot').value); if(l?.perBooster) $('#vAmt').value = (Math.round(l.perBooster * Number($('#vB').value)) / 100).toFixed(2).replace('.', ','); };
  $('#vLot').addEventListener('change', fill); $('#vB').addEventListener('input', fill);
  $('#vForm').addEventListener('submit', async e => {
    e.preventDefault();
    const l = P.lots.find(x => x.id === $('#vLot').value);
    const { error } = await supabase.from('pool_sales').insert({ lot_id: l?.id || null, set_name: l?.set_name || $('#vNote').value || 'Verkauf',
      boosters: Number($('#vB').value) || 0, amount_cents: parseCents($('#vAmt').value), date: $('#vDate').value, note: $('#vNote').value.trim() || null });
    if(error) toast(error.message, 'err'); else { toast('Verkauf gebucht.', 'ok'); reload(); }
  });
  $$('[data-del]').forEach(b => b.addEventListener('click', del('pool_sales', b.dataset.del, 'Verkauf')));
}

// ---------- Lager-Korrektur ----------
function lager(host){
  host.innerHTML = `<div class="list">${P.lots.filter(l => l.boosters != null).map(l => `<div class="list-item">
      <div class="grow"><div class="title small">${esc(l.set_name)}</div><div class="sub">${l.boosters} gekauft − ${l.used} gedraftet − ${l.sold} verkauft${l.adjusted ? ` ${l.adjusted > 0 ? '+' : '−'} ${Math.abs(l.adjusted)} korrigiert` : ''} · 📦 ${esc(l.storage || '–')}</div></div>
      <b>${l.stock}</b></div>`).join('')}</div>
    <form class="card mt" id="xForm"><b>Bestand korrigieren</b>
      <div class="field mt"><label>Los</label><select id="xLot">${lotOpts(null, false)}</select></div>
      <div class="row" style="gap:10px"><div class="field" style="width:110px"><label>± Booster</label><input id="xB" type="number" required placeholder="-2"></div>
        <div class="field grow"><label>Grund</label><input id="xNote" required placeholder="z. B. 3 Booster zu Frido übertragen"></div></div>
      <button class="btn block" type="submit">Korrektur buchen</button></form>
    ${P.adjustments.length ? `<div class="section-head mt-l"><h2>Korrekturen</h2></div><div class="list">${P.adjustments.map(x => `<div class="list-item" style="min-height:48px"><div class="grow small">${dt(x.date)} · ${esc(P.lots.find(l => l.id === x.lot_id)?.set_name || '')}: ${x.boosters > 0 ? '+' : ''}${x.boosters} · ${esc(x.note || '')}</div><button class="btn xs danger" data-del="${x.id}">${icon('trash')}</button></div>`).join('')}</div>` : ''}`;
  $('#xForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('pool_adjustments').insert({ lot_id: $('#xLot').value, boosters: Number($('#xB').value), note: $('#xNote').value.trim(), date: today() });
    if(error) toast(error.message, 'err'); else { toast('Korrigiert.', 'ok'); reload(); }
  });
  $$('[data-del]').forEach(b => b.addEventListener('click', del('pool_adjustments', b.dataset.del, 'Korrektur')));
}

// ---------- Konten ----------
async function konten(host){
  const { data: roster } = await supabase.from('roster').select('slug,name,real_name').order('real_name');
  host.innerHTML = `<form class="card" id="cForm"><b>Neues Konto</b>
      <div class="row mt" style="gap:10px"><div class="field grow"><label>Name</label><input id="cName" required placeholder="z. B. Klaus"></div>
        <div class="field grow"><label>Mitglied (optional)</label><select id="cSlug"><option value="">– extern –</option>${roster.map(r => `<option value="${esc(r.slug)}">${esc(r.real_name || r.name)}</option>`).join('')}</select></div></div>
      <button class="btn block" type="submit">Anlegen</button></form>
    <div class="list mt">${P.accounts.map(a => `<div class="list-item">
      <div class="grow"><div class="title small">${esc(a.name)}${a.slug ? '' : ' <span class="chip" style="height:20px;font-size:11px">extern</span>'}</div><div class="sub">${eur(a.balance)} · ${a.draftCount} Drafts</div></div>
      <select class="input" data-link="${a.id}" style="width:130px;min-height:36px;padding:4px 8px;font-size:13px"><option value="">– extern –</option>${roster.map(r => `<option value="${esc(r.slug)}" ${a.slug === r.slug ? 'selected' : ''}>${esc(r.real_name || r.name)}</option>`).join('')}</select>
      <label class="switch" style="padding:0;border:0"><input type="checkbox" data-active="${a.id}" ${a.active ? 'checked' : ''} title="aktiv"></label></div>`).join('')}</div>
    <p class="hint mt">Verknüpfte Konten sehen ihr Guthaben in der App und kriegen Push bei Buchungen.</p>`;
  $('#cForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('pool_accounts').insert({ name: $('#cName').value.trim(), slug: $('#cSlug').value || null });
    if(error) toast(error.message, 'err'); else { toast('Konto angelegt.', 'ok'); reload(); }
  });
  $$('[data-link]').forEach(s => s.addEventListener('change', async () => {
    const { error } = await supabase.from('pool_accounts').update({ slug: s.value || null }).eq('id', s.dataset.link);
    toast(error ? error.message : 'Verknüpft.', error ? 'err' : 'ok');
  }));
  $$('[data-active]').forEach(c => c.addEventListener('change', async () => {
    const { error } = await supabase.from('pool_accounts').update({ active: c.checked }).eq('id', c.dataset.active);
    if(error) toast(error.message, 'err');
  }));
}

// ---------- Einstellungen ----------
function setup(host){
  host.innerHTML = `<form class="card" id="sForm">
      <div class="field"><label>IBAN fürs Aufladen</label><input id="sIban" value="${esc(P.settings.iban || '')}"></div>
      <div class="field"><label>Empfänger</label><input id="sHolder" value="${esc(P.settings.holder || '')}"></div>
      <div class="field"><label>Info für alle</label><textarea id="sInfo">${esc(P.settings.info || '')}</textarea></div>
      <button class="btn block" type="submit">Speichern</button></form>`;
  $('#sForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('pool_settings').upsert({ id: 1, iban: $('#sIban').value.trim() || null,
      holder: $('#sHolder').value.trim() || null, info: $('#sInfo').value.trim() || null, updated_at: new Date().toISOString() });
    toast(error ? error.message : 'Gespeichert.', error ? 'err' : 'ok');
  });
}

// Start erst am Ende: vorher waeren die Helfer weiter unten noch nicht definiert
if(!m.user) location.replace('/login.html?next=/boosterpool-admin.html');
else await reload();
