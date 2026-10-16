// Einzelner Blogartikel aus der Datenbank (post.html?id=…), oeffentlich.
import { initShell, $, esc, icon, supabase, loadPeople, me, toast } from './app.js';
import { renderMarkdown } from './markdown.js';

const id = new URLSearchParams(location.search).get('id');
await initShell({ tab: 'home', title: 'Blog', back: '/blog.html' });
const host = $('#post');

const [{ data: post }, people, m] = await Promise.all([
  supabase.from('blog_posts').select('*').eq('id', id).maybeSingle(),
  loadPeople(),
  me(),
]);

if(!post){
  host.innerHTML = '<div class="empty"><h3>Artikel nicht gefunden</h3></div>';
} else {
  const a = people.byId.get(post.author_id);
  const canEdit = m.user && (post.author_id === m.user.id || m.isAdmin);
  document.title = `${post.title} – Slaughter Games Blog`;
  host.innerHTML = `
    <h1>${esc(post.title)}</h1>
    <div class="post-author">
      <img class="avatar" src="${esc(a?.avatar || '/icons/icon-192.png')}" alt="">
      <div class="grow small"><b>${esc(a?.real || 'Mitglied')}</b><br><span class="muted">${new Date(post.created_at).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
      ${canEdit ? `<a class="btn xs ghost" href="/blog-edit.html?id=${post.id}">${icon('edit')} Bearbeiten</a>` : ''}
      <button class="icon-btn" id="shareBtn" aria-label="Teilen">${icon('share')}</button>
    </div>
    ${post.cover_url ? `<img class="cover" src="${esc(post.cover_url)}" alt="">` : ''}
    ${renderMarkdown(post.body)}`;
  host.querySelectorAll('.btn svg').forEach(s => { s.style.width = '15px'; s.style.height = '15px'; });
  $('#shareBtn').addEventListener('click', async () => {
    if(navigator.share){ try{ await navigator.share({ title: post.title, url: location.href }); }catch{} }
    else { await navigator.clipboard?.writeText(location.href); toast('Link kopiert.'); }
  });
}
