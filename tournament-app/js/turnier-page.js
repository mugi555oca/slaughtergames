// Turnier-Unterseite: Eckdaten, Fotokarussell und Endstand (turnier.html?sg=N)

const AXE_IMG = {
  M: ['SLG_Shirts_axe_mythic.png', 'Mystic Rare Axt'],
  R: ['SLG_Shirts_axe_rare.png', 'Rare Axt'],
  U: ['SLG_Shirts_axe_uncommon.png', 'Uncommon Axt'],
  C: ['SLG_Shirts_axe_common.png', 'Common Axt'],
};

function $(id){ return document.getElementById(id); }

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function fmtRange(from, to){
  const a = new Date(from + 'T12:00:00');
  const b = new Date(to + 'T12:00:00');
  const day = d => d.toLocaleDateString('de-AT', { weekday:'short', day:'numeric', month:'long' });
  return `${day(a)} bis ${day(b)} ${b.getFullYear()}`;
}

function initCarousel(root, photos, title){
  const track = $('tTrack');
  track.innerHTML = photos.map((src, i) => `
    <figure class="carousel-slide">
      <img src="${esc(src)}" ${i === 0 ? '' : 'loading="lazy"'} alt="${esc(title)} – Foto ${i + 1}">
    </figure>`).join('');

  const slides = [...track.querySelectorAll('.carousel-slide')];
  const counter = root.querySelector('.carousel-counter');
  const dotsBox = root.querySelector('.carousel-dots');
  let i = 0;

  // Bei vielen Fotos wären Punkte unbrauchbar - dann reicht der Zähler.
  const useDots = slides.length <= 40;
  const dots = useDots ? slides.map((_, n) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'carousel-dot';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', `Foto ${n + 1}`);
    d.addEventListener('click', () => go(n));
    dotsBox.appendChild(d);
    return d;
  }) : [];

  function render(){
    track.style.transform = `translateX(${-i * 100}%)`;
    counter.textContent = `${i + 1} / ${slides.length}`;
    dots.forEach((d, n) => {
      d.classList.toggle('active', n === i);
      d.setAttribute('aria-selected', n === i ? 'true' : 'false');
    });
    [i - 1, i, i + 1].forEach(n => {
      if(n >= 0 && n < slides.length) slides[n].querySelector('img').loading = 'eager';
    });
  }
  function go(n){ i = (n + slides.length) % slides.length; render(); }

  root.querySelector('.prev').addEventListener('click', () => go(i - 1));
  root.querySelector('.next').addEventListener('click', () => go(i + 1));
  root.addEventListener('keydown', e => {
    if(e.key === 'ArrowLeft'){ go(i - 1); e.preventDefault(); }
    if(e.key === 'ArrowRight'){ go(i + 1); e.preventDefault(); }
  });

  let x0 = null;
  track.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive:true });
  track.addEventListener('touchend', e => {
    if(x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if(Math.abs(dx) > 45) go(dx < 0 ? i + 1 : i - 1);
    x0 = null;
  }, { passive:true });

  render();
}

async function init(){
  const sg = Number(new URLSearchParams(location.search).get('sg'));
  let games = [];
  try{
    games = await (await fetch('tournaments.json', { cache:'no-store' })).json();
  }catch{
    $('tFacts').innerHTML = '<span class="muted">Turnierdaten konnten nicht geladen werden.</span>';
    return;
  }

  const g = games.find(x => x.sg === sg) || games[games.length - 1];
  if(!g) return;

  document.title = `${g.title} (${g.year}) – Slaughter Games`;
  $('tTitle').textContent = `${g.title.toUpperCase()} (${g.year})`;
  $('tLogo').src = `Logos_x/SG_Logo_${g.sg}.png`;
  $('tLogo').onerror = () => { $('tLogo').src = 'main_logo.png'; };

  const facts = [
    `<span class="fact"><b>Wann</b>${esc(fmtRange(g.dateFrom, g.dateTo))}${g.dateGuessed ? ' <i>(ungeprüft)</i>' : ''}</span>`,
    `<span class="fact"><b>Wo</b>${g.location ? esc(g.location) : '<i>noch nicht hinterlegt</i>'}</span>`,
    `<span class="fact"><b>Teilnehmer</b>${g.players}</span>`,
    `<span class="fact"><b>Sieger</b>${esc(g.ranking[0]?.name || '-')}</span>`,
  ];
  $('tFacts').innerHTML = facts.join('');

  $('tSwitch').innerHTML = games.map(x =>
    `<a class="game-chip${x.sg === g.sg ? ' active' : ''}" href="turnier.html?sg=${x.sg}">SG${x.sg}</a>`
  ).join('');

  if(g.photos?.length){
    initCarousel($('tCarousel'), g.photos, `${g.title} ${g.year}`);
  }else{
    $('tPhotoSection').innerHTML = '<h2 class="ranking-title">FOTOS</h2>'
      + '<p class="muted" style="text-align:center">Für dieses Turnier sind noch keine Fotos hinterlegt.</p>';
  }

  $('tRanking').innerHTML = g.ranking.map(r => {
    const axe = r.axe
      ? `<img src="${AXE_IMG[r.axe][0]}" class="axe-icon" alt="${esc(AXE_IMG[r.axe][1])}" title="${esc(AXE_IMG[r.axe][1])}">`
      : '';
    return `
      <div class="ranking-item">
        <span class="rank">${r.place}</span>
        <span class="name"><a href="player-profile.html?slug=${encodeURIComponent(r.slug)}">${esc(r.name)}</a></span>
        ${axe}
      </div>`;
  }).join('');
}

init();
