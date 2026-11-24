import Phaser from 'phaser';
import { makeCommonTextures } from '../render/textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    makeCommonTextures(this);
    this.scene.start('menu');
  }
}
