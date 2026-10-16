// Private Galerie: Fotos liegen im Storage-Bucket "gallery" (nicht oeffentlich),
// Metadaten in gallery_photos. Lesen und Hochladen nur Mitglieder, Loeschen
// nur Admin - beides per RLS in der Datenbank erzwungen.
import { supabase, esc, icon, resizeImage, confirmSheet, toast } from './app.js';

const BUCKET = 'gallery';
const TTL = 60 * 60 * 24;            // signierte URL gilt 24 h
const CACHE_KEY = 'sg-gallery-urls';

function readCache(){
  try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }catch{ return {}; }
}
function writeCache(c){
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }catch{}
}

// Signierte URLs holen, aber gleiche URL wiederverwenden solange gueltig -
// sonst laedt der Browser jedes Bild bei jedem Besuch neu.
export async function signUrls(paths){
  const cache = readCache();
  const now = Date.now();
  const missing = paths.filter(p => p && !(cache[p] && cache[p].exp > now + 60_000));
  for(let i = 0; i < missing.length; i += 100){
    const chunk = missing.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, TTL);
    if(error) throw error;
    for(const d of data || []) if(d.signedUrl) cache[d.path] = { url: d.signedUrl, exp: now + (TTL - 3600) * 1000 };
  }
  for(const k of Object.keys(cache)) if(cache[k].exp < now) delete cache[k];
  writeCache(cache);
  return Object.fromEntries(paths.map(p => [p, cache[p]?.url || null]));
}

export async function listPhotos(album, limit = null){
  let q = supabase.from('gallery_photos').select('*').order('sort_key', { ascending: true, nullsFirst: false }).order('created_at');
  if(album) q = q.eq('album', album);
  if(limit) q = q.limit(limit);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

export async function albumStats(){
  const { data, error } = await supabase.from('gallery_photos').select('album,thumb_path,path,sort_key,created_at')
    .order('sort_key', { ascending: true, nullsFirst: false }).order('created_at');
  if(error) throw error;
  const by = new Map();
  for(const r of data || []){
    const a = by.get(r.album) || { album: r.album, count: 0, cover: r.thumb_path || r.path };
    a.count++;
    by.set(r.album, a);
  }
  return by;
}

export function gridHtml(rows, urls){
  return `<div class="photo-grid">${rows.map((r, i) => `
    <button type="button" data-i="${i}" aria-label="Foto ${i + 1} öffnen">
      <img src="${esc(urls[r.thumb_path || r.path] || '')}" alt="" loading="lazy" decoding="async">
    </button>`).join('')}</div>`;
}

export async function uploadPhotos(files, album, onProgress){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) throw new Error('Nicht eingeloggt.');
  let done = 0;
  const added = [];
  for(const file of files){
    if(!file.type.startsWith('image/')){ done++; continue; }
    const full = await resizeImage(file, 2000, 0.85);
    const thumb = await resizeImage(file, 480, 0.78);
    const id = (crypto.randomUUID?.() || String(Date.now() + Math.random())).replace(/[^a-z0-9-]/gi, '');
    const path = `${album}/${id}.jpg`;
    const thumbPath = `${album}/thumbs/${id}.jpg`;
    const up1 = await supabase.storage.from(BUCKET).upload(path, full.blob, { contentType: 'image/jpeg' });
    if(up1.error) throw up1.error;
    const up2 = await supabase.storage.from(BUCKET).upload(thumbPath, thumb.blob, { contentType: 'image/jpeg' });
    if(up2.error) throw up2.error;
    const { data, error } = await supabase.from('gallery_photos').insert({
      album, path, thumb_path: thumbPath, width: full.width, height: full.height, uploaded_by: user.id,
    }).select('*').single();
    if(error) throw error;
    added.push(data);
    done++;
    onProgress?.(done, files.length);
  }
  return added;
}

export async function deletePhoto(row){
  const { error } = await supabase.from('gallery_photos').delete().eq('id', row.id);
  if(error) throw error;
  await supabase.storage.from(BUCKET).remove([row.path, row.thumb_path].filter(Boolean));
}

// Vollbild mit Wischen, Tastatur, Teilen und (Admin) Loeschen
export function openLightbox(rows, start, { isAdmin = false, people = null, onDelete = null } = {}){
  let i = start;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `
    <div class="lb-top">
      <span class="grow" data-count></span>
      <button class="icon-btn" data-share aria-label="Teilen / Speichern">${icon('download')}</button>
      ${isAdmin ? `<button class="icon-btn" data-del aria-label="Löschen" style="color:var(--danger)">${icon('trash')}</button>` : ''}
      <button class="icon-btn" data-x aria-label="Schließen">${icon('x')}</button>
    </div>
    <div class="lb-stage">
      <img alt="">
      <button class="lb-nav prev" aria-label="Vorheriges">${icon('chevL')}</button>
      <button class="lb-nav next" aria-label="Nächstes">${icon('chev')}</button>
    </div>
    <div class="lb-cap" data-cap></div>`;
  document.body.appendChild(box);
  document.body.style.overflow = 'hidden';
  const img = box.querySelector('.lb-stage img');

  async function render(){
    const r = rows[i];
    box.querySelector('[data-count]').textContent = `${i + 1} / ${rows.length}`;
    const who = r.uploaded_by && people?.byId.get(r.uploaded_by);
    box.querySelector('[data-cap]').textContent = [r.caption, who ? `hochgeladen von ${who.display}` : ''].filter(Boolean).join(' · ');
    const urls = await signUrls([r.path, r.thumb_path].filter(Boolean));
    img.src = urls[r.thumb_path] || urls[r.path];       // erst das kleine, dann das grosse
    const full = new Image();
    full.onload = () => { if(rows[i] === r) img.src = full.src; };
    full.src = urls[r.path];
    // Nachbarn vorladen
    signUrls([rows[i + 1]?.path, rows[i - 1]?.path].filter(Boolean)).then(u => Object.values(u).forEach(s => { if(s) new Image().src = s; }));
  }
  const go = d => { i = (i + d + rows.length) % rows.length; render(); };
  const close = () => { box.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => {
    if(e.key === 'Escape') close();
    if(e.key === 'ArrowLeft') go(-1);
    if(e.key === 'ArrowRight') go(1);
  };
  document.addEventListener('keydown', onKey);
  box.querySelector('[data-x]').addEventListener('click', close);
  box.querySelector('.prev').addEventListener('click', () => go(-1));
  box.querySelector('.next').addEventListener('click', () => go(1));

  let x0 = null, y0 = null;
  box.querySelector('.lb-stage').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  box.querySelector('.lb-stage').addEventListener('touchend', e => {
    if(x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if(dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    x0 = null;
  }, { passive: true });

  box.querySelector('[data-share]').addEventListener('click', async () => {
    const r = rows[i];
    const url = (await signUrls([r.path]))[r.path];
    try{
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `slaughter-games-${r.album}-${i + 1}.jpg`, { type: 'image/jpeg' });
      if(navigator.canShare?.({ files: [file] })){ await navigator.share({ files: [file] }); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }catch(err){ if(err.name !== 'AbortError') toast('Konnte das Foto nicht laden.', 'err'); }
  });

  box.querySelector('[data-del]')?.addEventListener('click', async () => {
    if(!await confirmSheet('Foto löschen?', 'Das Foto wird für alle endgültig entfernt.', 'Löschen', true)) return;
    try{
      const r = rows[i];
      await deletePhoto(r);
      rows.splice(i, 1);
      onDelete?.(r);
      toast('Foto gelöscht.', 'ok');
      if(!rows.length) return close();
      if(i >= rows.length) i = rows.length - 1;
      render();
    }catch(err){ toast(err.message, 'err'); }
  });

  render();
  return { close };
}
