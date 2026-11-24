// Simula partite CPU contro CPU senza grafica: utile per il bilanciamento.
// Uso: npx tsx scripts/sim.ts [partite]   (V=1 per il dettaglio di ogni partita)
import { createMatch, stepMatch, TEAMS } from '../src/shared';

const N = Number(process.argv[2] ?? 10);
const tot: Record<string, number> = {};
const add = (k: string, v = 1) => (tot[k] = (tot[k] ?? 0) + v);
const dist: Record<number, number> = {};
for (let i = 0; i < N; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i + 1) % TEAMS.length];
  const s = createMatch({ home, away, seed: 1000 + i });
  let ticks = 0;
  while (s.phase !== 'ended' && ticks < 60 * 60 * 10) {
    stepMatch(s, {});
    for (const e of s.events) {
      if (['trick', 'trickFail', 'wallPass', 'gamebreaker', 'header', 'volley', 'bicycle', 'heavyTouch', 'foul', 'special', 'combo'].includes(e.type)) add(e.type);
      if (e.type === 'pass' && e.skill === '4') add('passAlMuro');
      if (e.type === 'pass' && e.skill === '5') add('unoDueMuro');
      if (e.type === 'shot' && e.skill) add(`tiro_${e.skill}`);
      if (e.type === 'goal' && e.label === 'GAMEBREAKER') add('golGamebreaker');
    }
    ticks++;
  }
  const g = s.score[0] + s.score[1];
  dist[g] = (dist[g] ?? 0) + 1;
  add('gol', g);
  for (const t of s.stats) {
    add('tiri', t.shots);
    add('parate', t.saves);
    add('contrasti', t.tackles);
    add('passaggi', t.passes);
  }
  if (process.env.V) console.log(`${home.short} ${s.score[0]}-${s.score[1]} ${away.short}`);
}
const avg = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +(v / N).toFixed(1)]));
console.log('media a partita:', avg);
console.log('gol per partita → numero di partite:', dist);
