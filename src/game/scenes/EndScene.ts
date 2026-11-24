// Schermata di fine partita: risultato e statistiche, poi rivincita o menu.
import Phaser from 'phaser';
import type { MatchState } from '../../shared/types';
import { COLORS, GAME_H, GAME_W, button, hexColor, text } from '../ui';
import { InputManager } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';
import type { MatchData } from './MatchScene';

export class EndScene extends Phaser.Scene {
  private s!: MatchState;
  private data_!: MatchData;
  private nav!: MenuNav;
  private focus = 0;
  private btns: ReturnType<typeof button>[] = [];

  constructor() {
    super('end');
  }

  init(d: { state: MatchState; data: MatchData }): void {
    this.s = d.state;
    this.data_ = d.data;
    this.focus = 0;
    this.btns = [];
  }

  create(): void {
    const s = this.s;
    const g = this.add.graphics();
    g.fillGradientStyle(0x2a1d45, 0x2a1d45, 0x0d0b14, 0x0d0b14, 1).fillRect(0, 0, GAME_W, GAME_H);

    const [a, b] = s.score;
    const title = a > b ? 'VITTORIA!' : a < b ? 'SCONFITTA' : 'PAREGGIO';
    const col = a > b ? hexColor(COLORS.yellow) : a < b ? '#ff4d6d' : '#ffffff';
    const t = text(this, GAME_W / 2, 60, title, 34, col);
    this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 500, ease: 'Back.Out' });

    text(this, GAME_W / 2 - 70, 125, s.teams[0].name.toUpperCase(), 12, '#ffffff', 1);
    text(this, GAME_W / 2 + 70, 125, s.teams[1].name.toUpperCase(), 12, '#ffffff', 0);
    text(this, GAME_W / 2, 125, `${a} - ${b}`, 24, hexColor(COLORS.yellow));

    const total = s.stats[0].possessionTicks + s.stats[1].possessionTicks || 1;
    const rows: [string, number | string, number | string][] = [
      ['POSSESSO', `${Math.round((s.stats[0].possessionTicks / total) * 100)}%`, `${Math.round((s.stats[1].possessionTicks / total) * 100)}%`],
      ['TIRI', s.stats[0].shots, s.stats[1].shots],
      ['IN PORTA', s.stats[0].onTarget, s.stats[1].onTarget],
      ['PARATE', s.stats[0].saves, s.stats[1].saves],
      ['PASSAGGI', s.stats[0].passes, s.stats[1].passes],
      ['CONTRASTI VINTI', s.stats[0].tackles, s.stats[1].tackles],
    ];
    const box = this.add.graphics();
    box.fillStyle(COLORS.panel, 0.9).fillRect(GAME_W / 2 - 280, 158, 560, rows.length * 30 + 16);
    rows.forEach(([label, h, w], i) => {
      const y = 180 + i * 30;
      text(this, GAME_W / 2 - 200, y, String(h), 12, '#ffffff');
      text(this, GAME_W / 2, y, label, 9, '#8a83a0');
      text(this, GAME_W / 2 + 200, y, String(w), 12, '#ffffff');
    });

    this.btns.push(button(this, GAME_W / 2 - 120, GAME_H - 70, 210, 52, 'RIVINCITA', () => this.again()));
    this.btns.push(button(this, GAME_W / 2 + 120, GAME_H - 70, 210, 52, 'MENU', () => this.scene.start('menu')));
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);
    this.refresh();
  }

  private again(): void {
    this.scene.start('match', this.data_);
  }

  private refresh(): void {
    this.btns.forEach((b, i) => b.setFocus(i === this.focus));
  }

  update(_t: number, dt: number): void {
    const ev = this.nav.update(dt);
    if (ev.dx || ev.dy) {
      this.focus = 1 - this.focus;
      this.refresh();
    }
    if (ev.ok) (this.focus === 0 ? () => this.again() : () => this.scene.start('menu'))();
  }
}
