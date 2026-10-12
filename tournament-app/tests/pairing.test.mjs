// Tests fuer die Swiss-Paarung.
//
//   node tournament-app/tests/pairing.test.mjs
//
// Gleiches Prinzip wie correction.test.mjs: die echte tournament.js wird mit
// einem In-Memory-Supabase-Stub geladen.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realSource = fs.readFileSync(path.join(here, '..', 'js', 'tournament.js'), 'utf8');
const stubUrl = pathToFileURL(path.join(here, 'supabase-stub.mjs')).href;
const shimPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-pair-')), 'tournament.mjs');
fs.writeFileSync(shimPath, realSource.replace("'./supabase-client.js'", JSON.stringify(stubUrl)));

const { db, resetDb } = await import(stubUrl);
const { generateNextRound } = await import(pathToFileURL(shimPath).href);

let pass = 0, fail = 0;
async function test(name, fn){
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const T = 't1';

// Baut ein Turnier aus bereits gespielten Runden auf.
// rounds: [[ [a, b, result], ... ], ...]  - Namen statt IDs
function seed(names, rounds, roundsTotal = 3){
  const id = n => 'p_' + n;
  const matches = [], opps = [], rws = [];
  rounds.forEach((games, ri) => {
    const rn = ri + 1;
    rws.push({ id: 'r' + rn, tournament_id: T, round_no: rn, finalized_at: '2026-10-08T18:00:00Z' });
    games.forEach(([a, b, result], ti) => {
      matches.push({ id: `m${rn}_${ti}`, tournament_id: T, round_id: 'r' + rn, round_no: rn,
        table_no: ti + 1, player_a_id: id(a), player_b_id: id(b), is_bye: false, result });
      opps.push({ tournament_id: T, player_id: id(a), opponent_id: id(b), round_no: rn });
      opps.push({ tournament_id: T, player_id: id(b), opponent_id: id(a), round_no: rn });
    });
  });
  resetDb({
    tournaments: [{ id: T, owner_id: 'u1', name: 'Test', rounds_total: roundsTotal,
      current_round: rounds.length, status: 'active', avoid_rematches: true, allow_bye: true }],
    players: names.map((n, i) => ({ id: id(n), tournament_id: T, name: n, seat: i + 1, dropped: false, had_bye: false })),
    rounds: rws, matches, player_opponents: opps, player_round_stats: [],
  });
}

function pairsOf(roundNo){
  const name = pid => pid.replace(/^p_/, '');
  return db.matches.filter(m => m.round_no === roundNo && !m.is_bye)
    .map(m => [name(m.player_a_id), name(m.player_b_id)].sort().join('-'));
}

function rematches(roundNo){
  const earlier = new Set(db.matches.filter(m => m.round_no < roundNo && !m.is_bye)
    .map(m => [m.player_a_id, m.player_b_id].sort().join('|')));
  return db.matches.filter(m => m.round_no === roundNo && !m.is_bye)
    .filter(m => earlier.has([m.player_a_id, m.player_b_id].sort().join('|')))
    .map(m => [m.player_a_id, m.player_b_id].map(p => p.replace(/^p_/, '')).sort().join('-'));
}

console.log('\nSwiss-Paarung\n');

// Exakt das Turnier "Thunderdraft FRA" vom 08.10.2026. Runde 3 hat dort
// Heber-Burni erneut gepaart, obwohl eine rematch-freie Runde existierte.
await test('Thunderdraft FRA: Runde 3 ohne Rematch', async () => {
  seed(['Felix', 'Simon', 'Heber', 'Raul', 'Burni', 'Vince'], [
    [['Felix', 'Simon', '0:2'], ['Heber', 'Raul', '0:2'], ['Burni', 'Vince', '0:2']],
    [['Raul', 'Simon', '1:2'], ['Vince', 'Felix', '0:2'], ['Burni', 'Heber', '1:2']],
  ]);
  const res = await generateNextRound(T);
  assert.equal(res.roundNo, 3);
  assert.deepEqual(rematches(3), [], `Rematch in Runde 3: ${rematches(3).join(', ')} (Paarung: ${pairsOf(3).join(', ')})`);
  assert.equal(res.rematchCount, 0);
});

await test('Thunderdraft FRA: der einzige 2:0-Spieler bleibt oben gepaart', async () => {
  seed(['Felix', 'Simon', 'Heber', 'Raul', 'Burni', 'Vince'], [
    [['Felix', 'Simon', '0:2'], ['Heber', 'Raul', '0:2'], ['Burni', 'Vince', '0:2']],
    [['Raul', 'Simon', '1:2'], ['Vince', 'Felix', '0:2'], ['Burni', 'Heber', '1:2']],
  ]);
  await generateNextRound(T);
  // Simon (6 Punkte) muss gegen einen 3-Punkte-Spieler, nicht gegen Burni (0).
  const simon = pairsOf(3).find(p => p.split('-').includes('Simon'));
  assert.ok(!simon.includes('Burni'), `Simon spielt gegen ${simon}`);
});

// Allgemeiner: 6 Spieler, 3 Runden, viele Ergebnisverlaeufe - nie ein
// vermeidbares Rematch. Bei 6 Spielern und 3 Runden gibt es IMMER eine
// rematch-freie dritte Runde (jeder hat erst 2 von 5 moeglichen Gegnern).
await test('6 Spieler: 200 zufaellige Verlaeufe, nie ein Rematch in Runde 3', async () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const results = ['2:0', '2:1', '1:2', '0:2'];
  let seedNo = 1;
  const rnd = () => { seedNo = (seedNo * 16807) % 2147483647; return seedNo / 2147483647; };

  for (let run = 0; run < 200; run++) {
    // Runde 1 zufaellig, Runde 2 von der App paaren lassen
    const order = [...names].sort(() => rnd() - 0.5);
    seed(names, [[
      [order[0], order[1], results[Math.floor(rnd() * 4)]],
      [order[2], order[3], results[Math.floor(rnd() * 4)]],
      [order[4], order[5], results[Math.floor(rnd() * 4)]],
    ]]);
    await generateNextRound(T);
    for (const m of db.matches.filter(x => x.round_no === 2)) m.result = results[Math.floor(rnd() * 4)];
    db.tournaments[0].current_round = 2;

    await generateNextRound(T);
    const r = rematches(3);
    assert.deepEqual(r, [], `Lauf ${run}: Rematch ${r.join(', ')}`);
  }
});

await test('8 Spieler: 200 zufaellige Verlaeufe, nie ein vermeidbares Rematch', async () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const results = ['2:0', '2:1', '1:2', '0:2'];
  let seedNo = 7;
  const rnd = () => { seedNo = (seedNo * 16807) % 2147483647; return seedNo / 2147483647; };

  for (let run = 0; run < 200; run++) {
    const order = [...names].sort(() => rnd() - 0.5);
    const r1 = [];
    for (let i = 0; i < 8; i += 2) r1.push([order[i], order[i + 1], results[Math.floor(rnd() * 4)]]);
    seed(names, [r1]);
    await generateNextRound(T);
    for (const m of db.matches.filter(x => x.round_no === 2)) m.result = results[Math.floor(rnd() * 4)];
    db.tournaments[0].current_round = 2;
    await generateNextRound(T);
    assert.deepEqual(rematches(3), [], `Lauf ${run}: Rematch ${rematches(3).join(', ')}`);
  }
});


// Die Suche darf Punktegruppen nur aufbrechen, wenn sonst ein Rematch kaeme.
await test('Ohne Rematch-Druck: Sieger spielen gegen Sieger', async () => {
  // 8 Spieler, nach R1 vier Sieger (A,C,E,G) und vier Verlierer
  seed(['A','B','C','D','E','F','G','H'], [
    [['A','B','2:0'], ['C','D','2:1'], ['E','F','2:0'], ['G','H','2:1']],
  ]);
  await generateNextRound(T);
  const winners = new Set(['A','C','E','G']);
  for (const p of pairsOf(2)) {
    const [x, y] = p.split('-');
    assert.equal(winners.has(x), winners.has(y), `Sieger gegen Verlierer gepaart: ${p}`);
  }
});

await test('Ungerade Siegergruppe: genau ein Sieger steigt ab, der Rest bleibt unter sich', async () => {
  // 6 Spieler, 3 Sieger - einer MUSS gegen einen Verlierer, das ist unvermeidbar
  seed(['A','B','C','D','E','F'], [
    [['A','B','2:0'], ['C','D','2:0'], ['E','F','2:0']],
  ]);
  await generateNextRound(T);
  const winners = new Set(['A','C','E']);
  const mixed = pairsOf(2).filter(p => { const [x,y] = p.split('-'); return winners.has(x) !== winners.has(y); });
  assert.equal(mixed.length, 1, `erwartet genau 1 Sieger-Verlierer-Paarung, waren: ${mixed.join(', ') || 'keine'}`);
});

await test('20 Spieler (SG-Groesse): 30 zufaellige 3-Runden-Turniere, schnell und ohne Rematch', async () => {
  const names = Array.from({ length: 20 }, (_, i) => 'P' + String(i).padStart(2, '0'));
  const results = ['2:0', '2:1', '1:2', '0:2'];
  let seedNo = 99;
  const rnd = () => { seedNo = (seedNo * 16807) % 2147483647; return seedNo / 2147483647; };
  const t0 = Date.now();
  let slowest = 0;

  for (let run = 0; run < 30; run++) {
    const order = [...names].sort(() => rnd() - 0.5);
    const r1 = [];
    for (let i = 0; i < 20; i += 2) r1.push([order[i], order[i + 1], results[Math.floor(rnd() * 4)]]);
    seed(names, [r1]);
    for (const rn of [2, 3]) {
      if (rn === 3) {
        for (const m of db.matches.filter(x => x.round_no === 2)) m.result = results[Math.floor(rnd() * 4)];
        db.tournaments[0].current_round = 2;
      }
      const s0 = Date.now();
      await generateNextRound(T);
      slowest = Math.max(slowest, Date.now() - s0);
      assert.deepEqual(rematches(rn), [], `Lauf ${run} R${rn}: Rematch ${rematches(rn).join(', ')}`);
    }
  }
  console.log(`       (${Date.now() - t0} ms gesamt, langsamste Runde ${slowest} ms)`);
  assert.ok(slowest < 2000, `zu langsam: ${slowest} ms fuer eine Runde`);
});


await test('Bracket-Finalrunde laeuft weiterhin (Thunderdraft-Stand)', async () => {
  seed(['Felix', 'Simon', 'Heber', 'Raul', 'Burni', 'Vince'], [
    [['Felix', 'Simon', '0:2'], ['Heber', 'Raul', '0:2'], ['Burni', 'Vince', '0:2']],
    [['Raul', 'Simon', '1:2'], ['Vince', 'Felix', '0:2'], ['Burni', 'Heber', '1:2']],
  ]);
  const res = await generateNextRound(T, { finalRoundMode: 'bracket' });
  assert.equal(pairsOf(3).length, 3, 'Runde 3 muss 3 Tische haben');
  assert.deepEqual(rematches(3), [], `Rematch im Bracket-Modus: ${rematches(3).join(', ')}`);
  assert.ok(['bracket', 'swiss'].includes(res.finalRoundModeUsed));
});

await test('Ungerade Spielerzahl: Bye wird vergeben, Rest ohne Rematch', async () => {
  seed(['A','B','C','D','E','F','G'], [
    [['A','B','2:0'], ['C','D','2:0'], ['E','F','2:0']],
  ]);
  db.matches.push({ id: 'bye1', tournament_id: T, round_id: 'r1', round_no: 1, table_no: 4,
    player_a_id: 'p_G', player_b_id: null, is_bye: true, result: 'BYE' });
  db.players.find(p => p.id === 'p_G').had_bye = true;
  await generateNextRound(T);
  const r2 = db.matches.filter(m => m.round_no === 2);
  assert.equal(r2.filter(m => m.is_bye).length, 1, 'genau ein Bye');
  assert.notEqual(r2.find(m => m.is_bye).player_a_id, 'p_G', 'G hatte schon ein Bye');
  assert.deepEqual(rematches(2), []);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exitCode = fail ? 1 : 0;
