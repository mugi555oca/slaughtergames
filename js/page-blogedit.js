// Blogartikel schreiben/bearbeiten (Mitglieder). Bilder landen im
// oeffentlichen Bucket "blog" - der Blog ist bewusst oeffentlich.
import { initShell, $, esc, supabase, requireLogin, toast, busy, resizeImage, openSheet, confirmSheet } from './app.js';
import { renderMarkdown, teaserOf } from './markdown.js';

const id = new URLSearchParams(location.search).get('id');
await initShell({ tab: 'home', title: id ? 'Artikel bearbeiten' : 'Neuer Artikel', back: id ? `/post.html?id=${id}` : '/blog.html' });
const m = await requireLogin();
if(m && !m.isMember){ document.querySelector('main').innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>'; }
if(!m?.isMember) throw new Error('kein Mitglied');

let coverUrl = null;
const body = $('#pBody');

if(id){
  const { data: post, error } = await supabase.from('blog_posts').select('*').eq('id', id).single();
  if(error || !post){ toast('Artikel nicht gefunden.', 'err'); throw error; }
  if(post.author_id !== m.user.id && !m.isAdmin){ location.replace(`/post.html?id=${id}`); }
  $('#edTitle').textContent = 'Artikel bearbeiten';
  $('#pTitle').value = post.title;
  body.value = post.body;
  setCover(post.cover_url);
  $('#pubBtn').textContent = 'Speichern';
  $('#delBtn').hidden = false;
}

function setCover(url){
  coverUrl = url;
  $('#coverImg').hidden = !url;
  if(url) $('#coverImg').src = url;
  $('#coverHint').textContent = url ? '' : '＋ Titelbild wählen';
}

async function upload(file, side){
  const { blob } = await resizeImage(file, side, 0.85);
  const path = `${m.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('blog').upload(path, blob, { contentType: 'image/jpeg' });
  if(error) throw error;
  return supabase.storage.from('blog').getPublicUrl(path).data.publicUrl;
}

$('#coverBtn').addEventListener('click', () => $('#coverFile').click());
$('#coverFile').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if(!f) return;
  try{ toast('Lade Titelbild…'); setCover(await upload(f, 1800)); }catch(err){ toast(err.message, 'err'); }
});

// ---------- Werkzeugleiste ----------
function wrap(before, after = before, placeholder = 'Text'){
  const s = body.selectionStart, e = body.selectionEnd;
  const sel = body.value.slice(s, e) || placeholder;
  body.setRangeText(before + sel + after, s, e, 'end');
  body.focus();
}
function insertBlock(text){
  const pos = body.selectionStart;
  const pre = body.value.slice(0, pos);
  const lead = !pre || pre.endsWith('\n\n') ? '' : pre.endsWith('\n') ? '\n' : '\n\n';
  body.setRangeText(`${lead}${text}\n\n`, pos, body.selectionEnd, 'end');
  body.focus();
}
$('#mdBar').addEventListener('click', e => {
  const k = e.target.closest('[data-md]')?.dataset.md;
  if(k === 'b') wrap('**');
  if(k === 'i') wrap('*');
  if(k === 'h') insertBlock('## Zwischenüberschrift');
  if(k === 'l') insertBlock('- Punkt eins\n- Punkt zwei');
  if(k === 'a'){
    const url = prompt('Link-Adresse (https://…):', 'https://');
    if(url && /^https:\/\//.test(url)) wrap('[', `](${url})`, 'Linktext');
  }
  if(k === 'img') $('#bodyFile').click();
});
$('#bodyFile').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if(!f) return;
  const caption = prompt('Bildunterschrift (optional):', '') || '';
  try{
    toast('Lade Bild…');
    const url = await upload(f, 1600);
    insertBlock(`![${caption.replace(/[\[\]]/g, '')}](${url})`);
  }catch(err){ toast(err.message, 'err'); }
});

$('#previewBtn').addEventListener('click', () => {
  openSheet(`<div class="prose">${coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="">` : ''}
    <h1>${esc($('#pTitle').value || 'Ohne Titel')}</h1>${renderMarkdown(body.value)}</div>
    <button class="btn block ghost mt" data-close>Zurück zum Bearbeiten</button>`);
});

$('#edForm').addEventListener('submit', async e => {
  e.preventDefault();
  if(!coverUrl){ toast('Bitte ein Titelbild wählen.', 'err'); return; }
  if(!body.value.trim()){ toast('Der Text fehlt noch.', 'err'); return; }
  busy(e.submitter, true, 'Speichere…');
  const row = { title: $('#pTitle').value.trim(), body: body.value, cover_url: coverUrl, teaser: teaserOf(body.value) };
  const res = id
    ? await supabase.from('blog_posts').update(row).eq('id', id).select('id').single()
    : await supabase.from('blog_posts').insert({ ...row, author_id: m.user.id }).select('id').single();
  if(res.error){ busy(e.submitter, false); toast(res.error.message, 'err'); return; }
  location.replace(`/post.html?id=${res.data.id}`);
});

$('#delBtn').addEventListener('click', async () => {
  if(!await confirmSheet('Artikel löschen?', 'Der Artikel verschwindet endgültig aus dem Blog.', 'Löschen', true)) return;
  const { error } = await supabase.from('blog_posts').delete().eq('id', id);
  if(error){ toast(error.message, 'err'); return; }
  location.replace('/blog.html');
});
