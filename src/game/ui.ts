// Costanti e piccoli helper per l'interfaccia.
import Phaser from 'phaser';

import { safeInsetsCss } from './fullscreen';

/** Dimensione di base: con Scale.EXPAND la parte visibile può essere più larga o più alta. */
export const GAME_W = 960;
export const GAME_H = 540;

/** Dimensione attuale del gioco (in pixel di gioco). */
export function view(scene: Phaser.Scene): { w: number; h: number } {
  return { w: scene.scale.width, h: scene.scale.height };
}

/** Margini dell'area sicura (notch) in pixel di gioco, con un minimo di respiro. */
export function safeInsets(scene: Phaser.Scene, min = 10): { l: number; r: number; t: number; b: number } {
  const css = safeInsetsCss();
  const cssW = scene.scale.canvasBounds.width || scene.scale.width;
  const k = scene.scale.width / cssW;
  return {
    l: Math.max(min, css.l * k),
    r: Math.max(min, css.r * k),
    t: Math.max(min, css.t * k),
    b: Math.max(min, css.b * k),
  };
}

/** Rilancia la scena quando cambia la dimensione (rotazione, barre del browser). */
export function restartOnResize(scene: Phaser.Scene, data?: object): void {
  let timer: Phaser.Time.TimerEvent | null = null;
  const onResize = () => {
    timer?.remove();
    timer = scene.time.delayedCall(120, () => scene.scene.restart(data));
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => scene.scale.off('resize', onResize));
}
export const FONT = '"Press Start 2P", monospace';

export const COLORS = {
  yellow: 0xffd21f,
  pink: 0xff4d6d,
  cyan: 0x2ec4b6,
  ink: 0x0d0b14,
  panel: 0x1b1726,
  white: 0xffffff,
};

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size = 12,
  color = '#ffffff',
  origin = 0.5,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, str, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      stroke: '#0d0b14',
      strokeThickness: Math.max(2, Math.round(size / 4)),
      align: 'center',
    })
    .setOrigin(origin, 0.5);
}

export const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Pulsante grande, utilizzabile con mouse e dito. */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
): { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; setFocus: (f: boolean) => void } {
  const bg = scene.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(3, COLORS.white, 0.6);
  const t = text(scene, x, y, label, 12);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerup', onClick);
  const setFocus = (f: boolean) => {
    bg.setFillStyle(f ? COLORS.yellow : COLORS.panel);
    bg.setStrokeStyle(3, f ? COLORS.white : COLORS.white, f ? 1 : 0.6);
    t.setColor(f ? '#0d0b14' : '#ffffff');
    t.setStroke(f ? '#ffd21f' : '#0d0b14', 3);
  };
  return { bg, label: t, setFocus };
}

export function fmtClock(sec: number): string {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
