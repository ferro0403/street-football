// HUD sopra la partita: punteggio, tempo, scheda del giocatore, radar, scritte a comparsa e,
// sui dispositivi touch, joystick dinamico + pulsanti grandi (a eventi: nessun ritardo).
import Phaser from 'phaser';
import type { MatchScene } from './MatchScene';
import type { MatchEvent, MatchState } from '../../shared/types';
import { SKILL_LABELS } from '../../shared/stats';
import { FIELD } from '../../shared/constants';
import { COLORS, fmtClock, hexColor, safeInsets, text, view } from '../ui';
import { isTouchDevice, touchLatch, touchState, type TouchKey } from '../input/InputManager';
import { isMuted, toggleMute } from '../fx/sfx';

interface TouchButton {
  key: TouchKey;
  dx: number; // posizione rispetto all'angolo in basso a destra (area sicura)
  dy: number;
  r: number;
  label: string;
  alt: string; // etichetta senza palla
  color: number;
  x: number;
  y: number;
  g: Phaser.GameObjects.Graphics;
  t: Phaser.GameObjects.Text;
  down: boolean;
}

type Grab = { kind: 'stick' } | { kind: 'btn'; key: TouchKey } | { kind: 'none' };

const BUTTONS: Omit<TouchButton, 'x' | 'y' | 'g' | 't' | 'down'>[] = [
  { key: 'shoot', dx: -78, dy: -165, r: 60, label: 'TIRA', alt: 'CONTRASTO', color: 0xff4d6d },
  { key: 'pass', dx: -178, dy: -64, r: 56, label: 'PASSA', alt: 'CAMBIO', color: 0x2ec4b6 },
  { key: 'sprint', dx: -64, dy: -52, r: 48, label: 'SCATTO', alt: 'SCATTO', color: 0x7cff6b },
  { key: 'lob', dx: -285, dy: -52, r: 42, label: 'LANCIO', alt: 'SCIVOLATA', color: 0x4d9dff },
  { key: 'through', dx: -272, dy: -152, r: 40, label: 'FILTRANTE', alt: '', color: 0x00d0ff },
  { key: 'skill', dx: -184, dy: -220, r: 40, label: 'SKILL', alt: '', color: 0xffd21f },
  { key: 'feint', dx: -64, dy: -278, r: 36, label: 'FINTA', alt: '', color: 0xb47cff },
];

export class HudScene extends Phaser.Scene {
  private match!: MatchScene;
  private board!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private homeName!: Phaser.GameObjects.Text;
  private awayName!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Graphics;
  private cardName!: Phaser.GameObjects.Text;
  private cardInfo!: Phaser.GameObjects.Text;
  private radar!: Phaser.GameObjects.Graphics;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private skillText!: Phaser.GameObjects.Text;
  private replayBars!: Phaser.GameObjects.Graphics;
  private replayText!: Phaser.GameObjects.Text;
  private pauseBtn!: Phaser.GameObjects.Text;
  private muteBtn!: Phaser.GameObjects.Text;
  // Touch.
  private touchOn = false;
  private stickBase!: Phaser.GameObjects.Arc;
  private stickKnob!: Phaser.GameObjects.Arc;
  private stickHint!: Phaser.GameObjects.Text;
  private stickOrigin = new Phaser.Math.Vector2();
  private grabs = new Map<number, Grab>();
  private buttons: TouchButton[] = [];
  private hasBallLabels = true;

  constructor() {
    super('hud');
  }

  create(): void {
    this.match = this.scene.get('match') as MatchScene;
    const s = this.match.state;
    this.buttons = [];
    this.grabs.clear();

    this.board = this.add.graphics();
    this.homeName = text(this, 0, 0, s.teams[0].short, 14, '#ffffff', 0);
    this.awayName = text(this, 0, 0, s.teams[1].short, 14, '#ffffff', 1);
    this.scoreText = text(this, 0, 0, '0 - 0', 18, hexColor(COLORS.yellow));
    this.clockText = text(this, 0, 0, fmtClock(s.clock), 12);

    this.card = this.add.graphics();
    this.cardName = text(this, 0, 0, '', 10, '#ffffff', 0);
    this.cardInfo = text(this, 0, 0, '', 8, '#cfc8e0', 0);
    this.radar = this.add.graphics();

    this.banner = text(this, 0, 0, '', 40, hexColor(COLORS.yellow)).setVisible(false).setDepth(10);
    this.sub = text(this, 0, 0, '', 14).setVisible(false).setDepth(10);
    this.skillText = text(this, 0, 0, '', 34, '#2ec4b6').setVisible(false).setDepth(11);

    this.replayBars = this.add.graphics().setVisible(false);
    this.replayText = text(this, 0, 0, '● REPLAY', 14, '#ff4d6d', 0).setVisible(false).setDepth(10);

    this.muteBtn = text(this, 0, 0, isMuted() ? '♪×' : '♪', 14, '#ffffff', 1).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerup', () => this.muteBtn.setText(toggleMute() ? '♪×' : '♪'));
    this.pauseBtn = text(this, 0, 0, 'II', 16, '#ffffff', 0).setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerup', () => this.match.openPause());

    this.buildTouch();
    if (isTouchDevice()) this.setTouch(true);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('gameout', this.releaseAll, this);

    this.match.events.on('sim', this.onSim, this);
    this.match.events.on('replay', this.onReplay, this);
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => {
      this.match.events.off('sim', this.onSim, this);
      this.match.events.off('replay', this.onReplay, this);
      this.scale.off('resize', this.layout, this);
      this.releaseAll();
    });

    this.layout();
    this.showBanner('PRONTI?', `${s.teams[0].name}  vs  ${s.teams[1].name}`, 1100);
  }

  // --- Disposizione (si ricalcola a ogni ridimensionamento) ----------------------------

  private layout(): void {
    const { w, h } = view(this);
    const ins = safeInsets(this);
    const s = this.match.state;
    const cx = w / 2;
    const top = ins.t;

    const g = this.board.clear();
    const bw = Math.min(460, w - ins.l - ins.r - 140);
    g.fillStyle(COLORS.ink, 0.85).fillRect(cx - bw / 2, top, bw, 40);
    g.lineStyle(2, COLORS.white, 0.5).strokeRect(cx - bw / 2, top, bw, 40);
    const k0 = s.teams[0].kit;
    const k1 = s.teams[1].kit;
    g.fillStyle(k0.shirt, 1).fillRect(cx - bw / 2 + 4, top + 4, 10, 32);
    g.fillStyle(k0.trim, 1).fillRect(cx - bw / 2 + 14, top + 4, 4, 32);
    g.fillStyle(k1.shirt, 1).fillRect(cx + bw / 2 - 14, top + 4, 10, 32);
    g.fillStyle(k1.trim, 1).fillRect(cx + bw / 2 - 18, top + 4, 4, 32);
    this.homeName.setPosition(cx - bw / 2 + 26, top + 20);
    this.awayName.setPosition(cx + bw / 2 - 26, top + 20);
    this.scoreText.setPosition(cx, top + 20);
    this.clockText.setPosition(cx, top + 54);

    this.pauseBtn.setPosition(ins.l + 4, top + 18);
    this.muteBtn.setPosition(w - ins.r - 4, top + 18);
    this.pauseBtn.input!.hitArea.setTo(-14, -14, this.pauseBtn.width + 28, this.pauseBtn.height + 28);
    this.muteBtn.input!.hitArea.setTo(-14, -14, this.muteBtn.width + 28, this.muteBtn.height + 28);

    this.banner.setPosition(cx, h / 2 - 40);
    this.sub.setPosition(cx, h / 2 + 10);
    this.skillText.setPosition(cx, top + 110);

    this.replayBars.clear().fillStyle(0x000000, 1).fillRect(0, 0, w, 46).fillRect(0, h - 46, w, 46);
    this.replayText.setPosition(ins.l + 14, h - 23);

    // Pulsanti touch ancorati all'angolo in basso a destra dell'area sicura.
    const ax = w - ins.r;
    const ay = h - ins.b;
    for (const b of this.buttons) {
      b.x = ax + b.dx;
      b.y = ay + b.dy;
      b.t.setPosition(b.x, b.y);
      this.drawButton(b);
    }
    this.stickHint.setPosition(ins.l + 150, h - ins.b - 120);
    this.parkStick();
  }

  // --- Eventi della partita --------------------------------------------------------

  private onSim(e: MatchEvent): void {
    const s = this.match.state;
    switch (e.type) {
      case 'kickoff':
        this.showBanner('VIA!', '', 700);
        break;
      case 'goal': {
        const scorer = e.p !== undefined && e.p >= 0 ? s.players[e.p] : null;
        const own = s.lastGoal?.ownGoal;
        const team = s.teams[e.team ?? 0];
        this.showBanner('GOOOL!', own ? `Autogol! Punto ${team.short}` : scorer ? `${scorer.name} #${scorer.number}` : team.name, 2300, true);
        this.tweens.add({ targets: this.scoreText, scale: { from: 1.8, to: 1 }, duration: 500, ease: 'Back.Out' });
        break;
      }
      case 'save':
        this.toast('RESPINTA!');
        break;
      case 'catch':
        this.toast('PARATA!');
        break;
      case 'post':
        this.toast('PALO!');
        break;
      case 'foul':
        this.toast('FALLO!', '#ff4d6d');
        break;
      case 'tackle':
        this.toast(e.skill === 'slide' ? 'SCIVOLATA!' : e.skill === 'shoulder' ? 'SPALLATA!' : 'RUBATA!', e.team === 0 ? '#7cff6b' : '#ff4d6d');
        break;
      case 'steal':
        this.toast('SOFFIATA!', e.team === 0 ? '#7cff6b' : '#ff4d6d');
        break;
      case 'heavyTouch':
        if (e.team === 0) this.toast('PALLA LUNGA!', '#ffb14d');
        break;
      case 'dodge':
        this.toast('SALTATO!', '#2ec4b6');
        break;
      case 'special':
        this.showSkill(e);
        break;
      case 'end': {
        const [a, b] = s.score;
        this.showBanner('FINE!', a === b ? 'Pareggio' : `Vince ${s.teams[a > b ? 0 : 1].name}`, 2200);
        break;
      }
    }
  }

  private showSkill(e: MatchEvent): void {
    const s = this.match.state;
    const name = (SKILL_LABELS[e.skill as keyof typeof SKILL_LABELS] ?? 'SKILL').toUpperCase();
    const p = e.p !== undefined ? s.players[e.p] : null;
    const kit = s.teams[e.team ?? 0].kit;
    this.tweens.killTweensOf(this.skillText);
    this.skillText
      .setText(`${name}!${p ? `\n${p.name.toUpperCase()}` : ''}`)
      .setColor(hexColor(kit.shirt === 0xffffff ? COLORS.yellow : kit.shirt))
      .setVisible(true)
      .setAlpha(1)
      .setScale(0.3)
      .setAngle(-8);
    this.tweens.add({ targets: this.skillText, scale: 1, angle: 0, duration: 320, ease: 'Back.Out' });
    this.tweens.add({ targets: this.skillText, alpha: 0, delay: 1100, duration: 350 });
  }

  private onReplay(on: boolean): void {
    const { w, h } = view(this);
    this.replayBars.setVisible(on);
    this.replayText.setVisible(on);
    if (on) {
      this.banner.setVisible(false);
      this.tweens.killTweensOf(this.sub);
      this.sub
        .setText(this.touchOn ? 'TOCCA PASSA PER SALTARE' : 'PASSAGGIO PER SALTARE')
        .setVisible(true)
        .setAlpha(0.85)
        .setPosition(w - 200, h - 23)
        .setScale(0.6);
    } else {
      this.sub.setVisible(false).setPosition(w / 2, h / 2 + 10).setScale(1);
    }
  }

  private showBanner(big: string, small: string, ms: number, pop = false): void {
    const { w, h } = view(this);
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setText(big).setVisible(true).setAlpha(1).setScale(pop ? 0.2 : 1).setAngle(0);
    this.sub.setText(small).setVisible(!!small).setAlpha(1).setPosition(w / 2, h / 2 + 10).setScale(1);
    if (pop) {
      this.tweens.add({ targets: this.banner, scale: 1, duration: 450, ease: 'Back.Out' });
      this.tweens.add({ targets: this.banner, angle: { from: -6, to: 6 }, duration: 260, yoyo: true, repeat: 3 });
    }
    this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, delay: ms, duration: 300 });
  }

  private toast(msg: string, color = '#ffd21f'): void {
    const { w } = view(this);
    const y = safeInsets(this).t + 86;
    const t = text(this, w / 2, y, msg, 14, color);
    this.tweens.add({
      targets: t,
      y: y - 16,
      alpha: { from: 1, to: 0 },
      delay: 550,
      duration: 450,
      onComplete: () => t.destroy(),
    });
  }

  // --- Aggiornamento ------------------------------------------------------------------

  update(): void {
    const s = this.match.state;
    this.scoreText.setText(`${s.score[0]} - ${s.score[1]}`);
    this.clockText.setText(fmtClock(s.clock));
    this.clockText.setColor(s.clock <= 10 && s.phase === 'play' ? '#ff4d6d' : '#ffffff');
    this.drawCard(s);
    this.drawRadar(s);
    if (this.touchOn) this.updateTouchLabels(s);
  }

  private drawCard(s: MatchState): void {
    const { h } = view(this);
    const ins = safeInsets(this);
    const c = s.controllers[0];
    const p = c && c.player >= 0 ? s.players[c.player] : null;
    this.card.clear();
    const show = !!p && !this.match.replayActive;
    this.cardName.setVisible(show);
    this.cardInfo.setVisible(show);
    if (!show || !p) return;
    const x = ins.l + (this.touchOn ? 40 : 0);
    const cy = this.touchOn ? ins.t + 72 : h - ins.b - 46;
    const w = 236;
    this.card.fillStyle(COLORS.ink, 0.8).fillRect(x, cy - 16, w, 50);
    this.card.fillStyle(s.teams[0].kit.shirt, 1).fillRect(x, cy - 16, 5, 50);
    this.cardName.setText(`#${p.number} ${p.name.toUpperCase()}  ${p.ovr}`).setPosition(x + 12, cy - 4);
    const skill = p.special ? SKILL_LABELS[p.special] : '-';
    const ready = p.skillCd <= 0 ? 'PRONTA' : `${p.skillCd.toFixed(1)}s`;
    this.cardInfo.setText(`SKILL ${skill.toUpperCase()} ${ready}`).setPosition(x + 12, cy + 12);
    this.card.fillStyle(0x333044, 1).fillRect(x + 12, cy + 22, w - 24, 6);
    this.card.fillStyle(p.stamina > 0.3 ? 0x7cff6b : 0xff4d6d, 1).fillRect(x + 12, cy + 22, (w - 24) * p.stamina, 6);
  }

  /** Radar visto dall'alto: con la telecamera vicina serve a vedere tutti. */
  private drawRadar(s: MatchState): void {
    const { w, h } = view(this);
    const ins = safeInsets(this);
    const g = this.radar.clear();
    if (this.match.replayActive) return;
    const rw = 132;
    const rh = Math.round((rw * FIELD.width) / FIELD.length);
    const x0 = this.touchOn ? w - ins.r - rw - 8 : w - ins.r - rw - 6;
    const y0 = this.touchOn ? ins.t + 46 : h - ins.b - rh - 6;
    g.fillStyle(0x0d0b14, 0.6).fillRect(x0 - 3, y0 - 3, rw + 6, rh + 6);
    g.lineStyle(1, 0xffffff, 0.5).strokeRect(x0, y0, rw, rh);
    g.lineBetween(x0 + rw / 2, y0, x0 + rw / 2, y0 + rh);
    const gy = (rh * (FIELD.width - FIELD.goalWidth)) / 2 / FIELD.width;
    g.lineStyle(2, 0xffffff, 0.9).lineBetween(x0, y0 + gy, x0, y0 + rh - gy).lineBetween(x0 + rw, y0 + gy, x0 + rw, y0 + rh - gy);
    const px = (x: number) => x0 + (x / FIELD.length) * rw;
    const py = (y: number) => y0 + (y / FIELD.width) * rh;
    const me = s.controllers[0]?.player ?? -1;
    for (const p of s.players) {
      const kit = s.teams[p.team].kit;
      g.fillStyle(kit.shirt, 1).fillCircle(px(p.x), py(p.y), 3);
      if (p.idx === me) g.lineStyle(2, 0xffd21f, 1).strokeCircle(px(p.x), py(p.y), 5);
    }
    g.fillStyle(0xffffff, 1).fillCircle(px(s.ball.x), py(s.ball.y), 2);
  }

  // --- Comandi touch -------------------------------------------------------------------

  private buildTouch(): void {
    this.stickBase = this.add.circle(0, 0, 78, 0xffffff, 0.1).setStrokeStyle(3, 0xffffff, 0.45).setVisible(false).setDepth(20);
    this.stickKnob = this.add.circle(0, 0, 36, 0xffffff, 0.35).setStrokeStyle(3, 0xffffff, 0.8).setVisible(false).setDepth(21);
    this.stickHint = text(this, 0, 0, 'MUOVITI\nQUI', 9, '#ffffff').setAlpha(0.25).setVisible(false);
    for (const d of BUTTONS) {
      const g = this.add.graphics().setDepth(20);
      const t = text(this, 0, 0, d.label, d.r >= 50 ? 11 : d.r >= 42 ? 9 : 8).setDepth(21);
      this.buttons.push({ ...d, x: 0, y: 0, g, t, down: false });
    }
    this.setButtonsVisible(false);
  }

  private setButtonsVisible(v: boolean): void {
    for (const b of this.buttons) {
      b.g.setVisible(v);
      b.t.setVisible(v);
    }
    this.stickHint.setVisible(v);
  }

  private drawButton(b: TouchButton, enabled = true): void {
    const g = b.g.clear();
    const a = enabled ? 1 : 0.35;
    if (b.down) {
      g.fillStyle(b.color, 0.35).fillCircle(b.x, b.y, b.r + 10); // alone
      g.fillStyle(b.color, 0.9).fillCircle(b.x, b.y, b.r * 0.94);
      g.lineStyle(4, 0xffffff, 1).strokeCircle(b.x, b.y, b.r * 0.94);
    } else {
      g.fillStyle(0x0d0b14, 0.35 * a).fillCircle(b.x, b.y, b.r);
      g.fillStyle(b.color, 0.3 * a).fillCircle(b.x, b.y, b.r);
      g.lineStyle(3, b.color, 0.9 * a).strokeCircle(b.x, b.y, b.r);
    }
    b.t.setScale(b.down ? 0.9 : 1).setAlpha(enabled ? 1 : 0.4).setColor('#ffffff');
  }

  private setTouch(on: boolean): void {
    this.touchOn = on;
    this.setButtonsVisible(on);
    if (!on) this.releaseAll();
    this.layout();
  }

  private parkStick(): void {
    this.stickBase.setVisible(false);
    this.stickKnob.setVisible(false);
  }

  private buttonAt(x: number, y: number): TouchButton | null {
    let best: TouchButton | null = null;
    let bd = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r + 16 && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (p.wasTouch && !this.touchOn) this.setTouch(true);
    if (!this.touchOn || over.includes(this.pauseBtn) || over.includes(this.muteBtn)) return;
    const { w } = view(this);
    const b = this.buttonAt(p.x, p.y);
    if (b) {
      this.grabs.set(p.id, { kind: 'btn', key: b.key });
      this.syncButtons();
      touchLatch.add(b.key);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* non supportato */
      }
      return;
    }
    if (p.x < w * 0.5 && ![...this.grabs.values()].some((g) => g.kind === 'stick')) {
      // Joystick dinamico: nasce dove appoggi il pollice.
      this.grabs.set(p.id, { kind: 'stick' });
      this.stickOrigin.set(p.x, p.y);
      this.stickBase.setPosition(p.x, p.y).setVisible(true);
      this.stickKnob.setPosition(p.x, p.y).setVisible(true);
      this.stickHint.setVisible(false);
      touchState.sx = 0;
      touchState.sy = 0;
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const g = this.grabs.get(p.id);
    if (!g || !p.isDown) return;
    if (g.kind === 'stick') {
      const max = 70;
      let dx = p.x - this.stickOrigin.x;
      let dy = p.y - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      // Se il pollice va oltre il bordo, la base lo segue: niente "fine corsa".
      if (d > max * 1.4) {
        const k = (d - max * 1.4) / d;
        this.stickOrigin.x += dx * k;
        this.stickOrigin.y += dy * k;
        dx = p.x - this.stickOrigin.x;
        dy = p.y - this.stickOrigin.y;
        this.stickBase.setPosition(this.stickOrigin.x, this.stickOrigin.y);
      }
      const dd = Math.hypot(dx, dy);
      const k = dd > max ? max / dd : 1;
      this.stickKnob.setPosition(this.stickOrigin.x + dx * k, this.stickOrigin.y + dy * k);
      let sx = (dx * k) / max;
      let sy = (dy * k) / max;
      const m = Math.hypot(sx, sy);
      if (m < 0.15) {
        sx = 0;
        sy = 0;
      } else {
        const r = Math.min(1, (m - 0.15) / 0.85) / m;
        sx *= r;
        sy *= r;
      }
      touchState.sx = sx;
      touchState.sy = sy;
    } else if (g.kind === 'btn') {
      // Il dito può scivolare su un altro pulsante.
      const b = this.buttonAt(p.x, p.y);
      if (b && b.key !== g.key) {
        this.grabs.set(p.id, { kind: 'btn', key: b.key });
        touchLatch.add(b.key);
        this.syncButtons();
      }
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const g = this.grabs.get(p.id);
    if (!g) return;
    this.grabs.delete(p.id);
    if (g.kind === 'stick') {
      touchState.sx = 0;
      touchState.sy = 0;
      this.parkStick();
      if (this.touchOn) this.stickHint.setVisible(true);
    }
    this.syncButtons();
  }

  private releaseAll(): void {
    this.grabs.clear();
    Object.assign(touchState, { sx: 0, sy: 0, pass: false, lob: false, through: false, shoot: false, sprint: false, skill: false, feint: false, pause: false });
    if (this.stickBase) this.parkStick();
    if (this.buttons.length) this.syncButtons();
  }

  /** Aggiorna lo stato premuto dei pulsanti da tutti i diti attivi. */
  private syncButtons(): void {
    const held = new Set<TouchKey>();
    for (const g of this.grabs.values()) if (g.kind === 'btn') held.add(g.key);
    for (const b of this.buttons) {
      const on = held.has(b.key);
      touchState[b.key] = on;
      if (b.down !== on) {
        b.down = on;
        this.drawButton(b, this.enabledFor(b));
      }
    }
  }

  private enabledFor(b: TouchButton): boolean {
    return this.hasBallLabels || b.alt !== '';
  }

  /** Con o senza palla i pulsanti cambiano significato (e scritta). */
  private updateTouchLabels(s: MatchState): void {
    const c = s.controllers[0];
    const mine = c && c.player >= 0 ? s.players[c.player] : null;
    const team0Has = s.ball.owner >= 0 && s.players[s.ball.owner].team === 0;
    const hasBall = !!mine && (s.ball.owner === mine.idx || (team0Has && s.phase !== 'play'));
    const attacking = hasBall || (s.ball.owner < 0 && s.ball.passTarget >= 0 && s.players[s.ball.passTarget].team === 0);
    if (attacking === this.hasBallLabels) return;
    this.hasBallLabels = attacking;
    for (const b of this.buttons) {
      b.t.setText(attacking || !b.alt ? b.label : b.alt);
      this.drawButton(b, this.enabledFor(b));
    }
  }
}
