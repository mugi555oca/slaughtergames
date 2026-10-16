// Kleines, sicheres Markdown fuer Blogartikel. Erst wird alles escaped, dann
// nur eine Handvoll Formate erlaubt - so kann niemand HTML/Skripte einschleusen.
//
//   ## Ueberschrift      **fett**   *kursiv*   [Text](https://…)
//   - Liste              ![Bildunterschrift](https://…bild.jpg)  (eigene Zeile)
import { esc } from './app.js';

const safeUrl = u => /^(https:\/\/|\/)[^\s"'<>]*$/i.test(u) ? u : null;

function inline(s){
  return s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      const url = safeUrl(u.replace(/&amp;/g, '&'));
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${t}</a>` : t;
    })
    .replace(/(^|[\s(])(https:\/\/[^\s<]+)/g, (m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

export function renderMarkdown(src){
  const blocks = esc(src || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks.map(block => {
    const b = block.trim();
    if(!b) return '';
    const img = b.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if(img){
      const url = safeUrl(img[2].replace(/&amp;/g, '&'));
      if(!url) return '';
      return `<figure><img src="${esc(url)}" alt="${img[1]}" loading="lazy">${img[1] ? `<figcaption>${img[1]}</figcaption>` : ''}</figure>`;
    }
    if(/^#{1,3} /.test(b)) return `<h3>${inline(b.replace(/^#{1,3} /, ''))}</h3>`;
    const lines = b.split('\n');
    if(lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

export function teaserOf(src, n = 180){
  const text = String(src || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>-]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > n ? text.slice(0, n).replace(/\s\S*$/, '') + '…' : text;
}
