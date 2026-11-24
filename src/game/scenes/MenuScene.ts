// Menu iniziale (Fase 1): scegli la tua squadra, l'avversario e la durata, poi gioca.
// Si usa con mouse/dito, tastiera (frecce + Invio/J) e controller (croce + A).
import Phaser from 'phaser';
import { TEAMS } from '../../shared/teams';
import { overall, SKILL_LABELS } from '../../shared/stats';
import { COLORS, GAME_H, GAME_W, button, hexColor, text } from '../ui';
import { InputManager, isTouchDevice } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';
import { makePlayerTexture } from '../render/textures';
import { sfx, unlockAudio } from '../fx/sfx';

const DURATIONS = [60, 120, 180, 300];

interface Row {
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Rectangle;
  change: (d: number) => void;
}

export class MenuScene extends Phaser.Scene {
  private home = 0;
  private away = 1;
  private dur = 2;
  private focus = 0;
  private rows: Row[] = [];
  private playBtn!: ReturnType<typeof button>;
  private helpBtn!: ReturnType<typeof button>;
  private nav!: MenuNav;
  private previews: Phaser.GameObjects.Image[] = [];
  private help!: Phaser.GameObjects.Container;

  constructor() {
    super('menu');
  }

  create(): void {
    try {
      const saved = JSON.parse(localStorage.getItem('sc-menu') ?? '{}') as { home?: number; away?: number; dur?: number };
      if (typeof saved.home === 'number' && TEAMS[saved.home]) this.home = saved.home;
      if (typeof saved.away === 'number' && TEAMS[saved.away]) this.away = saved.away;
      if (typeof saved.dur === 'number' && DURATIONS[saved.dur]) this.dur = saved.dur;
    } catch {
      /* preferenze non disponibili */
    }
    this.rows = [];
    this.previews = [];
    this.focus = 0;
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);

    this.drawBackdrop();
    const title = text(this, GAME_W / 2, 70, 'STREET CAGE', 44, hexColor(COLORS.yellow));
    this.tweens.add({ targets: title, scale: { from: 1, to: 1.04 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    text(this, GAME_W / 2, 118, 'CALCIO DI STRADA 5 CONTRO 5', 12, '#ffffff');

    const y0 = 190;
    this.addRow(y0, 'LA TUA SQUADRA', (d) => {
      this.home = Phaser.Math.Wrap(this.home + d, 0, TEAMS.length);
      if (this.home === this.away) this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
    });
    this.addRow(y0 + 64, 'AVVERSARIO', (d) => {
      this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
      if (this.away === this.home) this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
    });
    this.addRow(y0 + 128, 'DURATA', (d) => {
      this.dur = Phaser.Math.Wrap(this.dur + d, 0, DURATIONS.length);
    });

    this.playBtn = button(this, GAME_W / 2 - 110, y0 + 210, 200, 52, 'GIOCA', () => this.play());
    this.helpBtn = button(this, GAME_W / 2 + 110, y0 + 210, 200, 52, 'COMANDI', () => this.toggleHelp());

    text(this, GAME_W / 2, GAME_H - 18, 'FASE 1 · PARTITA VELOCE', 8, '#8a83a0');
    this.buildHelp();
    this.refresh();

    this.input.on('pointerdown', unlockAudio);
  }

  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x2a1d45, 0x2a1d45, 0x0d0b14, 0x0d0b14, 1).fillRect(0, 0, GAME_W, GAME_H);
    // Rete metallica stilizzata.
    g.lineStyle(1, 0xc9d1e0, 0.08);
    for (let x = -GAME_H; x < GAME_W; x += 22) {
      g.lineBetween(x, 0, x + GAME_H, GAME_H);
      g.lineBetween(x + GAME_H, 0, x, GAME_H);
    }
  }

  private addRow(y: number, label: string, change: (d: number) => void): void {
    const bg = this.add.rectangle(GAME_W / 2, y, 640, 52, COLORS.panel, 0.9).setStrokeStyle(2, 0xffffff, 0.25);
    const l = text(this, GAME_W / 2 - 300, y - 12, label, 8, '#8a83a0', 0);
    const v = text(this, GAME_W / 2, y + 6, '', 13);
    const left = text(this, GAME_W / 2 - 290, y + 6, '◀', 16, hexColor(COLORS.yellow)).setInteractive({ useHandCursor: true });
    const right = text(this, GAME_W / 2 + 290, y + 6, '▶', 16, hexColor(COLORS.yellow)).setInteractive({ useHandCursor: true });
    const idx = this.rows.length;
    const act = (d: number) => {
      this.focus = idx;
      change(d);
      sfx.ui();
      this.refresh();
    };
    // Aree di tocco ampie per le frecce.
    const hitL = this.add.zone(GAME_W / 2 - 270, y, 110, 52).setInteractive({ useHandCursor: true });
    const hitR = this.add.zone(GAME_W / 2 + 270, y, 110, 52).setInteractive({ useHandCursor: true });
    left.on('pointerup', () => act(-1));
    right.on('pointerup', () => act(1));
    hitL.on('pointerup', () => act(-1));
    hitR.on('pointerup', () => act(1));
    this.rows.push({ label: l, value: v, bg, change });
  }

  private teamLine(i: number): string {
    const t = TEAMS[i];
    const ovr = Math.round(t.players.reduce((a, p) => a + overall(p.stats, p.role), 0) / t.players.length);
    return `${t.name.toUpperCase()} (${t.nation}) · ${ovr} · ${SKILL_LABELS[t.style]}`;
  }

  private refresh(): void {
    this.rows[0].value.setText(this.teamLine(this.home));
    this.rows[1].value.setText(this.teamLine(this.away));
    this.rows[2].value.setText(`${DURATIONS[this.dur] / 60} MINUTI`);
    this.rows.forEach((r, i) => r.bg.setStrokeStyle(i === this.focus ? 3 : 2, i === this.focus ? COLORS.yellow : 0xffffff, i === this.focus ? 1 : 0.25));
    this.playBtn.setFocus(this.focus === 3);
    this.helpBtn.setFocus(this.focus === 4);

    // Anteprima delle maglie.
    this.previews.forEach((p) => p.destroy());
    this.previews = [];
    [this.home, this.away].forEach((ti, k) => {
      const t = TEAMS[ti];
      const star = t.players[4];
      const key = `menu-${t.id}`;
      makePlayerTexture(this, key, t.kit, star.look, star.number);
      const x = k === 0 ? 80 : GAME_W - 80;
      this.previews.push(this.add.image(x, 230, key, k === 0 ? 'cheer' : 'idle').setScale(3).setFlipX(k === 1));
    });
    try {
      localStorage.setItem('sc-menu', JSON.stringify({ home: this.home, away: this.away, dur: this.dur }));
    } catch {
      /* ignora */
    }
  }

  private buildHelp(): void {
    const c = this.add.container(0, 0).setDepth(10).setVisible(false);
    const bg = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W - 80, GAME_H - 60, COLORS.ink, 0.96).setStrokeStyle(3, COLORS.yellow);
    bg.setInteractive();
    bg.on('pointerup', () => this.toggleHelp());
    const lines = [
      'COMANDI',
      '',
      'AZIONE          TASTIERA       CONTROLLER',
      'Movimento       WASD / frecce  levetta sx',
      'Passaggio       J  (Z)         A / X',
      'Tiro (tieni)    K  (X)         B / O',
      'Scatto          Shift / Spazio RB / RT',
      'Finta           L  (C)         X / Quadrato',
      'Skill speciale  I  (V)         Y / Triangolo',
      'Cambio giocat.  Q              LB',
      'Pausa           Esc / P        Start',
      '',
      'Senza palla: TIRO = contrasto, PASSAGGIO = cambio.',
      'Tieni premuto PASSAGGIO per un lancio alto.',
      'Tiro: piu carichi, piu e forte e alto.',
      'Su telefono: joystick a sinistra, pulsanti a destra.',
    ];
    const t = this.add
      .text(GAME_W / 2, GAME_H / 2, lines.join('\n'), {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffffff',
        lineSpacing: 8,
      })
      .setOrigin(0.5);
    const close = text(this, GAME_W / 2, GAME_H - 50, isTouchDevice() ? 'TOCCA PER CHIUDERE' : 'INVIO / A PER CHIUDERE', 9, hexColor(COLORS.yellow));
    c.add([bg, t, close]);
    this.help = c;
  }

  private toggleHelp(): void {
    this.help.setVisible(!this.help.visible);
    sfx.ui();
  }

  private play(): void {
    unlockAudio();
    sfx.whistle();
    // Su telefono: schermo intero e orientamento orizzontale (se il browser lo consente).
    if (isTouchDevice() && !this.scale.isFullscreen) {
      try {
        this.scale.startFullscreen();
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        o.lock?.('landscape').catch(() => undefined);
      } catch {
        /* non supportato (es. iPhone): si continua */
      }
    }
    this.scene.start('match', { home: TEAMS[this.home].id, away: TEAMS[this.away].id, duration: DURATIONS[this.dur] });
  }

  update(_t: number, dt: number): void {
    const ev = this.nav.update(dt);
    if (this.help.visible) {
      if (ev.ok || ev.back) this.toggleHelp();
      return;
    }
    if (ev.dy) {
      this.focus = Phaser.Math.Wrap(this.focus + ev.dy, 0, 5);
      sfx.ui();
      this.refresh();
    }
    if (ev.dx) {
      if (this.focus < 3) {
        this.rows[this.focus].change(ev.dx);
        sfx.ui();
      } else {
        this.focus = this.focus === 3 ? 4 : 3;
      }
      this.refresh();
    }
    if (ev.ok) {
      if (this.focus === 4) this.toggleHelp();
      else this.play();
    }
  }
}
