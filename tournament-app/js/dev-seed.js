import { requireAuthOrRedirect } from './auth.js';
import { createTournament, generateNextRound, getRoundMatches, submitMatchResult, finalizeCurrentRound } from './tournament.js';

const PLAYERS = ['Anna','Benedikt','Clara','David','Elena','Fabian','Greta','Hannes'];
const RESULTS = ['2:0','2:1','2:1','1:2','0:2','1:1'];

async function run(){
  const user = await requireAuthOrRedirect();
  if(!user) return;

  const t = await createTournament(user.id, {
    name: `DEV Seed ${new Date().toISOString().slice(0,16)}`,
    roundsTotal: 3,
    avoidRematches: true,
    allowBye: true,
    playerNames: PLAYERS,
  });

  for(let r=1;r<=3;r++){
    await generateNextRound(t.id);
    const matches = await getRoundMatches(t.id, r);
    let idx = 0;
    for(const m of matches){
      if(m.is_bye) continue;
      await submitMatchResult(m.id, RESULTS[idx % RESULTS.length]);
      idx++;
    }
    await finalizeCurrentRound(t.id);
  }

  alert(`Seed fertig: ${t.name}`);
  window.location.href = `./round.html?tournament=${t.id}`;
}

run();
