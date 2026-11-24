import Phaser from 'phaser';
import { makeCommonTextures } from '../render/textures';
import { COLORS, view } from '../ui';

/** Carica gli sprite sheet generati da `npm run sprites` (public/assets/sprites). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const { w, h } = view(this);
    const bar = this.add.graphics();
    this.load.on('progress', (p: number) => {
      bar.clear().fillStyle(0x333044, 1).fillRect(w / 2 - 150, h / 2 - 6, 300, 12);
      bar.fillStyle(COLORS.yellow, 1).fillRect(w / 2 - 150, h / 2 - 6, 300 * p, 12);
    });
    this.load.setPath('assets/sprites/');
    this.load.multiatlas('players', 'players.json');
    this.load.json('players-meta', 'players-meta.json');
    this.load.spritesheet('ballroll', 'ball.png', { frameWidth: 16, frameHeight: 16 });
    this.load.image('shadow', 'shadow.png');
  }

  create(): void {
    makeCommonTextures(this);
    this.scene.start('menu');
  }
}
