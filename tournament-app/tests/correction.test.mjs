import assert from 'node:assert/strict';
// Tests fuer die Ergebnis-Korrektur der Turnier-App.
//
//   node tournament-app/tests/correction.test.mjs
//
// Laeuft ohne Supabase: der Stub in ./supabase-stub.mjs haelt die Tabellen im
// Speicher. Damit die echte tournament.js getestet wird (und nicht eine Kopie,
// die veraltet), wird sie zur Laufzeit gelesen und nur ihr Import des
// Supabase-Clients auf den Stub umgebogen.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realSource = fs.readFileSync(path.join(here, '..', 'js', 'tournament.js'), 'utf8');
const stubUrl = pathToFileURL(path.join(here, 'supabase-stub.mjs')).href;
const shimPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-tourney-')), 'tournament.mjs');
fs.writeFileSync(shimPath, realSource.replace("'./supabase-client.js'", JSON.stringify(stubUrl)));

const { db, resetDb } = await import(stubUrl);
const {
  correctMatchResult,
  recomputeSnapshotsFrom,
  resetRoundsAfter,
  reopenTournament,
  finalizeCurrentRound,
  getLiveStandings,
} = await import(pathToFileURL(shimPath).href);

const T = 't1';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// 4 players, 2 rounds, both finalized.
function seed() {
  resetDb({
    tournaments: [{ id: T, owner_id: 'u1', name: 'SG Test', rounds_total: 3, current_round: 2, status: 'active', avoid_rematches: true, allow_bye: true }],
    players: [
      { id: 'pA', tournament_id: T, name: 'Anna', seat: 1, dropped: false, had_bye: false },
      { id: 'pB', tournament_id: T, name: 'Bert', seat: 2, dropped: false, had_bye: false },
      { id: 'pC', tournament_id: T, name: 'Cleo', seat: 3, dropped: false, had_bye: false },
      { id: 'pD', tournament_id: T, name: 'Dora', seat: 4, dropped: false, had_bye: false },
    ],
    rounds: [
      { id: 'r1', tournament_id: T, round_no: 1, finalized_at: '2026-01-01T10:00:00Z' },
      { id: 'r2', tournament_id: T, round_no: 2, finalized_at: '2026-01-01T11:00:00Z' },
    ],
    matches: [
      { id: 'm1', tournament_id: T, round_id: 'r1', round_no: 1, table_no: 1, player_a_id: 'pA', player_b_id: 'pB', is_bye: false, result: '2:0' },
      { id: 'm2', tournament_id: T, round_id: 'r1', round_no: 1, table_no: 2, player_a_id: 'pC', player_b_id: 'pD', is_bye: false, result: '2:1' },
      { id: 'm3', tournament_id: T, round_id: 'r2', round_no: 2, table_no: 1, player_a_id: 'pA', player_b_id: 'pC', is_bye: false, result: '2:0' },
      { id: 'm4', tournament_id: T, round_id: 'r2', round_no: 2, table_no: 2, player_a_id: 'pB', player_b_id: 'pD', is_bye: false, result: '0:2' },
    ],
    player_opponents: [
      { tournament_id: T, player_id: 'pA', opponent_id: 'pB', round_no: 1 },
      { tournament_id: T, player_id: 'pB', opponent_id: 'pA', round_no: 1 },
      { tournament_id: T, player_id: 'pC', opponent_id: 'pD', round_no: 1 },
      { tournament_id: T, player_id: 'pD', opponent_id: 'pC', round_no: 1 },
      { tournament_id: T, player_id: 'pA', opponent_id: 'pC', round_no: 2 },
      { tournament_id: T, player_id: 'pC', opponent_id: 'pA', round_no: 2 },
      { tournament_id: T, player_id: 'pB', opponent_id: 'pD', round_no: 2 },
      { tournament_id: T, player_id: 'pD', opponent_id: 'pB', round_no: 2 },
    ],
    player_round_stats: [],
  });
}

const snap = (pid, rn) => db.player_round_stats.find(s => s.player_id === pid && s.round_no === rn);

console.log('\nErgebnis-Korrektur\n');

await test('Setup: beide Runden finalisiert, Snapshots vorhanden', async () => {
  seed();
  db.tournaments[0].current_round = 1;
  await finalizeCurrentRound(T);
  db.tournaments[0].current_round = 2;
  await finalizeCurrentRound(T);
  assert.equal(snap('pA', 1).match_points, 3);
  assert.equal(snap('pA', 2).match_points, 6);
  assert.equal(snap('pB', 2).match_points, 0);
});

await test('Korrektur in Runde 1 schreibt Snapshots beider Runden neu', async () => {
  // Anna gewann R1 - in Wahrheit gewann Bert.
  const res = await correctMatchResult('m1', '0:2');
  assert.equal(res.changed, true);
  assert.deepEqual(res.refreshedRounds, [1, 2]);
  assert.equal(snap('pA', 1).match_points, 0, 'Anna R1 muss auf 0 fallen');
  assert.equal(snap('pB', 1).match_points, 3, 'Bert R1 muss auf 3 steigen');
  assert.equal(snap('pA', 2).match_points, 3, 'Anna R2: nur noch der R2-Sieg');
  assert.equal(snap('pB', 2).match_points, 3, 'Bert R2: R1-Sieg, R2-Niederlage');
});

await test('Live-Standings stimmen mit dem korrigierten Snapshot ueberein', async () => {
  const live = await getLiveStandings(T);
  const byName = Object.fromEntries(live.map(s => [s.name, s]));
  assert.equal(byName.Anna.matchPoints, snap('pA', 2).match_points);
  assert.equal(byName.Bert.matchPoints, snap('pB', 2).match_points);
  assert.equal(byName.Dora.matchPoints, snap('pD', 2).match_points);
});

await test('Gleiches Ergebnis erneut setzen ist ein No-op', async () => {
  const res = await correctMatchResult('m1', '0:2');
  assert.equal(res.changed, false);
  assert.deepEqual(res.refreshedRounds, []);
});

await test('Bye laesst sich nicht in ein normales Ergebnis aendern', async () => {
  seed();
  db.matches.push({ id: 'mb', tournament_id: T, round_id: 'r2', round_no: 2, table_no: 3, player_a_id: 'pD', player_b_id: null, is_bye: true, result: 'BYE' });
  await assert.rejects(() => correctMatchResult('mb', '2:0'), /Bye/);
  await assert.rejects(() => correctMatchResult('m1', 'BYE'), /Bye-Match/);
});

await test('Ungueltiges Ergebnis wird abgelehnt', async () => {
  await assert.rejects(() => correctMatchResult('m1', '5:0'), /Ungueltiges Ergebnis/);
});

await test('recomputeSnapshotsFrom legt keine Snapshots fuer nicht finalisierte Runden an', async () => {
  seed();
  db.tournaments[0].current_round = 1;
  await finalizeCurrentRound(T);          // nur Runde 1 hat einen Snapshot
  db.tournaments[0].current_round = 2;    // Runde 2 laeuft, nicht finalisiert
  const refreshed = await recomputeSnapshotsFrom(T, 1);
  assert.deepEqual(refreshed, [1]);
  assert.equal(db.player_round_stats.filter(s => s.round_no === 2).length, 0);
});

console.log('\nRunden zuruecksetzen\n');

await test('resetRoundsAfter loescht Runde 2 komplett und setzt current_round zurueck', async () => {
  seed();
  db.tournaments[0].current_round = 1;
  await finalizeCurrentRound(T);
  db.tournaments[0].current_round = 2;
  await finalizeCurrentRound(T);

  const res = await resetRoundsAfter(T, 1);
  assert.equal(res.removedRounds, 1);
  assert.equal(db.tournaments[0].current_round, 1);
  assert.equal(db.matches.filter(m => m.round_no > 1).length, 0, 'Matches von R2 weg');
  assert.equal(db.rounds.filter(r => r.round_no > 1).length, 0, 'Runde R2 weg');
  assert.equal(db.player_opponents.filter(o => o.round_no > 1).length, 0, 'Gegner-Graph R2 weg');
  assert.equal(db.player_round_stats.filter(s => s.round_no > 1).length, 0, 'Snapshot R2 weg');
  assert.equal(db.matches.filter(m => m.round_no === 1).length, 2, 'Runde 1 bleibt unangetastet');
  assert.equal(snap('pA', 1).match_points, 3, 'Snapshot R1 bleibt korrekt');
});

await test('resetRoundsAfter setzt had_bye aus den verbliebenen Runden neu', async () => {
  seed();
  // Dora bekam in Runde 2 das Bye.
  db.matches.push({ id: 'mb', tournament_id: T, round_id: 'r2', round_no: 2, table_no: 3, player_a_id: 'pD', player_b_id: null, is_bye: true, result: 'BYE' });
  db.players.find(p => p.id === 'pD').had_bye = true;

  await resetRoundsAfter(T, 1);
  assert.equal(db.players.find(p => p.id === 'pD').had_bye, false,
    'had_bye muss zurueckgesetzt werden, sonst bekommt Dora nie wieder ein Bye');
});

await test('resetRoundsAfter behaelt had_bye, wenn das Bye in einer bleibenden Runde lag', async () => {
  seed();
  db.matches.push({ id: 'mb', tournament_id: T, round_id: 'r1', round_no: 1, table_no: 3, player_a_id: 'pC', player_b_id: null, is_bye: true, result: 'BYE' });
  db.players.find(p => p.id === 'pC').had_bye = true;

  await resetRoundsAfter(T, 1);
  assert.equal(db.players.find(p => p.id === 'pC').had_bye, true);
});

await test('resetRoundsAfter oeffnet ein abgeschlossenes Turnier wieder', async () => {
  seed();
  db.tournaments[0].status = 'finished';
  await resetRoundsAfter(T, 1);
  assert.equal(db.tournaments[0].status, 'active');
});

await test('resetRoundsAfter lehnt ab, wenn es nichts zu loeschen gibt', async () => {
  seed();
  await assert.rejects(() => resetRoundsAfter(T, 2), /nichts zu loeschen/);
  await assert.rejects(() => resetRoundsAfter(T, 5), /nichts zu loeschen/);
  assert.equal(db.matches.length, 4, 'nichts darf geloescht worden sein');
});

await test('resetRoundsAfter(0) raeumt das ganze Turnier zurueck auf Start', async () => {
  seed();
  const res = await resetRoundsAfter(T, 0);
  assert.equal(res.removedRounds, 2);
  assert.equal(db.tournaments[0].current_round, 0);
  assert.equal(db.matches.length, 0);
  assert.equal(db.rounds.length, 0);
  assert.equal(db.player_opponents.length, 0);
  assert.equal(db.players.length, 4, 'Spieler bleiben erhalten');
});

console.log('\nTurnier wieder oeffnen\n');

await test('reopenTournament setzt den Status auf aktiv', async () => {
  seed();
  db.tournaments[0].status = 'finished';
  const row = await reopenTournament(T);
  assert.equal(row.status, 'active');
  assert.equal(db.tournaments[0].status, 'active');
});

await test('Korrektur funktioniert auch bei abgeschlossenem Turnier', async () => {
  seed();
  db.tournaments[0].current_round = 1;
  await finalizeCurrentRound(T);
  db.tournaments[0].current_round = 2;
  await finalizeCurrentRound(T);
  db.tournaments[0].status = 'finished';

  assert.equal(snap('pB', 2).match_points, 0, 'vorher: Bert ohne Punkte');
  assert.equal(snap('pD', 2).match_points, 3, 'vorher: Dora mit dem R2-Sieg');

  const res = await correctMatchResult('m4', '2:0');   // Bert schlaegt Dora doch
  assert.equal(res.changed, true);
  assert.equal(snap('pB', 2).match_points, 3, 'Bert bekommt den R2-Sieg');
  assert.equal(snap('pD', 2).match_points, 0, 'Dora verliert beide Runden');
  assert.equal(db.tournaments[0].status, 'finished', 'Status bleibt unveraendert');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exitCode = fail ? 1 : 0;
