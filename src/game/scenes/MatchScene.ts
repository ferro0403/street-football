// Scena di gioco: fa girare la simulazione condivisa a passo fisso (60 Hz) e la disegna
// in isometrico con interpolazione, camera che segue l'azione, effetti (skill game-feel) e replay.
import Phaser from 'phaser';
import { createMatch, stepMatch, trainingReset } from '../../shared/match';
import { DT, FIELD } from '../../shared/constants';
import { teamById } from '../../shared/teams';
import { pickPassTarget, shotAimFromInput, shotTarget } from '../../shared/actions';
import { planWallOneTwo, planWallPass, wallAimed, type WallPlan } from '../../shared/walls';
import { aerialOption } from '../../shared/aerial';
import { loadTune, aimLineEnabled, toggleDebug, closeDebug } from '../debugPanel';
import { attackDir } from '../../shared/world';
import type { MatchEvent, MatchState, PlayerInput, PlayerState } from '../../shared/types';
import { isoDepth, isoX, isoY, screenToWorldDir, worldToScreenDir } from '../iso';
import { drawField, worldBounds } from '../render/field';
import { PlayerSprite, dir8 } from '../render/playerSprite';
import { InputManager, isTouchDevice } from '../input/InputManager';
import { sfx, unlockAudio } from '../fx/sfx';
import { view } from '../ui';

export interface MatchData {
  home: string;
  away: string;
  duration: number;
  /** Allenamento: numero di difensori e portiere. */
  training?: { defenders: number; keeper: boolean };
}

/** Animazione dello sprite per ogni trucco del trick stick. */
const TRICK_ANIM: Record<string, string> = {
  sombrero: 'sombrero',
  arcobaleno: 'sombrero',
  flick: 'sombrero',
  panna: 'tunnel',
  finta: 'feint',
  croqueta: 'feint',
  doppio: 'stepover',
  elastico: 'elastico',
  trascinata: 'dragback',
  ruleta: 'veronica',
  mondo: 'juggle',
};

const LOCAL_ID = 'p1';
const STEP_MS = DT * 1000;
const REPLAY_START = 2.4;
const REPLAY_SPEED = 0.7;
const REPLAY_LEN = 200;
/** Altezza del mondo visibile (pixel isometrici): più piccola = camera più vicina. */
const VISIBLE_H_TOUCH = 310;
const VISIBLE_H_DESKTOP = 440;
/** Altezza del giocatore in pixel (per freccia e barra di carica). */
const FIG_H = 58;
/** Raggio della palla nello sprite (pixel) e lunghezza di un giro per fotogramma (m). */
const BALL_R = 6.4;
const BALL_STEP = (2 * Math.PI * 0.22) / 16;

interface PlayerView {
  shadow: Phaser.GameObjects.Image;
  ps: PlayerSprite;
  runDist: number;
  ghostT: number;
  lastKind: string;
  lockDir: number;
  catchT: number;
}

interface ReplayFrame {
  b: [number, number, number];
  p: number[]; // per giocatore: x, y, fx, fy, codice posa, avanzamento, velocità
  speed: number;
}

const ACTION_CODES = [
  'none', 'kick', 'shoot', 'tackle', 'shoulder', 'slide', 'fall', 'stagger', 'feint', 'veronica',
  'elastico', 'sombrero', 'tunnel', 'rabona', 'dive', 'stunned', 'celebrate',
];
const SKILL_KINDS = new Set(['veronica', 'elastico', 'sombrero', 'tunnel', 'rabona']);

export class MatchScene extends Phaser.Scene {
  state!: MatchState;
  data_!: MatchData;
  private input_!: InputManager;
  private lastInput: PlayerInput | null = null;
  private views: PlayerView[] = [];
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private trail!: Phaser.GameObjects.Graphics;
  private trailPts: { x: number; y: number; fire: boolean }[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Image;
  private targetRing!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private acc = 0;
  private prev: number[] = [];
  private prevBall: [number, number, number] = [0, 0, 0];
  private history: ReplayFrame[] = [];
  private replay: ReplayFrame[] | null = null;
  replayActive = false;
  private camX = 0;
  private camY = 0;
  private zoom = 1.6;
  private zoomPunch = 0;
  private trauma = 0;
  private shakeT = 0;
  private pausePrev = true;
  private endTimer = -1;
  /** Rallentatore (solo presentazione: la simulazione resta a passo fisso). */
  private timeScale = 1;
  private slowLeft = 0;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastBallSpeed = 0;
  private debugPrev = false;
  private resetPrev = false;
  private targetArrow!: Phaser.GameObjects.Image;

  constructor() {
    super('match');
  }

  init(data: MatchData): void {
    this.data_ = data;
    this.views = [];
    this.trailPts = [];
    this.history = [];
    this.replay = null;
    this.replayActive = false;
    this.acc = 0;
    this.trauma = 0;
    this.endTimer = -1;
    this.pausePrev = true;
    this.timeScale = 1;
    this.slowLeft = 0;
    this.zoomPunch = 0;
    this.lastInput = null;
  }

  create(): void {
    const home = teamById(this.data_.home);
    const away = teamById(this.data_.away);
    this.state = createMatch({
      home,
      away,
      durationSec: this.data_.duration,
      seed: (Date.now() & 0x7fffffff) ^ 0x2f6b,
      humans: [{ id: LOCAL_ID, team: 0 }],
      tune: loadTune(),
      training: this.data_.training,
    });
    this.input_ = new InputManager(this);
    this.events.once('shutdown', () => closeDebug());

    drawField(this);

    for (const p of this.state.players) {
      const t = p.team === 0 ? home : away;
      const def = t.players[p.idx % 5];
      const kit = p.role === 'gk' ? t.gkKit : t.kit;
      const shadow = this.add.image(0, 0, 'shadow').setDepth(10);
      const ps = new PlayerSprite(this, { look: def.look, kit, number: def.number, gk: p.role === 'gk' });
      this.views.push({ shadow, ps, runDist: 0, ghostT: 0, lastKind: 'none', lockDir: 0, catchT: -10 });
    }

    this.ring = this.add.image(0, 0, 'ring').setDepth(11).setTint(0xffd21f);
    this.targetRing = this.add.image(0, 0, 'ring').setDepth(11).setTint(0x2ec4b6).setVisible(false);
    this.arrow = this.add.image(0, 0, 'arrow').setDepth(6000).setTint(0xffd21f);
    this.targetArrow = this.add.image(0, 0, 'arrow').setDepth(6000).setTint(0x2ec4b6).setVisible(false);
    this.ballShadow = this.add.image(0, 0, 'shadow').setScale(0.4).setDepth(12);
    this.trail = this.add.graphics().setDepth(4900);
    this.ball = this.add.image(0, 0, 'ballroll', 0);
    this.overlay = this.add.graphics().setDepth(6001);

    this.dust = this.add.particles(0, 0, 'puff', {
      lifespan: 450,
      speed: { min: 10, max: 50 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: 0xb8b0a0,
      emitting: false,
    });
    this.dust.setDepth(4800);
    this.confetti = this.add.particles(0, 0, 'px', {
      lifespan: 1800,
      speed: { min: 80, max: 260 },
      angle: { min: 200, max: 340 },
      gravityY: 260,
      rotate: { min: 0, max: 360 },
      scale: { min: 0.6, max: 1.2 },
      emitting: false,
    });
    this.confetti.setDepth(6002);

    const cam = this.cameras.main;
    const bounds = worldBounds();
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.zoom = this.baseZoom();
    cam.setZoom(this.zoom);
    cam.setBackgroundColor('#0d0b14');
    this.camX = isoX(this.state.ball.x, this.state.ball.y);
    this.camY = isoY(this.state.ball.x, this.state.ball.y);
    cam.centerOn(this.camX, this.camY);

    this.capturePrev();
    this.render(1);

    this.input.on('pointerdown', unlockAudio);
    this.input.keyboard?.on('keydown', unlockAudio);

    if (this.scene.isActive('hud')) this.scene.stop('hud');
    this.scene.launch('hud');
    this.scene.bringToTop('hud');
    this.events.once('shutdown', () => this.input.off('pointerdown', unlockAudio));
  }

  /** Zoom in base all'altezza dello schermo: su telefono la camera è più vicina. */
  private baseZoom(): number {
    const { h } = view(this);
    return h / (isTouchDevice() ? VISIBLE_H_TOUCH : VISIBLE_H_DESKTOP);
  }

  // --- Ciclo ---------------------------------------------------------------------

  update(_time: number, delta: number): void {
    const si = this.input_.read();
    if (si.pause && !this.pausePrev && this.state.phase !== 'ended') {
      this.pausePrev = true;
      this.openPause();
      return;
    }
    this.pausePrev = si.pause;

    if (si.debug && !this.debugPrev) toggleDebug(() => this.state.tune);
    this.debugPrev = si.debug;
    if (si.reset && !this.resetPrev && this.state.mode === 'training') trainingReset(this.state);
    this.resetPrev = si.reset;

    const [mx, my] = screenToWorldDir(si.sx, si.sy);
    // Tastiera: tasto trucco + direzione (senza direzione = in avanti, dove guarda il giocatore).
    let tsx = si.tsx;
    let tsy = si.tsy;
    if (si.trick) {
      if (Math.hypot(si.sx, si.sy) > 0.2) {
        tsx = si.sx;
        tsy = si.sy;
      } else {
        const c = this.state.controllers[0];
        const p = c && c.player >= 0 ? this.state.players[c.player] : null;
        if (p) [tsx, tsy] = worldToScreenDir(p.fx, p.fy);
      }
    }
    const [tx, ty] = screenToWorldDir(tsx, tsy);
    const inp: PlayerInput = {
      mx,
      my,
      sprint: si.sprint,
      pass: si.pass,
      lob: si.lob,
      through: si.through,
      shoot: si.shoot,
      tx,
      ty,
      mod: si.mod,
      shield: si.shield,
      skill: si.skill,
      gb: si.gb,
      switch: si.switch,
    };
    this.lastInput = inp;

    // Rallentatore delle skill: torna a velocità normale con dolcezza.
    if (this.slowLeft > 0) {
      this.slowLeft -= delta;
      if (this.slowLeft <= 0) this.tweens.add({ targets: this, timeScale: 1, duration: 220, ease: 'Quad.In' });
    }

    this.acc += Math.min(delta, 250) * this.timeScale;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 8) {
      this.capturePrev();
      stepMatch(this.state, { [LOCAL_ID]: inp });
      this.record();
      for (const e of this.state.events) this.onEvent(e);
      this.acc -= STEP_MS;
      steps++;
    }
    if (steps === 8) this.acc = 0;

    if (this.state.phase === 'ended') {
      if (this.endTimer < 0) this.endTimer = 2200;
      this.endTimer -= delta;
      if (this.endTimer <= 0) {
        this.scene.stop('hud');
        this.scene.start('end', { state: this.state, data: this.data_ });
        return;
      }
    }

    this.render(this.acc / STEP_MS);
    this.updateCamera(delta / 1000);
  }

  openPause(): void {
    if (this.scene.isPaused()) return;
    this.scene.pause();
    this.scene.launch('pause', { data: this.data_ });
    this.scene.bringToTop('pause');
  }

  resumeFromPause(): void {
    this.pausePrev = true;
  }

  private capturePrev(): void {
    const ps = this.state.players;
    if (this.prev.length !== ps.length * 2) this.prev = new Array(ps.length * 2).fill(0);
    ps.forEach((p, i) => {
      this.prev[i * 2] = p.x;
      this.prev[i * 2 + 1] = p.y;
    });
    const b = this.state.ball;
    this.prevBall = [b.x, b.y, b.z];
  }

  private record(): void {
    const s = this.state;
    if (s.phase !== 'play') return;
    const b = s.ball;
    const p: number[] = [];
    for (const q of s.players) {
      const prog = q.action.dur > 0 ? Math.min(1, q.action.t / q.action.dur) : 0;
      p.push(q.x, q.y, q.fx, q.fy, ACTION_CODES.indexOf(q.action.kind), prog, Math.hypot(q.vx, q.vy));
    }
    this.history.push({ b: [b.x, b.y, b.z], p, speed: Math.hypot(b.vx, b.vy) });
    if (this.history.length > REPLAY_LEN + 40) this.history.shift();
  }

  // --- Eventi → suoni ed effetti ------------------------------------------------

  private slowMo(scale: number, ms: number): void {
    this.tweens.killTweensOf(this);
    this.timeScale = scale;
    this.slowLeft = ms;
  }

  private onEvent(e: MatchEvent): void {
    const s = this.state;
    this.events.emit('sim', e);
    switch (e.type) {
      case 'shot': {
        const pw = e.power ?? 0;
        sfx.kick(pw);
        if (pw > 22) this.addTrauma(0.22 + (pw - 22) * 0.04);
        this.puff(e.x, e.y, 6);
        this.popBall();
        break;
      }
      case 'pass':
        sfx.pass();
        this.popBall();
        break;
      case 'bounce':
        sfx.bounce(e.power ?? 0);
        break;
      case 'wall':
        sfx.wall(e.power ?? 0);
        if ((e.power ?? 0) > 18) this.addTrauma(0.15);
        break;
      case 'post':
        sfx.post();
        this.addTrauma(0.35);
        break;
      case 'slide':
        sfx.whoosh();
        break;
      case 'tackle':
      case 'steal':
        sfx.tackle();
        this.addTrauma(e.skill === 'slide' || e.skill === 'shoulder' ? 0.22 : 0.12);
        this.puff(e.x, e.y, 10);
        break;
      case 'foul':
        sfx.tackle();
        this.addTrauma(0.2);
        this.puff(e.x, e.y, 10);
        break;
      case 'tackleMiss':
      case 'heavyTouch':
        this.puff(e.x, e.y, 4);
        break;
      case 'save':
        sfx.save();
        this.addTrauma(0.3);
        this.puff(e.x, e.y, 8);
        break;
      case 'catch':
        sfx.save();
        if (e.p !== undefined) this.views[e.p].catchT = this.time.now;
        break;
      case 'dive':
        sfx.whoosh();
        break;
      case 'special':
        // Skill: nome grande (HUD), rallentatore breve, zoom e scia.
        sfx.trick();
        this.slowMo(0.3, 480);
        this.zoomPunch = 0.35;
        break;
      case 'trick':
        // Trucco riuscito: un istante di rallentatore e uno sbuffo (game-feel: piccolo, breve).
        sfx.trick();
        if (e.skill && e.skill !== 'palleggio') {
          this.slowMo(0.5, 140);
          this.zoomPunch = Math.max(this.zoomPunch, 0.15);
          this.puff(e.x, e.y, 5);
        }
        break;
      case 'trickFail':
        sfx.thud();
        this.addTrauma(0.18);
        this.puff(e.x, e.y, 8);
        break;
      case 'wallPass':
        sfx.trick();
        break;
      case 'gamebreaker':
        sfx.gamebreaker();
        this.slowMo(0.25, 900);
        this.addTrauma(0.45);
        this.zoomPunch = 0.5;
        break;
      case 'header':
      case 'volley':
        this.addTrauma(0.2);
        break;
      case 'bicycle':
        this.slowMo(0.35, 500);
        this.addTrauma(0.3);
        this.zoomPunch = 0.3;
        break;
      case 'feint':
      case 'dodge':
        sfx.whoosh();
        break;
      case 'whistle':
        sfx.whistle(s.phase === 'ended');
        break;
      case 'goal': {
        sfx.crowd();
        sfx.whistle(false);
        this.addTrauma(0.55);
        this.slowMo(0.4, 450);
        this.replay = this.history.slice(-REPLAY_LEN);
        const team = e.team ?? 0;
        const kit = s.teams[team].kit;
        const gx = team === 0 ? FIELD.length : 0;
        const x = isoX(gx, 11);
        const y = isoY(gx, 11, 1.5);
        this.confetti.setParticleTint(kit.shirt);
        this.confetti.explode(40, x, y);
        this.confetti.setParticleTint(kit.trim);
        this.confetti.explode(30, x, y);
        break;
      }
      case 'kickoff':
        this.trailPts = [];
        break;
    }
  }

  private puff(x = 0, y = 0, n = 5): void {
    this.dust.explode(n, isoX(x, y), isoY(x, y));
  }

  private popBall(): void {
    this.tweens.killTweensOf(this.ball);
    this.ball.setScale(1.5);
    this.tweens.add({ targets: this.ball, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  // --- Disegno -----------------------------------------------------------------------

  private render(alpha: number): void {
    const s = this.state;
    const inGoal = s.phase === 'goal';
    const replayOn = inGoal && this.replay !== null && this.replay.length > 10 && s.phaseTime >= REPLAY_START;
    if (replayOn !== this.replayActive) {
      this.replayActive = replayOn;
      this.trailPts = [];
      this.events.emit('replay', replayOn);
    }

    if (replayOn && this.replay) {
      const t = (s.phaseTime - REPLAY_START) * 60 * REPLAY_SPEED;
      const i = Math.min(this.replay.length - 1, Math.floor(t));
      const fr = this.replay[i];
      const pf = this.replay[Math.max(0, i - 1)];
      s.players.forEach((p, k) => {
        const o = k * 7;
        const kind = ACTION_CODES[fr.p[o + 4]] ?? 'none';
        const step = Math.hypot(fr.p[o] - pf.p[o], fr.p[o + 1] - pf.p[o + 1]);
        this.drawPlayer(p, fr.p[o], fr.p[o + 1], fr.p[o + 2], fr.p[o + 3], kind, fr.p[o + 5], fr.p[o + 6], step, true);
      });
      this.drawBall(fr.b[0], fr.b[1], fr.b[2], fr.speed, false);
      this.ring.setVisible(false);
      this.targetRing.setVisible(false);
      this.arrow.setVisible(false);
      this.overlay.clear();
      return;
    }

    s.players.forEach((p, i) => {
      const x = Phaser.Math.Linear(this.prev[i * 2] ?? p.x, p.x, alpha);
      const y = Phaser.Math.Linear(this.prev[i * 2 + 1] ?? p.y, p.y, alpha);
      const sp = Math.hypot(p.vx, p.vy);
      const prog = p.action.dur > 0 ? Math.min(1, p.action.t / p.action.dur) : 0;
      this.drawPlayer(p, x, y, p.fx, p.fy, p.action.kind, prog, sp, sp * DT, false);
    });

    const b = s.ball;
    const bx = Phaser.Math.Linear(this.prevBall[0], b.x, alpha);
    const by = Phaser.Math.Linear(this.prevBall[1], b.y, alpha);
    const bz = Phaser.Math.Linear(this.prevBall[2], b.z, alpha);
    this.drawBall(bx, by, bz, Math.hypot(b.vx, b.vy), b.owner >= 0);
    this.drawIndicators();
  }

  /** Linea tratteggiata in coordinate mondo (a terra, z costante). */
  private dashed(o: Phaser.GameObjects.Graphics, pts: [number, number][], col: number, z = 0.05): void {
    o.lineStyle(2, col, 0.8);
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1];
      const [bx, by] = pts[k];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(2, Math.floor(len / 0.6));
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n;
        const t1 = Math.min(1, (i + 1) / n);
        o.lineBetween(
          isoX(ax + (bx - ax) * t0, ay + (by - ay) * t0),
          isoY(ax + (bx - ax) * t0, ay + (by - ay) * t0, z),
          isoX(ax + (bx - ax) * t1, ay + (by - ay) * t1),
          isoY(ax + (bx - ax) * t1, ay + (by - ay) * t1, z),
        );
      }
    }
  }

  private showTarget(idx: number, alpha: number): void {
    const tv = this.views[idx];
    if (!tv) return;
    const x = tv.ps.container.x;
    const y = tv.ps.container.y;
    this.targetRing.setVisible(true).setPosition(x, y).setAlpha(alpha);
    this.targetArrow.setVisible(true).setPosition(x, y - FIG_H - 8 + Math.sin(this.time.now / 120) * 3).setAlpha(alpha);
  }

  /** Anello sul giocatore controllato, freccia sul destinatario, linea di mira col rimbalzo, mirino. */
  private drawIndicators(): void {
    const s = this.state;
    const c = s.controllers.find((k) => k.id === LOCAL_ID);
    const o = this.overlay.clear();
    this.targetRing.setVisible(false);
    this.targetArrow.setVisible(false);
    if (!c || c.player < 0 || s.phase === 'goal') {
      this.ring.setVisible(false);
      this.arrow.setVisible(false);
      return;
    }
    const p = s.players[c.player];
    const v = this.views[c.player];
    const x = v.ps.container.x;
    const y = v.ps.container.y;
    const gb = s.gbActive[p.team] > 0;
    this.ring.setVisible(true).setPosition(x, y).setTint(gb ? 0xff7b1f : 0xffd21f);
    this.arrow.setVisible(true).setPosition(x, y - FIG_H - 8 + Math.sin(this.time.now / 140) * 2);

    // Palla alta vicina: suggerisce l'azione contestuale.
    if (s.ball.owner !== p.idx) {
      const air = aerialOption(s, p);
      if (air) {
        const label = air === 'header' ? 'TESTA' : air === 'bicycle' ? 'ROVESCIATA' : 'AL VOLO';
        o.fillStyle(0x0d0b14, 0.8).fillRect(x - 34, y - FIG_H - 30, 68, 12);
        this.events.emit('hint', label);
      }
      return;
    }

    const inp = this.lastInput;
    const mx = inp?.mx ?? 0;
    const my = inp?.my ?? 0;
    const hasDir = Math.hypot(mx, my) > 0.2;
    const aim = aimLineEnabled();

    // Passaggio al muro: la levetta punta una parete → linea con il rimbalzo.
    if (p.chargeKind !== 'shot') {
      let plan: WallPlan | null = null;
      if (wallAimed(s, p, mx, my, 13)) plan = inp?.through ? planWallOneTwo(s, p, mx, my) : planWallPass(s, p, mx, my);
      if (plan) {
        if (aim) this.dashed(o, [[plan.sx, plan.sy], [plan.hx, plan.hy], [plan.tx, plan.ty]], 0x00e5ff);
        if (plan.receiver !== p.idx) this.showTarget(plan.receiver, 1);
        o.lineStyle(2, 0x00e5ff, 1).strokeCircle(isoX(plan.hx, plan.hy), isoY(plan.hx, plan.hy), 5);
      } else {
        const t = pickPassTarget(s, p, hasDir ? mx : p.fx, hasDir ? my : p.fy);
        if (t >= 0) {
          this.showTarget(t, p.chargeKind === 'pass' ? 1 : 0.6);
          if (aim && p.chargeKind === 'pass') {
            const q = s.players[t];
            this.dashed(o, [[s.ball.x, s.ball.y], [q.x, q.y]], 0x2ec4b6);
          }
        }
      }
    }

    if (p.chargeKind === 'none') return;
    const w = 28;
    const col = p.chargeKind === 'pass' ? 0x2ec4b6 : p.charge > 0.8 ? 0xff4d6d : p.charge > 0.45 ? 0xffd21f : 0x7cff6b;
    o.fillStyle(0x0d0b14, 0.85).fillRect(x - w / 2 - 1, y - FIG_H - 24, w + 2, 6);
    o.fillStyle(col, 1).fillRect(x - w / 2, y - FIG_H - 23, w * p.charge, 4);

    if (p.chargeKind === 'shot') {
      // Mirino sulla porta e traiettoria: dove andrà il tiro (piazzato, potente o pallonetto).
      const aimY = shotAimFromInput(mx, my);
      const [gx, gy] = shotTarget(p, aimY);
      const chip = !!inp?.lob;
      const h = chip ? 1.2 : 0.25 + p.charge * p.charge * 0.95;
      const tx = isoX(gx, gy);
      const ty = isoY(gx, gy, h);
      const sx = isoX(p.x, p.y);
      const sy = isoY(p.x, p.y, 0.2);
      const tcol = inp?.mod ? 0x2ec4b6 : chip ? 0xb47cff : col;
      o.lineStyle(2, tcol, 0.75);
      const n = 12;
      const arcH = chip ? 70 : 18 * p.charge;
      for (let i = 0; i < n; i += 2) {
        const a = i / n;
        const b2 = (i + 1) / n;
        const arc = (t: number) => Math.sin(Math.PI * t) * arcH;
        o.lineBetween(
          Phaser.Math.Linear(sx, tx, a),
          Phaser.Math.Linear(sy, ty, a) - arc(a),
          Phaser.Math.Linear(sx, tx, b2),
          Phaser.Math.Linear(sy, ty, b2) - arc(b2),
        );
      }
      const r = 7 + (1 - p.charge) * 5;
      o.lineStyle(2, tcol, 1).strokeCircle(tx, ty, r);
      o.lineBetween(tx - r - 4, ty, tx + r + 4, ty).lineBetween(tx, ty - r - 4, tx, ty + r + 4);
    }
  }

  /** Sceglie animazione e fotogramma dallo stato della simulazione. */
  private drawPlayer(
    p: PlayerState,
    x: number,
    y: number,
    fx: number,
    fy: number,
    kind: string,
    prog: number,
    speed: number,
    step: number,
    replay: boolean,
  ): void {
    const v = this.views[p.idx];
    const ps = v.ps;
    const F = ps.frames;
    const sx = isoX(x, y);
    const sy = isoY(x, y);
    const [dx, dy] = worldToScreenDir(fx, fy);
    let dir = dir8(dx, dy);
    if (kind !== v.lastKind) {
      v.lastKind = kind;
      v.lockDir = dir;
    }
    const now = this.time.now / 1000;
    const seq = (a: string) => Math.min(F[a].frames - 1, Math.floor(prog * F[a].frames));
    const loop = (a: string) => Math.floor(now * F[a].fps) % F[a].frames;
    let anim = 'idle';
    let fr = 0;
    switch (kind) {
      case 'trick': {
        anim = TRICK_ANIM[p.action.id] ?? 'feint';
        fr = seq(anim);
        if (anim === 'veronica') dir = v.lockDir;
        if (anim === 'juggle') fr = loop(anim);
        break;
      }
      case 'header':
      case 'volley':
      case 'bicycle':
        anim = kind;
        fr = seq(anim);
        if (kind === 'bicycle') dir = v.lockDir;
        break;
      case 'shoot':
      case 'rabona':
      case 'tackle':
      case 'shoulder':
      case 'slide':
      case 'feint':
      case 'elastico':
      case 'sombrero':
      case 'tunnel':
        anim = ps.has(kind) ? kind : 'pass';
        fr = seq(anim);
        break;
      case 'kick':
        anim = 'pass';
        fr = seq(anim);
        break;
      case 'veronica':
        // La giravolta è già nell'animazione: direzione bloccata all'inizio.
        anim = 'veronica';
        fr = seq(anim);
        dir = v.lockDir;
        break;
      case 'fall':
      case 'stunned':
        anim = 'fall';
        fr = Math.min(F.fall.frames - 1, Math.floor(Math.min(1, prog * 1.4) * F.fall.frames));
        break;
      case 'stagger':
        anim = 'stagger';
        fr = loop(anim);
        break;
      case 'celebrate':
        anim = 'celebrate';
        fr = loop(anim);
        break;
      case 'dive': {
        // Tuffo verso la sinistra o la destra del portiere (lo specchio inverte i lati).
        const out = p.team === 0 ? 1 : -1;
        let left = (p.action.dy || 1) * out > 0;
        dir = v.lockDir;
        if (dir >= 5) left = !left;
        anim = left ? 'diveL' : 'diveR';
        fr = seq(anim);
        break;
      }
      default: {
        const s = this.state;
        if (!replay && p.juggle > 0) {
          anim = 'juggle';
          fr = loop(anim);
        } else if (!replay && p.shield && p.role === 'field') {
          // Protezione palla (con palla) o contenimento (senza).
          anim = s.ball.owner === p.idx ? 'shield' : 'jockey';
          fr = loop(anim);
        } else if (p.role === 'gk' && s.ball.owner === p.idx && !replay) {
          const since = (this.time.now - v.catchT) / 1000;
          if (since < 0.35) {
            anim = 'save';
            fr = Math.min(F.save.frames - 1, Math.floor((since / 0.35) * F.save.frames));
          } else {
            anim = 'hold';
            fr = loop(anim);
          }
        } else if (speed > 0.6) {
          const sprint = p.role === 'field' && speed > 7.2;
          anim = sprint ? 'sprint' : 'run';
          v.runDist += step;
          const cycle = sprint ? 2.7 : 1.9;
          fr = Math.floor((v.runDist / cycle) * F[anim].frames) % F[anim].frames;
        } else if (p.role === 'gk') {
          const gx = p.team === 0 ? 0 : FIELD.length;
          anim = Math.abs(s.ball.x - gx) < 15 ? 'ready' : 'idle';
          fr = loop(anim);
        } else {
          anim = 'idle';
          fr = loop(anim);
        }
      }
    }
    ps.show(anim, fr, dir);
    ps.setPosition(sx, sy).setDepth(isoDepth(x, y) + 0.5);
    const lying = anim === 'slide' || anim === 'fall' || anim.startsWith('dive');
    v.shadow.setPosition(sx, sy).setDepth(isoDepth(x, y) - 0.5).setScale(lying ? 1.35 : 1, lying ? 1.2 : 1);

    // Scia "fantasma" durante le skill: si vede bene il movimento.
    const gbCarrier = this.state.gbActive[p.team] > 0 && this.state.ball.owner === p.idx;
    if (!replay && (SKILL_KINDS.has(kind) || kind === 'trick' || gbCarrier)) {
      v.ghostT -= this.game.loop.delta;
      if (v.ghostT <= 0) {
        v.ghostT = 45;
        const ghost = ps.ghost(gbCarrier ? 0xff7b1f : 0x2ec4b6);
        ghost.setDepth(ps.container.depth - 0.1).setAlpha(0.5);
        this.tweens.add({ targets: ghost, alpha: 0, duration: 260, onComplete: () => ghost.destroy() });
      }
    }
  }

  private ballRoll = 0;
  private ballAngle = 0;

  private drawBall(x: number, y: number, z: number, speed: number, owned: boolean): void {
    const s = this.state;
    // Il portiere tiene la palla in mano, all'altezza del petto.
    const owner = owned ? s.players[s.ball.owner] : null;
    if (owner && owner.role === 'gk' && s.phase === 'play') {
      x = owner.x + owner.fx * 0.28;
      y = owner.y + owner.fy * 0.28;
      z = 1.0;
    }
    const sx = isoX(x, y);
    const sy = isoY(x, y, z);
    this.ball.setPosition(sx, sy - BALL_R).setDepth(isoDepth(x, y) + (owned ? 0.7 : 0.6));
    // Rotazione visibile: fotogrammi del rotolamento + orientamento sulla direzione di moto.
    const b = s.ball;
    const [vx, vy] = worldToScreenDir(b.vx, b.vy);
    if (Math.hypot(vx, vy) > 2) this.ballAngle = Math.atan2(vy, vx);
    if (!(owner && owner.role === 'gk')) this.ballRoll += (speed * this.game.loop.delta) / 1000;
    this.ball.setFrame(Math.floor(this.ballRoll / BALL_STEP) % 16).setRotation(this.ballAngle);
    const sh = Math.max(0.18, 0.4 - z * 0.05);
    this.ballShadow.setPosition(isoX(x, y), isoY(x, y)).setScale(sh, sh * 1.2).setAlpha(Math.max(0.35, 1 - z * 0.15));
    this.ballShadow.setDepth(isoDepth(x, y) - 0.6);

    if (!owned && speed > 7) {
      const gbShot = s.ball.shotGb || (s.ball.owner >= 0 && s.gbActive[s.players[s.ball.owner].team] > 0);
      this.trailPts.push({ x: sx, y: sy - BALL_R, fire: gbShot || speed > 21 || this.lastBallSpeed > 21 });
    } else if (this.trailPts.length) {
      this.trailPts.shift();
    }
    this.lastBallSpeed = owned ? 0 : speed;
    if (this.trailPts.length > 16) this.trailPts.shift();
    this.trail.clear();
    const n = this.trailPts.length;
    for (let i = 1; i < n; i++) {
      const a = this.trailPts[i - 1];
      const c = this.trailPts[i];
      const k = i / n;
      const col = c.fire ? (k > 0.6 ? 0xfff27a : 0xff7b1f) : 0xffffff;
      this.trail.lineStyle(1 + k * (c.fire ? 8 : 5), col, k * (c.fire ? 0.85 : 0.5));
      this.trail.lineBetween(a.x, a.y, c.x, c.y);
    }
  }

  private updateCamera(dt: number): void {
    const s = this.state;
    const cam = this.cameras.main;
    const base = this.baseZoom();
    let tx: number;
    let ty: number;
    let tz = base;
    if (this.replayActive) {
      tx = this.ball.x;
      ty = this.ball.y;
      tz = base * 1.12;
    } else if (s.phase === 'goal' && s.lastGoal && s.lastGoal.scorer >= 0) {
      const v = this.views[s.lastGoal.scorer];
      tx = v.ps.container.x;
      ty = v.ps.container.y - 30;
      tz = base * 1.25;
    } else {
      // Palla al centro, un po' verso il giocatore controllato e in avanti nella direzione d'attacco.
      const c = s.controllers.find((k) => k.id === LOCAL_ID);
      tx = this.ball.x;
      ty = this.ball.y;
      if (c && c.player >= 0) {
        const v = this.views[c.player];
        tx = tx * 0.7 + v.ps.container.x * 0.3;
        ty = ty * 0.7 + v.ps.container.y * 0.3;
      }
      const b = s.ball;
      const owner = b.owner >= 0 ? s.players[b.owner] : null;
      const ad = owner ? attackDir(owner.team) : 0;
      const [lx, ly] = worldToScreenDir(b.vx * 0.25 + ad * 2.5, b.vy * 0.25);
      tx += Phaser.Math.Clamp(lx, -105, 105);
      ty += Phaser.Math.Clamp(ly, -65, 65);
    }
    if (this.zoomPunch > 0) this.zoomPunch = Math.max(0, this.zoomPunch - dt * 0.9);
    const k = 1 - Math.exp(-dt * 5);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.zoom += (tz - this.zoom) * (1 - Math.exp(-dt * 3));
    cam.setZoom(this.zoom * (1 + this.zoomPunch * 0.25));
    cam.centerOn(this.camX, this.camY);

    // Scossa da "trauma" (skill game-feel): somma di seni, ampiezza = trauma², tempo reale.
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      this.shakeT += dt * 30;
      const sh = this.trauma * this.trauma;
      cam.scrollX += 7 * sh * Math.sin(this.shakeT * 1.7);
      cam.scrollY += 5 * sh * Math.sin(this.shakeT * 2.3);
    }
  }

  debugInfo() {
    const s = this.state;
    return { phase: s.phase, score: s.score, clock: s.clock, tick: s.tick, zoom: this.cameras.main.zoom, timeScale: this.timeScale };
  }
}
