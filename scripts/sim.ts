// Simula partite CPU contro CPU senza grafica: utile per il bilanciamento.
// Uso: npx vite-node scripts/sim.ts  (oppure: npx tsx scripts/sim.ts)
import { createMatch, stepMatch, TEAMS } from '../src/shared';

const N = Number(process.argv[2] ?? 6);
let goals = 0, shots = 0, saves = 0, tackles = 0, passes = 0, fouls = 0;
const dist: Record<number, number> = {};
for (let i = 0; i < N; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 1) % TEAMS.length];
  const s = createMatch({ home, away, seed: 1000 + i });
  let ticks = 0;
  while (s.phase !== 'ended' && ticks < 60 * 60 * 10) { stepMatch(s, {}); ticks++; }
  goals += s.score[0] + s.score[1];
  dist[s.score[0] + s.score[1]] = (dist[s.score[0] + s.score[1]] ?? 0) + 1;
  for (const t of s.stats) { shots += t.shots; saves += t.saves; tackles += t.tackles; passes += t.passes; fouls += t.fouls; }
  if (process.env.V) console.log(`${home.short} ${s.score[0]}-${s.score[1]} ${away.short}  tiri ${s.stats[0].shots}/${s.stats[1].shots} parate ${s.stats[0].saves}/${s.stats[1].saves} contrasti ${s.stats[0].tackles}/${s.stats[1].tackles} passaggi ${s.stats[0].passes}/${s.stats[1].passes} possesso ${s.stats[0].possessionTicks}/${s.stats[1].possessionTicks}`);
}
console.log(`media: gol ${(goals / N).toFixed(1)} tiri ${(shots / N).toFixed(1)} parate ${(saves / N).toFixed(1)} contrasti ${(tackles / N).toFixed(1)} passaggi ${(passes / N).toFixed(1)} falli ${(fouls / N).toFixed(1)}`);
console.log('gol per partita → numero di partite:', dist);
