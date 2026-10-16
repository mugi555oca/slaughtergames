import { initShell, $, esc, icon, loadPeople, supabase, canInstall, promptInstall, isStandalone } from './app.js';
import { NEXT_EVENT, GRAND_SLAUGHTERER, POSTS, CUBES, loadTournaments, eternalRanking, axesHtml } from './data.js';

await initShell({ tab: 'home' });

$('#qGallery').innerHTML = `${icon('images')}Galerie`;
$('#qPlayers').innerHTML = `${icon('users')}Spieler`;
$('#qMerch').innerHTML = `${icon('shirt')}Merch`;
$('#qBlog').innerHTML = `${icon('book')}Blog`;

// ---------- Naechstes Event + Countdown ----------
$('#nextTitle').textContent = NEXT_EVENT.title;
$('#nextDate').textContent = NEXT_EVENT.dateLabel;
const start = new Date(NEXT_EVENT.dateFrom + 'T12:00:00');
function tick(){
  let s = Math.max(0, Math.floor((start - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  $('#countdown').innerHTML = [[d, 'Tage'], [h, 'Std'], [m, 'Min']]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}
tick(); setInterval(tick, 30000);

// ---------- Install-Hinweis ----------
function renderInstall(){
  const slot = $('#installSlot');
  if(isStandalone() || localStorage.getItem('sg-install-dismissed')){ slot.innerHTML = ''; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(!canInstall() && !ios){ slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="install">
    <img src="/icons/icon-192.png" alt="">
    <div class="grow"><div style="font-weight:700">Als App installieren</div>
      <div class="small muted">${ios ? 'Teilen-Symbol → „Zum Home-Bildschirm“' : 'Ein Tipp – immer aktuell, mit Push.'}</div></div>
    ${ios ? '' : '<button class="btn sm" id="installBtn">Installieren</button>'}
    <button class="icon-btn" id="installX" aria-label="Ausblenden">${icon('x')}</button>
  </div>`;
  $('#installBtn')?.addEventListener('click', async () => { await promptInstall(); renderInstall(); });
  $('#installX').addEventListener('click', () => { localStorage.setItem('sg-install-dismissed', '1'); renderInstall(); });
}
renderInstall();
document.addEventListener('sg:installable', renderInstall);

// ---------- Daten ----------
const [tournaments, people] = await Promise.all([loadTournaments(), loadPeople()]);
const person = slug => people.bySlug.get(slug);

const gs = person(GRAND_SLAUGHTERER.slug);
$('#gsCard').href = `/player-profile.html?slug=${encodeURIComponent(GRAND_SLAUGHTERER.slug)}`;
$('#gsImg').src = gs?.avatar || '';
$('#gsName').textContent = gs?.name || GRAND_SLAUGHTERER.slug;
$('#gsYear').textContent = `Titelträger ${GRAND_SLAUGHTERER.year}`;
$('#gsSub').textContent = GRAND_SLAUGHTERER.sub;

const ranking = eternalRanking(tournaments).slice(0, 5);
$('#topRank').innerHTML = ranking.map((r, i) => {
  const p = person(r.slug);
  return `<a class="rank-row" href="/player-profile.html?slug=${encodeURIComponent(r.slug)}">
    <span class="rank-no">${i + 1}</span>
    <img class="avatar sm" src="${esc(p?.avatar)}" alt="" loading="lazy">
    <span class="who"><span class="title">${esc(p?.name || r.name)}</span>${axesHtml(r.axes)}</span>
    <span class="pts">${r.E.toFixed(2)}<small>${r.n}× dabei</small></span>
  </a>`;
}).join('');

const post = POSTS[0];
$('#latestPost').innerHTML = `<a class="post-card" href="${post.href}">
  <img src="${post.img}" alt="" loading="lazy">
  <div class="pc-body"><div class="kicker">${new Date(post.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
  <h3>${esc(post.title)}</h3><p class="small muted">${esc(post.teaser)}</p></div></a>`;

$('#cubes').innerHTML = CUBES.map(([n, u]) =>
  `<a class="chip" href="${u}" target="_blank" rel="noopener">${icon('dice')} ${esc(n)}</a>`).join('');
$('#cubes').querySelectorAll('svg').forEach(s => { s.style.width = '15px'; s.style.height = '15px'; });

// ---------- Laufende Turniere (Donnerstagsdrafts) ----------
const { data: live } = await supabase.from('tournaments')
  .select('id,name,current_round,rounds_total').eq('status', 'active').order('created_at', { ascending: false }).limit(3);
if(live?.length){
  const slot = $('#liveSlot');
  slot.hidden = false;
  slot.innerHTML = `<div class="section-head"><h2>Läuft gerade</h2></div><div class="list">${live.map(t => `
    <a class="list-item" href="/tournament-app/round.html?tournament=${t.id}">
      <span class="chip live">LIVE</span>
      <div class="grow"><div class="title ellipsis">${esc(t.name)}</div>
      <div class="sub">Runde ${t.current_round} von ${t.rounds_total}</div></div>
      ${icon('chev', 'chev')}
    </a>`).join('')}</div>`;
}
