import { initShell, $, esc, icon } from './app.js';
import { MERCH } from './data.js';

await initShell({ tab: 'home', title: 'Merch', back: '/' });

const all = MERCH.flatMap(g => g.items);
$('#merch').innerHTML = MERCH.map(g => `
  <section class="section"><div class="section-head"><h2>${esc(g.group)}</h2></div>
  <div class="merch-grid">${g.items.map(([full, label, thumb]) => `
    <button class="merch-item" type="button" data-i="${all.findIndex(x => x[0] === full)}">
      <img src="${esc(thumb || full)}" alt="${esc(label)}" loading="lazy"><span>${esc(label)}</span>
    </button>`).join('')}</div></section>`).join('');

$('#merch').addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  if(!b) return;
  let i = Number(b.dataset.i);
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<div class="lb-top"><span class="grow"></span><button class="icon-btn" data-x aria-label="Schließen">${icon('x')}</button></div>
    <div class="lb-stage"><img alt=""><button class="lb-nav prev" aria-label="Zurück">${icon('chevL')}</button><button class="lb-nav next" aria-label="Weiter">${icon('chev')}</button></div>
    <div class="lb-cap"></div>`;
  document.body.appendChild(box);
  const show = () => { box.querySelector('img').src = all[i][0]; box.querySelector('.lb-cap').textContent = all[i][1]; };
  const close = () => { box.remove(); document.removeEventListener('keydown', key); };
  const go = d => { i = (i + d + all.length) % all.length; show(); };
  const key = e2 => { if(e2.key === 'Escape') close(); if(e2.key === 'ArrowLeft') go(-1); if(e2.key === 'ArrowRight') go(1); };
  document.addEventListener('keydown', key);
  box.querySelector('[data-x]').onclick = close;
  box.querySelector('.prev').onclick = () => go(-1);
  box.querySelector('.next').onclick = () => go(1);
  let x0 = null;
  box.addEventListener('touchstart', ev => { x0 = ev.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', ev => { if(x0 === null) return; const dx = ev.changedTouches[0].clientX - x0; if(Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; }, { passive: true });
  show();
});
