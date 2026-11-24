// Simulazione della partita a passo fisso. Pura e deterministica: dato lo stesso stato e gli
// stessi input produce lo stesso stato. Gira identica nel browser e (in futuro) su un server Node.
import { CENTER_X, CENTER_Y, DT, FIELD, PHYS, RULES, PLAYERS_PER_TEAM } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, seedFrom } from './rng';
import {
  EXPOSED_OFFSET,
  SPRINT_MULT,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  acceleration,
  controlMaxSpeed,
  controlRadius,
  dribbleSpeedMult,
  overall,
  runSpeed,
  stealChance,
  turnLossChance,
  turnRate,
} from './stats';
import { attachBall, stepBall } from './ball';
import {
  bankShot,
  endSlide,
  groundPass,
  lobPass,
  pickPassTarget,
  resolveTackle,
  setAction,
  shoot,
  shotAimFromInput,
  skillTick,
  special,
  startSlide,
  startTackle,
  throughPass,
  updateSlide,
  wallPass,
} from './actions';
import { aiFieldPlayer, type Intent } from './ai';
import { aerialOption, aerialPass, aerialShot } from './aerial';
import { updateKeeper } from './keeper';
import { activateGb, addGb, canActivate, emptyCombo, endGbOnGoal, gbOn, loseGb, tickGamebreaker } from './gamebreaker';
import { coolTricks, startTrick, trickFor, trickTick } from './tricks';
import { planWallOneTwo, planWallPass, wallAimed } from './walls';
import { DEFAULT_TUNE, sanitizeTune, type Tuning } from './tune';
import type {
  ControllerState,
  InputMap,
  MatchState,
  PlayerAction,
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
  lob: false,
  through: false,
  shoot: false,
  tx: 0,
  ty: 0,
  mod: false,
  shield: false,
  skill: false,
  gb: false,
  switch: false,
}) as PlayerInput;

export interface TrainingConfig {
  /** Difensori avversari (0-3) e portiere sì/no. */
  defenders: number;
  keeper: boolean;
}

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  durationSec?: number;
  seed?: number;
  /** Giocatori umani: id del controller e squadra. Nessuno = CPU contro CPU. */
  humans?: { id: string; team: TeamIndex }[];
  tune?: Partial<Tuning>;
  training?: TrainingConfig;
}

const noAction = (): PlayerAction => ({ kind: 'none', t: 0, dur: 0, dx: 0, dy: 0, done: false, ax: 0, ay: 0, side: 0, target: -1, id: '', res: 0 });

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
        action: noAction(),
        stun: 0,
        evade: 0,
        skillCd: 0,
        feintCd: 0,
        tackleCd: 0,
        slideCd: 0,
        charge: 0,
        chargeKind: 'none',
        dribble: 0,
        ballOff: 0,
        touchCd: 0,
        active: true,
        heat: 0,
        lastTrick: '',
        trickCd: 0,
        shield: false,
        juggle: 0,
        seenTrick: '',
        seenT: 0,
        tackleT: 0,
        human: null,
        ai: { think: 0, tx: 0, ty: 0, score: -1e9, shieldT: 0 },
        gk: { react: 0, seenShot: -1, rolledShot: -1, hold: 0 },
      });
    });
  });

  const training = cfg.training;
  if (training) {
    // Allenamento: tu + 2 compagni contro N difensori (+ portiere).
    for (const p of players) {
      const i = p.idx % PLAYERS_PER_TEAM;
      if (p.team === 0) p.active = i >= 2;
      else p.active = i === 0 ? training.keeper : i <= Math.min(3, training.defenders);
    }
  }

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
      spin: 0,
      passKind: 0,
      passTx: 0,
      passTy: 0,
      inGoal: -1,
      shotGb: false,
      passer: -1,
    },
    controllers: [],
    kickoffTeam: 0,
    lastGoal: null,
    stats: [emptyStats(), emptyStats()],
    events: [],
    mode: training ? 'training' : 'match',
    tune: sanitizeTune({ ...DEFAULT_TUNE, ...cfg.tune }),
    gb: [0, 0],
    gbActive: [0, 0],
    combo: [emptyCombo(), emptyCombo()],
  };
  for (const h of cfg.humans ?? []) addController(s, h.id, h.team);
  if (training) trainingReset(s);
  else resetKickoff(s, 0);
  return s;
}

function emptyStats() {
  return { shots: 0, onTarget: 0, saves: 0, tackles: 0, passes: 0, fouls: 0, possessionTicks: 0 };
}

export function addController(s: MatchState, id: string, team: TeamIndex): void {
  if (s.controllers.some((c) => c.id === id)) return;
  const c: ControllerState = { id, team, player: -1, prev: { ...NEUTRAL_INPUT } };
  s.controllers.push(c);
  const free = s.players
    .filter((p) => p.active && p.team === team && p.role === 'field' && !p.human)
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
    old.shield = false;
    old.ai.think = 0;
  }
  c.player = idx;
  s.players[idx].human = c.id;
  s.events.push({ type: 'switch', p: idx, team: c.team, ctrl: c.id });
}

function resetPlayer(p: PlayerState, x: number, y: number, fx: number): void {
  p.x = x;
  p.y = y;
  p.vx = p.vy = 0;
  p.fx = fx;
  p.fy = 0;
  p.action = noAction();
  p.stun = p.evade = 0;
  p.charge = 0;
  p.chargeKind = 'none';
  p.touchCd = 0;
  p.shield = false;
  p.juggle = 0;
  p.heat = 0;
  p.ai.think = 0;
  p.ai.score = -1e9;
  p.ai.shieldT = 0;
  p.ai.tx = x;
  p.ai.ty = y;
  p.gk.hold = 0;
}

function resetBall(s: MatchState, x: number, y: number): void {
  Object.assign(s.ball, {
    x,
    y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    owner: -1,
    lastTouch: -1,
    kicker: -1,
    kickCd: 0,
    passTarget: -1,
    passKind: 0,
    spin: 0,
    shotActive: false,
    shotTeam: -1,
    shotGb: false,
    inGoal: -1,
    passer: -1,
  });
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
  resetBall(s, CENTER_X, CENTER_Y);
  for (const p of s.players) {
    const i = p.idx % PLAYERS_PER_TEAM;
    const dir = attackDir(p.team);
    const [ox, oy] = KICKOFF_SPOTS[i];
    let x = ownGoalX(p.team) + dir * ox;
    if (i === 4) x = p.team === team ? CENTER_X - dir * 0.6 : CENTER_X - dir * 4;
    resetPlayer(p, x, oy, dir);
  }
  for (const c of s.controllers) {
    const cands = s.players.filter((p) => p.active && p.team === c.team && p.role === 'field' && (!p.human || p.human === c.id));
    const others = s.controllers.filter((o) => o !== c && o.team === c.team).length;
    if (others > 0 && c.player >= 0) continue;
    cands.sort((a, b2) => dist(a.x, a.y, CENTER_X, CENTER_Y) - dist(b2.x, b2.y, CENTER_X, CENTER_Y));
    if (cands[0]) assign(s, c, cands[0].idx);
  }
}

/** Allenamento: rimette tutti al loro posto, palla al giocatore umano. */
export function trainingReset(s: MatchState): void {
  // Breve pausa come al calcio d'inizio, poi la palla è tua.
  s.phase = 'kickoff';
  s.phaseTime = 0;
  s.kickoffTeam = 0;
  const spots: Record<number, [number, number]> = {
    2: [16, 4],
    3: [16, FIELD.width - 4],
    4: [12, CENTER_Y],
    5: [FIELD.length - 0.9, CENTER_Y],
    6: [21, CENTER_Y + 1],
    7: [24, CENTER_Y - 3],
    8: [26, CENTER_Y + 4],
  };
  for (const p of s.players) {
    const sp = spots[p.idx];
    if (!p.active || !sp) {
      // Fuori dal campo, fermi: non partecipano.
      resetPlayer(p, p.team === 0 ? 0.5 + p.idx * 0.6 : FIELD.length - 0.5 - (p.idx - 5) * 0.6, -3, 1);
      continue;
    }
    resetPlayer(p, sp[0], sp[1], attackDir(p.team));
  }
  const me = s.players[4];
  resetBall(s, me.x + 0.45, me.y);
  for (const c of s.controllers) if (c.team === 0) assign(s, c, 4);
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

  if (s.mode === 'match') s.clock = Math.max(0, s.clock - DT);
  const prevOwner = s.ball.owner;
  const prevPass = { target: s.ball.passTarget, kind: s.ball.passKind, passer: s.ball.passer };
  tickGamebreaker(s);

  updateControllers(s, inputs);

  let ownerSprinting = false;
  for (const p of s.players) {
    if (!p.active) continue;
    tickTimers(p);
    coolTricks(p);
    if (p.role === 'gk') {
      const k = updateKeeper(s, p);
      movePlayer(s, p, { mx: k.mx, my: k.my, sprint: false }, k.speed);
      continue;
    }
    let intent: Intent;
    const c = p.human ? s.controllers.find((x) => x.id === p.human) : undefined;
    if (c) {
      intent = humanIntent(s, p, inputs[c.id] ?? NEUTRAL_INPUT, c.prev);
    } else {
      intent = aiFieldPlayer(s, p);
    }
    p.shield = !!intent.shield && p.stun <= 0;
    resolveTackle(s, p);
    updateSlide(s, p);
    if (s.ball.owner === p.idx) ownerSprinting = intent.sprint && p.stamina > 0.02 && !p.shield;
    if (!trickTick(s, p) && !skillTick(s, p)) movePlayer(s, p, intent, 0);
  }
  for (const c of s.controllers) c.prev = { ...(inputs[c.id] ?? NEUTRAL_INPUT) };

  separatePlayers(s);

  const b = s.ball;
  if (b.kickCd > 0) b.kickCd -= DT;
  if (b.owner >= 0) {
    attachBall(s, ownerSprinting);
    contestExposedBall(s);
  } else {
    const scored = stepBall(s);
    if (scored >= 0) {
      onGoal(s, scored as TeamIndex);
      return;
    }
    tryPossession(s);
  }
  if (b.shotActive && b.owner < 0 && len(b.vx, b.vy) < 4) b.shotActive = false;
  if (b.owner < 0 && b.passTarget >= 0 && len(b.vx, b.vy) < 0.5 && b.z < 0.05) {
    b.passTarget = -1;
    b.passKind = 0;
  }

  if (b.owner >= 0) s.stats[s.players[b.owner].team].possessionTicks += 1;
  if (b.owner !== prevOwner && b.owner >= 0) {
    const p = s.players[b.owner];
    s.events.push({ type: 'possession', p: p.idx, team: p.team });
    onPossession(s, p, prevOwner, prevPass);
    autoSwitchOnPossession(s, p.team, p.idx);
  }

  if (s.mode === 'match' && s.clock <= 0) {
    s.phase = 'ended';
    s.phaseTime = 0;
    s.events.push({ type: 'whistle' }, { type: 'end' });
  }
}

/** Crediti di combo/Gamebreaker quando cambia chi ha la palla. */
function onPossession(s: MatchState, p: PlayerState, prevOwner: number, prevPass: { target: number; kind: number; passer: number }): void {
  const prevTeam = prevOwner >= 0 ? s.players[prevOwner].team : prevPass.passer >= 0 ? s.players[prevPass.passer].team : -1;
  if (prevTeam >= 0 && prevTeam !== p.team) {
    // Persa: la combo finisce e la barra cala un po'.
    loseGb(s, prevTeam as TeamIndex, 0.03);
  }
  if ((prevPass.kind === 4 || prevPass.kind === 5) && prevPass.target === p.idx) {
    const pts = addGb(s, p.team, prevPass.kind === 5 ? 0.1 : 0.08);
    s.events.push({ type: 'wallPass', p: p.idx, team: p.team, label: prevPass.kind === 5 ? 'UNO-DUE COL MURO!' : 'WALL PASS!', pts, x: p.x, y: p.y });
  }
}

function tickTimers(p: PlayerState): void {
  const a = p.action;
  if (a.kind !== 'none') {
    a.t += DT;
    if (a.t >= a.dur && a.kind !== 'celebrate') {
      if (a.kind === 'slide') endSlide(p);
      else p.action = noAction();
    }
  }
  if (p.stun > 0) p.stun = Math.max(0, p.stun - DT);
  if (p.evade > 0) p.evade = Math.max(0, p.evade - DT);
  if (p.skillCd > 0) p.skillCd = Math.max(0, p.skillCd - DT);
  if (p.feintCd > 0) p.feintCd = Math.max(0, p.feintCd - DT);
  if (p.tackleCd > 0) p.tackleCd = Math.max(0, p.tackleCd - DT);
  if (p.slideCd > 0) p.slideCd = Math.max(0, p.slideCd - DT);
  if (p.touchCd > 0) p.touchCd = Math.max(0, p.touchCd - DT);
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
  const tx = Number.isFinite(inp.tx) ? inp.tx : 0;
  const ty = Number.isFinite(inp.ty) ? inp.ty : 0;
  const pressed = (k: keyof PlayerInput) => !!inp[k] && !prev[k];
  const released = (k: keyof PlayerInput) => !inp[k] && !!prev[k];
  const trickEdge = len(tx, ty) > 0.6 && len(prev.tx || 0, prev.ty || 0) < 0.4;
  const b = s.ball;
  const hasBall = b.owner === p.idx;
  const side = mx * -p.fy + my * p.fx;
  const dirX = l > 0.2 ? mx : p.fx;
  const dirY = l > 0.2 ? my : p.fy;
  const myTeamHas = b.owner >= 0 && s.players[b.owner].team === p.team;

  if (pressed('gb') && myTeamHas && canActivate(s, p.team)) activateGb(s, p.team);

  if (hasBall && p.stun <= 0) {
    if (inp.shoot && p.chargeKind !== 'pass') {
      p.chargeKind = 'shot';
      p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
    } else if (inp.pass && p.chargeKind !== 'shot') {
      p.chargeKind = 'pass';
      p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
    }
    if (released('shoot') && p.chargeKind === 'shot') {
      const aim = shotAimFromInput(mx, my);
      if (p.juggle > 0) {
        // Dal palleggio: tiro al volo.
        p.juggle = 0;
        aerialShot(s, p, 'volley', aim);
        return { mx, my, sprint: false };
      }
      // Tiro di sponda: levetta verso il muro laterale vicino.
      const toWall = Math.abs(my) > 0.8 && Math.abs(mx) < 0.6 ? (my < 0 ? -1 : 1) : 0;
      const wallNear = toWall < 0 ? p.y < 5 : toWall > 0 ? p.y > FIELD.width - 5 : false;
      if (toWall && wallNear && !inp.mod && bankShot(s, p, toWall as -1 | 1, -toWall * 0.5, p.charge)) return { mx, my, sprint: false };
      const mode = inp.lob ? 'chip' : inp.mod ? 'placed' : 'power';
      const curl = Math.abs(aim) > 0.35 ? Math.min(1, Math.abs(aim)) * 0.8 : 0;
      shoot(s, p, 0.15 + p.charge * 0.85, aim, curl, 0, mode);
      return { mx, my, sprint: false };
    }
    if (released('pass') && p.chargeKind === 'pass') {
      const charge = p.charge;
      p.charge = 0;
      p.chargeKind = 'none';
      if (wallAimed(s, p, mx, my, 13)) {
        const plan = planWallPass(s, p, mx, my);
        if (plan) {
          wallPass(s, p, plan, 4);
          autoSwitchToReceiver(s, p.team, plan.receiver);
          return { mx, my, sprint: false };
        }
      }
      const t = pickPassTarget(s, p, dirX, dirY);
      if (t >= 0) {
        groundPass(s, p, t, charge);
        autoSwitchToReceiver(s, p.team, t);
      }
      return { mx, my, sprint: false };
    }
    if (pressed('lob') && p.chargeKind === 'none') {
      const t = pickPassTarget(s, p, dirX, dirY);
      if (t >= 0) {
        lobPass(s, p, t);
        autoSwitchToReceiver(s, p.team, t);
        return { mx, my, sprint: false };
      }
    }
    if (pressed('through') && p.chargeKind === 'none') {
      // Filtrante verso un muro = uno-due col muro (dai e ricevi da solo).
      if (wallAimed(s, p, mx, my, 9)) {
        const plan = planWallOneTwo(s, p, mx, my);
        if (plan) {
          wallPass(s, p, plan, 5);
          return { mx, my, sprint: true };
        }
      }
      const t = pickPassTarget(s, p, dirX, dirY);
      if (t >= 0) {
        throughPass(s, p, t, l > 0.2 ? mx : 0, l > 0.2 ? my : 0);
        autoSwitchToReceiver(s, p.team, t);
        return { mx, my, sprint: false };
      }
    }
    if (trickEdge && p.chargeKind === 'none') {
      const tr = trickFor(p, tx, ty, inp.mod);
      startTrick(s, p, tr.id, tr.side);
    }
    if (pressed('skill')) special(s, p, side);
  } else {
    p.charge = 0;
    p.chargeKind = 'none';
    if (s.phase === 'play' && p.stun <= 0) {
      const air = aerialOption(s, p);
      if (air && pressed('shoot')) {
        aerialShot(s, p, air, shotAimFromInput(mx, my));
        return { mx, my, sprint: false };
      }
      if (air && pressed('pass')) {
        const t = pickPassTarget(s, p, dirX, dirY);
        if (t >= 0) {
          aerialPass(s, p, air === 'bicycle' ? 'header' : air, t);
          return { mx, my, sprint: false };
        }
      }
      if (pressed('shoot')) startTackle(s, p);
      else if (pressed('lob')) startSlide(s, p);
    }
    // Calamita: passaggio per me e levetta ferma → vado incontro alla palla.
    if (b.owner < 0 && b.passTarget === p.idx && l < 0.2) {
      const gx = b.passKind >= 2 ? b.passTx : b.x + b.vx * 0.25;
      const gy = b.passKind >= 2 ? b.passTy : b.y + b.vy * 0.25;
      const d = dist(p.x, p.y, gx, gy);
      if (d > 0.3) {
        const [ux, uy] = norm(gx - p.x, gy - p.y);
        const k = Math.min(1, d / 0.6);
        return { mx: ux * k, my: uy * k, sprint: b.passKind >= 3 };
      }
    }
    // Contenimento: resto tra l'attaccante e la porta, lo stick mi sposta di lato.
    if (inp.shield && b.owner >= 0 && s.players[b.owner].team !== p.team) {
      const c = s.players[b.owner];
      if (dist(p.x, p.y, c.x, c.y) < 7) {
        const gx = ownGoalX(p.team);
        const [gdx, gdy] = norm(gx - c.x, CENTER_Y - c.y);
        const tx2 = c.x + gdx * 1.4 + mx * 0.9;
        const ty2 = c.y + gdy * 1.4 + my * 0.9;
        const d = dist(p.x, p.y, tx2, ty2);
        const [ux, uy] = norm(tx2 - p.x, ty2 - p.y);
        const k = Math.min(1, d / 0.5);
        return { mx: ux * k, my: uy * k, sprint: false, shield: true };
      }
    }
  }
  return { mx, my, sprint: inp.sprint, shield: inp.shield };
}

function updateControllers(s: MatchState, inputs: InputMap): void {
  for (const c of s.controllers) {
    const inp = inputs[c.id] ?? NEUTRAL_INPUT;
    const p = c.player >= 0 ? s.players[c.player] : null;
    const hasBall = p !== null && s.ball.owner === p.idx;
    const aerial = p !== null && aerialOption(s, p) !== null;
    const manual = (inp.switch && !c.prev.switch) || (!hasBall && !aerial && inp.pass && !c.prev.pass);
    if (manual) switchToBest(s, c, true);
  }
}

function switchToBest(s: MatchState, c: ControllerState, excludeCurrent: boolean): void {
  const b = s.ball;
  let best = -1;
  let bd = Infinity;
  for (const p of s.players) {
    if (!p.active || p.team !== c.team || p.role === 'gk') continue;
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
      if (!p.active || p.team !== otherTeam || p.role === 'gk') continue;
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

const LOCKED: ReadonlySet<string> = new Set([
  'tackle',
  'shoulder',
  'slide',
  'feint',
  'elastico',
  'veronica',
  'tunnel',
  'sombrero',
  'dive',
  'fall',
  'trick',
  'bicycle',
]);

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
  if (gbOn(s, p.team)) maxV *= 1.1;
  const sprinting = it.sprint && p.stamina > 0.02 && (mx !== 0 || my !== 0) && p.role === 'field' && !p.shield;
  if (sprinting) {
    maxV *= SPRINT_MULT;
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * DT);
  } else {
    p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * DT);
  }
  if (hasBall) {
    maxV *= dribbleSpeedMult(st);
    // Dribbling a tocchi: un piccolo freno a ogni tocco di palla.
    if (p.dribble < 0.12 && !p.juggle) maxV *= 0.92;
  }
  if (p.chargeKind !== 'none') maxV *= 0.75;
  if (p.shield) maxV *= hasBall ? 0.5 : 0.85;
  if (p.juggle > 0) {
    if (sprinting) p.juggle = 0; // scattando la palla torna a terra
    else maxV = Math.min(maxV, 2.2);
  }

  // Cambio di direzione brusco con la palla in corsa: si può perdere il controllo.
  if (hasBall && !locked && !p.shield && p.touchCd <= 0 && (mx !== 0 || my !== 0)) {
    const [ix, iy] = norm(mx, my);
    const sp = len(p.vx, p.vy);
    if (ix * p.fx + iy * p.fy < -0.15 && sp > runSpeed(st) * 0.75) {
      p.touchCd = 0.6;
      if (chance(s, turnLossChance(st, sprinting))) {
        const b = s.ball;
        b.owner = -1;
        b.lastTouch = p.idx;
        b.kicker = p.idx;
        b.kickCd = 0.35;
        b.passTarget = -1;
        b.passKind = 0;
        b.vx = p.vx * 1.15;
        b.vy = p.vy * 1.15;
        b.vz = 0.8;
        p.juggle = 0;
        s.events.push({ type: 'heavyTouch', p: p.idx, team: p.team, x: p.x, y: p.y, label: 'PALLA LUNGA' });
      }
    }
  }

  if (!locked) {
    const tvx = mx * maxV;
    const tvy = my * maxV;
    const k = Math.min(1, acceleration(st) * (p.shield && !hasBall ? 1.4 : 1) * DT);
    p.vx += (tvx - p.vx) * k;
    p.vy += (tvy - p.vy) * k;
  } else {
    const fr = p.action.kind === 'slide' ? 2.6 : p.action.kind === 'fall' ? 8 : p.action.kind === 'dive' ? 1.6 : 3;
    const k = Math.min(1, fr * DT);
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

  // Direzione dello sguardo.
  let dx = 0;
  let dy = 0;
  if (p.shield && !locked) {
    const foe = nearestFoe(s, p, hasBall ? 3 : 7, hasBall);
    if (foe) {
      // Con palla: schiena al difensore. Senza: sguardo sull'attaccante.
      [dx, dy] = hasBall ? norm(p.x - foe.x, p.y - foe.y) : norm(foe.x - p.x, foe.y - p.y);
    }
  }
  if (dx === 0 && dy === 0) {
    const sp = len(p.vx, p.vy);
    if (!locked && (mx !== 0 || my !== 0)) [dx, dy] = norm(mx, my);
    else if (sp > 0.5 && !locked) [dx, dy] = norm(p.vx, p.vy);
  }
  if (dx !== 0 || dy !== 0) {
    const k = Math.min(1, turnRate(st, hasBall) * DT);
    const [nx, ny] = norm(p.fx + (dx - p.fx) * k, p.fy + (dy - p.fy) * k);
    if (nx !== 0 || ny !== 0) {
      p.fx = nx;
      p.fy = ny;
    } else {
      const ox = p.fx;
      p.fx = -p.fy;
      p.fy = ox;
    }
  }
}

function nearestFoe(s: MatchState, p: PlayerState, maxD: number, anyRole: boolean): PlayerState | null {
  let best: PlayerState | null = null;
  let bd = maxD;
  for (const q of s.players) {
    if (!q.active || q.team === p.team || (!anyRole && s.ball.owner !== q.idx)) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function separatePlayers(s: MatchState): void {
  const ps = s.players;
  const minD = PHYS.playerRadius * 2;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!a.active) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!b.active) continue;
      if (a.action.kind === 'slide' || b.action.kind === 'slide') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      const nx = d < 1e-6 ? 1 : dx / d;
      const ny = d < 1e-6 ? 0 : dy / d;
      // Più forte (e chi protegge palla) sposta di più l'altro.
      const sa = a.stats.strength * (a.shield ? 1.4 : 1);
      const sb = b.stats.strength * (b.shield ? 1.4 : 1);
      const wa = sb / (sa + sb);
      const push = minD - d;
      a.x -= nx * push * wa;
      a.y -= ny * push * wa;
      b.x += nx * push * (1 - wa);
      b.y += ny * push * (1 - wa);
    }
  }
  for (const p of ps) {
    if (!p.active) continue;
    p.x = clamp(p.x, PHYS.playerRadius, FIELD.length - PHYS.playerRadius);
    p.y = clamp(p.y, PHYS.playerRadius, FIELD.width - PHYS.playerRadius);
  }
}

// --- Possesso --------------------------------------------------------------------

function contestExposedBall(s: MatchState): void {
  const b = s.ball;
  const c = s.players[b.owner];
  if (c.ballOff <= EXPOSED_OFFSET || c.evade > 0 || c.shield || c.juggle > 0) return;
  for (const q of s.players) {
    if (!q.active || q.team === c.team || q.stun > 0) continue;
    const r = q.role === 'gk' ? 0.75 : 0.55;
    if (dist(q.x, q.y, b.x, b.y) > r) continue;
    if (q.role === 'gk' && Math.abs(q.x - ownGoalX(q.team)) > 5.5) continue;
    if (chance(s, q.role === 'gk' ? 0.25 : Math.min(0.9, stealChance(q.stats, c.stats) * s.tune.tackle))) {
      b.owner = q.idx;
      b.lastTouch = q.idx;
      b.passTarget = -1;
      b.passKind = 0;
      s.stats[q.team].tackles += 1;
      s.events.push({ type: 'steal', p: q.idx, team: q.team, x: b.x, y: b.y });
      return;
    }
  }
}

function tryPossession(s: MatchState): void {
  const b = s.ball;
  if (b.inGoal >= 0) return;
  const cands: { p: PlayerState; d: number }[] = [];
  for (const p of s.players) {
    if (!p.active || p.stun > 0 || p.action.kind === 'dive' || p.action.kind === 'slide') continue;
    if (p.idx === b.kicker && b.kickCd > 0) continue;
    // Stop di petto per chi riceve un lancio; per gli altri palla fino al ginocchio-anca.
    const maxZ = p.role === 'gk' ? 2.2 : b.passTarget === p.idx ? 1.4 : 1.0;
    if (b.z > maxZ) continue;
    const r = p.role === 'gk' ? 0.8 : controlRadius(p.stats);
    const d = dist(p.x, p.y, b.x, b.y);
    if (d > r) continue;
    if (p.role === 'gk') {
      if (b.shotActive && b.shotTeam !== p.team) continue;
      if (Math.abs(p.x - ownGoalX(p.team)) > 6) continue;
    }
    cands.push({ p, d: b.passTarget === p.idx ? d - 0.25 : d });
  }
  if (!cands.length) return;
  cands.sort((a, c) => a.d - c.d || a.p.idx - c.p.idx);
  let best = cands[0].p;
  // 50/50: due avversari sulla stessa palla vagante → spallata, vince (spesso) il più forte.
  const rival = cands.find((c) => c.p.team !== best.team && c.p.role === 'field' && c.d < cands[0].d + 0.35);
  if (rival && best.role === 'field' && b.passTarget !== best.idx) {
    const a = best.stats.strength + best.stats.defense * 0.3;
    const o = rival.p.stats.strength + rival.p.stats.defense * 0.3;
    if (!chance(s, a / (a + o))) {
      const loser = best;
      best = rival.p;
      setAction(best, 'shoulder', 0.25, loser.x - best.x, loser.y - best.y);
      s.events.push({ type: 'tackle', p: best.idx, team: best.team, x: b.x, y: b.y, skill: 'shoulder' });
    }
  }

  const rel = len(b.vx - best.vx, b.vy - best.vy);
  if (best.role === 'field') {
    if (rel > controlMaxSpeed(best.stats) && b.passTarget !== best.idx) {
      bounceOff(s, best, 0.25);
      return;
    }
    // Primo controllo: dipende da statistica, velocità e angolo della palla.
    const comfort = 8.5 + best.stats.dribbling * 0.1 + (b.passTarget === best.idx ? 5 : 0);
    const [bdx, bdy] = norm(b.vx, b.vy);
    const behind = bdx * best.fx + bdy * best.fy > 0.5 && rel > 3; // arriva da dietro
    const q = 0.98 - Math.max(0, rel - comfort) * 0.06 - (behind ? 0.1 : 0) - (b.z > 0.4 ? 0.08 : 0);
    if (!chance(s, clamp(q, 0.2, 0.99))) {
      // Controllo sporco: la palla si allunga.
      b.vx = b.vx * 0.35 + best.fx * 3 + best.vx * 0.3;
      b.vy = b.vy * 0.35 + best.fy * 3 + best.vy * 0.3;
      b.vz = 0.6;
      b.spin = 0;
      b.lastTouch = best.idx;
      b.kicker = best.idx;
      b.kickCd = 0.25;
      b.passTarget = -1;
      b.passKind = 0;
      b.shotActive = false;
      s.events.push({ type: 'heavyTouch', p: best.idx, team: best.team, x: best.x, y: best.y, label: 'CONTROLLO SPORCO' });
      return;
    }
  }
  b.owner = best.idx;
  b.lastTouch = best.idx;
  b.passTarget = -1;
  b.passKind = 0;
  b.shotActive = false;
  b.kicker = -1;
  b.spin = 0;
  best.dribble = 0;
  if (best.role === 'field') {
    const [fx, fy] = norm(best.vx || best.fx, best.vy || best.fy);
    if (fx !== 0 || fy !== 0) {
      best.fx = fx;
      best.fy = fy;
    }
  }
}

function bounceOff(s: MatchState, p: PlayerState, k: number): void {
  const b = s.ball;
  b.vx = -b.vx * k + p.vx * 0.5;
  b.vy = -b.vy * k + p.vy * 0.5;
  b.vz = 1.2;
  b.spin = 0;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.2;
  b.passTarget = -1;
  b.passKind = 0;
  b.shotActive = false;
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
    p.shield = false;
    p.juggle = 0;
  }
  if (scorer >= 0 && !ownGoal) setAction(s.players[scorer], 'celebrate', RULES.goalPhaseSec);
  s.events.push({ type: 'goal', team, p: scorer, x: b.x, y: b.y, z: b.z, label: b.shotGb ? 'GAMEBREAKER' : '' });
  endGbOnGoal(s);
}

function stepGoalPhase(s: MatchState, inputs: InputMap): void {
  stepBall(s);
  for (const p of s.players) {
    if (!p.active) continue;
    tickTimers(p);
    const scorerTeam = s.lastGoal?.team;
    let it: Intent = { mx: 0, my: 0, sprint: false };
    if (p.action.kind === 'celebrate' && s.phaseTime < 2.5) {
      const [mx, my] = norm(CENTER_X - p.x, CENTER_Y - p.y);
      it = { mx: mx * 0.7, my: my * 0.7, sprint: false };
    } else if (p.team === scorerTeam && s.lastGoal && s.lastGoal.scorer >= 0 && p.role === 'field') {
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
  const total = s.mode === 'training' ? 2.5 : RULES.goalPhaseSec;
  const canSkip = s.phaseTime >= RULES.goalSkipAfterSec && s.controllers.length > 0;
  if (s.phaseTime >= total || (skip && canSkip)) {
    for (const p of s.players) if (p.action.kind === 'celebrate') p.action = noAction();
    if (s.mode === 'training') {
      trainingReset(s);
      return;
    }
    if (s.clock <= 0) {
      s.phase = 'ended';
      s.events.push({ type: 'whistle' }, { type: 'end' });
      return;
    }
    const conceded: TeamIndex = s.lastGoal?.team === 0 ? 1 : 0;
    resetKickoff(s, conceded);
  }
}

/** Copia profonda serializzabile. */
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


