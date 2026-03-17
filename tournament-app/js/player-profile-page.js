const badgeMap = {
  'TD':'Tragischer Dichter','PQ':'Pub Quizmaster','KC':'Küchenchef','ÜN':'Übernachtiger','ÜL':'Übelster Loss',
  'GM':'Grill Master','BK':'Bar Keeper','FF':'Founding Father','SM':'Show Master','ME':'Master of Excel','SP':'Slow Player'
};

const axeMap = { 'M':'Mythic Axe', 'R':'Rare Axe', 'U':'Uncommon Axe', 'C':'Common Axe' };
const axeImg = { 'M':'SLG_Shirts_axe_mythic.png', 'R':'SLG_Shirts_axe_rare.png', 'U':'SLG_Shirts_axe_uncommon.png', 'C':'SLG_Shirts_axe_common.png' };

function q(name){ return new URLSearchParams(location.search).get(name); }

async function init(){
  const slug = q('slug');
  if(!slug) return;

  const res = await fetch('./tournament-app/player_profiles.json', { cache:'no-store' });
  const profiles = await res.json();
  const p = profiles.find(x => x.slug === slug);
  if(!p) return;

  document.getElementById('ppName').textContent = p.name;
  document.getElementById('ppReal').textContent = p.realName || '';
  document.getElementById('ppDesc').textContent = p.description || '-';

  const img = document.getElementById('ppImg');
  img.src = p.profileImage || 'main_logo.png';
  img.onerror = () => { img.src = 'main_logo.png'; };

  const parts = document.getElementById('ppParts');
  parts.innerHTML = '';
  for(let i=1;i<=Number(p.participations||0);i++){
    const el = document.createElement('img');
    el.src = `Logos_x/SG_Logo_${i}.png`;
    el.alt = `SG ${i}`;
    el.title = `Teilnahme SG ${i}`;
    el.style.height = '26px';
    el.style.marginRight = '6px';
    parts.appendChild(el);
  }

  const axes = document.getElementById('ppAxes');
  axes.innerHTML = '';
  (p.axes || []).forEach((a, idx) => {
    const wrap = document.createElement('span');
    wrap.className = 'chip';
    wrap.title = `Gewonnen bei SG ${idx+1}`;
    wrap.innerHTML = `<img src="${axeImg[a] || ''}" alt="${a}" style="height:14px;vertical-align:middle;margin-right:6px"/>${axeMap[a] || a} (SG ${idx+1})`;
    axes.appendChild(wrap);
  });

  const badges = document.getElementById('ppBadges');
  badges.innerHTML = '';
  (p.badges || []).forEach(b => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = b;
    chip.title = badgeMap[b] || b;
    badges.appendChild(chip);
  });
}

init();
