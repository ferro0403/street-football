// Menu iniziale: scegli squadra, avversario e durata, poi gioca. Si adatta a qualunque schermo.
// Si usa con mouse/dito, tastiera (frecce + Invio/J) e controller (croce + A).
import Phaser from 'phaser';
import { TEAMS } from '../../shared/teams';
import { overall, SKILL_LABELS } from '../../shared/stats';
import { COLORS, button, hexColor, restartOnResize, safeInsets, text, view } from '../ui';
import { InputManager, isTouchDevice } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';
import { PlayerSprite } from '../render/playerSprite';
import { sfx, unlockAudio } from '../fx/sfx';
import { fullscreenSupported, isFullscreen, isIOS, isStandalone, toggleFullscreen } from '../fullscreen';

const DURATIONS = [60, 120, 180, 300];

interface Row {
  value: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Rectangle;
  change: (d: number) => void;
}

type Btn = ReturnType<typeof button>;

export class MenuScene extends Phaser.Scene {
  private home = 0;
  private away = 1;
  private dur = 2;
  private focus = 0;
  private rows: Row[] = [];
  private btns: { b: Btn; act: () => void }[] = [];
  private nav!: MenuNav;
  private previews: PlayerSprite[] = [];
  private overlay!: Phaser.GameObjects.Container;

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
    this.btns = [];
    this.previews = [];
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);

    const { w, h } = view(this);
    const ins = safeInsets(this);
    const cx = w / 2;
    // Su schermi bassi (telefono) si stringe tutto in verticale.
    const k = Math.min(1, h / 540);
    const rowW = Math.min(680, w - ins.l - ins.r - 220);

    this.drawBackdrop(w, h);
    const title = text(this, cx, ins.t + 34 * k + 14, 'STREET CAGE', Math.round(40 * Math.max(0.8, k)), hexColor(COLORS.yellow));
    this.tweens.add({ targets: title, scale: { from: 1, to: 1.04 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    text(this, cx, title.y + 40 * k, 'CALCIO DI STRADA 5 CONTRO 5', 11, '#ffffff');

    const y0 = title.y + 100 * k;
    const gap = 62 * k + 4;
    this.addRow(cx, y0, rowW, 'LA TUA SQUADRA', (d) => {
      this.home = Phaser.Math.Wrap(this.home + d, 0, TEAMS.length);
      if (this.home === this.away) this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
    });
    this.addRow(cx, y0 + gap, rowW, 'AVVERSARIO', (d) => {
      this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
      if (this.away === this.home) this.away = Phaser.Math.Wrap(this.away + d, 0, TEAMS.length);
    });
    this.addRow(cx, y0 + gap * 2, rowW, 'DURATA', (d) => {
      this.dur = Phaser.Math.Wrap(this.dur + d, 0, DURATIONS.length);
    });

    // Pulsanti: GIOCA grande, poi COMANDI e SCHERMO INTERO.
    const by = Math.min(h - ins.b - 40, y0 + gap * 2 + 80 * k + 20);
    const bw = Math.min(200, (w - ins.l - ins.r - 60) / 4);
    const showFs = isFullscreen() || (!isStandalone() && (fullscreenSupported() || isIOS()));
    const items: [string, () => void][] = [
      ['GIOCA', () => this.play()],
      ['COMANDI', () => this.showHelp()],
      ['GIOCATORI', () => this.scene.start('gallery', { team: this.home })],
    ];
    if (showFs) items.push([isFullscreen() ? 'ESCI SCH. INTERO' : 'SCHERMO INTERO', () => this.fullscreen()]);
    const total = items.length * bw + (items.length - 1) * 16;
    items.forEach(([label, act], i) => {
      const b = button(this, cx - total / 2 + bw / 2 + i * (bw + 16), by, bw, 56, label, act);
      if (i === 0) b.bg.setStrokeStyle(3, COLORS.yellow, 1);
      this.btns.push({ b, act });
    });

    this.overlay = this.add.container(0, 0).setDepth(10).setVisible(false);
    this.focus = Math.min(this.focus, this.rows.length + this.btns.length - 1);
    this.refresh();
    this.input.on('pointerdown', unlockAudio);
    this.scale.on('enterfullscreen', this.relabel, this);
    this.scale.on('leavefullscreen', this.relabel, this);
    this.events.once('shutdown', () => {
      this.scale.off('enterfullscreen', this.relabel, this);
      this.scale.off('leavefullscreen', this.relabel, this);
    });
    restartOnResize(this);
  }

  private relabel(): void {
    const fs = this.btns[3];
    if (fs) fs.b.label.setText(isFullscreen() ? 'ESCI SCH. INTERO' : 'SCHERMO INTERO');
  }

  private drawBackdrop(w: number, h: number): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x2a1d45, 0x2a1d45, 0x0d0b14, 0x0d0b14, 1).fillRect(0, 0, w, h);
    g.lineStyle(1, 0xc9d1e0, 0.08);
    for (let x = -h; x < w; x += 22) {
      g.lineBetween(x, 0, x + h, h);
      g.lineBetween(x + h, 0, x, h);
    }
  }

  private addRow(cx: number, y: number, w: number, label: string, change: (d: number) => void): void {
    const bg = this.add.rectangle(cx, y, w, 54, COLORS.panel, 0.9).setStrokeStyle(2, 0xffffff, 0.25);
    text(this, cx - w / 2 + 20, y - 14, label, 8, '#8a83a0', 0);
    const v = text(this, cx, y + 6, '', 11);
    text(this, cx - w / 2 + 14, y + 6, '◀', 16, hexColor(COLORS.yellow));
    text(this, cx + w / 2 - 14, y + 6, '▶', 16, hexColor(COLORS.yellow));
    const idx = this.rows.length;
    const act = (d: number) => {
      this.focus = idx;
      change(d);
      sfx.ui();
      this.refresh();
    };
    // Aree di tocco ampie: metà sinistra e metà destra della riga.
    const hitL = this.add.zone(cx - w / 4, y, w / 2, 54).setInteractive({ useHandCursor: true });
    const hitR = this.add.zone(cx + w / 4, y, w / 2, 54).setInteractive({ useHandCursor: true });
    hitL.on('pointerup', () => act(-1));
    hitR.on('pointerup', () => act(1));
    this.rows.push({ value: v, bg, change });
  }

  private teamLine(i: number): string {
    const t = TEAMS[i];
    const ovr = Math.round(t.players.reduce((a, p) => a + overall(p.stats, p.role), 0) / t.players.length);
    return `${t.name.toUpperCase()} · ${ovr} · ${SKILL_LABELS[t.style].toUpperCase()}`;
  }

  private refresh(): void {
    this.rows[0].value.setText(this.teamLine(this.home));
    this.rows[1].value.setText(this.teamLine(this.away));
    this.rows[2].value.setText(`${DURATIONS[this.dur] / 60} MINUTI`);
    this.rows.forEach((r, i) =>
      r.bg.setStrokeStyle(i === this.focus ? 3 : 2, i === this.focus ? COLORS.yellow : 0xffffff, i === this.focus ? 1 : 0.25),
    );
    this.btns.forEach(({ b }, i) => b.setFocus(this.focus === this.rows.length + i));

    this.previews.forEach((p) => p.destroy());
    this.previews = [];
    const { w } = view(this);
    if (w > 820) {
      [this.home, this.away].forEach((ti, k) => {
        const t = TEAMS[ti];
        const star = t.players[4];
        const ps = new PlayerSprite(this, { look: star.look, kit: t.kit, number: star.number, gk: false });
        ps.scaleK = 2;
        ps.setPosition(k === 0 ? 80 : w - 80, this.rows[2].bg.y + 40);
        this.previews.push(ps);
      });
    }
    try {
      localStorage.setItem('sc-menu', JSON.stringify({ home: this.home, away: this.away, dur: this.dur }));
    } catch {
      /* ignora */
    }
  }

  private showPanel(lines: string[], size = 10): void {
    const { w, h } = view(this);
    this.overlay.removeAll(true);
    const bg = this.add.rectangle(w / 2, h / 2, w - 40, h - 30, COLORS.ink, 0.97).setStrokeStyle(3, COLORS.yellow);
    bg.setInteractive();
    bg.on('pointerup', () => this.hidePanel());
    const t = this.add
      .text(w / 2, h / 2 - 10, lines.join('\n'), {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: `${size}px`,
        color: '#ffffff',
        lineSpacing: 7,
        align: 'left',
      })
      .setOrigin(0.5);
    // Se non ci sta, si rimpicciolisce.
    const maxH = h - 90;
    if (t.height > maxH) t.setScale(maxH / t.height);
    const close = text(this, w / 2, h - 36, isTouchDevice() ? 'TOCCA PER CHIUDERE' : 'INVIO / A PER CHIUDERE', 9, hexColor(COLORS.yellow));
    this.overlay.add([bg, t, close]).setVisible(true);
    sfx.ui();
  }

  private hidePanel(): void {
    this.overlay.setVisible(false);
    sfx.ui();
  }

  private showHelp(): void {
    this.showPanel([
      '                  COMANDI',
      '',
      'AZIONE          TASTIERA     CONTROLLER',
      'Movimento       WASD/frecce  levetta sx',
      'Passaggio       J  (Z)       A / Croce',
      'Lancio alto     U  (C)       X / Quadrato',
      'Filtrante       O  (V)       Y / Triangolo',
      'Tiro (tieni)    K  (X)       B / Cerchio',
      'Scatto          Shift        RT / R2',
      'Finta           L  (B)       LT / L2',
      'Skill speciale  I  (N)       RB / R1',
      'Cambio giocat.  Q            LB / L1',
      'Pausa           Esc / P      Start',
      '',
      'SENZA PALLA',
      'Tiro = contrasto in piedi  Lancio = scivolata',
      'Passaggio = cambio giocatore',
      'Da dietro e fallo! Di lato e una spallata.',
      '',
      'Passaggio: piu tieni, piu e teso (arriva sempre).',
      'Tiro: mira con la levetta verso un angolo = a giro.',
    ]);
  }

  private fullscreen(): void {
    if (fullscreenSupported()) {
      toggleFullscreen(this);
      sfx.ui();
      return;
    }
    // iPhone: niente Fullscreen API per le pagine web.
    this.showPanel([
      'A TUTTO SCHERMO SU IPHONE',
      '',
      'Safari non permette lo schermo intero',
      'alle pagine web. Per giocare a tutto',
      'schermo installa il gioco:',
      '',
      '1. Tocca il pulsante Condividi',
      '2. "Aggiungi alla schermata Home"',
      '3. Apri Street Cage dalla Home',
    ]);
  }

  private play(): void {
    unlockAudio();
    sfx.whistle();
    // Su telefono si entra direttamente a schermo intero (se il browser lo consente).
    if (isTouchDevice() && fullscreenSupported() && !isFullscreen()) toggleFullscreen(this);
    this.scene.start('match', { home: TEAMS[this.home].id, away: TEAMS[this.away].id, duration: DURATIONS[this.dur] });
  }

  update(t: number, dt: number): void {
    // Anteprime animate: il tuo campione esulta, l'avversario gira su se stesso correndo.
    if (this.previews.length === 2) {
      const [a, b] = this.previews;
      a.show('celebrate', Math.floor(t / 125) % 6, 0);
      b.show('run', Math.floor(t / 80) % 8, Math.floor(t / 900) % 8);
    }
    const ev = this.nav.update(dt);
    if (this.overlay.visible) {
      if (ev.ok || ev.back) this.hidePanel();
      return;
    }
    const n = this.rows.length + this.btns.length;
    if (ev.dy) {
      // Su/giù: tra le righe; dai pulsanti si torna all'ultima riga.
      if (this.focus >= this.rows.length) this.focus = ev.dy < 0 ? this.rows.length - 1 : this.focus;
      else this.focus = Phaser.Math.Clamp(this.focus + ev.dy, 0, this.rows.length);
      sfx.ui();
      this.refresh();
    }
    if (ev.dx) {
      if (this.focus < this.rows.length) {
        this.rows[this.focus].change(ev.dx);
      } else {
        this.focus = Phaser.Math.Clamp(this.focus + ev.dx, this.rows.length, n - 1);
      }
      sfx.ui();
      this.refresh();
    }
    if (ev.ok) {
      if (this.focus < this.rows.length) this.play();
      else this.btns[this.focus - this.rows.length].act();
    }
  }
}
