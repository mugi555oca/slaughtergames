// Event-Seite einer Slaughter Games Ausgabe (turnier.html?sg=N).
// Ergebnisse sind oeffentlich, Fotos nur fuer eingeloggte Mitglieder.
import { initShell, $, esc, loadPeople, lockHtml, icon } from './app.js';
import { loadTournaments, sgLogo, AXES, NEXT_EVENT, MAPS } from './data.js';
import { listPhotos, signUrls, gridHtml, openLightbox } from './gallery.js';

const sgParam = Number(new URLSearchParams(location.search).get('sg'));
const m = await initShell({ tab: 'ranking', title: 'Slaughter Games', back: '/ranking.html#games' });

const [tournaments, people] = await Promise.all([loadTournaments(), loadPeople()]);
const person = slug => people.bySlug.get(slug);
const maxSg = Math.max(...tournaments.map(t => t.sg));
const sg = sgParam || maxSg;
const isNext = sg === NEXT_EVENT.sg && !tournaments.some(t => t.sg === sg);
const g = tournaments.find(t => t.sg === sg);

const fmtRange = (from, to) => {
  const a = new Date(from + 'T12:00:00'), b = new Date(to + 'T12:00:00');
  const o = { day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('de-AT', o)} – ${b.toLocaleDateString('de-AT', o)} ${b.getFullYear()}`;
};

$('#tSwitch').innerHTML = [...tournaments.map(t => t.sg), NEXT_EVENT.sg]
  .filter((v, i, a) => a.indexOf(v) === i)
  .map(n => `<a class="${n === sg ? 'on' : ''}" href="/turnier.html?sg=${n}">SG${n}</a>`).join('');
$('#tSwitch .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });

$('#tLogo').src = sgLogo(sg);
$('#tGalleryLink').href = `/galerie.html?album=sg${sg}`;

if(isNext){
  document.title = `${NEXT_EVENT.title} – Slaughter Games`;
  $('#tTitle').textContent = NEXT_EVENT.title;
  $('#tSub').textContent = NEXT_EVENT.dateLabel;
  const days = Math.max(0, Math.ceil((new Date(NEXT_EVENT.dateFrom) - Date.now()) / 86400000));
  $('#tFacts').innerHTML = `
    <div class="stat"><b>${days}</b><span>Tage noch</span></div>
    <div class="stat"><b>${NEXT_EVENT.roster.length}</b><span>Spieler</span></div>
    <div class="stat"><b>${NEXT_EVENT.waiting.length}</b><span>Warteliste</span></div>`;
  $('#tRankTitle').textContent = 'Startfeld';
  $('#tRanking').innerHTML = NEXT_EVENT.roster.map(slug => {
    const p = person(slug);
    return `<a class="rank-row" href="/player-profile.html?slug=${encodeURIComponent(slug)}">
      <img class="avatar sm" src="${esc(p?.avatar)}" alt="" loading="lazy">
      <span class="who"><span class="title">${esc(p?.name || slug)}</span>
      ${NEXT_EVENT.wobblers.includes(slug) ? '<span class="wobbler">Wackelkandidat</span>' : ''}</span></a>`;
  }).join('') + `<div class="rank-row" style="background:var(--bg-2)"><span class="who"><span class="sub" style="font-weight:700;letter-spacing:.1em;text-transform:uppercase">⏳ Waiting Room</span></span></div>`
    + NEXT_EVENT.waiting.map((n, i) => `<div class="rank-row"><span class="rank-no">${i + 1}</span><span class="who"><span class="title">${esc(n)}</span></span></div>`).join('');
} else if(g){
  document.title = `${g.title} (${g.year}) – Slaughter Games`;
  $('#tTitle').textContent = g.title;
  $('#tSub').textContent = fmtRange(g.dateFrom, g.dateTo);
  const w = person(g.ranking[0]?.slug);
  $('#tFacts').innerHTML = `
    <div class="stat"><b>${g.players}</b><span>Spieler</span></div>
    <div class="stat"><b>${g.year}</b><span>Jahr</span></div>
    <a class="stat" href="/player-profile.html?slug=${encodeURIComponent(g.ranking[0]?.slug || '')}">
      <img class="avatar xs" src="${esc(w?.avatar)}" alt="" style="margin:0 auto 4px;width:28px;height:28px">
      <span>Sieger</span></a>`;
  if(g.location || MAPS[g.sg]){
    $('#tFacts').insertAdjacentHTML('afterend', `<a class="card row mt" ${MAPS[g.sg] ? `href="${MAPS[g.sg]}" target="_blank" rel="noopener"` : ''} style="gap:12px">
      <span style="width:42px;height:42px;border-radius:12px;background:rgba(214,42,42,.15);display:grid;place-items:center;flex:0 0 auto;color:var(--blood-2)">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
      <span class="grow"><span class="small muted" style="display:block">Location</span><b>${esc(g.location || 'Location')}</b></span>
      ${MAPS[g.sg] ? '<span class="small" style="color:var(--blood-2);font-weight:700">Karte ↗</span>' : ''}</a>`);
  }
  $('#tRanking').innerHTML = g.ranking.map(r => {
    const p = person(r.slug);
    const axe = r.axe ? `<img src="${AXES[r.axe].img}" alt="${AXES[r.axe].label}" title="${AXES[r.axe].label}" style="width:24px;height:24px;object-fit:contain">` : '';
    return `<a class="rank-row" href="/player-profile.html?slug=${encodeURIComponent(r.slug)}">
      <span class="rank-no">${r.place}</span>
      <img class="avatar sm" src="${esc(p?.avatar)}" alt="" loading="lazy">
      <span class="who"><span class="title">${esc(p?.name || r.name)}</span></span>${axe}</a>`;
  }).join('');
}

// ---------- Fotos ----------
const host = $('#tPhotos');
if(!m.user){
  $('#tGalleryLink').hidden = true;
  host.innerHTML = lockHtml('Fotos nur für Mitglieder', 'Die Galerien sind privat. Einloggen, dann siehst du alle Bilder – und kannst eigene hochladen.');
} else if(!m.isMember){
  host.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet. Sag Mugi Bescheid.</div>';
} else {
  host.innerHTML = '<div class="skel" style="height:240px"></div>';
  const rows = await listPhotos(`sg${sg}`);
  if(!rows.length){
    host.innerHTML = `<div class="card empty">${icon('camera')}<h3>Noch keine Fotos</h3>
      <p>Lade die ersten hoch.</p><a class="btn sm mt" href="/galerie.html?album=sg${sg}">Fotos hochladen</a></div>`;
  } else {
    const preview = rows.slice(0, 9);
    const urls = await signUrls(preview.map(r => r.thumb_path || r.path));
    host.innerHTML = gridHtml(preview, urls) + (rows.length > 9
      ? `<a class="btn ghost block mt" href="/galerie.html?album=sg${sg}">Alle ${rows.length} Fotos ansehen</a>` : '');
    host.querySelector('.photo-grid').addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if(b) openLightbox(rows, Number(b.dataset.i), { isAdmin: m.isAdmin, people });
    });
  }
}
