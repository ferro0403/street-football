// HUD sopra la partita: punteggio, tempo, scheda del giocatore controllato, scritte a comparsa
// e, sui dispositivi touch, joystick virtuale + pulsanti grandi.
import Phaser from 'phaser';
import type { MatchScene } from './MatchScene';
import type { MatchEvent } from '../../shared/types';
import { SKILL_LABELS } from '../../shared/stats';
import { COLORS, GAME_H, GAME_W, fmtClock, hexColor, text } from '../ui';
import { isTouchDevice, touchState } from '../input/InputManager';
import { isMuted, toggleMute } from '../fx/sfx';

interface TouchButton {
  key: 'pass' | 'shoot' | 'sprint' | 'skill' | 'feint';
  x: number;
  y: number;
  r: number;
  label: string;
  color: number;
  g: Phaser.GameObjects.Graphics;
  t: Phaser.GameObjects.Text;
}

export class HudScene extends Phaser.Scene {
  private match!: MatchScene;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private homeName!: Phaser.GameObjects.Text;
  private awayName!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Graphics;
  private cardName!: Phaser.GameObjects.Text;
  private cardInfo!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private replayBars!: Phaser.GameObjects.Graphics;
  private replayText!: Phaser.GameObjects.Text;
  private toasts: Phaser.GameObjects.Text[] = [];
  // Touch.
  private touchOn = false;
  private touchLayer!: Phaser.GameObjects.Container;
  private stickBase!: Phaser.GameObjects.Arc;
  private stickKnob!: Phaser.GameObjects.Arc;
  private stickPointer = -1;
  private stickOrigin = new Phaser.Math.Vector2();
  private buttons: TouchButton[] = [];
  private pauseBtn!: Phaser.GameObjects.Text;

  constructor() {
    super('hud');
  }

  create(): void {
    this.match = this.scene.get('match') as MatchScene;
    const s = this.match.state;
    this.toasts = [];
    this.buttons = [];
    this.stickPointer = -1;

    // Tabellone in alto al centro.
    const g = this.add.graphics();
    g.fillStyle(COLORS.ink, 0.85).fillRect(GAME_W / 2 - 230, 10, 460, 40);
    g.lineStyle(2, COLORS.white, 0.5).strokeRect(GAME_W / 2 - 230, 10, 460, 40);
    const k0 = s.teams[0].kit;
    const k1 = s.teams[1].kit;
    g.fillStyle(k0.shirt, 1).fillRect(GAME_W / 2 - 226, 14, 10, 32);
    g.fillStyle(k0.trim, 1).fillRect(GAME_W / 2 - 216, 14, 4, 32);
    g.fillStyle(k1.shirt, 1).fillRect(GAME_W / 2 + 216, 14, 10, 32);
    g.fillStyle(k1.trim, 1).fillRect(GAME_W / 2 + 212, 14, 4, 32);
    this.homeName = text(this, GAME_W / 2 - 200, 30, s.teams[0].short, 14, '#ffffff', 0);
    this.awayName = text(this, GAME_W / 2 + 200, 30, s.teams[1].short, 14, '#ffffff', 1);
    this.scoreText = text(this, GAME_W / 2, 30, '0 - 0', 18, hexColor(COLORS.yellow));
    this.clockText = text(this, GAME_W / 2, 64, fmtClock(s.clock), 12);
    this.add.existing(this.homeName);
    this.add.existing(this.awayName);

    // Scheda giocatore in basso a sinistra (sopra il joystick su touch).
    this.card = this.add.graphics();
    this.cardName = text(this, 22, 0, '', 10, '#ffffff', 0);
    this.cardInfo = text(this, 22, 0, '', 8, '#cfc8e0', 0);

    this.banner = text(this, GAME_W / 2, GAME_H / 2 - 30, '', 40, hexColor(COLORS.yellow)).setVisible(false);
    this.sub = text(this, GAME_W / 2, GAME_H / 2 + 20, '', 14).setVisible(false);

    this.replayBars = this.add.graphics().setVisible(false);
    this.replayBars.fillStyle(0x000000, 1).fillRect(0, 0, GAME_W, 46).fillRect(0, GAME_H - 46, GAME_W, 46);
    this.replayText = text(this, 24, GAME_H - 23, '● REPLAY', 14, '#ff4d6d', 0).setVisible(false);
    this.banner.setDepth(10);
    this.sub.setDepth(10);

    // Pulsante audio + pausa (utile su touch, cliccabile su PC).
    const mute = text(this, GAME_W - 18, 22, isMuted() ? '♪×' : '♪', 12, '#ffffff', 1).setInteractive({ useHandCursor: true });
    mute.on('pointerup', () => mute.setText(toggleMute() ? '♪×' : '♪'));
    this.pauseBtn = text(this, 18, 22, 'II', 14, '#ffffff', 0).setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerup', () => this.match.openPause());

    this.buildTouch();
    if (isTouchDevice()) this.setTouch(true);
    // Primo tocco su un dispositivo ibrido: mostra i comandi touch.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch && !this.touchOn) this.setTouch(true);
    });

    this.match.events.on('sim', this.onSim, this);
    this.match.events.on('replay', this.onReplay, this);
    this.events.once('shutdown', () => {
      this.match.events.off('sim', this.onSim, this);
      this.match.events.off('replay', this.onReplay, this);
      this.resetTouch();
    });

    this.showBanner('PRONTI?', `${s.teams[0].name}  vs  ${s.teams[1].name}`, 1100);
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
        this.toast('PARATA!', e);
        break;
      case 'catch':
        this.toast('PRESA!', e);
        break;
      case 'post':
        this.toast('PALO!', e);
        break;
      case 'tackle':
        if (e.team === 0) this.toast('RUBATA!', e);
        break;
      case 'dodge':
        this.toast('SALTATO!', e);
        break;
      case 'special':
        this.toast(`${SKILL_LABELS[e.skill as keyof typeof SKILL_LABELS] ?? 'SKILL'}!`.toUpperCase(), e, '#2ec4b6');
        break;
      case 'end': {
        const [a, b] = s.score;
        this.showBanner('FINE!', a === b ? 'Pareggio' : `Vince ${s.teams[a > b ? 0 : 1].name}`, 2200);
        break;
      }
    }
  }

  private onReplay(on: boolean): void {
    this.replayBars.setVisible(on);
    this.replayText.setVisible(on);
    if (on) {
      this.banner.setVisible(false);
      this.tweens.killTweensOf(this.sub);
      this.sub.setText(this.touchOn ? 'TOCCA PASSA PER SALTARE' : 'PASSAGGIO PER SALTARE').setVisible(true).setAlpha(0.85).setY(GAME_H - 23).setX(GAME_W - 200).setScale(0.6);
    } else {
      this.sub.setVisible(false).setY(GAME_H / 2 + 20).setX(GAME_W / 2).setScale(1);
    }
  }

  private showBanner(big: string, small: string, ms: number, pop = false): void {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setText(big).setVisible(true).setAlpha(1).setScale(pop ? 0.2 : 1);
    this.sub.setText(small).setVisible(!!small).setAlpha(1).setY(GAME_H / 2 + 20).setScale(1);
    if (pop) {
      this.tweens.add({ targets: this.banner, scale: 1, duration: 450, ease: 'Back.Out' });
      this.tweens.add({ targets: this.banner, angle: { from: -6, to: 6 }, duration: 260, yoyo: true, repeat: 3 });
    }
    this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, delay: ms, duration: 300 });
  }

  private toast(msg: string, e: MatchEvent, color = '#ffd21f'): void {
    const t = text(this, GAME_W / 2, 100, msg, 14, color);
    this.toasts.push(t);
    this.tweens.add({
      targets: t,
      y: 84,
      alpha: { from: 1, to: 0 },
      delay: 500,
      duration: 500,
      onComplete: () => {
        t.destroy();
        this.toasts = this.toasts.filter((x) => x !== t);
      },
    });
    void e;
  }

  // --- Aggiornamento ------------------------------------------------------------------

  update(): void {
    const s = this.match.state;
    this.scoreText.setText(`${s.score[0]} - ${s.score[1]}`);
    this.clockText.setText(fmtClock(s.clock));
    this.clockText.setColor(s.clock <= 10 && s.phase === 'play' ? '#ff4d6d' : '#ffffff');

    const c = s.controllers[0];
    const p = c && c.player >= 0 ? s.players[c.player] : null;
    const cy = this.touchOn ? 92 : GAME_H - 58;
    this.card.clear();
    if (p && !this.match.replayActive) {
      this.card.setVisible(true);
      this.cardName.setVisible(true);
      this.cardInfo.setVisible(true);
      const w = 230;
      this.card.fillStyle(COLORS.ink, 0.8).fillRect(12, cy - 16, w, 50);
      this.card.fillStyle(s.teams[0].kit.shirt, 1).fillRect(12, cy - 16, 5, 50);
      this.cardName.setText(`#${p.number} ${p.name.toUpperCase()}  ${p.ovr}`).setPosition(24, cy - 4);
      const skill = p.special ? SKILL_LABELS[p.special] : '-';
      const ready = p.skillCd <= 0 ? 'PRONTA' : `${p.skillCd.toFixed(1)}s`;
      this.cardInfo.setText(`SKILL ${skill.toUpperCase()} ${ready}`).setPosition(24, cy + 12);
      // Barra scatto (stamina).
      this.card.fillStyle(0x333044, 1).fillRect(24, cy + 22, w - 24, 6);
      this.card.fillStyle(p.stamina > 0.3 ? 0x7cff6b : 0xff4d6d, 1).fillRect(24, cy + 22, (w - 24) * p.stamina, 6);
    } else {
      this.cardName.setVisible(false);
      this.cardInfo.setVisible(false);
    }

    if (this.touchOn) this.updateTouch();
  }

  // --- Comandi touch -------------------------------------------------------------------

  private buildTouch(): void {
    this.touchLayer = this.add.container(0, 0).setVisible(false).setDepth(100);
    this.stickBase = this.add.circle(150, GAME_H - 130, 70, 0xffffff, 0.08).setStrokeStyle(3, 0xffffff, 0.35);
    this.stickKnob = this.add.circle(150, GAME_H - 130, 32, 0xffffff, 0.3).setStrokeStyle(3, 0xffffff, 0.7);
    this.touchLayer.add([this.stickBase, this.stickKnob]);

    const R = GAME_W - 110;
    const B = GAME_H - 120;
    const defs: Omit<TouchButton, 'g' | 't'>[] = [
      { key: 'shoot', x: R + 40, y: B - 10, r: 48, label: 'TIRA', color: 0xff4d6d },
      { key: 'pass', x: R - 60, y: B + 50, r: 44, label: 'PASSA', color: 0x2ec4b6 },
      { key: 'sprint', x: R - 70, y: B - 70, r: 38, label: 'SCATTO', color: 0x7cff6b },
      { key: 'skill', x: R + 30, y: B - 120, r: 38, label: 'SKILL', color: 0xffd21f },
      { key: 'feint', x: R - 160, y: B + 70, r: 30, label: 'FINTA', color: 0x9b5de5 },
    ];
    for (const d of defs) {
      const g = this.add.graphics();
      const t = text(this, d.x, d.y, d.label, d.r > 40 ? 10 : 8);
      const b: TouchButton = { ...d, g, t };
      this.drawButton(b, false);
      this.buttons.push(b);
      this.touchLayer.add([g, t]);
    }
  }

  private drawButton(b: TouchButton, down: boolean): void {
    b.g.clear();
    b.g.fillStyle(b.color, down ? 0.75 : 0.32).fillCircle(b.x, b.y, b.r);
    b.g.lineStyle(3, b.color, down ? 1 : 0.8).strokeCircle(b.x, b.y, b.r);
    b.t.setScale(down ? 0.92 : 1);
  }

  private setTouch(on: boolean): void {
    this.touchOn = on;
    this.touchLayer.setVisible(on);
    if (!on) this.resetTouch();
  }

  private resetTouch(): void {
    Object.assign(touchState, { sx: 0, sy: 0, sprint: false, pass: false, shoot: false, feint: false, skill: false, pause: false });
  }

  /** Legge tutti i puntatori attivi: multi-touch reale, scorrere tra i pulsanti funziona. */
  private updateTouch(): void {
    const pointers = this.input.manager.pointers.filter((p) => p.isDown);
    const pressed = new Set<string>();
    let stickFound = false;

    for (const p of pointers) {
      const x = p.x;
      const y = p.y;
      // Joystick fluttuante: metà sinistra dello schermo.
      if (p.id === this.stickPointer || (this.stickPointer < 0 && x < GAME_W * 0.42 && y > 80)) {
        if (this.stickPointer < 0) {
          this.stickPointer = p.id;
          this.stickOrigin.set(x, y);
        }
        stickFound = true;
        const dx = x - this.stickOrigin.x;
        const dy = y - this.stickOrigin.y;
        const max = 64;
        const d = Math.hypot(dx, dy);
        const k = d > max ? max / d : 1;
        this.stickBase.setPosition(this.stickOrigin.x, this.stickOrigin.y);
        this.stickKnob.setPosition(this.stickOrigin.x + dx * k, this.stickOrigin.y + dy * k);
        let sx = (dx * k) / max;
        let sy = (dy * k) / max;
        const m = Math.hypot(sx, sy);
        if (m < 0.18) {
          sx = 0;
          sy = 0;
        } else {
          const r = Math.min(1, (m - 0.18) / 0.82) / m;
          sx *= r;
          sy *= r;
        }
        touchState.sx = sx;
        touchState.sy = sy;
        continue;
      }
      for (const b of this.buttons) {
        if (Math.hypot(x - b.x, y - b.y) <= b.r + 12) pressed.add(b.key);
      }
    }
    if (!stickFound) {
      this.stickPointer = -1;
      touchState.sx = 0;
      touchState.sy = 0;
      this.stickBase.setPosition(150, GAME_H - 130);
      this.stickKnob.setPosition(150, GAME_H - 130);
    }
    for (const b of this.buttons) {
      const on = pressed.has(b.key);
      if (touchState[b.key] !== on) this.drawButton(b, on);
      touchState[b.key] = on;
    }
  }
}
