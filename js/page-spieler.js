import { initShell, $, esc, loadPeople, icon } from './app.js';
import { loadTournaments } from './data.js';

await initShell({ tab: 'ranking', title: 'Spieler', back: '/' });
const [people, tournaments] = await Promise.all([loadPeople(), loadTournaments()]);

const count = slug => tournaments.filter(t => t.ranking.some(r => r.slug === slug)).length;
const list = people.list.filter(p => p.active !== false)
  .map(p => ({ ...p, n: count(p.slug) }))
  .sort((a, b) => a.real.localeCompare(b.real, 'de'));

function render(q = ''){
  const needle = q.trim().toLowerCase();
  const rows = list.filter(p => !needle || `${p.name} ${p.real} ${p.display}`.toLowerCase().includes(needle));
  $('#pList').innerHTML = rows.map(p => `
    <a class="list-item" href="/player-profile.html?slug=${encodeURIComponent(p.slug)}">
      <img class="avatar" src="${esc(p.avatar)}" alt="" loading="lazy">
      <div class="grow"><div class="title">${esc(p.real)}</div><div class="sub ellipsis">${esc(p.name)}</div></div>
      <div class="trail">${p.n ? `${p.n}× SG` : 'neu'}${icon('chev', 'chev')}</div>
    </a>`).join('') || '<div class="empty">Niemand gefunden.</div>';
}
render();
$('#pSearch').addEventListener('input', e => render(e.target.value));
