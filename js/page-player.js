import { initShell, $, esc, loadPeople, supabase, me } from './app.js';
import { loadTournaments, eternalRanking, AXES, AXE_ORDER, sgLogo } from './data.js';
import { loadWeekly, renderPerformance } from './weekly.js';

const slug = new URLSearchParams(location.search).get('slug');
await initShell({ tab: 'ranking', title: 'Spielerprofil', back: '/spieler.html' });

const [tournaments, people, m] = await Promise.all([loadTournaments(), loadPeople(), me()]);
const p = people.bySlug.get(slug);

if(!p){
  $('#ppName').textContent = 'Spieler nicht gefunden';
} else {
  document.title = `${p.name} – Slaughter Games`;
  $('#ppImg').src = p.avatar;
  $('#ppName').textContent = p.name;
  $('#ppReal').textContent = p.display !== p.name ? p.display : '';
  $('#ppDesc').textContent = p.profile?.description || p.static?.description || '';
  if(m.user && m.profile?.slug === slug) $('#ppEdit').hidden = false;

  // Teilnahmen + Plaetze aus den Turnierdaten
  const results = tournaments.map(t => ({ t, r: t.ranking.find(x => x.slug === slug) })).filter(x => x.r);
  const axes = results.filter(x => x.r.axe).map(x => ({ sg: x.t.sg, rarity: x.r.axe }))
    .sort((a, b) => AXE_ORDER[a.rarity] - AXE_ORDER[b.rarity] || a.sg - b.sg);
  const eternal = eternalRanking(tournaments);
  const pos = eternal.findIndex(e => e.slug === slug);
  const best = results.length ? Math.min(...results.map(x => x.r.place)) : null;

  $('#ppStats').innerHTML = `
    <div class="stat"><b>${results.length}</b><span>Teilnahmen</span></div>
    <div class="stat"><b>${pos >= 0 ? pos + 1 : '–'}</b><span>Eternal</span></div>
    <div class="stat"><b>${best ? best + '.' : '–'}</b><span>Bester Platz</span></div>`;

  $('#ppParts').innerHTML = results.length
    ? [...results].reverse().map(x => `<a class="rank-row" href="/turnier.html?sg=${x.t.sg}">
        <img src="${sgLogo(x.t.sg)}" alt="" style="width:40px;height:40px;object-fit:contain">
        <span class="who"><span class="title">${esc(x.t.title)}</span><span class="sub">${x.t.year}${x.t.location ? ' · ' + esc(x.t.location) : ''}</span></span>
        ${x.r.axe ? `<img src="${AXES[x.r.axe].img}" alt="${AXES[x.r.axe].label}" title="${AXES[x.r.axe].label}" style="width:22px;height:22px;object-fit:contain">` : ''}
        <span class="pts">${x.r.place}.<small>von ${x.t.players}</small></span></a>`).join('')
    : '<div class="rank-row muted">Noch keine Teilnahme.</div>';

  $('#ppAxes').innerHTML = axes.length
    ? `<div class="row wrap" style="gap:8px">${axes.map(a => `<span class="chip"><img src="${AXES[a.rarity].img}" alt="" style="width:16px;height:16px;object-fit:contain">${AXES[a.rarity].label} · SG${a.sg}</span>`).join('')}</div>`
    : '<span class="muted">Noch keine Axt.</span>';

  // Abzeichen
  const [{ data: defs }, { data: awarded }] = await Promise.all([
    supabase.from('badges').select('code,name,description,icon_key,sort_order'),
    supabase.from('player_badges').select('badge_code,sg').eq('slug', slug),
  ]);
  if(awarded?.length){
    try{
      const res = await fetch('/badges.svg?v=17');
      const s = document.createElement('div'); s.hidden = true; s.innerHTML = await res.text(); document.body.appendChild(s);
    }catch{}
    const byCode = Object.fromEntries((defs || []).map(d => [d.code, d]));
    const grouped = new Map();
    for(const a of awarded){
      const d = byCode[a.badge_code]; if(!d) continue;
      const g = grouped.get(d.code) || { ...d, count: 0, events: [] };
      g.count++; if(a.sg) g.events.push(a.sg);
      grouped.set(d.code, g);
    }
    $('#ppBadges').innerHTML = `<div class="card">${[...grouped.values()].sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).map(b => `
      <span class="badge-chip" title="${esc(b.description || '')}${b.events.length ? ' · ' + esc(b.events.sort().join(', ')) : ''}">
        ${b.icon_key ? `<svg aria-hidden="true"><use href="#badge-${esc(b.icon_key)}"/></svg>` : ''}${esc(b.name)}${b.count > 1 ? `<b>×${b.count}</b>` : ''}
      </span>`).join('')}</div>`;
  } else {
    $('#ppBadges').innerHTML = '<div class="card muted">Noch keine Abzeichen.</div>';
  }

  // Lieblingskarte mit Bild von Scryfall
  const fav = p.profile?.favourite_card;
  if(!fav){
    $('#ppFav').innerHTML = '<div class="card muted">Keine angegeben.</div>';
  } else {
    const link = `https://scryfall.com/search?q=${encodeURIComponent('!"' + fav + '"')}`;
    $('#ppFav').innerHTML = `<a class="card row" href="${link}" target="_blank" rel="noopener"><span class="grow" style="font-weight:700">🃏 ${esc(fav)}</span><span class="small muted">Scryfall ↗</span></a>`;
    try{
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(fav)}`);
      if(res.ok){
        const c = await res.json();
        const img = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal;
        if(img) $('#ppFav').innerHTML = `<a href="${link}" target="_blank" rel="noopener" style="display:block;max-width:260px;margin:0 auto">
          <img src="${esc(img)}" alt="${esc(c.name)}" style="border-radius:13px;box-shadow:0 12px 30px rgba(0,0,0,.5)"></a>`;
      }
    }catch{}
  }
}

// ---------- Weekly Performance ----------
if(p){
  try{
    const weekly = await loadWeekly();
    const played = weekly.events.some(e => e.rows.some(r => r.key === slug));
    if(played) renderPerformance($('#ppWeekly'), weekly, slug);
    else $('#ppWeekly').innerHTML = '<div class="card muted">Noch kein Weekly gespielt.</div>';
    if(location.hash === '#weekly') $('#weekly').scrollIntoView();
  }catch(err){ $('#ppWeekly').innerHTML = `<div class="card muted">${esc(err.message)}</div>`; }
}
