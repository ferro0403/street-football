// Portiere CPU: si piazza sulla linea della palla, legge il tiro con un tempo di reazione
// che dipende dalla valutazione e para con una probabilità (non para tutto).
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import { keeperReach, keeperReaction, keeperSaveChance, keeperSpeed } from './stats';
import { pass, passValue, setAction } from './actions';
import type { MatchState, PlayerState } from './types';
import { ownGoalX } from './world';

const HALF_GOAL = FIELD.goalWidth / 2;

export function updateKeeper(s: MatchState, k: PlayerState): { mx: number; my: number; speed: number } {
  const b = s.ball;
  const gx = ownGoalX(k.team);
  const out = k.team === 0 ? 1 : -1;

  // Con la palla in mano: aspetta un attimo e poi rilancia.
  if (b.owner === k.idx) {
    k.gk.hold += DT;
    if (k.gk.hold > 0.9) {
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
      if (best >= 0) {
        const far = dist(k.x, k.y, s.players[best].x, s.players[best].y) > 11;
        pass(s, k, best, far, 0);
      }
      k.gk.hold = 0;
    }
    return { mx: 0, my: 0, speed: 0 };
  }
  k.gk.hold = 0;

  // Nuovo tiro verso la mia porta: parte il tempo di reazione.
  const incoming = b.owner < 0 && b.shotActive && b.shotTeam !== k.team && b.vx * -out > 4;
  if (incoming && k.gk.seenShot !== b.shotId) {
    k.gk.seenShot = b.shotId;
    k.gk.react = keeperReaction(k.stats) + nextRandom(s) * 0.06;
  }
  if (k.gk.react > 0) k.gk.react -= DT;

  // Posizione base: davanti alla porta, sulla bisettrice tra palla e centro porta.
  let tx = gx + out * 0.9;
  let ty = clamp(CENTER_Y + (b.y - CENTER_Y) * 0.35, CENTER_Y - HALF_GOAL + 0.3, CENTER_Y + HALF_GOAL - 0.3);
  let speed = keeperSpeed(k.stats);

  if (incoming && k.gk.react <= 0) {
    // Dove attraverserà la mia linea?
    const lineX = gx + out * 0.8;
    const tc = (lineX - b.x) / b.vx;
    if (tc > 0 && tc < 1.6) {
      ty = clamp(b.y + b.vy * tc, CENTER_Y - HALF_GOAL - 0.4, CENTER_Y + HALF_GOAL + 0.4);
      tx = lineX;
      speed *= 1.5; // tuffo
    }
  } else if (b.owner < 0 && !b.shotActive) {
    // Palla lenta vicino alla porta: esce a prenderla.
    const dGoal = Math.abs(b.x - gx);
    const sp = len(b.vx, b.vy);
    if (dGoal < 5 && sp < 9 && Math.abs(b.y - CENTER_Y) < 6) {
      let nearestOpp = Infinity;
      for (const q of s.players) if (q.team !== k.team) nearestOpp = Math.min(nearestOpp, dist(q.x, q.y, b.x, b.y));
      if (dist(k.x, k.y, b.x, b.y) < nearestOpp + 0.5) {
        tx = b.x;
        ty = b.y;
      }
    }
  } else if (b.owner >= 0 && s.players[b.owner].team !== k.team) {
    // Attaccante che arriva: accorcia un po' lo specchio.
    const c = s.players[b.owner];
    const dGoal = Math.abs(c.x - gx);
    if (dGoal < 10) tx = gx + out * clamp(0.9 + (10 - dGoal) * 0.12, 0.9, 1.9);
  }

  // Area del portiere.
  tx = out > 0 ? clamp(tx, 0.3, 5) : clamp(tx, FIELD.length - 5, FIELD.length - 0.3);

  // Parata.
  if (incoming && k.gk.rolledShot !== b.shotId) {
    const ahead = (b.x - k.x) * out; // > 0 se la palla è ancora davanti al portiere
    if (ahead < 0.7 && ahead > -0.6) {
      const lateral = Math.abs(b.y - k.y);
      const reach = keeperReach(k.stats);
      if (lateral < reach + 0.4 && b.z < 2.3) {
        k.gk.rolledShot = b.shotId;
        const bs = len(b.vx, b.vy);
        const p = k.gk.react > 0 ? 0.08 : keeperSaveChance(k.stats, bs, Math.max(0, lateral - 0.3), b.z);
        const [dx, dy] = norm(0, b.y - k.y);
        setAction(k, 'dive', 0.6, dx || 0, dy || 1);
        if (chance(s, p)) {
          s.stats[k.team].saves += 1;
          s.stats[b.shotTeam as 0 | 1].onTarget += 1;
          b.shotActive = false;
          if (bs < 15 && lateral < 0.8 && b.z < 1.6) {
            b.owner = k.idx;
            b.lastTouch = k.idx;
            b.passTarget = -1;
            k.fx = out;
            k.fy = 0;
            s.events.push({ type: 'catch', p: k.idx, team: k.team, x: b.x, y: b.y });
          } else {
            b.vx = out * (2 + bs * 0.25);
            b.vy = b.vy * 0.3 + randSigned(s) * 5;
            b.vz = 2 + nextRandom(s) * 3;
            b.lastTouch = k.idx;
            b.passTarget = -1;
            s.events.push({ type: 'save', p: k.idx, team: k.team, power: bs, x: b.x, y: b.y, z: b.z });
          }
        } else {
          s.events.push({ type: 'dive', p: k.idx, team: k.team, x: k.x, y: k.y });
        }
      }
    }
  }

  const d = dist(k.x, k.y, tx, ty);
  if (d < 0.08) return { mx: 0, my: 0, speed };
  const [mx, my] = norm(tx - k.x, ty - k.y);
  const arrive = Math.min(1, d / 0.6);
  return { mx: mx * arrive, my: my * arrive, speed };
}
