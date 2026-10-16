import { initShell, $, esc, icon, loadPeople, lockHtml, toast } from './app.js';
import { loadTournaments, NEXT_EVENT } from './data.js';
import { listPhotos, albumStats, signUrls, gridHtml, openLightbox, uploadPhotos } from './gallery.js';

const album = new URLSearchParams(location.search).get('album');
const m = await initShell({ tab: 'home', title: 'Galerie', back: album ? '/galerie.html' : '/' });
const body = $('#gBody');

const tournaments = await loadTournaments();
const albums = [...tournaments.map(t => ({ key: `sg${t.sg}`, title: t.title, sub: `${t.year} · ${t.location || ''}` })),
  { key: `sg${NEXT_EVENT.sg}`, title: NEXT_EVENT.title, sub: NEXT_EVENT.dateLabel }].reverse();
const meta = albums.find(a => a.key === album);

if(!m.user){
  $('#gTitle').textContent = meta?.title || 'Galerie';
  body.innerHTML = lockHtml('Galerie nur für Mitglieder', 'Die Fotos der Slaughter Games sind privat. Einloggen, dann siehst du alles und kannst selbst Fotos hochladen.');
} else if(!m.isMember){
  body.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet. Sag Mugi Bescheid.</div>';
} else if(!album){
  await renderAlbums();
} else {
  await renderAlbum();
}

async function renderAlbums(){
  const stats = await albumStats();
  const covers = await signUrls([...stats.values()].map(s => s.cover));
  body.innerHTML = `<div class="album-grid">${albums.map(a => {
    const s = stats.get(a.key);
    return `<a class="album" href="/galerie.html?album=${a.key}">
      ${s ? `<img src="${esc(covers[s.cover] || '')}" alt="" loading="lazy">` : `<div style="display:grid;place-items:center;height:100%;color:var(--faint)">${icon('camera')}</div>`}
      <span class="cap">${esc(a.title)}<small>${s ? s.count + ' Fotos' : 'noch leer'}</small></span>
    </a>`;
  }).join('')}</div>`;
  body.querySelectorAll('.album svg').forEach(s => { s.style.width = '36px'; s.style.height = '36px'; });
}

async function renderAlbum(){
  $('#gTitle').textContent = meta?.title || album.toUpperCase();
  document.title = `${meta?.title || 'Galerie'} – Fotos`;
  const people = await loadPeople();
  let rows = await listPhotos(album);

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `${icon('camera')}Fotos hinzufügen`;
  document.body.appendChild(fab);
  fab.addEventListener('click', () => $('#gFile').click());

  async function paint(){
    if(!rows.length){
      body.innerHTML = `<div class="card empty">${icon('camera')}<h3>Noch keine Fotos</h3><p>Sei der Erste – unten rechts hochladen.</p></div>`;
      return;
    }
    const urls = await signUrls(rows.map(r => r.thumb_path || r.path));
    body.innerHTML = `<p class="small muted mb">${rows.length} Fotos${meta?.sub ? ' · ' + esc(meta.sub) : ''}</p>` + gridHtml(rows, urls);
    body.querySelector('.photo-grid').addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if(b) openLightbox(rows, Number(b.dataset.i), { isAdmin: m.isAdmin, people, onDelete: () => paint() });
    });
  }
  await paint();

  $('#gFile').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if(!files.length) return;
    fab.disabled = true;
    const bar = document.createElement('div');
    bar.className = 'card mb';
    bar.innerHTML = `<div class="row between small mb"><b>Lade hoch…</b><span data-n>0 / ${files.length}</span></div><div class="progress"><i></i></div>`;
    body.prepend(bar);
    try{
      const added = await uploadPhotos(files, album, (done, total) => {
        bar.querySelector('[data-n]').textContent = `${done} / ${total}`;
        bar.querySelector('i').style.width = `${Math.round(done / total * 100)}%`;
      });
      rows = rows.concat(added);
      toast(`${added.length} Foto${added.length === 1 ? '' : 's'} hochgeladen.`, 'ok');
    }catch(err){
      toast(err.message || 'Upload fehlgeschlagen.', 'err');
    }finally{
      fab.disabled = false;
      await paint();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  });
}
