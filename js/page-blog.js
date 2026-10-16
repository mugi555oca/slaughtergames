import { initShell, $, esc } from './app.js';
import { POSTS } from './data.js';

await initShell({ tab: 'home', title: 'Blog', back: '/' });

$('#posts').innerHTML = POSTS.map(p => `
  <a class="post-card" href="${p.href}">
    <img src="${p.img}" alt="" loading="lazy">
    <div class="pc-body">
      <div class="kicker">${new Date(p.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <h3>${esc(p.title)}</h3><p class="small muted">${esc(p.teaser)}</p>
    </div>
  </a>`).join('');
