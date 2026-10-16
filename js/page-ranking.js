import { initShell, $, $$, esc, loadPeople, openSheet } from './app.js';
import { loadTournaments, eternalRanking, axesHtml, sgLogo, NEXT_EVENT } from './data.js';

await initShell({ tab: 'ranking' });

const [tournaments, people] = await Promise.all([loadTournaments(), loadPeople()]);
const person = slug => people.bySlug.get(slug);
const ranking = eternalRanking(tournaments);

// ---------- Umschalter ----------
function show(view){
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#viewEternal').hidden = view !== 'eternal';
  $('#viewEvents').hidden = view !== 'events';
  history.replaceState(null, '', view === 'events' ? '#turniere' : location.pathname);
}
$$('.seg button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
if(location.hash === '#turniere') show('events');

// ---------- Podium + Liste ----------
const top = ranking.slice(0, 3);
const pod = (r, cls, no) => {
  const p = person(r.slug);
  return `<a class="${cls}" href="/player-profile.html?slug=${encodeURIComponent(r.slug)}">
    <img class="avatar" src="${esc(p?.avatar)}" alt="">
    <span class="nm">${esc(p?.real || r.name)}</span>
    <span class="step">${no}</span></a>`;
};
$('#podium').innerHTML = `<div class="podium">${pod(top[1], 'p2', 2)}${pod(top[0], 'p1', 1)}${pod(top[2], 'p3', 3)}</div>`;

$('#eternal').innerHTML = ranking.map((r, i) => {
  const p = person(r.slug);
  return `<a class="rank-row" href="/player-profile.html?slug=${encodeURIComponent(r.slug)}">
    <span class="rank-no">${i + 1}</span>
    <img class="avatar sm" src="${esc(p?.avatar)}" alt="" loading="lazy">
    <span class="who"><span class="title">${esc(p?.name || r.name)}</span>${axesHtml(r.axes)}</span>
    <span class="pts">${r.E.toFixed(2)}<small>${r.n}× · ${r.sum} P</small></span>
  </a>`;
}).join('');

$('#formulaBtn').addEventListener('click', () => {
  const N = tournaments.length;
  const d = ranking.find(r => r.slug === 'david') || ranking[0];
  openSheet(`<h3>Wie entsteht das Eternal Ranking?</h3>
    <div class="stack">
      <div class="card"><b>1 · Punkte pro Turnier</b><p class="small muted mt">Platz 1 bekommt so viele Punkte, wie Spieler am Start waren – jeder Platz danach einen weniger, der Letzte bekommt 1.</p></div>
      <div class="card"><b>2 · Eternal-Punkte</b>
        <p class="mt" style="font-size:18px;text-align:center">E = ΣP / √( 2·n·N / (n+N) )</p>
        <p class="small muted mt"><b>n</b> = deine Teilnahmen, <b>N</b> = Turniere insgesamt (${N}). Geteilt wird durch die Wurzel aus dem harmonischen Mittel von n und N – wer selten dabei war, wird durch eine kleinere Zahl geteilt.</p></div>
      <div class="card"><b>3 · Beispiel ${esc(person(d.slug)?.real || d.name)}</b>
        <p class="small muted mt">${d.sum} Punkte aus n = ${d.n} Turnieren → E = ${d.sum} / √(2·${d.n}·${N}/${d.n + N}) = <b style="color:var(--text)">${d.E.toFixed(2)}</b></p></div>
    </div>
    <button class="btn block ghost mt" data-close>Schließen</button>`);
});

// ---------- Turniere ----------
const ev = [...tournaments].sort((a, b) => b.sg - a.sg);
$('#events').innerHTML = `
  <a class="event-card next" href="/turnier.html?sg=${NEXT_EVENT.sg}">
    <span class="chip gold" style="align-self:flex-start">Coming up</span>
    <div class="t display" style="font-size:24px;font-weight:400">${esc(NEXT_EVENT.title)}</div>
    <div class="s">${esc(NEXT_EVENT.dateLabel)} · ${NEXT_EVENT.roster.length} Spieler</div>
  </a>` + ev.map(t => {
  const w = person(t.ranking[0]?.slug);
  return `<a class="event-card" href="/turnier.html?sg=${t.sg}">
    <img class="logo" src="${sgLogo(t.sg)}" alt="" loading="lazy">
    <div class="t">${esc(t.title)}</div>
    <div class="s">${t.year} · ${esc(t.location || '')}</div>
    <div class="row" style="gap:6px;margin-top:auto"><img class="avatar xs" src="${esc(w?.avatar)}" alt="">
      <span class="small ellipsis">${esc(w?.real || t.ranking[0]?.name || '')}</span></div>
  </a>`;
}).join('');
