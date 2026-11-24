// Simulazione della partita a passo fisso (Passo 1: base solida in stile FIFA Street).
// Pura e deterministica: stesso stato + stessi input = stesso stato. Niente arbitro, niente
// falli, niente fuorigioco: la gabbia tiene la palla sempre in gioco.
import { CENTER_X, CENTER_Y, DT, FIELD, PHYS, RULES, PLAYERS_PER_TEAM } from './constants';
import { clamp, dist, len, norm } from './math';
import { seedFrom } from './rng';
import {
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  TURN_RATE,
  acceleration,
  controlMaxSpeed,
  controlRadius,
  dribbleSpeedMult,
  overall,
  runSpeed,
} from './stats';
import { attachBall, stepBall } from './ball';
import { finishAction, freePass, pass, passTargetInDir, setAction, shoot, shotAim, startSlide, startTackle, updateTackles } from './actions';
import { aiFieldPlayer, type Intent } from './ai';
import { updateKeeper } from './keeper';
import { sanitizeTune } from './tune';
import type { ControllerState, InputMap, MatchState, PlayerInput, PlayerState, TeamDef, TeamIndex, TeamMeta, Tuning } from './types';
import { attackDir, ownGoalX } from './world';

export const NEUTRAL_INPUT: PlayerInput = Object.freeze({
  mx: 0,
  my: 0,
  sprint: false,
  pass: false,
  shoot: false,
  tackle: false,
  slide: false,
  switch: false,
}) as PlayerInput;

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  durationSec?: number;
  seed?: number;
  /** Giocatori umani: id del controller e squadra. Nessuno = CPU contro CPU. */
  humans?: { id: string; team: TeamIndex }[];
  tune?: Partial<Tuning>;
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
        tackleCd: 0,
        slideCd: 0,
        charge: 0,
        charging: false,
        dribble: 0,
        human: null,
        ai: { think: 0, tx: 0, ty: 0, still: 0 },
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
      shotX: 0,
      shotY: 0,
      inGoal: -1,
    },
    controllers: [],
    kickoffTeam: 0,
    lastGoal: null,
    stats: [emptyStats(), emptyStats()],
    tune: sanitizeTune(cfg.tune),
    events: [],
  };
  for (const h of cfg.humans ?? []) addController(s, h.id, h.team);
  resetKickoff(s, 0);
  return s;
}

function emptyStats() {
  return { shots: 0, onTarget: 0, saves: 0, tackles: 0, passes: 0, possessionTicks: 0 };
}

export function addController(s: MatchState, id: string, team: TeamIndex): void {
  if (s.controllers.some((c) => c.id === id)) return;
  const c: ControllerState = { id, team, player: -1, prev: { ...NEUTRAL_INPUT } };
  s.controllers.push(c);
  const free = s.players.find((p) => p.team === team && p.role === 'field' && !p.human);
  if (free) assign(s, c, free.idx);
}

/** Passa il controllo a un altro giocatore. Quello nuovo parte "pulito": nessuna azione della CPU. */
function assign(s: MatchState, c: ControllerState, idx: number): void {
  if (c.player === idx) return;
  if (c.player >= 0) {
    const old = s.players[c.player];
    old.human = null;
    old.charge = 0;
    old.charging = false;
    old.ai.think = 0;
  }
  c.player = idx;
  const p = s.players[idx];
  p.human = c.id;
  // Se la CPU gli aveva appena fatto iniziare un contrasto, lo annulliamo: d'ora in poi
  // fa solo quello che preme il giocatore.
  if (p.action.kind === 'tackle' || p.action.kind === 'slide') {
    setAction(p, 'none', 0);
    p.vx *= 0.3;
    p.vy *= 0.3;
  }
  s.events.push({ type: 'switch', p: idx, team: c.team, ctrl: c.id });
}

// --- Calcio d'inizio ---------------------------------------------------------------

const KICKOFF_SPOTS: [number, number][] = [
  [0.9, CENTER_Y],
  [7, CENTER_Y],
  [12, FIELD.width * 0.22],
  [12, FIELD.width * 0.78],
  [15.5, CENTER_Y],
];

export function resetKickoff(s: MatchState, team: TeamIndex): void {
  s.phase = 'kickoff';
  s.phaseTime = 0;
  s.kickoffTeam = team;
  Object.assign(s.ball, {
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
    if (i === 4) p.x = p.team === team ? CENTER_X - dir * 0.6 : CENTER_X - dir * 4;
    p.vx = p.vy = 0;
    p.fx = dir;
    p.fy = 0;
    setAction(p, 'none', 0);
    p.stun = 0;
    p.charge = 0;
    p.charging = false;
    p.ai.think = 0;
    p.ai.still = 0;
    p.ai.tx = p.x;
    p.ai.ty = p.y;
    p.gk.hold = 0;
  }
  for (const c of s.controllers) {
    const others = s.controllers.filter((o) => o !== c && o.team === c.team).length;
    if (others > 0 && c.player >= 0) continue;
    const cands = s.players.filter((p) => p.team === c.team && p.role === 'field' && (!p.human || p.human === c.id));
    cands.sort((a, b) => dist(a.x, a.y, CENTER_X, CENTER_Y) - dist(b.x, b.y, CENTER_X, CENTER_Y));
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

  s.clock = Math.max(0, s.clock - DT);
  const prevOwner = s.ball.owner;

  // Cambio giocatore (tasto dedicato, o passaggio senza palla).
  for (const c of s.controllers) {
    const inp = inputs[c.id] ?? NEUTRAL_INPUT;
    const p = c.player >= 0 ? s.players[c.player] : null;
    const hasBall = p !== null && s.ball.owner === p.idx;
    if ((inp.switch && !c.prev.switch) || (!hasBall && inp.pass && !c.prev.pass)) switchToBest(s, c);
  }

  let ownerSprinting = false;
  for (const p of s.players) {
    tickTimers(p);
    if (p.role === 'gk') {
      const k = updateKeeper(s, p);
      movePlayer(s, p, { mx: k.mx, my: k.my, sprint: false }, k.speed);
      continue;
    }
    const c = p.human ? s.controllers.find((x) => x.id === p.human) : undefined;
    const intent = c ? humanIntent(s, p, inputs[c.id] ?? NEUTRAL_INPUT, c.prev) : aiFieldPlayer(s, p);
    updateTackles(s, p);
    if (s.ball.owner === p.idx) ownerSprinting = intent.sprint && p.stamina > 0.02;
    movePlayer(s, p, intent, 0);
    trackStill(p);
  }
  for (const c of s.controllers) c.prev = { ...(inputs[c.id] ?? NEUTRAL_INPUT) };

  separatePlayers(s);

  const b = s.ball;
  if (b.kickCd > 0) b.kickCd -= DT;
  if (b.owner >= 0) {
    attachBall(s, ownerSprinting);
  } else {
    const scored = stepBall(s);
    if (scored >= 0) {
      onGoal(s, scored as TeamIndex);
      return;
    }
    tryPossession(s);
  }
  if (b.shotActive && b.owner < 0 && len(b.vx, b.vy) < 4) b.shotActive = false;
  if (b.owner < 0 && b.passTarget >= 0 && len(b.vx, b.vy) < 0.5) b.passTarget = -1;

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
    if (a.t >= a.dur && a.kind !== 'celebrate') finishAction(p);
  }
  if (p.stun > 0) p.stun = Math.max(0, p.stun - DT);
  if (p.tackleCd > 0) p.tackleCd = Math.max(0, p.tackleCd - DT);
  if (p.slideCd > 0) p.slideCd = Math.max(0, p.slideCd - DT);
}

/** Guardia anti-blocco: quanto tempo il giocatore è rimasto fermo (l'IA la usa per ripensare). */
function trackStill(p: PlayerState): void {
  if (len(p.vx, p.vy) < 0.2 && p.stun <= 0) p.ai.still += DT;
  else p.ai.still = 0;
}

// --- Umani: SOLO quello che si preme ----------------------------------------------------

const CHARGE_TIME = 0.8;

function humanIntent(s: MatchState, p: PlayerState, inp: PlayerInput, prev: PlayerInput): Intent {
  let mx = Number.isFinite(inp.mx) ? inp.mx : 0;
  let my = Number.isFinite(inp.my) ? inp.my : 0;
  const l = len(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  const pressed = (k: keyof PlayerInput) => !!inp[k] && !prev[k];
  const b = s.ball;
  const hasBall = b.owner === p.idx;
  const dirX = l > 0.2 ? mx : p.fx;
  const dirY = l > 0.2 ? my : p.fy;

  if (hasBall && p.stun <= 0) {
    // Tiro: si carica tenendo premuto, parte al rilascio.
    if (inp.shoot) {
      p.charging = true;
      p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
    } else if (p.charging) {
      shoot(s, p, p.charge, shotAim(my));
      return { mx, my, sprint: false };
    }
    // Passaggio: alla pressione, subito. Al compagno nella direzione indicata, altrimenti
    // nella direzione stessa (anche contro il muro, che la fa rimbalzare).
    if (pressed('pass') && !p.charging) {
      const t = passTargetInDir(s, p, dirX, dirY);
      if (t >= 0) {
        pass(s, p, t);
        autoSwitchToReceiver(s, p.team, t);
      } else if (l > 0.2) {
        freePass(s, p, mx, my);
      } else {
        const t2 = passTargetInDir(s, p, p.fx, p.fy) >= 0 ? passTargetInDir(s, p, p.fx, p.fy) : nearestMate(s, p);
        if (t2 >= 0) {
          pass(s, p, t2);
          autoSwitchToReceiver(s, p.team, t2);
        }
      }
      return { mx, my, sprint: false };
    }
  } else {
    p.charge = 0;
    p.charging = false;
    if (s.phase === 'play') {
      if (pressed('tackle')) startTackle(s, p);
      else if (pressed('slide')) startSlide(s, p);
    }
  }
  return { mx, my, sprint: inp.sprint };
}

function nearestMate(s: MatchState, p: PlayerState): number {
  let best = -1;
  let bd = Infinity;
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd) {
      bd = d;
      best = q.idx;
    }
  }
  return best;
}

/** Cambio: il compagno più vicino alla palla (mai il portiere, mai uno di un altro umano). */
function switchToBest(s: MatchState, c: ControllerState): void {
  const b = s.ball;
  let best = -1;
  let bd = Infinity;
  for (const p of s.players) {
    if (p.team !== c.team || p.role === 'gk' || p.idx === c.player) continue;
    if (p.human && p.human !== c.id) continue;
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
  const mine = soloController(s, team);
  if (mine && o.role === 'field' && !o.human) assign(s, mine, owner);
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

// --- Movimento: reattivo, senza ritardi ----------------------------------------------------

const LOCKED: ReadonlySet<string> = new Set(['tackle', 'slide', 'fall', 'dive']);

function movePlayer(s: MatchState, p: PlayerState, it: Intent, keeperSpeed: number): void {
  const hasBall = s.ball.owner === p.idx;
  const st = p.stats;
  let mx = it.mx;
  let my = it.my;
  if (p.stun > 0) {
    mx = 0;
    my = 0;
  }
  const locked = LOCKED.has(p.action.kind);

  let maxV = (keeperSpeed > 0 ? keeperSpeed : runSpeed(st)) * s.tune.speed;
  const moving = mx !== 0 || my !== 0;
  const sprinting = it.sprint && p.stamina > 0.02 && moving && p.role === 'field';
  if (sprinting) {
    maxV *= SPRINT_MULT;
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * DT);
  } else {
    p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * DT);
  }
  if (hasBall) maxV *= dribbleSpeedMult(st);
  if (p.charging) maxV *= 0.8;

  if (!locked) {
    const k = Math.min(1, acceleration(st) * DT);
    p.vx += (mx * maxV - p.vx) * k;
    p.vy += (my * maxV - p.vy) * k;
  } else {
    // Contrasti e tuffi conservano lo slancio e frenano dolcemente.
    const fr = p.action.kind === 'fall' ? 10 : p.action.kind === 'dive' ? 1.6 : 2.6;
    const k = Math.min(1, fr * DT);
    p.vx -= p.vx * k;
    p.vy -= p.vy * k;
  }

  p.x += p.vx * DT;
  p.y += p.vy * DT;
  const r = PHYS.playerRadius;
  p.x = clamp(p.x, r, FIELD.length - r);
  p.y = clamp(p.y, r, FIELD.width - r);

  // Sguardo: segue subito la levetta (cambi di direzione immediati).
  if (!locked && moving) {
    const [dx, dy] = norm(mx, my);
    const k = Math.min(1, TURN_RATE * DT);
    const [nx, ny] = norm(p.fx + (dx - p.fx) * k, p.fy + (dy - p.fy) * k);
    if (nx !== 0 || ny !== 0) {
      p.fx = nx;
      p.fy = ny;
    } else {
      p.fx = dx;
      p.fy = dy;
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
      if (a.action.kind === 'slide' || b.action.kind === 'slide') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      const nx = d < 1e-6 ? 1 : dx / d;
      const ny = d < 1e-6 ? 0 : dy / d;
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

// --- Possesso ------------------------------------------------------------------------------

function tryPossession(s: MatchState): void {
  const b = s.ball;
  if (b.inGoal >= 0) return;
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (const p of s.players) {
    if (p.stun > 0 || p.action.kind === 'dive' || p.action.kind === 'slide') continue;
    if (p.idx === b.kicker && b.kickCd > 0) continue;
    if (b.z > (p.role === 'gk' ? 2.2 : 1.0)) continue;
    const r = p.role === 'gk' ? 0.8 : controlRadius(p.stats);
    const d = dist(p.x, p.y, b.x, b.y);
    if (d > r) continue;
    if (p.role === 'gk') {
      if (b.shotActive && b.shotTeam !== p.team) continue; // i tiri li gestisce la parata
      if (Math.abs(p.x - ownGoalX(p.team)) > 6) continue;
    }
    const dd = b.passTarget === p.idx ? d - 0.3 : d;
    if (dd < bd) {
      bd = dd;
      best = p;
    }
  }
  if (!best) return;
  // Il destinatario di un passaggio controlla sempre; gli altri non riescono a fermare
  // una palla troppo veloce (rimbalza via).
  if (best.role === 'field' && b.passTarget !== best.idx && len(b.vx - best.vx, b.vy - best.vy) > controlMaxSpeed(best.stats)) {
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
  best.dribble = 0;
  if (best.role === 'field') {
    // Si gira verso dove andava (o verso la palla), per ripartire subito.
    const [fx, fy] = norm(best.vx || b.vx, best.vy || b.vy);
    if (fx !== 0 || fy !== 0) {
      best.fx = fx;
      best.fy = fy;
    }
  }
}

// --- Gol --------------------------------------------------------------------------------

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
    p.charging = false;
  }
  if (scorer >= 0 && !ownGoal) setAction(s.players[scorer], 'celebrate', RULES.goalPhaseSec);
  s.events.push({ type: 'goal', team, p: scorer, x: b.x, y: b.y, z: b.z });
}

function stepGoalPhase(s: MatchState, inputs: InputMap): void {
  stepBall(s);
  for (const p of s.players) {
    tickTimers(p);
    let it: Intent = { mx: 0, my: 0, sprint: false };
    if (p.action.kind === 'celebrate' && s.phaseTime < 2.5) {
      const [mx, my] = norm(CENTER_X - p.x, CENTER_Y - p.y);
      it = { mx: mx * 0.7, my: my * 0.7, sprint: false };
    } else if (s.lastGoal && p.team === s.lastGoal.team && s.lastGoal.scorer >= 0 && p.role === 'field') {
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
    if ((inp.pass && !c.prev.pass) || (inp.shoot && !c.prev.shoot)) skip = true;
    c.prev = { ...inp };
  }
  const canSkip = s.phaseTime >= RULES.goalSkipAfterSec && s.controllers.length > 0;
  if (s.phaseTime >= RULES.goalPhaseSec || (skip && canSkip)) {
    for (const p of s.players) if (p.action.kind === 'celebrate') setAction(p, 'none', 0);
    if (s.clock <= 0) {
      s.phase = 'ended';
      s.events.push({ type: 'whistle' }, { type: 'end' });
      return;
    }
    resetKickoff(s, s.lastGoal?.team === 0 ? 1 : 0);
  }
}

/** Copia profonda serializzabile. */
export function cloneState(s: MatchState): MatchState {
  return JSON.parse(JSON.stringify(s)) as MatchState;
}

/** Hash veloce (FNV-1a) dello stato serializzato. */
export function hashState(s: MatchState): string {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
