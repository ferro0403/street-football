import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W, button, hexColor, text } from '../ui';
import { InputManager } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';
import type { MatchData, MatchScene } from './MatchScene';

export class PauseScene extends Phaser.Scene {
  private data_!: MatchData;
  private nav!: MenuNav;
  private focus = 0;
  private btns: ReturnType<typeof button>[] = [];

  constructor() {
    super('pause');
  }

  init(d: { data: MatchData }): void {
    this.data_ = d.data;
    this.focus = 0;
    this.btns = [];
  }

  create(): void {
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, COLORS.ink, 0.7).setInteractive();
    text(this, GAME_W / 2, 140, 'PAUSA', 32, hexColor(COLORS.yellow));
    const actions: [string, () => void][] = [
      ['RIPRENDI', () => this.resume()],
      ['RICOMINCIA', () => this.restart()],
      ['MENU', () => this.toMenu()],
    ];
    actions.forEach(([l, fn], i) => this.btns.push(button(this, GAME_W / 2, 230 + i * 70, 260, 52, l, fn)));
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);
    this.refresh();
  }

  private refresh(): void {
    this.btns.forEach((b, i) => b.setFocus(i === this.focus));
  }

  private resume(): void {
    const m = this.scene.get('match') as MatchScene;
    m.resumeFromPause();
    this.scene.resume('match');
    this.scene.stop();
  }

  private restart(): void {
    this.scene.stop('hud');
    this.scene.stop('match');
    this.scene.start('match', this.data_);
  }

  private toMenu(): void {
    this.scene.stop('hud');
    this.scene.stop('match');
    this.scene.start('menu');
  }

  update(_t: number, dt: number): void {
    const ev = this.nav.update(dt);
    if (ev.dy) {
      this.focus = Phaser.Math.Wrap(this.focus + ev.dy, 0, this.btns.length);
      this.refresh();
    }
    if (ev.back) this.resume();
    else if (ev.ok) [() => this.resume(), () => this.restart(), () => this.toMenu()][this.focus]();
  }
}
