// Simulazione della partita a passo fisso. Pura e deterministica: dato lo stesso stato e gli
// stessi input produce lo stesso stato. Gira identica nel browser e (in futuro) su un server Node.
import { CENTER_X, CENTER_Y, DT, FIELD, PHYS, RULES, PLAYERS_PER_TEAM } from './constants';
import { clamp, dist, len, norm } from './math';
import { seedFrom } from './rng';
import {
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  acceleration,
  controlMaxSpeed,
  controlRadius,
  dribbleSpeedMult,
  overall,
  runSpeed,
  turnRate,
} from './stats';
import { attachBall, stepBall } from './ball';
import { feint, pass, pickPassTarget, resolveTackle, setAction, shoot, special, startTackle } from './actions';
import { aiFieldPlayer, type Intent } from './ai';
import { updateKeeper } from './keeper';
import type {
  ControllerState,
  InputMap,
  MatchState,
  PlayerInput,
  PlayerState,
  TeamDef,
  TeamIndex,
  TeamMeta,
} from './types';
import { attackDir, ownGoalX } from './world';

export const NEUTRAL_INPUT: PlayerInput = Object.freeze({
  mx: 0,
  my: 0,
  sprint: false,
  pass: false,
  shoot: false,
  feint: false,
  skill: false,
  switch: false,
}) as PlayerInput;

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  durationSec?: number;
  seed?: number;
  /** Giocatori umani: id del controller e squadra. Nessuno = CPU contro CPU. */
  humans?: { id: string; team: TeamIndex }[];
}

function teamMeta(t: TeamDef): TeamMeta {
  const ovr = Math.round(t.players.reduce((a, p) => a + overall(p.stats, p.role), 0) / t.players.length);
  return { id: t.id, name: t.name, short: t.short, nation: t.nation, kit: t.kit, gkKit: t.gkKit, ovr };
}

export function createMatch(cfg: MatchConfig): MatchState {
  const teams: [TeamDef, TeamDef] = [cfg.home, cfg.away];
  for (const t of teams) {
    if (t.players.length !== PLAYERS_PER_TEAM) throw new Error(`${t.name}: servono ${PLAYERS_PER_TEAM} giocatori`);
  }
  const players: PlayerState[] = [];
  teams.forEach((t, ti) => {
    t.players.forEach((d, i) => {
      players.push({
        idx: ti * PLAYERS_PER_TEAM + i,
        team: ti as TeamIndex,
        role: i === 0 ? 'gk' : 'field',
        defId: d.id,
        name: d.name,
        number: d.number,
        stats: { ...d.stats },
        special: i === 0 ? null : d.special,
        ovr: overall(d.stats, i === 0 ? 'gk' : 'field'),
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        fx: ti === 0 ? 1 : -1,
        fy: 0,
        stamina: 1,
        action: { kind: 'none', t: 0, dur: 0, dx: 0, dy: 0, done: false },
        stun: 0,
        evade: 0,
        skillCd: 0,
        feintCd: 0,
        tackleCd: 0,
        charge: 0,
        chargeKind: 'none',
        human: null,
        ai: { think: 0, tx: 0, ty: 0, score: -1e9 },
        gk: { react: 0, seenShot: -1, rolledShot: -1, hold: 0 },
      });
    });
  });

  const duration = cfg.durationSec ?? RULES.defaultDurationSec;
  const s: MatchState = {
    version: 1,
    tick: 0,
    rng: seedFrom(cfg.seed ?? 1),
    phase: 'kickoff',
    phaseTime: 0,
    clock: duration,
    duration,
    score: [0, 0],
    teams: [teamMeta(cfg.home), teamMeta(cfg.away)],
    players,
    ball: {
      x: CENTER_X,
      y: CENTER_Y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      owner: -1,
      lastTouch: -1,
      kicker: -1,
      kickCd: 0,
      passTarget: -1,
      shotId: 0,
      shotTeam: -1,
      shotActive: false,
      inGoal: -1,
    },
    controllers: [],
    kickoffTeam: 0,
    lastGoal: null,
    stats: [emptyStats(), emptyStats()],
    events: [],
  };
  for (const h of cfg.humans ?? []) addController(s, h.id, h.team);
  resetKickoff(s, 0);
  return s;
}

function emptyStats() {
  return { shots: 0, onTarget: 0, saves: 0, tackles: 0, passes: 0, possessionTicks: 0 };
}

/** Aggiunge un controller umano (es. un giocatore in più che si collega). */
export function addController(s: MatchState, id: string, team: TeamIndex): void {
  if (s.controllers.some((c) => c.id === id)) return;
  const c: ControllerState = { id, team, player: -1, prev: { ...NEUTRAL_INPUT } };
  s.controllers.push(c);
  const free = s.players
    .filter((p) => p.team === team && p.role === 'field' && !p.human)
    .sort((a, b) => dist(a.x, a.y, s.ball.x, s.ball.y) - dist(b.x, b.y, s.ball.x, s.ball.y))[0];
  if (free) assign(s, c, free.idx);
}

function assign(s: MatchState, c: ControllerState, idx: number): void {
  if (c.player === idx) return;
  if (c.player >= 0) {
    const old = s.players[c.player];
    old.human = null;
    old.charge = 0;
    old.chargeKind = 'none';
    old.ai.think = 0;
  }
  c.player = idx;
  s.players[idx].human = c.id;
  s.events.push({ type: 'switch', p: idx, team: c.team, ctrl: c.id });
}

// --- Calcio d'inizio ---------------------------------------------------------------

const KICKOFF_SPOTS: [number, number][] = [
  [0.9, CENTER_Y], // portiere (distanza dalla propria linea)
  [7, CENTER_Y],
  [12, FIELD.width * 0.22],
  [12, FIELD.width * 0.78],
  [15.5, CENTER_Y],
];

export function resetKickoff(s: MatchState, team: TeamIndex): void {
  s.phase = 'kickoff';
  s.phaseTime = 0;
  s.kickoffTeam = team;
  const b = s.ball;
  Object.assign(b, {
    x: CENTER_X,
    y: CENTER_Y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    owner: -1,
    lastTouch: -1,
    kicker: -1,
    kickCd: 0,
    passTarget: -1,
    shotActive: false,
    shotTeam: -1,
    inGoal: -1,
  });
  for (const p of s.players) {
    const i = p.idx % PLAYERS_PER_TEAM;
    const dir = attackDir(p.team);
    const [ox, oy] = KICKOFF_SPOTS[i];
    p.x = ownGoalX(p.team) + dir * ox;
    p.y = oy;
    if (i === 4) {
      // L'attaccante di chi batte sta sulla palla, l'altro a distanza.
      p.x = p.team === team ? CENTER_X - dir * 0.6 : CENTER_X - dir * 4;
    }
    p.vx = p.vy = 0;
    p.fx = dir;
    p.fy = 0;
    p.action = { kind: 'none', t: 0, dur: 0, dx: 0, dy: 0, done: false };
    p.stun = p.evade = 0;
    p.charge = 0;
    p.chargeKind = 'none';
    p.ai.think = 0;
    p.ai.score = -1e9;
    p.ai.tx = p.x;
    p.ai.ty = p.y;
    p.gk.hold = 0;
  }
  // Il controller passa all'attaccante di chi batte (o al più vicino alla palla).
  for (const c of s.controllers) {
    const cands = s.players.filter((p) => p.team === c.team && p.role === 'field' && (!p.human || p.human === c.id));
    const others = s.controllers.filter((o) => o !== c && o.team === c.team).length;
    if (others > 0 && c.player >= 0) continue; // in cooperativa ognuno tiene il suo
    cands.sort((a, b2) => dist(a.x, a.y, CENTER_X, CENTER_Y) - dist(b2.x, b2.y, CENTER_X, CENTER_Y));
    if (cands[0]) assign(s, c, cands[0].idx);
  }
}

// --- Passo principale ---------------------------------------------------------

export function stepMatch(s: MatchState, inputs: InputMap): void {
  s.events = [];
  s.tick += 1;
  s.phaseTime += DT;

  if (s.phase === 'ended') return;

  if (s.phase === 'goal') {
    stepGoalPhase(s, inputs);
    return;
  }

  if (s.phase === 'kickoff') {
    // Tutti fermi; i controller restano registrati per i fronti di salita.
    for (const c of s.controllers) c.prev = { ...(inputs[c.id] ?? NEUTRAL_INPUT) };
    if (s.phaseTime >= RULES.kickoffFreezeSec) {
      s.phase = 'play';
      s.phaseTime = 0;
      const kicker = s.players[s.kickoffTeam * PLAYERS_PER_TEAM + 4];
      s.ball.owner = kicker.idx;
      s.ball.lastTouch = kicker.idx;
      s.events.push({ type: 'whistle' }, { type: 'kickoff', team: s.kickoffTeam });
    }
    return;
  }

  // phase === 'play'
  s.clock = Math.max(0, s.clock - DT);
  const prevOwner = s.ball.owner;

  updateControllers(s, inputs);

  for (const p of s.players) {
    tickTimers(p);
    let intent: Intent;
    if (p.role === 'gk') {
      const k = updateKeeper(s, p);
      intent = { mx: k.mx, my: k.my, sprint: false };
      movePlayer(s, p, intent, k.speed);
      continue;
    }
    if (p.human) {
      const c = s.controllers.find((x) => x.id === p.human)!;
      intent = humanIntent(s, p, inputs[c.id] ?? NEUTRAL_INPUT, c.prev);
    } else {
      intent = aiFieldPlayer(s, p);
    }
    resolveTackle(s, p);
    movePlayer(s, p, intent, 0);
  }
  for (const c of s.controllers) c.prev = { ...(inputs[c.id] ?? NEUTRAL_INPUT) };

  separatePlayers(s);

  // Palla.
  const b = s.ball;
  if (b.kickCd > 0) b.kickCd -= DT;
  if (b.owner >= 0) {
    attachBall(s);
  } else {
    const scored = stepBall(s);
    if (scored >= 0) {
      onGoal(s, scored as TeamIndex);
      return;
    }
    tryPossession(s);
  }
  if (b.shotActive && b.owner < 0 && len(b.vx, b.vy) < 4) b.shotActive = false;

  if (b.owner >= 0) s.stats[s.players[b.owner].team].possessionTicks += 1;
  if (b.owner !== prevOwner && b.owner >= 0) {
    const p = s.players[b.owner];
    s.events.push({ type: 'possession', p: p.idx, team: p.team });
    autoSwitchOnPossession(s, p.team, p.idx);
  }

  if (s.clock <= 0) {
    s.phase = 'ended';
    s.phaseTime = 0;
    s.events.push({ type: 'whistle' }, { type: 'end' });
  }
}

function tickTimers(p: PlayerState): void {
  const a = p.action;
  if (a.kind !== 'none') {
    a.t += DT;
    if (a.t >= a.dur && a.kind !== 'celebrate') a.kind = 'none';
  }
  if (p.stun > 0) p.stun = Math.max(0, p.stun - DT);
  if (p.evade > 0) p.evade = Math.max(0, p.evade - DT);
  if (p.skillCd > 0) p.skillCd = Math.max(0, p.skillCd - DT);
  if (p.feintCd > 0) p.feintCd = Math.max(0, p.feintCd - DT);
  if (p.tackleCd > 0) p.tackleCd = Math.max(0, p.tackleCd - DT);
}

// --- Umani --------------------------------------------------------------------

const CHARGE_TIME = 0.9;

function humanIntent(s: MatchState, p: PlayerState, inp: PlayerInput, prev: PlayerInput): Intent {
  let mx = Number.isFinite(inp.mx) ? inp.mx : 0;
  let my = Number.isFinite(inp.my) ? inp.my : 0;
  const l = len(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  const pressed = (k: keyof PlayerInput) => !!inp[k] && !prev[k];
  const released = (k: keyof PlayerInput) => !inp[k] && !!prev[k];
  const hasBall = s.ball.owner === p.idx;
  // Lato della finta: componente dell'input perpendicolare allo sguardo.
  const side = mx * -p.fy + my * p.fx;

  if (hasBall && p.stun <= 0) {
    if (inp.shoot && p.chargeKind !== 'pass') {
      p.chargeKind = 'shot';
      p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
    } else if (inp.pass && p.chargeKind !== 'shot') {
      p.chargeKind = 'pass';
      p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
    }
    if (released('shoot') && p.chargeKind === 'shot') {
      // La mira è lo spostamento laterale (asse y del campo) dato dalla levetta.
      const aim = clamp(my * 1.3, -1, 1);
      shoot(s, p, 0.15 + p.charge * 0.85, aim);
      return { mx, my, sprint: false };
    }
    if (released('pass') && p.chargeKind === 'pass') {
      const lofted = p.charge > 0.3;
      const t = pickPassTarget(s, p, l > 0.2 ? mx : p.fx, l > 0.2 ? my : p.fy);
      if (t >= 0) {
        pass(s, p, t, lofted);
        autoSwitchToReceiver(s, p.team, t);
      } else {
        p.charge = 0;
        p.chargeKind = 'none';
      }
      return { mx, my, sprint: false };
    }
    if (pressed('feint')) feint(s, p, side);
    if (pressed('skill')) special(s, p, side);
  } else {
    p.charge = 0;
    p.chargeKind = 'none';
    if (s.phase === 'play' && p.stun <= 0) {
      if (pressed('shoot')) startTackle(s, p);
    }
  }
  return { mx, my, sprint: inp.sprint };
}

function updateControllers(s: MatchState, inputs: InputMap): void {
  for (const c of s.controllers) {
    const inp = inputs[c.id] ?? NEUTRAL_INPUT;
    const p = c.player >= 0 ? s.players[c.player] : null;
    const hasBall = p !== null && s.ball.owner === p.idx;
    const manual = (inp.switch && !c.prev.switch) || (!hasBall && inp.pass && !c.prev.pass);
    if (manual) switchToBest(s, c, true);
  }
}

/** Cambia giocatore: il compagno più vicino alla palla (non portiere, non di un altro umano). */
function switchToBest(s: MatchState, c: ControllerState, excludeCurrent: boolean): void {
  const b = s.ball;
  let best = -1;
  let bd = Infinity;
  for (const p of s.players) {
    if (p.team !== c.team || p.role === 'gk') continue;
    if (p.human && p.human !== c.id) continue;
    if (excludeCurrent && p.idx === c.player) continue;
    const d = dist(p.x, p.y, b.x, b.y);
    if (d < bd) {
      bd = d;
      best = p.idx;
    }
  }
  if (best >= 0) assign(s, c, best);
}

function soloController(s: MatchState, team: TeamIndex): ControllerState | null {
  const cs = s.controllers.filter((c) => c.team === team);
  return cs.length === 1 ? cs[0] : null;
}

function autoSwitchOnPossession(s: MatchState, team: TeamIndex, owner: number): void {
  const o = s.players[owner];
  // La mia squadra prende palla: controllo chi ce l'ha.
  const mine = soloController(s, team);
  if (mine && o.role === 'field' && !o.human) assign(s, mine, owner);
  // L'altra squadra l'ha persa: passo al più vicino alla palla, se il mio è lontano.
  const otherTeam: TeamIndex = team === 0 ? 1 : 0;
  const theirs = soloController(s, otherTeam);
  if (theirs) {
    const cur = theirs.player >= 0 ? s.players[theirs.player] : null;
    const b = s.ball;
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const p of s.players) {
      if (p.team !== otherTeam || p.role === 'gk') continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best && (!cur || dist(cur.x, cur.y, b.x, b.y) > bd + 2)) assign(s, theirs, best.idx);
  }
}

function autoSwitchToReceiver(s: MatchState, team: TeamIndex, target: number): void {
  const c = soloController(s, team);
  const r = s.players[target];
  if (c && r.role === 'field' && !r.human) assign(s, c, target);
}

// --- Movimento -----------------------------------------------------------------

const LOCKED: ReadonlySet<string> = new Set(['tackle', 'feint', 'elastico', 'veronica', 'tunnel', 'sombrero', 'dive']);

function movePlayer(s: MatchState, p: PlayerState, it: Intent, keeperSpeed: number): void {
  const hasBall = s.ball.owner === p.idx;
  const st = p.stats;
  let mx = it.mx;
  let my = it.my;

  if (p.stun > 0 || p.action.kind === 'stunned') {
    mx = 0;
    my = 0;
  }
  const locked = LOCKED.has(p.action.kind);

  let maxV = keeperSpeed > 0 ? keeperSpeed : runSpeed(st);
  const sprinting = it.sprint && p.stamina > 0.02 && (mx !== 0 || my !== 0) && p.role === 'field';
  if (sprinting) {
    maxV *= SPRINT_MULT;
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * DT);
  } else {
    p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * DT);
  }
  if (hasBall) maxV *= dribbleSpeedMult(st);
  if (p.chargeKind !== 'none') maxV *= 0.75; // caricando si rallenta

  if (!locked) {
    const tvx = mx * maxV;
    const tvy = my * maxV;
    const k = Math.min(1, acceleration(st) * DT);
    p.vx += (tvx - p.vx) * k;
    p.vy += (tvy - p.vy) * k;
  } else {
    // Durante finte e contrasti conserva lo slancio e frena dolcemente.
    const k = Math.min(1, 3 * DT);
    p.vx -= p.vx * k;
    p.vy -= p.vy * k;
  }

  p.x += p.vx * DT;
  p.y += p.vy * DT;
  const r = PHYS.playerRadius;
  if (p.x < r) {
    p.x = r;
    p.vx = Math.max(0, p.vx);
  }
  if (p.x > FIELD.length - r) {
    p.x = FIELD.length - r;
    p.vx = Math.min(0, p.vx);
  }
  if (p.y < r) {
    p.y = r;
    p.vy = Math.max(0, p.vy);
  }
  if (p.y > FIELD.width - r) {
    p.y = FIELD.width - r;
    p.vy = Math.min(0, p.vy);
  }

  // Direzione dello sguardo: segue l'input (o la velocità) con un limite di rotazione.
  const sp = len(p.vx, p.vy);
  let dx = 0;
  let dy = 0;
  if (!locked && (mx !== 0 || my !== 0)) [dx, dy] = norm(mx, my);
  else if (sp > 0.5 && !locked) [dx, dy] = norm(p.vx, p.vy);
  if (dx !== 0 || dy !== 0) {
    const k = Math.min(1, turnRate(st, hasBall) * DT);
    const [nx, ny] = norm(p.fx + (dx - p.fx) * k, p.fy + (dy - p.fy) * k);
    if (nx !== 0 || ny !== 0) {
      p.fx = nx;
      p.fy = ny;
    } else {
      // Inversione di 180° esatta: ruota di lato.
      const ox = p.fx;
      p.fx = -p.fy;
      p.fy = ox;
    }
  }
}

function separatePlayers(s: MatchState): void {
  const ps = s.players;
  const minD = PHYS.playerRadius * 2;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      let nx: number;
      let ny: number;
      if (d < 1e-6) {
        nx = 1;
        ny = 0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }
      const push = (minD - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
  for (const p of ps) {
    p.x = clamp(p.x, PHYS.playerRadius, FIELD.length - PHYS.playerRadius);
    p.y = clamp(p.y, PHYS.playerRadius, FIELD.width - PHYS.playerRadius);
  }
}

// --- Possesso --------------------------------------------------------------------

function tryPossession(s: MatchState): void {
  const b = s.ball;
  if (b.inGoal >= 0) return;
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (const p of s.players) {
    if (p.stun > 0 || p.action.kind === 'dive') continue;
    if (p.idx === b.kicker && b.kickCd > 0) continue;
    const maxZ = p.role === 'gk' ? 2.2 : 1.0;
    if (b.z > maxZ) continue;
    const r = p.role === 'gk' ? 0.85 : controlRadius(p.stats);
    const d = dist(p.x, p.y, b.x, b.y);
    if (d > r) continue;
    // Il portiere non raccoglie i tiri: li gestisce la parata (keeper.ts).
    if (p.role === 'gk' && b.shotActive && b.shotTeam !== p.team) continue;
    // Il portiere usa le mani solo vicino alla propria porta.
    if (p.role === 'gk' && Math.abs(p.x - ownGoalX(p.team)) > 5.5) continue;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return;
  const sp = len(b.vx - best.vx, b.vy - best.vy);
  if (best.role === 'field' && sp > controlMaxSpeed(best.stats) && b.passTarget !== best.idx) {
    // Palla troppo veloce: tocco sporco, la palla rimbalza via.
    b.vx = -b.vx * 0.25 + best.vx * 0.5;
    b.vy = -b.vy * 0.25 + best.vy * 0.5;
    b.vz = 1.2;
    b.lastTouch = best.idx;
    b.kicker = best.idx;
    b.kickCd = 0.2;
    b.passTarget = -1;
    b.shotActive = false;
    return;
  }
  b.owner = best.idx;
  b.lastTouch = best.idx;
  b.passTarget = -1;
  b.shotActive = false;
  b.kicker = -1;
  // Si gira verso la direzione della palla.
  if (best.role === 'field') {
    const [fx, fy] = norm(best.vx || best.fx, best.vy || best.fy);
    if (fx !== 0 || fy !== 0) {
      best.fx = fx;
      best.fy = fy;
    }
  }
}

// --- Gol --------------------------------------------------------------------------

function onGoal(s: MatchState, team: TeamIndex): void {
  const b = s.ball;
  s.score[team] += 1;
  const scorer = b.lastTouch;
  const ownGoal = scorer >= 0 && s.players[scorer].team !== team;
  if (b.shotActive && b.shotTeam === team) s.stats[team].onTarget += 1;
  s.lastGoal = { team, scorer, ownGoal, tick: s.tick };
  s.phase = 'goal';
  s.phaseTime = 0;
  b.owner = -1;
  b.shotActive = false;
  for (const p of s.players) {
    p.charge = 0;
    p.chargeKind = 'none';
  }
  if (scorer >= 0 && !ownGoal) setAction(s.players[scorer], 'celebrate', RULES.goalPhaseSec);
  s.events.push({ type: 'goal', team, p: scorer, x: b.x, y: b.y, z: b.z });
}

function stepGoalPhase(s: MatchState, inputs: InputMap): void {
  // La palla finisce la sua corsa nella rete, i giocatori rallentano; l'autore esulta.
  stepBall(s);
  for (const p of s.players) {
    tickTimers(p);
    const scorerTeam = s.lastGoal?.team;
    let it: Intent = { mx: 0, my: 0, sprint: false };
    if (p.action.kind === 'celebrate' && s.phaseTime < 2.5) {
      // Corsa di esultanza verso il centro.
      const [mx, my] = norm(CENTER_X - p.x, CENTER_Y - p.y);
      it = { mx: mx * 0.7, my: my * 0.7, sprint: false };
    } else if (p.team === scorerTeam && s.lastGoal && s.lastGoal.scorer >= 0 && p.role === 'field') {
      // I compagni raggiungono chi ha segnato.
      const sc = s.players[s.lastGoal.scorer];
      if (dist(p.x, p.y, sc.x, sc.y) > 1.6) {
        const [mx, my] = norm(sc.x - p.x, sc.y - p.y);
        it = { mx: mx * 0.8, my: my * 0.8, sprint: false };
      }
    }
    movePlayer(s, p, it, p.role === 'gk' ? 3 : 0);
  }
  separatePlayers(s);

  let skip = false;
  for (const c of s.controllers) {
    const inp = inputs[c.id] ?? NEUTRAL_INPUT;
    if ((inp.pass && !c.prev.pass) || (inp.shoot && !c.prev.shoot) || (inp.skill && !c.prev.skill)) skip = true;
    c.prev = { ...inp };
  }
  const canSkip = s.phaseTime >= RULES.goalSkipAfterSec && s.controllers.length > 0;
  if (s.phaseTime >= RULES.goalPhaseSec || (skip && canSkip)) {
    if (s.clock <= 0) {
      s.phase = 'ended';
      s.events.push({ type: 'whistle' }, { type: 'end' });
      return;
    }
    const conceded: TeamIndex = s.lastGoal?.team === 0 ? 1 : 0;
    for (const p of s.players) if (p.action.kind === 'celebrate') p.action.kind = 'none';
    resetKickoff(s, conceded);
  }
}

/** Utility per test e debug: una copia profonda serializzabile. */
export function cloneState(s: MatchState): MatchState {
  return JSON.parse(JSON.stringify(s)) as MatchState;
}

/** Hash veloce (FNV-1a) dello stato serializzato: utile per confrontare simulazioni. */
export function hashState(s: MatchState): string {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

