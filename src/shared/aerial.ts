// Palle alte: azione contestuale in base all'altezza della palla e alla posizione.
// - sopra 1,35 m: colpo di testa (tiro o passaggio);
// - 0,95-1,9 m e di spalle alla porta: rovesciata (spettacolare, imprecisa);
// - 0,45-1,35 m: tiro (o passaggio) al volo.
import { CENTER_Y, FIELD, PHYS } from './constants';
import { clamp, dist, norm } from './math';
import { nextRandom, randSigned } from './rng';
import { setAction } from './actions';
import { addGb, gbOn } from './gamebreaker';
import { maxShotSpeed, shotError } from './stats';
import type { MatchState, PlayerState } from './types';
import { oppGoalX } from './world';

export type AerialKind = 'header' | 'volley' | 'bicycle';

/** Che azione aerea può fare il giocatore adesso (null = nessuna). */
export function aerialOption(s: MatchState, p: PlayerState): AerialKind | null {
  const b = s.ball;
  if (b.owner >= 0 || b.inGoal >= 0 || p.stun > 0 || p.role === 'gk') return null;
  if (b.z < 0.45 || b.z > 2.3) return null;
  if (b.kicker === p.idx && b.kickCd > 0) return null;
  if (dist(p.x, p.y, b.x, b.y) > 1.35) return null;
  const gx = oppGoalX(p.team);
  const [gdx, gdy] = norm(gx - p.x, CENTER_Y - p.y);
  const facingGoal = p.fx * gdx + p.fy * gdy;
  if (b.z >= 0.95 && b.z <= 1.9 && facingGoal < -0.25) return 'bicycle';
  if (b.z >= 1.35) return 'header';
  return 'volley';
}

/** Tiro aereo verso la porta. */
export function aerialShot(s: MatchState, p: PlayerState, kind: AerialKind, aim: number): void {
  const b = s.ball;
  const gx = oppGoalX(p.team);
  let ty = CENTER_Y + clamp(aim, -1, 1) * (FIELD.goalWidth / 2 - 0.35);
  const d0 = dist(b.x, b.y, gx, ty);
  const power = kind === 'header' ? 0.55 : kind === 'bicycle' ? 0.95 : 0.85;
  const errMul = kind === 'header' ? 1.1 : kind === 'bicycle' ? 1.7 : 1.3;
  ty += randSigned(s) * shotError(p.stats) * errMul * (0.6 + d0 / 18);
  const vh = (9 + (maxShotSpeed(p.stats) * s.tune.shot - 9) * power) * (gbOn(s, p.team) ? 1.15 : 1);
  const th = kind === 'header' ? 0.3 + nextRandom(s) * 0.5 : 0.4 + nextRandom(s) * 1.0;
  const [dx, dy] = norm(gx - b.x, ty - b.y);
  const t = Math.max(0.15, d0 / vh);
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.3;
  b.passTarget = -1;
  b.passKind = 0;
  b.spin = 0;
  b.vx = dx * vh;
  b.vy = dy * vh;
  b.vz = clamp((th - b.z + 0.5 * PHYS.gravity * t * t) / t, -6, 10);
  b.shotId += 1;
  b.shotActive = true;
  b.shotTeam = p.team;
  b.shotX = b.x;
  b.shotY = b.y;
  b.shotGb = gbOn(s, p.team);
  s.stats[p.team].shots += 1;
  p.fx = kind === 'bicycle' ? -dx : dx;
  p.fy = kind === 'bicycle' ? -dy : dy;
  setAction(p, kind, kind === 'bicycle' ? 0.9 : 0.4, dx, dy);
  if (kind === 'bicycle') p.stun = 0.75; // si rialza dopo la rovesciata
  const label = kind === 'header' ? 'COLPO DI TESTA!' : kind === 'bicycle' ? 'ROVESCIATA!' : 'AL VOLO!';
  const pts = addGb(s, p.team, kind === 'bicycle' ? 0.16 : 0.06);
  s.events.push({ type: kind, p: p.idx, team: p.team, label, pts, power: vh, x: b.x, y: b.y, z: b.z });
  s.events.push({ type: 'shot', p: p.idx, team: p.team, power: vh, x: b.x, y: b.y });
}

/** Passaggio aereo (di testa o al volo) verso un compagno. */
export function aerialPass(s: MatchState, p: PlayerState, kind: AerialKind, target: number): void {
  const b = s.ball;
  const r = s.players[target];
  const d = dist(b.x, b.y, r.x, r.y);
  const [dx, dy] = norm(r.x - b.x, r.y - b.y);
  const vh = clamp(d / 0.9, 6, 15);
  const t = d / vh;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.3;
  b.passTarget = target;
  b.passKind = 2;
  b.passTx = r.x;
  b.passTy = r.y;
  b.passer = p.idx;
  b.spin = 0;
  b.vx = dx * vh;
  b.vy = dy * vh;
  b.vz = clamp((0.6 - b.z + 0.5 * PHYS.gravity * t * t) / t, -4, 9);
  p.fx = dx;
  p.fy = dy;
  setAction(p, kind === 'header' ? 'header' : 'volley', 0.35, dx, dy);
  s.stats[p.team].passes += 1;
  s.events.push({ type: 'pass', p: p.idx, team: p.team, power: vh, x: b.x, y: b.y, skill: '2' });
}
