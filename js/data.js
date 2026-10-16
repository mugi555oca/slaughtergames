// Statische Inhalte der Seite an einer Stelle. Turnierergebnisse kommen aus
// /tournaments.json (generiert, siehe HANDOVER.md).

export const AXES = {
  M: { img: '/SLG_Shirts_axe_mythic.png',   label: 'Mythic Axt' },
  R: { img: '/SLG_Shirts_axe_rare.png',     label: 'Rare Axt' },
  U: { img: '/SLG_Shirts_axe_uncommon.png', label: 'Uncommon Axt' },
  C: { img: '/SLG_Shirts_axe_common.png',   label: 'Common Axt' },
};
export const AXE_ORDER = { M: 0, R: 1, U: 2, C: 3 };

export const sgLogo = sg => sg <= 6 ? `/Logos_x/SG_Logo_${sg}.png` : '/icons/logo-160.webp';

export const NEXT_EVENT = {
  sg: 7,
  title: 'Slaughter Games 7',
  dateFrom: '2027-05-13',
  dateTo: '2027-05-17',
  dateLabel: 'Do 13. – Mo 17. Mai 2027',
  roster: ['david','simon','hansi','vinc','heber','fabi','osti','felix','marc','burni',
           'frido','silvio','ivo','maugi555-gmail','leo','niki','wenzl','raul','luki','paul'],
  wobblers: ['wenzl'],
  waiting: ['Klaus Jöns', 'Patrick Tomilitsch'],
};

export const GRAND_SLAUGHTERER = { slug: 'david', year: 2026, sub: 'Sieger Slaughter Games 6' };

export const POSTS = [
  { href: '/blog_posts/post_3.html', date: '2026-09-22', img: '/assets/sg6_fotos/sg6_01.jpg',
    title: 'Slaughter Games VI – Ein fulminantes Pfingstturnier in der Steiermark',
    teaser: '20 Mann. Fünf Autos. Neun Runden. Fünf Tage Magic. Und am Ende ein neuer Name auf der Axt!' },
  { href: '/blog_posts/post_2.html', date: '2026-03-17', img: '/assets/sg6_pick_craziness.jpg',
    title: 'Pick-Craziness total',
    teaser: 'Der SG6-Draft zum Seat-Picking ist im vollen Gange – die Top 4 sitzen alle im selben Pod.' },
  { href: '/blog_posts/post_1.html', date: '2026-03-12', img: '/assets/sg6_draft_announcement.jpg',
    title: 'Axt-ion pur: Der erste Seat-Draft für Slaughter Games 6 startet!',
    teaser: 'Zum allerersten Mal starten wir mit einem Seat-Draft.' },
];

export const CUBES = [
  ['Pauper Cube', 'https://cubecobra.com/cube/overview/1bsx6'],
  ['Blube', 'https://cubecobra.com/cube/overview/46ssl'],
  ['Multicolor', 'https://cubecobra.com/cube/overview/1d6458da-b8d6-42a8-8640-ad269fa63a1a'],
  ['Silvios Cube', 'https://cubecobra.com/cube/overview/34f834ea-1ffd-44a0-bb09-ba596586c1db'],
  ['Uncommon Cube', 'https://cubecobra.com/cube/list/6162fbf5e5383b103524a998'],
  ['Oldboarder Bube', 'https://cubecobra.com/cube/list/9a824baa-9ef2-4d88-8569-ef689917f773'],
  ['Shube', 'https://cubecobra.com/cube/list/0ec8230d-6037-483c-91da-47f84aa64839'],
];

const P = '/assets/merch/products/';
export const MERCH = [
  { group: 'Shirts', items: [
    [P + 'shirt_sg6_front.webp', 'SG6 Shirt vorne'], [P + 'shirt_sg6_back.webp', 'SG6 Shirt hinten'],
    [P + 'shirt_sg5_front.webp', 'SG5 Shirt vorne'], [P + 'shirt_sg5_back.webp', 'SG5 Shirt hinten – Waiting Room'],
    [P + 'shirt_sg3.webp', 'SG3 Shirt vorne'], [P + 'shirt_sg3_back.webp', 'SG3 Shirt hinten'],
    [P + 'shirt_nr1.webp', 'Shirt Nr. 1'], [P + 'shirt_abyss.webp', 'Shirt „The Abyss – You’re Next!“'],
    [P + 'shirt_enough.webp', 'Shirt „For You, it might be enough.“'],
  ]},
  { group: 'Krüge & Tassen', items: [
    [P + 'krug_sg5.webp', 'Bierkrug SG5'], [P + 'krug_ostibot.webp', 'Bierkrug „Ostibot, from another Kingdom“'],
    [P + 'krug_leogoyf.webp', 'Bierkrug „Leogoyf“'], [P + 'tasse_toth.webp', 'Tasse „Top of the Hill“'],
  ]},
  { group: 'Taschen', items: [
    [P + 'tasche_sg6_schwarz.webp', 'Stofftasche SG6 – schwarz'], [P + 'tasche_sg6_pink.webp', 'Stofftasche SG6 – pink'],
    [P + 'tasche_sg5_schwarz.webp', 'Stofftasche SG5 – schwarz'], [P + 'tasche_sg5_natur.webp', 'Stofftasche SG5 – natur'],
  ]},
  { group: 'Caps, Hüte & Socken', items: [
    [P + 'hut_toth.webp', 'Bucket Hat „Top of the Hill“'], [P + 'cap_kuechenchef.webp', 'Cap „Küchenchef“'],
    [P + 'visor_grandpunter.webp', 'Visor „Grand Punter“'], [P + 'socken_sg6.webp', 'SG6 Socken'],
  ]},
  { group: 'Playmats', items: [2021, 2022, 2023, 2024, 2025, 2026].map(y =>
    [`/assets/merch/playmat_${y}.jpg`, `Playmat ${y}`, `/assets/merch/playmat_${y}_t.jpg`]) },
];

let tournamentsPromise = null;
export function loadTournaments(){
  if(!tournamentsPromise){
    tournamentsPromise = fetch('/tournaments.json').then(r => r.json());
  }
  return tournamentsPromise;
}

// Eternal Ranking: E = ΣP / √(2·n·N / (n+N)),  P = (Teilnehmer + 1) − Platz
// Formel siehe ETERNAL_RANKING_FORMEL.md
export function eternalRanking(tournaments){
  const N = tournaments.length;
  const by = new Map();
  for(const t of tournaments){
    for(const r of t.ranking){
      const o = by.get(r.slug) || { slug: r.slug, name: r.name, sum: 0, n: 0, axes: [], places: [] };
      o.sum += (t.players + 1) - r.place;
      o.n += 1;
      o.places.push({ sg: t.sg, place: r.place });
      if(r.axe) o.axes.push(r.axe);
      by.set(r.slug, o);
    }
  }
  return [...by.values()]
    .map(o => ({ ...o, E: o.sum / Math.sqrt(2 * o.n * N / (o.n + N)),
                 axes: o.axes.sort((a, b) => AXE_ORDER[a] - AXE_ORDER[b]) }))
    .sort((a, b) => b.E - a.E);
}

export function axesHtml(axes){
  return axes.length
    ? `<span class="axes">${axes.map(a => `<img src="${AXES[a].img}" alt="${AXES[a].label}" title="${AXES[a].label}">`).join('')}</span>`
    : '';
}
