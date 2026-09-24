import { supabase } from './supabase-client.js';

const axeMap = { 'M':'Mythic Axe', 'R':'Rare Axe', 'U':'Uncommon Axe', 'C':'Common Axe' };
const axeImg = { 'M':'SLG_Shirts_axe_mythic.png', 'R':'SLG_Shirts_axe_rare.png', 'U':'SLG_Shirts_axe_uncommon.png', 'C':'SLG_Shirts_axe_common.png' };
const axeRank = { 'M':1, 'R':2, 'U':3, 'C':4 };

function q(name){ return new URLSearchParams(location.search).get(name); }
function $(id){ return document.getElementById(id); }

function setEmpty(host, text){
  const span = document.createElement('span');
  span.className = 'pp-empty';
  span.textContent = text;
  host.appendChild(span);
}

// Das Sprite wird eingebettet statt per externem <use> referenziert - externe
// Sprite-Referenzen sind nicht in allen Browsern zuverlaessig.
async function injectSprite(){
  if(document.getElementById('badgeSprite')) return;
  try{
    const res = await fetch('badges.svg', { cache:'force-cache' });
    const host = document.createElement('div');
    host.id = 'badgeSprite';
    host.style.display = 'none';
    host.innerHTML = await res.text();
    document.body.appendChild(host);
  }catch{}
}

function badgeIcon(iconKey){
  if(!iconKey) return '';
  return `<svg class="badge-icon" aria-hidden="true"><use href="#badge-${iconKey}"/></svg>`;
}

async function loadBadges(slug){
  try{
    const [{ data: defs }, { data: awarded }] = await Promise.all([
      supabase.from('badges').select('code,name,description,icon_key,sort_order'),
      supabase.from('player_badges').select('badge_code,sg').eq('slug', slug),
    ]);
    if(!defs || !awarded) return [];
    const byCode = Object.fromEntries(defs.map(d => [d.code, d]));

    // Mehrfach vergebene Abzeichen buendeln, Events sammeln.
    const grouped = new Map();
    for(const a of awarded){
      const def = byCode[a.badge_code];
      if(!def) continue;
      if(!grouped.has(a.badge_code)) grouped.set(a.badge_code, { ...def, count: 0, events: [] });
      const g = grouped.get(a.badge_code);
      g.count += 1;
      if(a.sg) g.events.push(a.sg);
    }
    return [...grouped.values()].sort((x, y) => (x.sort_order || 999) - (y.sort_order || 999));
  }catch{
    return [];
  }
}

async function init(){
  const slug = q('slug');
  if(!slug) return;

  await injectSprite();

  const res = await fetch('./tournament-app/player_profiles.json', { cache:'no-store' });
  const profiles = await res.json();
  const p = profiles.find(x => x.slug === slug);
  if(!p) return;

  // Turnierfakten aus der JSON, selbst gepflegte Felder + Abzeichen aus der DB.
  let editable = null;
  try{
    const { data } = await supabase
      .from('profiles')
      .select('display_name,description,avatar_url,favourite_card')
      .eq('slug', slug)
      .maybeSingle();
    editable = data || null;
  }catch{}

  $('ppName').textContent = p.name;
  $('ppReal').textContent = editable?.display_name || p.realName || '';
  $('ppDesc').textContent = editable?.description || p.description || '-';

  const img = $('ppImg');
  img.src = editable?.avatar_url || p.profileImage || 'main_logo.png';
  img.onerror = () => { img.src = 'main_logo.png'; };

  // --- Teilnahmen ---
  const parts = $('ppParts');
  parts.innerHTML = '';
  const participations = p.participations || [];
  if(!participations.length){
    setEmpty(parts, 'noch keine Teilnahme');
  }else{
    participations.forEach((sg) => {
      const num = String(sg).replace('SG','');
      const el = document.createElement('img');
      el.src = `Logos_x/SG_Logo_${num}.png`;
      el.alt = sg;
      el.className = 'pp-part';
      el.title = `Teilnahme an den Slaughter Games ${num}`;
      parts.appendChild(el);
    });
  }

  // --- Äxte ---
  const axes = $('ppAxes');
  axes.innerHTML = '';
  const wonAxes = [...(p.axes || [])].sort((a, b) =>
    (axeRank[a.rarity] || 9) - (axeRank[b.rarity] || 9) || String(a.sg).localeCompare(String(b.sg)));
  if(!wonAxes.length){
    setEmpty(axes, 'keine');
  }else{
    wonAxes.forEach((a) => {
      const rarity = a.rarity || a;
      const wrap = document.createElement('span');
      wrap.className = 'chip';
      wrap.title = `${axeMap[rarity] || rarity} – gewonnen bei ${a.sg || ''}`;
      wrap.innerHTML = `<img src="${axeImg[rarity] || ''}" alt="${rarity}" style="height:16px;vertical-align:middle;margin-right:6px"/>${axeMap[rarity] || rarity} (${a.sg || ''})`;
      axes.appendChild(wrap);
    });
  }

  // --- Abzeichen ---
  const badges = $('ppBadges');
  badges.innerHTML = '';
  const list = await loadBadges(slug);
  if(!list.length){
    setEmpty(badges, 'keine');
  }else{
    list.forEach(b => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-badge';
      const events = b.events.length ? ` · ${b.events.sort().join(', ')}` : '';
      chip.title = `${b.name}${b.description ? ' – ' + b.description : ''}${events}`;
      chip.innerHTML = `${badgeIcon(b.icon_key)}<span class="chip-label">${b.name}</span>`
        + (b.count > 1 ? `<span class="chip-count">×${b.count}</span>` : '');
      badges.appendChild(chip);
    });
  }

  // --- Lieblingskarte ---
  const favHost = $('ppFav');
  if(favHost){
    favHost.innerHTML = '';
    const fav = editable?.favourite_card;
    if(!fav){
      setEmpty(favHost, 'keine angegeben');
    }else{
      const a = document.createElement('a');
      a.className = 'chip chip-fav';
      a.href = `https://scryfall.com/search?q=${encodeURIComponent('!"' + fav + '"')}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = `${fav} auf Scryfall ansehen`;
      a.textContent = `🃏 ${fav}`;
      favHost.appendChild(a);
    }
  }

  // --- Navigation: eigenes Profil bearbeiten ---
  try{
    const { data: auth } = await supabase.auth.getUser();
    const editLink = $('ppEdit');
    if(auth?.user && editLink){
      const { data: mine } = await supabase
        .from('profiles').select('slug').eq('id', auth.user.id).maybeSingle();
      if(mine?.slug === slug) editLink.hidden = false;
    }
  }catch{}
}

init();
