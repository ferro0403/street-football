// IA dei giocatori di movimento, stile FIFA Street (semplice ma credibile).
// Livelli (skill game-ai): percezione minima → decisione a intervalli → movimento ogni tick.
// - Portatore: tira se ha l'occasione, passa se pressato o se un compagno sta meglio,
//   altrimenti dribbla verso la zona di tiro schivando l'avversario. Mai fermo.
// - Compagni: si smarcano (spazio libero + linea di passaggio pulita) e si muovono di continuo.
// - Difesa: UN difensore va sul portatore (e contrasta in piedi; scivolata rara), gli altri
//   marcano un avversario o coprono la zona davanti alla porta.
// - Palla vagante: il più vicino di ogni squadra la insegue.
// - Guardia anti-blocco: chi resta fermo troppo a lungo rifà subito la scelta.
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, norm } from './math';
import { chance, nextRandom } from './rng';
import { pass, passValue, predictSlide, predictTackle, shoot, startSlide, startTackle } from './actions';
import { AI_TACKLE_WAIT, aiTackleReaction } from './stats';
import type { MatchState, PlayerState } from './types';
import { attackDir, keeperOf, laneClear, nearestOpponent, oppGoalX, openness, ownGoalX } from './world';

export interface Intent {
  mx: number;
  my: number;
  sprint: boolean;
  /** Con palla: protezione. */
  shield?: boolean;
}

const STAND: Intent = { mx: 0, my: 0, sprint: false };

type Slot = 'def' | 'left' | 'right' | 'fwd';
const slotOf = (p: PlayerState): Slot => (['def', 'def', 'left', 'right', 'fwd'] as const)[p.idx % 5];

/** Decisione a intervalli (con un po' di variazione, così non decidono tutti insieme). */
function thinkDue(s: MatchState, p: PlayerState, base: number): boolean {
  p.ai.think -= DT;
  // Anti-blocco: fermo da troppo tempo → si decide subito.
  if (p.ai.think > 0 && p.ai.still < 1) return false;
  p.ai.think = base + nextRandom(s) * base * 0.6;
  return true;
}

function seek(p: PlayerState, tx: number, ty: number, sprintDist = 4): Intent {
  const d = dist(p.x, p.y, tx, ty);
  if (d < 0.2) return { ...STAND };
  const [mx, my] = norm(tx - p.x, ty - p.y);
  const k = Math.min(1, d / 0.8);
  return { mx: mx * k, my: my * k, sprint: d > sprintDist && p.stamina > 0.25 };
}

export function aiFieldPlayer(s: MatchState, p: PlayerState): Intent {
  if (p.ai.tackleWait > 0) p.ai.tackleWait = Math.max(0, p.ai.tackleWait - DT);
  if (s.phase !== 'play' || p.stun > 0) {
    p.ai.windup = 0;
    return STAND;
  }
  const b = s.ball;
  if (b.owner === p.idx) return carrier(s, p);
  if (b.owner < 0) {
    if (b.passTarget === p.idx) return receive(s, p);
    const passTeam = b.passTarget >= 0 ? s.players[b.passTarget].team : -1;
    // Un passaggio avversario in viaggio non si insegue: si resta in marcatura (l'intercetto
    // avviene solo se uno è già sulla linea). Si insegue solo la palla davvero vagante.
    if (passTeam < 0 && isChaser(s, p)) return chase(s, p);
    return passTeam === p.team ? support(s, p) : defend(s, p);
  }
  return s.players[b.owner].team === p.team ? support(s, p) : defend(s, p);
}

// --- Con la palla ------------------------------------------------------------------

function carrier(s: MatchState, p: PlayerState): Intent {
  const dir = attackDir(p.team);
  const gx = oppGoalX(p.team);
  const dGoal = dist(p.x, p.y, gx, CENTER_Y);
  const opp = nearestOpponent(s, p, false);
  const pressured = opp.d < 2;
  p.ai.pressed = pressured ? p.ai.pressed + DT : Math.max(0, p.ai.pressed - DT * 2);
  // Vicino a un muro: la palla rischia di restare intrappolata.
  const nearWall = Math.min(p.x, FIELD.length - p.x, p.y, FIELD.width - p.y) < 2;

  // Dribbling secco deciso quando un difensore ha caricato il contrasto (vedi press).
  if (p.ai.cut > 0) {
    p.ai.cut -= DT;
    if (p.ai.cut <= 0 && opp.p) {
      p.ai.cut = 0;
      const [vx, vy] = norm(p.vx || p.fx, p.vy || p.fy);
      // Perpendicolare alla corsa, dalla parte opposta al difensore.
      const side = (opp.p.x - p.x) * -vy + (opp.p.y - p.y) * vx > 0 ? -1 : 1;
      p.ai.tx = clamp(p.x - vy * side * 3 + dir * 0.5, 1, FIELD.length - 1);
      p.ai.ty = clamp(p.y + vx * side * 3, 1, FIELD.width - 1);
      p.ai.think = 0.4;
    }
  }

  if (thinkDue(s, p, 0.2)) {
    // 1) Tiro: verso l'angolo con la linea libera (il difensore che contiene sta sulla linea
    //    centrale: bisogna aprirsi l'angolo).
    const range = 7 + (p.stats.shooting / 99) * 7;
    const angleOk = Math.abs(p.y - CENTER_Y) < Math.abs(gx - p.x) * 1.1 + 1;
    if (dGoal < range && angleOk) {
      const k = keeperOf(s, p.team === 0 ? 1 : 0);
      const first = k.y < CENTER_Y ? 1 : -1;
      let aim = 0;
      let open = false;
      for (const side of [first, -first]) {
        if (laneClear(s, p.team, p.x, p.y, gx, CENTER_Y + side * FIELD.goalWidth * 0.33, 0.45, true)) {
          aim = side * (0.5 + nextRandom(s) * 0.45);
          open = true;
          break;
        }
      }
      const quality = (1 - dGoal / range) * (open ? 1 : 0.3);
      if (open && (quality > 0.25 || dGoal < 7 || chance(s, 0.35))) {
        shoot(s, p, clamp(0.3 + dGoal / 20 + nextRandom(s) * 0.3, 0.2, 1), aim);
        return STAND;
      }
      // Chiuso: dribbling secco di lato per aprirsi l'angolo.
      if (!open && pressured && p.ai.cut <= 0 && chance(s, 0.25)) p.ai.cut = DT;
    }
    // 2) Passaggio: se pressato, o se un compagno è messo molto meglio.
    let best: PlayerState | null = null;
    let bv = -Infinity;
    for (const q of s.players) {
      if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
      const v = passValue(s, p, q);
      if (v > bv) {
        bv = v;
        best = q;
      }
    }
    const selfV = openness(s, p.team, p.x, p.y) * 0.7 + (dGoal < 12 ? 1.5 : 0);
    // Pressato da troppo tempo (o chiuso contro il muro): scarica al compagno migliore.
    const stuck = p.ai.pressed > 1.2 || (nearWall && pressured);
    if (best && (stuck || (bv > selfV + (pressured ? -0.5 : 2) && (pressured || chance(s, 0.5))))) {
      p.ai.pressed = 0;
      pass(s, p, best.idx);
      return STAND;
    }
    // 3) Dribbling: verso la zona di tiro, schivando chi ha davanti.
    let tx = gx - dir * 7;
    let ty = CENTER_Y + (p.y - CENTER_Y) * 0.5;
    if (Math.abs(p.x - gx) < 9) {
      // Già in zona: si sposta di lato per trovare l'angolo (mai fermo).
      tx = p.x + dir * 1.5;
      ty = p.y + (p.y < CENTER_Y ? 2 : -2);
    }
    if (opp.p && opp.d < 4) {
      const [ax, ay] = norm(p.x - opp.p.x, p.y - opp.p.y);
      const w = (4 - opp.d) * 1.4;
      tx = p.x + (tx - p.x) * 0.5 + ax * w + dir * 1.5;
      ty = p.y + (ty - p.y) * 0.5 + ay * w;
    }
    // Lontano dai muri: verso il centro del campo.
    const m = 3;
    if (p.x < m) tx += (m - p.x) * 2;
    if (p.x > FIELD.length - m) tx -= (p.x - FIELD.length + m) * 2;
    if (p.y < m) ty += (m - p.y) * 2;
    if (p.y > FIELD.width - m) ty -= (p.y - FIELD.width + m) * 2;
    p.ai.tx = clamp(tx, 1, FIELD.length - 1);
    p.ai.ty = clamp(ty, 1, FIELD.width - 1);
  }
  const it = seek(p, p.ai.tx, p.ai.ty, 0);
  if (it.mx === 0 && it.my === 0) {
    // Arrivato: forza una nuova scelta al prossimo tick, intanto avanza.
    p.ai.think = 0;
    return { mx: dir, my: 0, sprint: false };
  }
  it.sprint = !pressured && p.stamina > 0.35 && opp.d > 3;
  return it;
}

// --- Senza palla, la mia squadra attacca ----------------------------------------------

function baseSpot(s: MatchState, p: PlayerState): [number, number] {
  const dir = attackDir(p.team);
  const b = s.ball;
  const W = FIELD.width;
  let x: number;
  let y: number;
  switch (slotOf(p)) {
    case 'def':
      x = b.x - dir * 8;
      y = CENTER_Y + (b.y - CENTER_Y) * 0.3;
      break;
    case 'left':
      x = b.x + dir * 3;
      y = W * 0.2;
      break;
    case 'right':
      x = b.x + dir * 3;
      y = W * 0.8;
      break;
    default:
      x = b.x + dir * 8;
      y = CENTER_Y + (CENTER_Y - b.y) * 0.35;
  }
  const limit = oppGoalX(p.team) - dir * 2.5;
  x = dir > 0 ? Math.min(x, limit) : Math.max(x, limit);
  return [clamp(x, 2, FIELD.length - 2), clamp(y, 1.5, W - 1.5)];
}

const OFFSETS: [number, number][] = [
  [0, 0],
  [2.5, 0],
  [-2.5, 0],
  [0, 2.5],
  [0, -2.5],
  [2, 2],
  [2, -2],
];

/** Smarcamento: spazio libero e linea di passaggio pulita verso chi ha palla. */
function support(s: MatchState, p: PlayerState): Intent {
  const near = dist(p.x, p.y, p.ai.tx, p.ai.ty) < 0.8;
  if (thinkDue(s, p, 0.35) || near) {
    const [bx, by] = baseSpot(s, p);
    const dir = attackDir(p.team);
    const c = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
    let best = -Infinity;
    let btx = bx;
    let bty = by;
    for (const [ox, oy] of OFFSETS) {
      const x = clamp(bx + ox, 1.5, FIELD.length - 1.5);
      const y = clamp(by + oy, 1.2, FIELD.width - 1.2);
      let v = openness(s, p.team, x, y) * 0.8 + (x - bx) * dir * 0.12 - dist(bx, by, x, y) * 0.15;
      if (c && !laneClear(s, p.team, c.x, c.y, x, y, 0.9)) v -= 2;
      // Non restare dove sono: muoversi per chiedere palla.
      if (dist(p.x, p.y, x, y) < 1) v -= 1.2;
      for (const q of s.players) if (q.team === p.team && q.idx !== p.idx && dist(q.x, q.y, x, y) < 3) v -= 1.5;
      v += nextRandom(s) * 0.3;
      if (v > best) {
        best = v;
        btx = x;
        bty = y;
      }
    }
    p.ai.tx = btx;
    p.ai.ty = bty;
    p.ai.think = Math.max(p.ai.think, 0.3);
  }
  return seek(p, p.ai.tx, p.ai.ty, 5);
}

// --- Palla vagante / ricezione ---------------------------------------------------------

function predictBall(s: MatchState, t: number): [number, number] {
  const b = s.ball;
  return [clamp(b.x + b.vx * t, 0.5, FIELD.length - 0.5), clamp(b.y + b.vy * t, 0.5, FIELD.width - 0.5)];
}

/** Il passaggio è per me: non scappo, vado incontro alla palla (al passo). */
function receive(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  if (d < 0.3) return { ...STAND };
  const [mx, my] = norm(b.x - p.x, b.y - p.y);
  const k = d < 1.5 ? 1 : 0.55;
  return { mx: mx * k, my: my * k, sprint: false };
}

/** Inseguo la palla vagante se sono il più vicino della squadra (gli umani contano). */
function isChaser(s: MatchState, p: PlayerState): boolean {
  const [px, py] = predictBall(s, 0.3);
  const myD = dist(p.x, p.y, px, py);
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const qd = dist(q.x, q.y, px, py);
    if (qd < myD || (qd === myD && q.idx < p.idx)) return false;
  }
  return true;
}

function chase(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const [tx, ty] = predictBall(s, Math.min(0.5, d / 8));
  return seek(p, tx, ty, 1.5);
}

// --- Difesa -------------------------------------------------------------------------------

function defend(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const team = p.team;
  const gx = ownGoalX(team);
  const c = b.owner >= 0 ? s.players[b.owner] : null;

  // Chi va sul portatore: il difensore CPU più vicino alla palla.
  let presser: PlayerState | null = null;
  let pd = Infinity;
  let humanD = Infinity;
  for (const q of s.players) {
    if (q.team !== team || q.role === 'gk') continue;
    const d = dist(q.x, q.y, b.x, b.y);
    if (q.human) {
      humanD = Math.min(humanD, d);
      continue;
    }
    if (d < pd) {
      pd = d;
      presser = q;
    }
  }

  if (presser === p && c) return press(s, p, c, humanD < pd - 0.5);
  p.ai.windup = 0;

  // Marcatura: ognuno prende l'attaccante libero più vicino (ordine stabile per indice).
  const attackers = s.players.filter((q) => q.team !== team && q.role === 'field' && q.idx !== b.owner);
  const markers = s.players.filter((q) => q.team === team && q.role === 'field' && q !== presser && !q.human);
  const taken = new Set<number>();
  let mark: PlayerState | null = null;
  for (const m of markers) {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const a of attackers) {
      if (taken.has(a.idx)) continue;
      const d = dist(m.x, m.y, a.x, a.y) + Math.abs(a.x - gx) * 0.15;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) taken.add(best.idx);
    if (m === p) {
      mark = best;
      break;
    }
  }
  if (mark) {
    const [gdx, gdy] = norm(gx - mark.x, CENTER_Y - mark.y);
    let tx = mark.x + gdx * 1.6;
    let ty = mark.y + gdy * 1.6;
    if (c) {
      // Un po' sulla linea di passaggio dal portatore.
      tx = tx * 0.8 + ((c.x + mark.x) / 2) * 0.2;
      ty = ty * 0.8 + ((c.y + mark.y) / 2) * 0.2;
    }
    return seek(p, tx, ty, 3.5);
  }
  // Nessuno da marcare: copre davanti alla porta, verso il lato della palla.
  return seek(p, gx + attackDir(team) * 6, CENTER_Y + (b.y - CENTER_Y) * 0.4, 4);
}

// --- Pressing sul portatore: contenere, aspettare, entrare -----------------------------------

/** Distanza di contenimento davanti all'attaccante (m). */
const JOCKEY_DIST = 1.25;
/** Dopo una scivolata la CPU non ne fa un'altra per un bel po' (s). */
const AI_SLIDE_REST = 9;

/**
 * Il difensore CPU sta DAVANTI all'attaccante (tra lui e la porta) e lo accompagna. Entra solo
 * quando prevede che il contrasto riesca (palla lontana dal piede dopo un tocco, corpo che
 * non copre, nessun dribbling in corso). Prima di entrare carica per un attimo: segnale
 * visibile per chi ha palla. Dopo ogni tentativo aspetta 1,5-2,5 s (meno se più aggressivo).
 */
function press(s: MatchState, p: PlayerState, c: PlayerState, cover: boolean): Intent {
  const gx = ownGoalX(p.team);
  const aggr = s.tune.aggression;
  const d = dist(p.x, p.y, c.x, c.y);

  if (p.ai.windup > 0) {
    p.ai.windup -= DT;
    if (p.ai.windup <= 0) {
      p.ai.windup = 0;
      startTackle(s, p);
      return STAND;
    }
  }

  // Dove stare: davanti, sulla linea verso la porta; se protegge palla, girargli intorno.
  const [gdx, gdy] = norm(gx - c.x, CENTER_Y - c.y);
  const jd = cover ? 3 : JOCKEY_DIST / (0.85 + 0.15 * aggr);
  let tx = c.x + c.vx * 0.2 + gdx * jd;
  let ty = c.y + c.vy * 0.2 + gdy * jd;
  if (c.shielding && !cover) {
    tx = c.x + c.shx * 1.05;
    ty = c.y + c.shy * 1.05;
  }

  if (!cover && p.ai.windup <= 0 && p.ai.tackleWait <= 0 && c.role !== 'gk' && d < 2.4 && p.tackleCd <= 0) {
    const react = aiTackleReaction(p.stats) / Math.sqrt(aggr);
    // Più aggressivo = entra anche quando la palla è appena al limite del piede.
    const out = predictTackle(s, p, c, react, (aggr - 1) * 0.12);
    if (out === 'steal') {
      p.ai.windup = react;
      p.ai.tackleWait = react + tackleWait(s, aggr);
      s.events.push({ type: 'windup', p: p.idx, team: p.team, x: p.x, y: p.y });
      // Un portatore CPU bravo nel dribbling a volte lo legge e cambia direzione all'ultimo.
      if (!c.human && chance(s, 0.12 + (c.stats.dribbling / 99) * 0.33)) c.ai.cut = Math.max(DT, react - 0.12);
    } else if (
      p.slideCd <= 0 &&
      d > 1.6 &&
      d < 3 &&
      Math.abs(c.x - gx) < 14 && // solo quando è pericoloso
      (p.x - c.x) * gdx + (p.y - c.y) * gdy < 0.3
    ) {
      // Scivolata solo se l'attaccante gli è scappato (non è più davanti a lui) e la palla
      // è raggiungibile senza passare dal corpo.
      const so = predictSlide(s, p, c, 0.2);
      if (so === 'steal') {
        startSlide(s, p);
        p.slideCd = AI_SLIDE_REST; // con moderazione: poi a lungo niente scivolate
        p.ai.tackleWait = tackleWait(s, aggr);
        return STAND;
      }
    }
  }

  const it = seek(p, tx, ty, 3);
  // Vicino all'attaccante non scatta: lo accompagna (mai fermo se lui si muove).
  if (d < 2.5) it.sprint = false;
  return it;
}

/** Attesa tra due tentativi: 1,5-2,5 s, meno se la difesa è più aggressiva. */
function tackleWait(s: MatchState, aggr: number): number {
  return (AI_TACKLE_WAIT[0] + nextRandom(s) * (AI_TACKLE_WAIT[1] - AI_TACKLE_WAIT[0])) / aggr;
}
