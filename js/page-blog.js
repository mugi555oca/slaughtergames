import { initShell, $, esc, loadPeople } from './app.js';
import { loadAllPosts } from './blog.js';

const m = await initShell({ tab: 'home', title: 'Blog', back: '/' });
if(m.isMember) $('#writeBtn').hidden = false;

const [posts, people] = await Promise.all([loadAllPosts(), loadPeople()]);
$('#posts').innerHTML = posts.map(p => {
  const a = p.author && people.byId.get(p.author);
  return `<a class="post-card" href="${esc(p.href)}">
    <img src="${esc(p.img || '/assets/logo-640.webp')}" alt="" loading="lazy">
    <div class="pc-body">
      <div class="kicker">${new Date(p.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}${a ? ' · ' + esc(a.real) : ''}</div>
      <h3>${esc(p.title)}</h3><p class="small muted">${esc(p.teaser)}</p>
    </div>
  </a>`;
}).join('');
