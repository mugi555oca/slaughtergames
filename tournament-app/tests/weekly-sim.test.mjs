// Simulation: viele zufaellige 3-Runden-Weeklys (7-10 Spieler, Random- und
// Cross-Start). Prueft, dass es NIE ein Rematch gibt und dass Runde 2/3
// nach Tabelle gepaart werden (Tabellenerster spielt gegen den Bestplatzierten,
// gegen den er noch nicht gespielt hat).
//
//   node tournament-app/tests/weekly-sim.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realSource = fs.readFileSync(path.join(here, '..', 'js', 'tournament.js'), 'utf8');
const stubUrl = pathToFileURL(path.join(here, 'supabase-stub.mjs')).href;
const shimPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-sim-')), 'tournament.mjs');
fs.writeFileSync(shimPath, realSource.replace("'./supabase-client.js'", JSON.stringify(stubUrl)));

const { db, resetDb } = await import(stubUrl);
const { generateNextRound, finalizeCurrentRound, buildStandings } = await import(pathToFileURL(shimPath).href);

const RESULTS = ['2:0', '2:1', '1:2', '0:2', '2:0', '0:2', '1:1'];
const T = 't1';
let runs = 0, rematchCount = 0, topNotBest = 0;

for(let run = 0; run < 400; run++){
  const n = 7 + (run % 4);                       // 7, 8, 9, 10 Spieler
  resetDb({
    tournaments: [{ id: T, owner_id: 'u1', name: 'Sim', rounds_total: 3, current_round: 0,
      status: 'active', avoid_rematches: true, allow_bye: true }],
    players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, tournament_id: T, name: 'P' + i, seat: i + 1, dropped: false, had_bye: false })),
    rounds: [], matches: [], player_opponents: [], player_round_stats: [],
  });
  const firstRoundMode = run % 2 ? 'cross' : 'random';
  for(let r = 1; r <= 3; r++){
    // Vor Runde 2/3: Tabellenstand merken, um die Paarung zu pruefen
    const before = r > 1 ? buildStandings(db.players, db.matches, r - 1) : null;
    await generateNextRound(T, { firstRoundMode, finalRoundMode: 'swiss' });
    const ms = db.matches.filter(m => m.round_no === r);
    const seen = new Set();
    for(const m of db.matches.filter(x => x.round_no < r && !x.is_bye)) seen.add([m.player_a_id, m.player_b_id].sort().join());
    for(const m of ms.filter(x => !x.is_bye)) if(seen.has([m.player_a_id, m.player_b_id].sort().join())) rematchCount++;
    if(before){
      // Tabellenerster (ohne Bye) muss gegen den Bestplatzierten spielen, gegen den kein Rematch waere
      const leader = before.find(s => ms.some(m => !m.is_bye && (m.player_a_id === s.id || m.player_b_id === s.id)));
      const opp = ms.find(m => m.player_a_id === leader.id || m.player_b_id === leader.id);
      const oppId = opp.player_a_id === leader.id ? opp.player_b_id : opp.player_a_id;
      const best = before.find(s => s.id !== leader.id && !seen.has([leader.id, s.id].sort().join())
        && ms.some(m => !m.is_bye && (m.player_a_id === s.id || m.player_b_id === s.id)));
      if(best && best.matchPoints !== before.find(s => s.id === oppId).matchPoints) topNotBest++;
    }
    for(const m of ms) if(m.result === 'pending') m.result = RESULTS[Math.floor(Math.random() * RESULTS.length)];
    await finalizeCurrentRound(T);
  }
  runs++;
}

console.log(`${runs} Weeklys simuliert · Rematches: ${rematchCount} · Tabellenerster nicht gegen Punktgleichen/Besten: ${topNotBest}`);
assert.equal(rematchCount, 0, 'Es gab Rematches');
console.log('ok');
