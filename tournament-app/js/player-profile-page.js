import { supabase } from './supabase-client.js';

const badgeMap = {
  'TD':'Tragischer Dichter','PQ':'Pub Quizmaster','KC':'Küchenchef','ÜN':'Übernachtiger','ÜL':'Übelster Loss',
  'GM':'Grill Master','BK':'Bar Keeper','FF':'Founding Father','SM':'Show Master','ME':'Master of Excel','SP':'Slow Player'
};

const axeMap = { 'M':'Mythic Axe', 'R':'Rare Axe', 'U':'Uncommon Axe', 'C':'Common Axe' };
const axeImg = { 'M':'SLG_Shirts_axe_mythic.png', 'R':'SLG_Shirts_axe_rare.png', 'U':'SLG_Shirts_axe_uncommon.png', 'C':'SLG_Shirts_axe_common.png' };
const axeRank = { 'M':1, 'R':2, 'U':3, 'C':4 };

function q(name){ return new URLSearchParams(location.search).get(name); }
function $(id){ return document.getElementById(id); }

function setEmpty(host, text){
  const p = document.createElement('span');
  p.className = 'pp-empty';
  p.textContent = text;
  host.appendChild(p);
}

async function init(){
  const slug = q('slug');
  if(!slug) return;

  const res = await fetch('./tournament-app/player_profiles.json', { cache:'no-store' });
  const profiles = await res.json();
  const p = profiles.find(x => x.slug === slug);
  if(!p) return;

  // Turnierfakten kommen aus der JSON, die selbst gepflegten Felder aus der DB.
  let editable = null;
  try{
    const { data } = await supabase
      .from('profiles')
      .select('display_name,description,avatar_url,favourite_card')
      .eq('slug', slug)
      .maybeSingle();
    editable = data || null;
  }catch{}

  document.getElementById('ppName').textContent = p.name;
  document.getElementById('ppReal').textContent = editable?.display_name || p.realName || '';
  document.getElementById('ppDesc').textContent = editable?.description || p.description || '-';

  const img = document.getElementById('ppImg');
  img.src = editable?.avatar_url || p.profileImage || 'main_logo.png';
  img.onerror = () => { img.src = 'main_logo.png'; };

  // --- Teilnahmen ---
  const parts = document.getElementById('ppParts');
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
  const axes = document.getElementById('ppAxes');
  axes.innerHTML = '';
  const wonAxes = [...(p.axes || [])].sort((a, b) =>
    (axeRank[a.rarity] || 9) - (axeRank[b.rarity] || 9) || String(a.sg).localeCompare(String(b.sg)));

  if(!wonAxes.length){
    setEmpty(axes, 'keine');
  }else{
    wonAxes.forEach((a) => {
      const rarity = a.rarity || a;
      const sg = a.sg || '';
      const wrap = document.createElement('span');
      wrap.className = 'chip';
      wrap.title = `${axeMap[rarity] || rarity} – gewonnen bei ${sg}`;
      wrap.innerHTML = `<img src="${axeImg[rarity] || ''}" alt="${rarity}" style="height:16px;vertical-align:middle;margin-right:6px"/>${axeMap[rarity] || rarity} (${sg})`;
      axes.appendChild(wrap);
    });
  }

  // --- Abzeichen ---
  const badges = document.getElementById('ppBadges');
  badges.innerHTML = '';
  const badgeList = p.badges || [];
  if(!badgeList.length){
    setEmpty(badges, 'keine');
  }else{
    badgeList.forEach(b => {
      const full = badgeMap[b] || b;
      const chip = document.createElement('span');
      chip.className = 'chip chip-badge';
      chip.title = full;
      chip.innerHTML = `<b>${b}</b> <span class="chip-label">${full}</span>`;
      badges.appendChild(chip);
    });
  }

  // --- Lieblingskarte ---
  const favHost = document.getElementById('ppFav');
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
}

init();
