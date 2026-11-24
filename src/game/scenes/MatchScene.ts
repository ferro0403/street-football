// Scena di gioco: fa girare la simulazione condivisa a passo fisso (60 Hz) e la disegna
// in isometrico con interpolazione, camera che segue l'azione, effetti e replay del gol.
import Phaser from 'phaser';
import { createMatch, stepMatch } from '../../shared/match';
import { DT, FIELD, RULES } from '../../shared/constants';
import { teamById } from '../../shared/teams';
import type { MatchEvent, MatchState, PlayerInput, PlayerState } from '../../shared/types';
import { isoDepth, isoX, isoY, screenToWorldDir, worldToScreenDir } from '../iso';
import { drawField, worldBounds } from '../render/field';
import { FRAME_H, makePlayerTexture, type FrameName } from '../render/textures';
import { InputManager } from '../input/InputManager';
import { sfx, unlockAudio } from '../fx/sfx';

export interface MatchData {
  home: string;
  away: string;
  duration: number;
}

const LOCAL_ID = 'p1';
const STEP_MS = DT * 1000;
const REPLAY_START = 2.4; // secondi di esultanza prima del replay
const REPLAY_SPEED = 0.7;
const REPLAY_LEN = 200; // tick registrati per il replay (~3,3 s)
const BASE_ZOOM = 1.55;

interface PlayerView {
  shadow: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Sprite;
  tex: string;
  runDist: number;
}

/** Fotogramma minimo per il replay. */
interface ReplayFrame {
  b: [number, number, number];
  p: number[]; // per giocatore: x, y, fx, fy, codice posa
  speed: number;
}

const ACTION_CODES = ['none', 'kick', 'tackle', 'feint', 'veronica', 'elastico', 'sombrero', 'tunnel', 'rabona', 'dive', 'stunned', 'celebrate'];

export class MatchScene extends Phaser.Scene {
  state!: MatchState;
  data_!: MatchData;
  private input_!: InputManager;
  private views: PlayerView[] = [];
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private trail!: Phaser.GameObjects.Graphics;
  private trailPts: { x: number; y: number; fire: boolean }[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private acc = 0;
  private prev: number[] = [];
  private prevBall: [number, number, number] = [0, 0, 0];
  private history: ReplayFrame[] = [];
  private replay: ReplayFrame[] | null = null;
  replayActive = false;
  private camX = 0;
  private camY = 0;
  private zoom = BASE_ZOOM;
  private trauma = 0;
  private shakeT = 0;
  private pausePrev = true;
  private endTimer = -1;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastBallSpeed = 0;

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
    this.zoom = BASE_ZOOM;
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
    });
    this.input_ = new InputManager(this);

    drawField(this);

    // Giocatori.
    for (const p of this.state.players) {
      const t = p.team === 0 ? home : away;
      const def = t.players[p.idx % 5];
      const kit = p.role === 'gk' ? t.gkKit : t.kit;
      const key = `pl-${t.id}-${p.idx % 5}-${p.team}`;
      makePlayerTexture(this, key, kit, def.look, def.number);
      const shadow = this.add.image(0, 0, 'shadow').setDepth(10);
      const sprite = this.add.sprite(0, 0, key, 'idle').setOrigin(0.5, 1);
      this.views.push({ shadow, sprite, tex: key, runDist: 0 });
    }

    this.ring = this.add.image(0, 0, 'ring').setDepth(11).setTint(0xffd21f);
    this.arrow = this.add.image(0, 0, 'arrow').setDepth(6000).setTint(0xffd21f);
    this.ballShadow = this.add.image(0, 0, 'shadow').setScale(0.45).setDepth(12);
    this.trail = this.add.graphics().setDepth(4900);
    this.ball = this.add.image(0, 0, 'ball');
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
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', unlockAudio);
    });
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

    const [mx, my] = screenToWorldDir(si.sx, si.sy);
    const inp: PlayerInput = {
      mx,
      my,
      sprint: si.sprint,
      pass: si.pass,
      shoot: si.shoot,
      feint: si.feint,
      skill: si.skill,
      switch: si.switch,
    };

    this.acc += Math.min(delta, 250);
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

    // Fine partita: breve attesa poi riepilogo.
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

  /** Chiamato dalla pausa alla ripresa: ignora il tasto pausa ancora premuto. */
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
    for (const q of s.players) p.push(q.x, q.y, q.fx, q.fy, ACTION_CODES.indexOf(q.action.kind));
    this.history.push({ b: [b.x, b.y, b.z], p, speed: Math.hypot(b.vx, b.vy) });
    if (this.history.length > REPLAY_LEN + 40) this.history.shift();
  }

  // --- Eventi → suoni ed effetti (game feel) ------------------------------------

  private onEvent(e: MatchEvent): void {
    const s = this.state;
    this.events.emit('sim', e);
    switch (e.type) {
      case 'shot': {
        const pw = e.power ?? 0;
        sfx.kick(pw);
        if (pw > 22) this.addTrauma(0.22 + (pw - 22) * 0.04); // scossa leggera sul tiro forte
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
      case 'tackle':
        sfx.tackle();
        this.addTrauma(0.12);
        this.puff(e.x, e.y, 8);
        break;
      case 'tackleMiss':
        this.puff(e.x, e.y, 4);
        break;
      case 'save':
        sfx.save();
        this.addTrauma(0.25);
        break;
      case 'catch':
        sfx.save();
        break;
      case 'feint':
      case 'special':
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
        this.replay = this.history.slice(-REPLAY_LEN);
        const team = e.team ?? 0;
        const kit = s.teams[team].kit;
        this.confetti.setParticleTint(kit.shirt);
        const gx = team === 0 ? FIELD.length : 0;
        const x = isoX(gx, 11);
        const y = isoY(gx, 11, 1.5);
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
      s.players.forEach((p, k) => {
        const o = k * 5;
        const kind = ACTION_CODES[fr.p[o + 4]] ?? 'none';
        const prevFr = this.replay![Math.max(0, i - 1)];
        const moving = Math.hypot(fr.p[o] - prevFr.p[o], fr.p[o + 1] - prevFr.p[o + 1]) * 60 > 0.6;
        this.drawPlayer(p, fr.p[o], fr.p[o + 1], fr.p[o + 2], fr.p[o + 3], kind, moving, Math.hypot(fr.p[o] - prevFr.p[o], fr.p[o + 1] - prevFr.p[o + 1]));
      });
      this.drawBall(fr.b[0], fr.b[1], fr.b[2], fr.speed, false);
      this.ring.setVisible(false);
      this.arrow.setVisible(false);
      this.overlay.clear();
      return;
    }

    s.players.forEach((p, i) => {
      const x = Phaser.Math.Linear(this.prev[i * 2] ?? p.x, p.x, alpha);
      const y = Phaser.Math.Linear(this.prev[i * 2 + 1] ?? p.y, p.y, alpha);
      const sp = Math.hypot(p.vx, p.vy);
      this.drawPlayer(p, x, y, p.fx, p.fy, p.action.kind, sp > 0.6, sp * DT);
    });

    const b = s.ball;
    const bx = Phaser.Math.Linear(this.prevBall[0], b.x, alpha);
    const by = Phaser.Math.Linear(this.prevBall[1], b.y, alpha);
    const bz = Phaser.Math.Linear(this.prevBall[2], b.z, alpha);
    this.drawBall(bx, by, bz, Math.hypot(b.vx, b.vy), b.owner >= 0);

    // Indicatore del giocatore controllato e barra di carica.
    const c = s.controllers.find((k) => k.id === LOCAL_ID);
    this.overlay.clear();
    if (c && c.player >= 0 && s.phase !== 'goal') {
      const p = s.players[c.player];
      const v = this.views[c.player];
      const x = v.sprite.x;
      const y = v.sprite.y;
      this.ring.setVisible(true).setPosition(x, y);
      this.arrow.setVisible(true).setPosition(x, y - FRAME_H - 8 + Math.sin(this.time.now / 140) * 2);
      if (p.chargeKind !== 'none') {
        const w = 26;
        const col = p.chargeKind === 'pass' ? 0x2ec4b6 : p.charge > 0.8 ? 0xff4d6d : p.charge > 0.45 ? 0xffd21f : 0x7cff6b;
        this.overlay.fillStyle(0x0d0b14, 0.85).fillRect(x - w / 2 - 1, y - FRAME_H - 22, w + 2, 6);
        this.overlay.fillStyle(col, 1).fillRect(x - w / 2, y - FRAME_H - 21, w * p.charge, 4);
      }
    } else {
      this.ring.setVisible(false);
      this.arrow.setVisible(false);
    }
  }

  private drawPlayer(
    p: PlayerState,
    x: number,
    y: number,
    fx: number,
    fy: number,
    kind: string,
    moving: boolean,
    step: number,
  ): void {
    const v = this.views[p.idx];
    const sx = isoX(x, y);
    const sy = isoY(x, y);
    const [dx, dy] = worldToScreenDir(fx, fy);
    const back = dy < -0.5;
    let frame: FrameName = 'idle';
    let lift = 0;
    let flip = dx < 0;
    let angle = 0;
    switch (kind) {
      case 'kick':
      case 'rabona':
        frame = 'kick';
        break;
      case 'tackle':
        frame = 'slide';
        break;
      case 'stunned':
        frame = p.stun > 0.5 || kind === 'stunned' ? 'down' : 'idle';
        break;
      case 'dive':
        frame = 'down';
        lift = 10;
        flip = p.action.dy * (p.team === 0 ? 1 : -1) < 0;
        break;
      case 'celebrate':
        frame = 'cheer';
        lift = Math.abs(Math.sin(this.time.now / 110)) * 6;
        break;
      case 'veronica': {
        // Giro su se stesso: alterna fronte/spalle e specchia.
        const ph = Math.floor(this.time.now / 70) % 4;
        frame = ph % 2 === 0 ? 'spin' : 'idle';
        flip = ph >= 2;
        break;
      }
      case 'elastico':
      case 'feint':
      case 'tunnel':
        frame = 'run2';
        angle = (p.action.dx > 0 ? 1 : -1) * 8;
        break;
      case 'sombrero':
        frame = 'kick';
        break;
      default:
        if (moving) {
          v.runDist += step;
          frame = Math.floor(v.runDist * 2.4) % 2 === 0 ? 'run1' : 'run2';
          lift = Math.floor(v.runDist * 4.8) % 2 === 0 ? 1 : 0;
        } else {
          frame = 'idle';
        }
    }
    const name = back && frame !== 'down' && frame !== 'slide' ? `${frame}_b` : frame;
    v.sprite.setFrame(name).setPosition(sx, sy - lift).setFlipX(flip).setAngle(angle);
    v.sprite.setDepth(isoDepth(x, y) + 0.5);
    // Lampeggia quando è "piantato" da una skill o da un contrasto.
    v.sprite.setAlpha(p.stun > 0 && kind !== 'stunned' && Math.floor(this.time.now / 80) % 2 === 0 ? 0.55 : 1);
    v.shadow.setPosition(sx, sy).setDepth(isoDepth(x, y) - 0.5);
  }

  private drawBall(x: number, y: number, z: number, speed: number, owned: boolean): void {
    const sx = isoX(x, y);
    const sy = isoY(x, y, z);
    this.ball.setPosition(sx, sy - 5).setDepth(isoDepth(x, y) + (owned ? 0.7 : 0.6));
    this.ball.setAngle(this.ball.angle + speed * 1.2);
    const sh = Math.max(0.2, 0.45 - z * 0.06);
    this.ballShadow.setPosition(isoX(x, y), isoY(x, y)).setScale(sh).setAlpha(Math.max(0.3, 1 - z * 0.15));
    this.ballShadow.setDepth(isoDepth(x, y) - 0.6);

    // Scia: punti recenti, più lunga e "infuocata" sui tiri potenti.
    if (!owned && speed > 7) {
      this.trailPts.push({ x: sx, y: sy - 5, fire: speed > 21 || this.lastBallSpeed > 21 });
    } else if (this.trailPts.length) {
      this.trailPts.shift();
    }
    this.lastBallSpeed = owned ? 0 : speed;
    if (this.trailPts.length > 14) this.trailPts.shift();
    this.trail.clear();
    const n = this.trailPts.length;
    for (let i = 1; i < n; i++) {
      const a = this.trailPts[i - 1];
      const b = this.trailPts[i];
      const k = i / n;
      const col = b.fire ? (k > 0.6 ? 0xfff27a : 0xff7b1f) : 0xffffff;
      this.trail.lineStyle(1 + k * (b.fire ? 6 : 4), col, k * (b.fire ? 0.85 : 0.5));
      this.trail.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private updateCamera(dt: number): void {
    const s = this.state;
    const cam = this.cameras.main;
    let tx: number;
    let ty: number;
    let tz = BASE_ZOOM;
    if (this.replayActive) {
      tx = this.ball.x;
      ty = this.ball.y;
      tz = 1.75;
    } else if (s.phase === 'goal' && s.lastGoal && s.lastGoal.scorer >= 0) {
      const v = this.views[s.lastGoal.scorer];
      tx = v.sprite.x;
      ty = v.sprite.y - 20;
      tz = 1.95;
    } else {
      // Palla al centro con un po' di anticipo sul giocatore controllato.
      const c = s.controllers.find((k) => k.id === LOCAL_ID);
      const bx = this.ball.x;
      const by = this.ball.y;
      tx = bx;
      ty = by;
      if (c && c.player >= 0) {
        const v = this.views[c.player];
        tx = bx * 0.75 + v.sprite.x * 0.25;
        ty = by * 0.75 + v.sprite.y * 0.25;
      }
      const b = s.ball;
      const [lx, ly] = worldToScreenDir(b.vx, b.vy);
      tx += Phaser.Math.Clamp(lx * 0.25, -60, 60);
      ty += Phaser.Math.Clamp(ly * 0.25, -40, 40);
    }
    const k = 1 - Math.exp(-dt * 5);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.zoom += (tz - this.zoom) * (1 - Math.exp(-dt * 3));
    cam.setZoom(this.zoom);
    cam.centerOn(this.camX, this.camY);

    // Scossa da "trauma" (skill game-feel): somma di seni, ampiezza = trauma², decade nel tempo reale.
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      this.shakeT += dt * 30;
      const sh = this.trauma * this.trauma;
      cam.scrollX += 7 * sh * Math.sin(this.shakeT * 1.7);
      cam.scrollY += 5 * sh * Math.sin(this.shakeT * 2.3);
    }
  }

  /** Utile al test automatico e al debug da console. */
  debugInfo() {
    const s = this.state;
    return { phase: s.phase, score: s.score, clock: s.clock, tick: s.tick, goalPhase: RULES.goalPhaseSec };
  }
}
