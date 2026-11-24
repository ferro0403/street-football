// Portiere CPU (Passo 1, semplice e prevedibile):
// - sta in porta, sulla bisettrice dell'angolo palla-pali, poco avanti alla linea;
// - legge il tiro dopo un breve tempo di reazione, si sposta o si tuffa verso il punto d'impatto;
// - para spesso i tiri centrali e deboli, prende gol su quelli angolati e potenti;
// - esce SOLO su palle vaganti vicinissime alla porta, e MAI sul portatore (niente contrasti).
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import { keeperCatchChance, keeperDive, keeperReaction, keeperSaveChance, keeperSpeed } from './stats';
import { pass, passValue, setAction } from './actions';
import type { MatchState, PlayerState } from './types';
import { ownGoalX } from './world';

const HALF_GOAL = FIELD.goalWidth / 2;

export interface KeeperIntent {
  mx: number;
  my: number;
  speed: number;
}

const STILL: KeeperIntent = { mx: 0, my: 0, speed: 0 };

function seekTo(k: PlayerState, tx: number, ty: number, speed: number): KeeperIntent {
  const d = dist(k.x, k.y, tx, ty);
  if (d < 0.05) return { mx: 0, my: 0, speed };
  const [mx, my] = norm(tx - k.x, ty - k.y);
  const arrive = Math.min(1, d / 0.4);
  return { mx: mx * arrive, my: my * arrive, speed };
}

/** Posizione sulla bisettrice dell'angolo tra palla e pali, a `depth` metri dalla linea. */
export function anglePosition(team: 0 | 1, bx: number, by: number, depth: number): [number, number] {
  const gx = ownGoalX(team);
  const out = team === 0 ? 1 : -1;
  const [ax, ay] = norm(gx - bx, CENTER_Y - HALF_GOAL - by);
  const [cx, cy] = norm(gx - bx, CENTER_Y + HALF_GOAL - by);
  const [ux, uy] = norm(ax + cx, ay + cy);
  const px = gx + out * depth;
  let py = CENTER_Y;
  if (Math.abs(ux) > 1e-6) py = by + uy * ((px - bx) / ux);
  return [px, clamp(py, CENTER_Y - HALF_GOAL + 0.1, CENTER_Y + HALF_GOAL - 0.1)];
}

export function updateKeeper(s: MatchState, k: PlayerState): KeeperIntent {
  const b = s.ball;
  const gx = ownGoalX(k.team);
  const out = k.team === 0 ? 1 : -1;

  // Palla in mano: un attimo e poi la passa al compagno più libero.
  if (b.owner === k.idx) {
    k.gk.hold += DT;
    if (k.gk.hold > 0.8) {
      let best = -1;
      let bv = -Infinity;
      for (const q of s.players) {
        if (q.team !== k.team || q.idx === k.idx) continue;
        const v = passValue(s, k, q);
        if (v > bv) {
          bv = v;
          best = q.idx;
        }
      }
      if (best >= 0) pass(s, k, best);
      k.gk.hold = 0;
    }
    return STILL;
  }
  k.gk.hold = 0;

  const incoming = b.owner < 0 && b.shotActive && b.shotTeam !== k.team && b.vx * -out > 4;
  if (incoming && k.gk.seenShot !== b.shotId) {
    k.gk.seenShot = b.shotId;
    k.gk.react = keeperReaction(k.stats) + nextRandom(s) * 0.05;
  }
  if (k.gk.react > 0) k.gk.react -= DT;

  if (k.action.kind === 'dive') {
    if (incoming) checkSave(s, k);
    return STILL;
  }

  if (incoming) {
    checkSave(s, k);
    if (b.owner === k.idx || !b.shotActive || k.gk.react > 0) return STILL;
    const tc = (k.x - b.x) / b.vx;
    if (tc > 0 && tc < 1.8) {
      const yc = clamp(b.y + b.vy * tc, CENTER_Y - HALF_GOAL - 0.6, CENTER_Y + HALF_GOAL + 0.6);
      const gap = yc - k.y;
      if (Math.abs(gap) > 0.55 && tc < 0.4) {
        const v = clamp(gap / Math.max(tc, 0.12), -keeperDive(k.stats), keeperDive(k.stats));
        setAction(k, 'dive', 0.65, 0, gap > 0 ? 1 : -1);
        k.vx = 0;
        k.vy = v;
        s.events.push({ type: 'dive', p: k.idx, team: k.team, x: k.x, y: k.y });
        return STILL;
      }
      return seekTo(k, k.x, yc, keeperSpeed(k.stats) * 1.3);
    }
  }

  // Esce solo su palla vagante vicinissima, se ci arriva prima degli avversari.
  if (b.owner < 0 && !b.shotActive && b.inGoal < 0 && b.z < 1.5) {
    const near = Math.abs(b.x - gx) < 3.5 && Math.abs(b.y - CENTER_Y) < 4 && len(b.vx, b.vy) < 8;
    if (near) {
      const myT = dist(k.x, k.y, b.x, b.y) / keeperSpeed(k.stats);
      let oppT = Infinity;
      for (const q of s.players) if (q.team !== k.team) oppT = Math.min(oppT, dist(q.x, q.y, b.x, b.y) / 7);
      if (myT < oppT) return seekTo(k, b.x, b.y, keeperSpeed(k.stats) * 1.3);
    }
  }

  // Posizione: un po' più avanti se la palla è vicina (accorcia l'angolo), ma sempre in porta.
  const dBall = dist(b.x, b.y, gx, CENTER_Y);
  const depth = dBall < 10 ? 0.9 + (10 - dBall) * 0.06 : 0.8;
  const [tx, ty] = anglePosition(k.team, b.x, b.y, depth);
  return seekTo(k, tx, ty, keeperSpeed(k.stats));
}

/** Parata: quando la palla passa sulla linea del portiere ed è a portata. */
function checkSave(s: MatchState, k: PlayerState): void {
  const b = s.ball;
  if (k.gk.rolledShot === b.shotId) return;
  const out = k.team === 0 ? 1 : -1;
  const ahead = (b.x - k.x) * out;
  if (ahead > 0.6 || ahead < -0.7) return;
  const diving = k.action.kind === 'dive';
  const lateral = Math.abs(b.y - k.y);
  const reach = 0.5 + (diving ? 0.75 : 0.35) + (k.stats.defense / 99) * 0.25;
  if (lateral > reach || b.z > (diving ? 1.5 : 2.1)) return;
  k.gk.rolledShot = b.shotId;
  const bs = len(b.vx, b.vy);
  const flight = dist(b.shotX, b.shotY, b.x, b.y) / Math.max(bs, 1);
  // Non ancora reagito: para solo se la palla gli arriva addosso.
  const p = k.gk.react > 0 ? (lateral < 0.55 && b.z < 1.6 ? 0.6 : 0.1) : keeperSaveChance(k.stats, bs, lateral, b.z, flight, Math.min(1, Math.abs(b.y - CENTER_Y) / HALF_GOAL));
  if (!chance(s, p)) return;
  s.stats[k.team].saves += 1;
  s.stats[b.shotTeam as 0 | 1].onTarget += 1;
  b.shotActive = false;
  b.lastTouch = k.idx;
  b.passTarget = -1;
  if (chance(s, keeperCatchChance(k.stats, bs, Math.max(0, lateral - 0.3)))) {
    b.owner = k.idx;
    k.fx = out;
    k.fy = 0;
    s.events.push({ type: 'catch', p: k.idx, team: k.team, x: b.x, y: b.y });
  } else {
    // Respinta verso l'esterno, lontano dal centro della porta.
    const side = b.y >= CENTER_Y ? 1 : -1;
    b.vx = out * (3 + bs * 0.2);
    b.vy = side * (3 + nextRandom(s) * 4) + randSigned(s);
    b.vz = 2 + nextRandom(s) * 2.5;
    b.x = k.x + out * 0.4;
    b.kicker = k.idx;
    b.kickCd = 0.4;
    s.events.push({ type: 'save', p: k.idx, team: k.team, power: bs, x: b.x, y: b.y, z: b.z });
  }
}
