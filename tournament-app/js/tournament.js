import { supabase } from './supabase-client.js';

const RESULT_TO_MATCH = {
  '2:0': { a: 'W', b: 'L', gwA:2, glA:0, gdA:0, gwB:0, glB:2, gdB:0 },
  '2:1': { a: 'W', b: 'L', gwA:2, glA:1, gdA:0, gwB:1, glB:2, gdB:0 },
  '1:2': { a: 'L', b: 'W', gwA:1, glA:2, gdA:0, gwB:2, glB:1, gdB:0 },
  '0:2': { a: 'L', b: 'W', gwA:0, glA:2, gdA:0, gwB:2, glB:0, gdB:0 },
  '1:1': { a: 'D', b: 'D', gwA:1, glA:1, gdA:0, gwB:1, glB:1, gdB:0 },
  '1:0': { a: 'W', b: 'L', gwA:1, glA:0, gdA:0, gwB:0, glB:1, gdB:0 },
  '0:1': { a: 'L', b: 'W', gwA:0, glA:1, gdA:0, gwB:1, glB:0, gdB:0 },
  '0:0': { a: 'D', b: 'D', gwA:0, glA:0, gdA:0, gwB:0, glB:0, gdB:0 },
  'ID':  { a: 'D', b: 'D', gwA:0, glA:0, gdA:0, gwB:0, glB:0, gdB:0 },
  'BYE': { a: 'W', b: null, gwA:2, glA:0, gdA:0, gwB:0, glB:0, gdB:0 },
};

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function round2(n){ return Math.round(n*100)/100; }

function computeDerived(playersMap){
  const base = {};
  for(const p of Object.values(playersMap)){
    const matchesPlayed = p.wins + p.losses + p.draws;
    const mwRaw = (p.wins*3 + p.draws) / Math.max(1, matchesPlayed*3);
    const gwRaw = p.gamePoints / Math.max(1, (p.gameWins+p.gameLosses+p.gameDraws)*3);
    base[p.id] = {
      mw: Math.max(0.33, mwRaw || 0),
      gw: Math.max(0.33, gwRaw || 0)
    };
  }

  for(const p of Object.values(playersMap)){
    const oppIds = p.opponents.filter(id => id !== 'BYE');
    const oppMw = oppIds.length ? oppIds.reduce((s,id)=>s+(base[id]?.mw||0.33),0)/oppIds.length : 0.33;
    const oppGw = oppIds.length ? oppIds.reduce((s,id)=>s+(base[id]?.gw||0.33),0)/oppIds.length : 0.33;
    p.omw = oppMw;
    p.gw = base[p.id].gw;
    p.ogw = oppGw;
  }
}

function compareStanding(a,b){
  if(b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
  if(b.omw !== a.omw) return b.omw - a.omw;
  if(b.gw !== a.gw) return b.gw - a.gw;
  if(b.ogw !== a.ogw) return b.ogw - a.ogw;
  return a.name.localeCompare(b.name, 'de');
}

function didPlay(a,b,playedSet){ return playedSet.has(`${a}::${b}`) || playedSet.has(`${b}::${a}`); }

function bestPairing(players, playedSet, avoidRematches=true){
  let best = null;
  let explored = 0;
  const HARD_LIMIT = 30000;

  function rec(unpaired, pairs, rematches){
    explored++;
    if(explored > HARD_LIMIT) return;
    if(unpaired.length === 0){
      const cand = { pairs: [...pairs], rematches };
      if(!best || cand.rematches < best.rematches) best = cand;
      return;
    }

    if(best && rematches > best.rematches) return;

    const a = unpaired[0];
    const rest = unpaired.slice(1);

    const candidates = rest
      .map((b, idx) => ({ b, idx, rematch: didPlay(a.id, b.id, playedSet) }))
      .sort((x,y) => Number(x.rematch)-Number(y.rematch) || x.idx-y.idx);

    for(const c of candidates){
      const b = c.b;
      if(avoidRematches && c.rematch && rest.some(o => !didPlay(a.id, o.id, playedSet))) continue;
      const remaining = rest.filter(x => x.id !== b.id);
      pairs.push([a,b]);
      rec(remaining, pairs, rematches + (c.rematch ? 1 : 0));
      pairs.pop();
    }
  }

  rec(players, [], 0);
  if(best) best.explored = explored;
  return best;
}

function pairGroupWithFloater(group, playedSet, avoidRematches=true){
  if(group.length === 0) return { pairs: [], floater: null, rematches: 0, explored: 0 };
  if(group.length % 2 === 0){
    const best = bestPairing(group, playedSet, avoidRematches);
    if(!best) return null;
    return { pairs: best.pairs, floater: null, rematches: best.rematches, explored: best.explored || 0 };
  }

  let best = null;
  for(let i=group.length-1;i>=0;i--){
    const floater = group[i];
    const rest = group.filter((_, idx) => idx !== i);
    const paired = bestPairing(rest, playedSet, avoidRematches);
    if(!paired) continue;
    const cand = { pairs: paired.pairs, floater, rematches: paired.rematches, explored: paired.explored || 0 };
    if(!best || cand.rematches < best.rematches) best = cand;
  }
  return best;
}

function swissPairings(players, playedSet, avoidRematches=true){
  const groups = new Map();
  for(const p of players){
    if(!groups.has(p.matchPoints)) groups.set(p.matchPoints, []);
    groups.get(p.matchPoints).push(p);
  }

  const pointsDesc = [...groups.keys()].sort((a,b)=>b-a);
  const outPairs = [];
  let floater = null;
  let totalRematches = 0;
  let exploredNodes = 0;

  for(const pts of pointsDesc){
    const group = [...groups.get(pts)];
    if(floater){ group.unshift(floater); floater = null; }

    const paired = pairGroupWithFloater(group, playedSet, avoidRematches);
    if(!paired) return { pairs: [], leftover: group[0] || null, rematches: 999 };

    outPairs.push(...paired.pairs);
    floater = paired.floater;
    totalRematches += paired.rematches;
    exploredNodes += (paired?.explored || 0);
  }

  return { pairs: outPairs, leftover: floater, rematches: totalRematches, explored: exploredNodes };
}

export async function createTournament(ownerId, payload){
  const { data: tRows, error: tErr } = await supabase
    .from('tournaments')
    .insert({
      owner_id: ownerId,
      name: payload.name,
      rounds_total: payload.roundsTotal,
      avoid_rematches: payload.avoidRematches,
      allow_bye: payload.allowBye,
      current_round: 0,
      status: 'active'
    })
    .select('*');
  if(tErr) throw tErr;

  const tournament = tRows[0];
  const playersInsert = payload.playerNames.map((n, i) => ({ tournament_id: tournament.id, name: n, seat: i+1 }));
  const { error: pErr } = await supabase.from('players').insert(playersInsert);
  if(pErr) throw pErr;
  return tournament;
}

export async function listTournaments(){
  const { data, error } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false });
  if(error) throw error;
  return data;
}

export async function getTournamentBundle(tournamentId){
  const [{ data: t, error: te }, { data: players, error: pe }, { data: matches, error: me }, { data: rounds, error: re }, { data: opps, error: oe }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', tournamentId).single(),
    supabase.from('players').select('*').eq('tournament_id', tournamentId),
    supabase.from('matches').select('*').eq('tournament_id', tournamentId).order('round_no', { ascending: true }).order('table_no', { ascending: true }),
    supabase.from('rounds').select('*').eq('tournament_id', tournamentId).order('round_no', { ascending: true }),
    supabase.from('player_opponents').select('*').eq('tournament_id', tournamentId)
  ]);
  if(te) throw te; if(pe) throw pe; if(me) throw me; if(re) throw re; if(oe) throw oe;
  return { tournament: t, players, matches, rounds, opps };
}

function buildStandings(players, matches, roundNo){
  const map = {};
  for(const p of players){
    map[p.id] = {
      id: p.id, name: p.name, hadBye: p.had_bye, dropped: p.dropped,
      opponents: [], wins:0, losses:0, draws:0,
      gameWins:0, gameLosses:0, gameDraws:0,
      matchPoints:0, gamePoints:0, omw:0.33, gw:0.33, ogw:0.33
    };
  }

  for(const m of matches.filter(x => x.round_no <= roundNo && x.result !== 'pending')){
    if(m.is_bye){
      const p = map[m.player_a_id];
      if(!p) continue;
      p.wins += 1; p.matchPoints += 3;
      p.gameWins += 2; p.gamePoints += 6;
      p.opponents.push('BYE');
      continue;
    }

    const res = RESULT_TO_MATCH[m.result];
    if(!res) continue;
    const a = map[m.player_a_id];
    const b = map[m.player_b_id];
    if(!a || !b) continue;

    a.opponents.push(b.id); b.opponents.push(a.id);

    if(res.a === 'W'){ a.wins++; a.matchPoints += 3; b.losses++; }
    else if(res.a === 'L'){ a.losses++; b.wins++; b.matchPoints += 3; }
    else { a.draws++; b.draws++; a.matchPoints += 1; b.matchPoints += 1; }

    a.gameWins += res.gwA; a.gameLosses += res.glA; a.gameDraws += res.gdA;
    b.gameWins += res.gwB; b.gameLosses += res.glB; b.gameDraws += res.gdB;

    a.gamePoints += res.gwA*3 + res.gdA;
    b.gamePoints += res.gwB*3 + res.gdB;
  }

  computeDerived(map);
  return Object.values(map).sort(compareStanding);
}

async function saveRoundSnapshot(tournamentId, roundNo, standings){
  const rows = standings.map(s => ({
    tournament_id: tournamentId, player_id: s.id, round_no: roundNo,
    wins: s.wins, losses: s.losses, draws: s.draws,
    game_wins: s.gameWins, game_losses: s.gameLosses, game_draws: s.gameDraws,
    match_points: s.matchPoints, game_points: s.gamePoints,
    omw: s.omw, gw: s.gw, ogw: s.ogw,
  }));
  const { error } = await supabase.from('player_round_stats').upsert(rows, { onConflict: 'tournament_id,player_id,round_no' });
  if(error) throw error;
}

export async function generateNextRound(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  const t = bundle.tournament;

  if(t.status !== 'active') throw new Error('Turnier ist bereits abgeschlossen.');
  if(t.current_round >= t.rounds_total) throw new Error('Maximale Rundenzahl erreicht.');

  if(t.current_round > 0){
    const currentMatches = bundle.matches.filter(m => m.round_no === t.current_round);
    if(currentMatches.some(m => m.result === 'pending')) throw new Error('Nicht alle Ergebnisse der aktuellen Runde sind eingetragen.');
  }

  const activePlayers = bundle.players.filter(p => !p.dropped);
  if(activePlayers.length < 2) throw new Error('Zu wenige aktive Spieler.');

  const roundNo = t.current_round + 1;
  const standings = buildStandings(bundle.players, bundle.matches, t.current_round);
  const playedSet = new Set(bundle.opps.map(o => `${o.player_id}::${o.opponent_id}`));

  let pool = roundNo === 1
    ? shuffle(standings.filter(s => !bundle.players.find(p=>p.id===s.id)?.dropped))
    : standings.filter(s => !bundle.players.find(p=>p.id===s.id)?.dropped);

  let byePlayer = null;
  if(pool.length % 2 === 1){
    if(!t.allow_bye) throw new Error('Ungerade Spielerzahl, aber Bye ist deaktiviert.');
    const reversed = [...pool].reverse();
    byePlayer = reversed.find(p => !bundle.players.find(bp=>bp.id===p.id)?.had_bye) || reversed[0];
    pool = pool.filter(p => p.id !== byePlayer.id);
  }

  const pairingResult = roundNo === 1
    ? { pairs: (() => { const out=[]; for(let i=0;i<pool.length;i+=2) out.push([pool[i],pool[i+1]]); return out; })(), leftover: null }
    : swissPairings(pool, playedSet, t.avoid_rematches);

  const { pairs, leftover } = pairingResult;
  if(leftover) throw new Error('Konnte keine gültige Paarung erzeugen.');

  const { data: roundRows, error: rErr } = await supabase.from('rounds').insert({ tournament_id: tournamentId, round_no: roundNo }).select('*');
  if(rErr) throw rErr;
  const round = roundRows[0];

  const insertMatches = pairs.map((pair, idx) => ({
    tournament_id: tournamentId, round_id: round.id, round_no: roundNo, table_no: idx + 1,
    player_a_id: pair[0].id, player_b_id: pair[1].id, is_bye: false, result: 'pending'
  }));

  if(byePlayer){
    insertMatches.push({
      tournament_id: tournamentId, round_id: round.id, round_no: roundNo, table_no: pairs.length + 1,
      player_a_id: byePlayer.id, player_b_id: null, is_bye: true, result: 'BYE',
      submitted_at: new Date().toISOString()
    });
  }

  const { error: mErr } = await supabase.from('matches').insert(insertMatches);
  if(mErr) throw mErr;

  const oppRows = [];
  for(const [a,b] of pairs){
    oppRows.push({ tournament_id: tournamentId, player_id: a.id, opponent_id: b.id, round_no: roundNo });
    oppRows.push({ tournament_id: tournamentId, player_id: b.id, opponent_id: a.id, round_no: roundNo });
  }
  if(oppRows.length){
    const { error: oErr } = await supabase.from('player_opponents').insert(oppRows);
    if(oErr) throw oErr;
  }

  if(byePlayer) await supabase.from('players').update({ had_bye: true }).eq('id', byePlayer.id);
  const { error: uErr } = await supabase.from('tournaments').update({ current_round: roundNo }).eq('id', tournamentId);
  if(uErr) throw uErr;

  const rematchTables = [];
  if(roundNo > 1){
    for(const [idx, pair] of pairs.entries()) if(didPlay(pair[0].id, pair[1].id, playedSet)) rematchTables.push(idx + 1);
  }

  return {
    roundNo,
    byePlayerId: byePlayer?.id || null,
    rematchTables,
    rematchCount: rematchTables.length,
    pairingExploredNodes: pairingResult?.explored || 0
  };
}

export async function submitMatchResult(matchId, result){
  if(!RESULT_TO_MATCH[result]) throw new Error('Ungültiges Ergebnis.');
  const { error } = await supabase.from('matches').update({ result, submitted_at: new Date().toISOString() }).eq('id', matchId);
  if(error) throw error;
}

export async function finalizeCurrentRound(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  const roundNo = bundle.tournament.current_round;
  if(roundNo < 1) throw new Error('Keine aktive Runde.');
  const roundMatches = bundle.matches.filter(m => m.round_no === roundNo);
  if(roundMatches.some(m => m.result === 'pending')) throw new Error('Nicht alle Ergebnisse eingetragen.');

  const standings = buildStandings(bundle.players, bundle.matches, roundNo);
  await saveRoundSnapshot(tournamentId, roundNo, standings);

  const round = bundle.rounds.find(r => r.round_no === roundNo);
  if(round) await supabase.from('rounds').update({ finalized_at: new Date().toISOString() }).eq('id', round.id);

  return standings;
}

export async function getLiveStandings(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  return buildStandings(bundle.players, bundle.matches, bundle.tournament.current_round);
}

export async function finishTournament(tournamentId){
  const bundle = await getTournamentBundle(tournamentId);
  const roundNo = bundle.tournament.current_round;
  if(roundNo > 0){
    const roundMatches = bundle.matches.filter(m => m.round_no === roundNo);
    if(roundMatches.some(m => m.result === 'pending')) throw new Error('Aktuelle Runde ist noch nicht vollständig.');
    const standings = buildStandings(bundle.players, bundle.matches, roundNo);
    await saveRoundSnapshot(tournamentId, roundNo, standings);
  }
  const { error } = await supabase.from('tournaments').update({ status: 'finished' }).eq('id', tournamentId);
  if(error) throw error;
}

export async function setPlayerDropped(playerId, dropped=true){
  const { error } = await supabase.from('players').update({ dropped }).eq('id', playerId);
  if(error) throw error;
}

export async function getRoundMatches(tournamentId, roundNo){
  const { data, error } = await supabase.from('matches').select('*').eq('tournament_id', tournamentId).eq('round_no', roundNo).order('table_no', { ascending: true });
  if(error) throw error;
  return data;
}

export async function getGlobalRanking(){
  const { data: tournaments, error: te } = await supabase.from('tournaments').select('id,current_round,status');
  if(te) throw te;

  const out = new Map();
  for(const t of tournaments){
    if((t.current_round || 0) < 1) continue;
    const { data: stats, error: se } = await supabase
      .from('player_round_stats')
      .select('player_id,match_points,round_no')
      .eq('tournament_id', t.id)
      .eq('round_no', t.current_round);
    if(se) throw se;

    const { data: players, error: pe } = await supabase
      .from('players')
      .select('id,name')
      .eq('tournament_id', t.id);
    if(pe) throw pe;

    const nameById = Object.fromEntries(players.map(p => [p.id, p.name]));
    for(const s of stats){
      const name = nameById[s.player_id];
      if(!name) continue;
      if(!out.has(name)) out.set(name, { name, totalMatchPoints: 0, totalTournaments: 0 });
      const row = out.get(name);
      row.totalMatchPoints += s.match_points || 0;
      row.totalTournaments += 1;
    }
  }

  return [...out.values()].sort((a,b)=>b.totalMatchPoints-a.totalMatchPoints || a.name.localeCompare(b.name));
}

export function formatPct(value){ return `${round2((value || 0) * 100).toFixed(2)}%`; }

export function standingsToCsvRows(standings){
  const header = ['Rank','Name','Record','Match Points','OMW%','GW%','OGW%','Dropped'];
  const rows = standings.map((s, idx) => [
    String(idx+1), s.name, `${s.wins}-${s.losses}-${s.draws}`,
    String(s.matchPoints), formatPct(s.omw), formatPct(s.gw), formatPct(s.ogw), s.dropped ? 'yes' : 'no'
  ]);
  return [header, ...rows];
}
