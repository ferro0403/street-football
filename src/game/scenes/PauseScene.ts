import Phaser from 'phaser';
import { COLORS, button, hexColor, restartOnResize, text, view } from '../ui';
import { InputManager } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';
import type { MatchData, MatchScene } from './MatchScene';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../fullscreen';
import { sfx } from '../fx/sfx';
import { trainingReset } from '../../shared/match';
import { aimLineEnabled, setAimLine, toggleDebug } from '../debugPanel';

export class PauseScene extends Phaser.Scene {
  private data_!: MatchData;
  private nav!: MenuNav;
  private focus = 0;
  private btns: { b: ReturnType<typeof button>; act: () => void }[] = [];

  constructor() {
    super('pause');
  }

  init(d: { data: MatchData }): void {
    this.data_ = d.data;
    this.btns = [];
  }

  create(): void {
    const { w, h } = view(this);
    this.add.rectangle(w / 2, h / 2, w, h, COLORS.ink, 0.72).setInteractive();
    const k = Math.min(1, h / 540);
    text(this, w / 2, 40 * k + 16, 'PAUSA', 26, hexColor(COLORS.yellow));
    const actions: [string, () => void][] = [
      ['RIPRENDI', () => this.resume()],
      ['RICOMINCIA', () => this.restart()],
      ['MENU', () => this.toMenu()],
    ];
    const m = this.scene.get('match') as MatchScene;
    if (m.state?.mode === 'training') actions.unshift(['RESET ALLENAMENTO', () => { trainingReset(m.state); this.resume(); }]);
    actions.push([`LINEA DI MIRA: ${aimLineEnabled() ? 'SI' : 'NO'}`, () => { setAimLine(!aimLineEnabled()); this.scene.restart({ data: this.data_ }); }]);
    actions.push(['DEBUG (REGOLAZIONI)', () => { toggleDebug(() => m.state?.tune ?? null); }]);
    if (fullscreenSupported()) actions.push([isFullscreen() ? 'ESCI SCH. INTERO' : 'SCHERMO INTERO', () => this.fs()]);
    const step = Math.min(60, (h - 140 * k) / actions.length);
    actions.forEach(([l, fn], i) => this.btns.push({ b: button(this, w / 2, 100 * k + 14 + i * step, 340, Math.min(48, step - 8), l, fn), act: fn }));
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);
    this.focus = Math.min(this.focus, this.btns.length - 1);
    this.refresh();
    restartOnResize(this, { data: this.data_ });
  }

  private refresh(): void {
    this.btns.forEach(({ b }, i) => b.setFocus(i === this.focus));
  }

  private fs(): void {
    toggleFullscreen(this);
    sfx.ui();
    this.time.delayedCall(300, () => this.btns[this.btns.length - 1]?.b.label.setText(isFullscreen() ? 'ESCI SCH. INTERO' : 'SCHERMO INTERO'));
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
    else if (ev.ok) this.btns[this.focus].act();
  }
}
