// Boosterpool fuer alle Mitglieder: Guthaben, Lager, eigene Buchungen.
import { initShell, $, $$, esc, icon, loadPeople, lockHtml, toast } from './app.js';
import { loadPool, ledger, eur } from './pool.js';

const main = $('#pMain');
const m = await initShell({ tab: 'chat', title: 'Boosterpool', back: '/chat.html' });
let view = location.hash === '#lager' ? 'stock' : location.hash === '#alle' ? 'all' : 'mine';

if(!m.user) main.innerHTML = `<h1 class="page-title">Boosterpool</h1>` + lockHtml('Nur für Mitglieder', 'Einloggen, um Guthaben und Lager zu sehen.');
else if(!m.isMember) main.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>';
else await render();

async function render(){
  const [P, people] = await Promise.all([loadPool(), loadPeople()]);
  const mine = P.accounts.find(a => a.slug && a.slug === m.profile?.slug);
  const current = P.inStock.find(l => l.perDraft) || P.lots.find(l => l.perDraft);
  const avatar = a => (a.slug && people.bySlug.get(a.slug)?.avatar) || null;
  const col = c => c < 0 ? '#ff8a80' : c > 0 ? 'var(--text)' : 'var(--muted)';

  main.innerHTML = `
    <div class="row between"><h1 class="page-title">Boosterpool</h1>
      ${P.isPoolAdmin ? `<a class="btn sm" href="/boosterpool-admin.html">${icon('settings')} Verwalten</a>` : ''}</div>

    ${mine ? `<div class="card hero">
      <div class="small muted">Dein Guthaben</div>
      <div style="font-size:36px;font-weight:800;color:${col(mine.balance)}">${eur(mine.balance)}</div>
      <div class="small muted">${mine.balance < 0 ? 'Du bist im Minus – bitte aufladen.' : current ? `reicht für ca. ${Math.floor(mine.balance / current.perDraft)} Draft${Math.floor(mine.balance / current.perDraft) === 1 ? '' : 's'} ${esc(current.set_name)} (${eur(current.perDraft)})` : ''}</div>
      ${P.settings.iban ? `<button class="btn sm ghost mt" id="ibanBtn">💶 Aufladen: IBAN kopieren</button>` : ''}
    </div>` : `<div class="card muted small">Du hast noch kein Boosterpool-Konto. Sag Frido Bescheid, wenn du mitmachen willst.</div>`}

    <div class="stat-row mt">
      <div class="stat"><b style="font-size:18px">${eur(P.totals.account)}</b><span>Pool-Konto</span></div>
      <div class="stat"><b style="font-size:18px">${eur(P.totals.stockValue)}</b><span>Lagerwert</span></div>
      <div class="stat"><b style="font-size:18px">${eur(P.totals.credit)}</b><span>Alle Guthaben</span></div>
    </div>

    <div class="seg mt" id="pSeg">
      <button data-v="mine" class="${view === 'mine' ? 'on' : ''}">Meine Buchungen</button>
      <button data-v="all" class="${view === 'all' ? 'on' : ''}">Guthaben</button>
      <button data-v="stock" class="${view === 'stock' ? 'on' : ''}">Lager</button>
    </div>
    <div class="mt" id="pView"></div>
    ${P.settings.info ? `<p class="hint mt-l center">${esc(P.settings.info)}</p>` : ''}`;

  $('#ibanBtn')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(P.settings.iban.replace(/\s/g, ''));
    toast(`IBAN kopiert${P.settings.holder ? ' (Empfänger: ' + P.settings.holder + ')' : ''}.`, 'ok');
  });
  $$('#pSeg button').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; paint(); }));

  function paint(){
    $$('#pSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    history.replaceState(null, '', view === 'stock' ? '#lager' : view === 'all' ? '#alle' : location.pathname);
    const host = $('#pView');
    if(view === 'mine'){
      const rows = mine ? ledger(P, mine.id) : [];
      host.innerHTML = rows.length ? `<div class="list">${rows.map(r => `<div class="list-item" style="min-height:54px">
        <span style="font-size:18px">${r.cents >= 0 ? '💶' : '🃏'}</span>
        <div class="grow"><div class="title small">${esc(r.label)}${r.status && r.status !== 'bestätigt' ? ` <span class="chip" style="height:20px;font-size:11px">${esc(r.status)}</span>` : ''}</div>
          <div class="sub">${new Date(r.date + 'T12:00:00').toLocaleDateString('de-AT')}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
        <div style="text-align:right"><b style="color:${r.cents >= 0 ? '#7ee2a8' : 'var(--text)'}">${r.cents >= 0 ? '+' : ''}${eur(r.cents)}</b>
          <div class="tiny faint">${eur(r.balance)}</div></div></div>`).join('')}</div>`
        : '<div class="card muted">Noch keine Buchungen.</div>';
    }
    if(view === 'all'){
      const list = [...P.accounts].filter(a => a.active || a.balance).sort((a, b) => b.balance - a.balance);
      host.innerHTML = `<div class="rank-list">${list.map(a => `<div class="rank-row" ${a.id === mine?.id ? 'style="background:var(--gold-dim)"' : ''}>
        ${avatar(a) ? `<img class="avatar sm" src="${esc(avatar(a))}" alt="">` : `<span class="avatar sm" style="display:grid;place-items:center;font-weight:700">${esc(a.name[0])}</span>`}
        <span class="who"><span class="title">${esc((a.slug && people.bySlug.get(a.slug)?.name) || a.name)}</span><span class="sub">${a.draftCount} Drafts · eingezahlt ${eur(a.in)}</span></span>
        <span class="pts" style="color:${col(a.balance)}">${eur(a.balance)}</span></div>`).join('')}</div>`;
    }
    if(view === 'stock'){
      host.innerHTML = `<div class="list">${P.inStock.map(l => `<div class="list-item">
        <div class="grow"><div class="title">${esc(l.set_name)}</div>
          <div class="sub">${l.perDraft ? `${eur(l.perDraft)} pro Draft · ` : ''}📦 ${esc(l.storage || '–')}</div></div>
        <div style="text-align:right"><b>${l.stock} Booster</b><div class="tiny faint">${l.stock >= 30 ? (l.stock / 30).toFixed(1).replace('.', ',') + ' Displays · ' : ''}${eur(l.value)}</div></div>
      </div>`).join('') || '<div class="empty">Lager leer.</div>'}</div>
      ${P.lots.some(l => l.delivery === 'bestellt') ? `<div class="section-head mt-l"><h2>Bestellt</h2></div><div class="list">${P.lots.filter(l => l.delivery === 'bestellt').map(l => `<div class="list-item"><div class="grow"><div class="title">${esc(l.set_name)}</div><div class="sub">${l.boosters || '?'} Booster · ${esc(l.source || '')}</div></div><b>${eur(l.cost_cents)}</b></div>`).join('')}</div>` : ''}
      <div class="section-head mt-l"><h2>Einkäufe</h2></div>
      <div class="list">${P.lots.filter(l => l.cost_cents > 0).map(l => `<div class="list-item" style="min-height:52px"><div class="grow"><div class="title small">${esc(l.set_name)}</div>
        <div class="sub">${new Date(l.purchased_on + 'T12:00:00').toLocaleDateString('de-AT')} · ${esc(l.source || '')}${l.boosters ? ' · ' + l.boosters + ' Booster' : ''}</div></div><b class="small">${eur(l.cost_cents)}</b></div>`).join('')}</div>`;
    }
  }
  paint();
}
