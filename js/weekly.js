// Weekly-Statistik: Rankings ueber alle abgeschlossenen Weeklys und die
// persoenliche Performance-Kurve. Rechnet direkt aus matches (wie die
// Turnierseite), damit Korrekturen sofort durchschlagen.
import { supabase, esc, loadPeople, personForName } from './app.js';
import { buildStandings } from '../tournament-app/js/tournament.js';
import { formatLabel } from '../tournament-app/js/t-shared.js';

let cache = null;

export function loadWeekly(){
  if(!cache){
    cache = (async () => {
      const { data: ts, error } = await supabase.from('tournaments')
        .select('id,name,created_at,format_key,edi_code,current_round,rounds_total,status')
        .eq('status', 'finished').gt('current_round', 0).order('created_at');
      if(error) throw error;
      const ids = ts.map(t => t.id);
      if(!ids.length) return { events: [], people: await loadPeople() };
      const [{ data: players }, { data: matches }, people] = await Promise.all([
        supabase.from('players').select('id,tournament_id,name,slug,dropped,had_bye').in('tournament_id', ids),
        supabase.from('matches').select('tournament_id,round_no,player_a_id,player_b_id,result,is_bye').in('tournament_id', ids),
        loadPeople(),
      ]);
      const events = ts.map(t => {
        const ps = players.filter(p => p.tournament_id === t.id);
        const st = buildStandings(ps, matches.filter(x => x.tournament_id === t.id), t.current_round);
        const rows = st.map((s, i) => {
          const pl = ps.find(p => p.id === s.id);
          const person = (pl.slug && people.bySlug.get(pl.slug)) || personForName(people, pl.name);
          const rounds = s.wins + s.losses + s.draws;
          return { key: person?.slug || 'name:' + pl.name, person, name: pl.name, place: i + 1,
                   points: s.matchPoints, rounds, record: `${s.wins}-${s.losses}-${s.draws}` };
        });
        return { ...t, rows, size: rows.length };
      });
      return { events, people };
    })();
  }
  return cache;
}

// Rankings fuer einen Format-Filter (null = alle)
export function weeklyRanking(data, format = null){
  const evs = data.events.filter(e => !format || e.format_key === format);
  const N = evs.length;
  const by = new Map();
  for(const e of evs){
    for(const r of e.rows){
      const o = by.get(r.key) || { key: r.key, person: r.person, name: r.name, n: 0, rounds: 0, points: 0, wins: 0 };
      o.n++; o.rounds += r.rounds; o.points += r.points;
      if(r.place === 1) o.wins++;
      by.set(r.key, o);
    }
  }
  return [...by.values()].map(o => ({
    ...o,
    avg: o.rounds ? o.points / o.rounds : 0,
    // wie das Eternal Ranking: Punkte / √(harmonisches Mittel aus Teilnahmen und Weeklys gesamt)
    score: o.points / Math.sqrt(2 * o.n * N / (o.n + N)),
  }));
}

export function historyFor(data, slug, format = null){
  return data.events
    .filter(e => !format || e.format_key === format)
    .map(e => ({ e, r: e.rows.find(r => r.key === slug) }))
    .filter(x => x.r && x.r.rounds)
    .map(({ e, r }) => ({ id: e.id, name: e.name, date: e.created_at, format: e.format_key, edi: e.edi_code,
      avg: r.points / r.rounds, points: r.points, rounds: r.rounds, place: r.place, of: e.size, record: r.record }));
}

export function formatsOf(data, slug = null){
  const set = new Set(data.events.filter(e => !slug || e.rows.some(r => r.key === slug)).map(e => e.format_key));
  return [...set];
}

const fmtNum = (v, d = 2) => v.toLocaleString('de-AT', { minimumFractionDigits: d, maximumFractionDigits: d });
export { fmtNum };

// ---------------------------------------------------------------
// Performance-Kurve: Ø Punkte pro Runde je Weekly + gleitender Trend
// ---------------------------------------------------------------
export function renderCurve(host, hist){
  if(hist.length < 2){
    host.innerHTML = `<div class="card empty" style="padding:24px"><h3>Noch zu wenig Daten</h3><p>Ab zwei Weeklys gibt's hier eine Kurve.</p></div>`;
    return;
  }
  const W = Math.max(300, Math.round(host.clientWidth || 340)), H = 220, L = 28, R = 12, T = 14, B = 28;
  const x = i => L + (hist.length === 1 ? 0 : i * (W - L - R) / (hist.length - 1));
  const y = v => T + (3 - v) * (H - T - B) / 3;
  const trend = hist.map((_, i) => { const w = hist.slice(Math.max(0, i - 2), i + 1); return w.reduce((s, h) => s + h.avg, 0) / w.length; });
  const path = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path(hist.map(h => h.avg))}L${x(hist.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const step = Math.ceil(hist.length / 5);
  const xl = hist.map((h, i) => (i % step === 0 || i === hist.length - 1)
    ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${new Date(h.date).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}</text>` : '').join('');

  host.innerHTML = `
    <div class="curve">
      <div class="curve-legend"><span><i class="lg-line"></i>Ø Punkte/Runde je Weekly</span><span><i class="lg-trend"></i>Trend (letzte 3)</span></div>
      <div class="curve-box">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Performance-Kurve">
          <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4b3e" stop-opacity=".28"/><stop offset="1" stop-color="#ff4b3e" stop-opacity="0"/></linearGradient></defs>
          ${[0, 1, 2, 3].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ylab" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
          <path d="${area}" fill="url(#cg)"/>
          <path d="${path(hist.map(h => h.avg))}" class="ln"/>
          <path d="${path(trend)}" class="tr"/>
          ${hist.map((h, i) => `<circle cx="${x(i)}" cy="${y(h.avg)}" r="4.5" class="dot ${h.place === 1 ? 'win' : ''}"/>`).join('')}
          <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
          <g class="xlab">${xl}</g>
        </svg>
        <div class="curve-tip" hidden></div>
      </div>
    </div>`;

  const box = host.querySelector('.curve-box');
  const svg = box.querySelector('svg');
  const tip = box.querySelector('.curve-tip');
  const cross = svg.querySelector('.cross');
  const dots = [...svg.querySelectorAll('.dot')];
  const show = clientX => {
    const rect = svg.getBoundingClientRect();
    const vx = (clientX - rect.left) / rect.width * W;
    let i = Math.round((vx - L) / ((W - L - R) / (hist.length - 1)));
    i = Math.max(0, Math.min(hist.length - 1, i));
    const h = hist[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(h.name)}</b><span>${new Date(h.date).toLocaleDateString('de-AT')} · ${esc(formatLabel(h.format))}${h.edi ? ' ' + esc(h.edi) : ''}</span>
      <span><b>${fmtNum(h.avg)}</b> Ø/Runde · ${h.points} Pkt · ${h.record}</span><span>Platz ${h.place} von ${h.of}</span>`;
    const px = x(i) / W * rect.width;
    tip.style.left = `${Math.min(Math.max(px, 90), rect.width - 90)}px`;
  };
  box.addEventListener('pointermove', e => show(e.clientX));
  box.addEventListener('pointerdown', e => show(e.clientX));
  box.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.classList.remove('on')); });
}

// Kopfzahlen + Formatfilter + Kurve in einem Block
export function renderPerformance(host, data, slug){
  const formats = formatsOf(data, slug);
  let fmt = null;
  function paint(){
    const hist = historyFor(data, slug, fmt);
    const all = weeklyRanking(data, fmt);
    const me = all.find(r => r.key === slug);
    const sorted = [...all].sort((a, b) => b.score - a.score);
    const rank = me ? sorted.findIndex(r => r.key === slug) + 1 : null;
    const last = hist.slice(-3), prev = hist.slice(0, -3);
    const avgOf = a => a.reduce((s, h) => s + h.avg, 0) / (a.length || 1);
    const delta = prev.length && last.length ? avgOf(last) - avgOf(prev) : null;
    host.innerHTML = `
      ${formats.length > 1 ? `<div class="seg mb" data-fmt>${['', ...formats].map(f => `<button data-f="${f}" class="${(f || null) === fmt ? 'on' : ''}">${f ? esc(formatLabel(f)) : 'Alle'}</button>`).join('')}</div>` : ''}
      ${me ? `<div class="stat-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat"><b>${me.n}</b><span>Weeklys</span></div>
        <div class="stat"><b>${fmtNum(me.avg)}</b><span>Ø / Runde</span></div>
        <div class="stat"><b>${me.wins}</b><span>Siege</span></div>
        <div class="stat"><b>${rank}.</b><span>Wertung</span></div>
      </div>
      ${delta !== null ? `<p class="small mt" style="color:${delta >= 0 ? '#7ee2a8' : '#ff8a80'};font-weight:700">${delta >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(delta))} Ø/Runde in den letzten 3 Weeklys gegenüber davor</p>` : ''}
      <div class="mt" data-curve></div>` : '<div class="card muted">Noch kein abgeschlossenes Weekly.</div>'}`;
    if(me) renderCurve(host.querySelector('[data-curve]'), hist);
    host.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { fmt = b.dataset.f || null; paint(); }));
  }
  paint();
}
