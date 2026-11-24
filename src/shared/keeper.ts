// Portiere CPU (skill game-ai: percezione → decisione → movimento).
// - Sta in porta sulla bisettrice dell'angolo palla-pali, più avanti se l'attaccante è vicino.
// - Esce solo su palle vaganti vicine o su uno contro uno chiari.
// - Legge il tiro dopo un tempo di reazione, si tuffa verso il punto d'impatto,
//   para con una probabilità e a volte respinge invece di bloccare.
// - Non contrasta mai: può prendere solo palle libere o "scoperte" (lontane dai piedi).
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import { EXPOSED_OFFSET, keeperCatchChance, keeperDive, keeperReaction, keeperSaveChance, keeperSpeed } from './stats';
import { groundPass, lobPass, passValue, setAction } from './actions';
import type { MatchState, PlayerState } from './types';
import { laneClear, ownGoalX } from './world';

const HALF_GOAL = FIELD.goalWidth / 2;

export interface KeeperIntent {
  mx: number;
  my: number;
  speed: number;
}

const STILL: KeeperIntent = { mx: 0, my: 0, speed: 0 };

function seekTo(k: PlayerState, tx: number, ty: number, speed: number): KeeperIntent {
  const d = dist(k.x, k.y, tx, ty);
  if (d < 0.06) return { mx: 0, my: 0, speed };
  const [mx, my] = norm(tx - k.x, ty - k.y);
  const arrive = Math.min(1, d / 0.5);
  return { mx: mx * arrive, my: my * arrive, speed };
}

/** Posizione sulla bisettrice dell'angolo tra palla e pali, a `depth` metri dalla linea. */
export function anglePosition(team: 0 | 1, bx: number, by: number, depth: number): [number, number] {
  const gx = ownGoalX(team);
  const out = team === 0 ? 1 : -1;
  const [ax, ay] = norm(gx - bx, CENTER_Y - HALF_GOAL - by);
  const [cx, cy] = norm(gx - bx, CENTER_Y + HALF_GOAL - by);
  const [ux, uy] = norm(ax + cx, ay + cy); // bisettrice: dalla palla verso la porta
  const px = gx + out * depth;
  // Punto della bisettrice con x = px.
  let py = CENTER_Y;
  if (Math.abs(ux) > 1e-6) {
    const t = (px - bx) / ux;
    py = by + uy * t;
  }
  return [px, clamp(py, CENTER_Y - HALF_GOAL - 0.2, CENTER_Y + HALF_GOAL + 0.2)];
}

export function updateKeeper(s: MatchState, k: PlayerState): KeeperIntent {
  const b = s.ball;
  const gx = ownGoalX(k.team);
  const out = k.team === 0 ? 1 : -1;

  // Palla in mano: aspetta un attimo e poi rilancia (rasoterra o lungo).
  if (b.owner === k.idx) {
    k.gk.hold += DT;
    if (k.gk.hold > 1.0) {
      let best = -1;
      let bv = -Infinity;
      for (const q of s.players) {
        if (!q.active || q.team !== k.team || q.idx === k.idx) continue;
        const v = passValue(s, k, q);
        if (v > bv) {
          bv = v;
          best = q.idx;
        }
      }
      if (best >= 0) {
        const q = s.players[best];
        const far = dist(k.x, k.y, q.x, q.y) > 12 || !laneClear(s, k.team, k.x, k.y, q.x, q.y, 1);
        if (far) lobPass(s, k, best);
        else groundPass(s, k, best, 0.4);
      }
      k.gk.hold = 0;
    }
    return STILL;
  }
  k.gk.hold = 0;

  // --- Tiro in arrivo -----------------------------------------------------------
  const incoming = b.owner < 0 && b.shotActive && b.shotTeam !== k.team && b.vx * -out > 4;
  if (incoming && k.gk.seenShot !== b.shotId) {
    k.gk.seenShot = b.shotId;
    k.gk.react = keeperReaction(k.stats) + nextRandom(s) * 0.06;
  }
  if (k.gk.react > 0) k.gk.react -= DT;

  if (k.action.kind === 'dive') {
    // In volo: si muove con la fisica del tuffo, ma può ancora toccare la palla.
    if (incoming) checkSave(s, k);
    return STILL;
  }

  if (incoming) {
    checkSave(s, k);
    if (b.owner === k.idx || !b.shotActive) return STILL;
    if (k.gk.react > 0) return STILL; // non l'ha ancora letto
    const tc = (k.x - b.x) / b.vx;
    if (tc > 0 && tc < 1.8) {
      // Punto d'impatto previsto (con l'effetto).
      const yc = clamp(b.y + b.vy * tc + 0.5 * spinAccelY(s) * tc * tc, CENTER_Y - HALF_GOAL - 0.6, CENTER_Y + HALF_GOAL + 0.6);
      const gap = yc - k.y;
      if (Math.abs(gap) > 0.5 && tc < 0.45) {
        // Tuffo.
        const v = clamp(gap / Math.max(tc, 0.12), -keeperDive(k.stats), keeperDive(k.stats));
        setAction(k, 'dive', 0.7, 0, gap > 0 ? 1 : -1);
        k.vx = 0;
        k.vy = v;
        s.events.push({ type: 'dive', p: k.idx, team: k.team, x: k.x, y: k.y });
        return STILL;
      }
      return seekTo(k, k.x, yc, keeperSpeed(k.stats) * 1.3);
    }
  }

  // --- Posizionamento ---------------------------------------------------------------
  const c = b.owner >= 0 ? s.players[b.owner] : null;
  const dBall = dist(b.x, b.y, gx, CENTER_Y);
  let depth = dBall < 10 ? 1.0 + (10 - dBall) * 0.1 : 0.8;

  // Uno contro uno chiaro: attaccante centrale, vicino, nessun difensore in mezzo.
  if (c && c.team !== k.team && c.role === 'field') {
    const dC = dist(c.x, c.y, gx, CENTER_Y);
    const oneOnOne =
      dC < 9.5 && Math.abs(c.y - CENTER_Y) < 5 && laneClear(s, c.team, c.x, c.y, gx, CENTER_Y, 1.1, true) && (c.vx * -out > 1.5 || dC < 6);
    if (oneOnOne) {
      depth = clamp(dC - 2.2, 1.2, 3.6);
      // Palla scoperta (tocco lungo) e vicina: si butta sui piedi.
      if (c.ballOff > EXPOSED_OFFSET && dist(k.x, k.y, b.x, b.y) < 1.6) {
        return seekTo(k, b.x, b.y, keeperSpeed(k.stats) * 1.4);
      }
    }
  }

  // Palla vagante vicina alla porta: esce solo se ci arriva prima degli avversari.
  if (!c && !b.shotActive && b.inGoal < 0) {
    const nearGoal = Math.abs(b.x - gx) < 6 && Math.abs(b.y - CENTER_Y) < 6;
    const sp = len(b.vx, b.vy);
    if (nearGoal && sp < 10 && b.z < 2) {
      const myT = dist(k.x, k.y, b.x, b.y) / keeperSpeed(k.stats);
      let oppT = Infinity;
      for (const q of s.players) {
        if (!q.active || q.team === k.team) continue;
        oppT = Math.min(oppT, dist(q.x, q.y, b.x, b.y) / 7);
      }
      if (myT < oppT - 0.1) return seekTo(k, b.x, b.y, keeperSpeed(k.stats) * 1.3);
    }
  }

  let [tx, ty] = anglePosition(k.team, b.x, b.y, depth);
  tx = out > 0 ? clamp(tx, 0.3, 4) : clamp(tx, FIELD.length - 4, FIELD.length - 0.3);
  return seekTo(k, tx, ty, keeperSpeed(k.stats));
}

/** Componente y dell'accelerazione da effetto (per prevedere i tiri a giro). */
function spinAccelY(s: MatchState): number {
  const b = s.ball;
  const sp = len(b.vx, b.vy);
  return sp > 1 ? (b.vx / sp) * b.spin : 0;
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
  const reachZ = diving ? 1.5 : 2.1;
  if (lateral > reach || b.z > reachZ) return;
  k.gk.rolledShot = b.shotId;
  const bs = len(b.vx, b.vy);
  const flight = dist(b.shotX, b.shotY, b.x, b.y) / Math.max(bs, 1);
  // Non ancora reagito: para solo se la palla gli arriva addosso (blocco col corpo).
  let p = k.gk.react > 0 ? (lateral < 0.55 && b.z < 1.6 ? 0.6 : 0.12) : keeperSaveChance(k.stats, bs, lateral, b.z, flight);
  p = Math.min(0.95, p * s.tune.keeper);
  // Tiro Gamebreaker: quasi imparabile.
  if (b.shotGb) p *= 0.3;
  if (!chance(s, p)) return; // gol (o palla che passa)
  s.stats[k.team].saves += 1;
  s.stats[b.shotTeam as 0 | 1].onTarget += 1;
  b.shotActive = false;
  b.spin = 0;
  b.lastTouch = k.idx;
  b.passTarget = -1;
  b.passKind = 0;
  if (chance(s, keeperCatchChance(k.stats, bs, Math.max(0, lateral - 0.3)))) {
    b.owner = k.idx;
    k.fx = out;
    k.fy = 0;
    if (!diving) setAction(k, 'none', 0);
    s.events.push({ type: 'catch', p: k.idx, team: k.team, x: b.x, y: b.y });
  } else {
    // Respinta: verso l'esterno, lontano dal centro della porta.
    const side = b.y >= CENTER_Y ? 1 : -1;
    b.vx = out * (3 + bs * 0.2);
    b.vy = side * (3 + nextRandom(s) * 4) + randSigned(s);
    b.vz = 2 + nextRandom(s) * 3;
    b.x = k.x + out * 0.4;
    b.kicker = k.idx;
    b.kickCd = 0.4;
    s.events.push({ type: 'save', p: k.idx, team: k.team, power: bs, x: b.x, y: b.y, z: b.z });
  }
}
