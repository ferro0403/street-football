// Texture piccole generate a runtime: anello del giocatore controllato, freccia, particelle,
// cifre dei numeri di maglia. Giocatori, palla e ombre sono sprite sheet generati da
// scripts/sprites (vedi BootScene).
import Phaser from 'phaser';

// Cifre 3x5 per i numeri di maglia (con bordo scuro).
const DIGITS: string[][] = [
  ['111', '101', '101', '101', '111'],
  ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'],
  ['111', '001', '011', '001', '111'],
  ['101', '101', '111', '001', '001'],
  ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'],
  ['111', '001', '010', '010', '010'],
  ['111', '101', '111', '101', '111'],
  ['111', '101', '111', '001', '111'],
];
export const DIGIT_W = 5;
export const DIGIT_H = 7;

export function makeCommonTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  g.clear();
  g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4);
  g.generateTexture('px', 4, 4);

  g.clear();
  g.fillStyle(0xffffff, 0.9).fillCircle(6, 6, 6);
  g.generateTexture('puff', 12, 12);

  // Anello isometrico sotto il giocatore controllato.
  g.clear();
  g.lineStyle(4, 0xffffff, 1).strokeEllipse(30, 14, 54, 24);
  g.generateTexture('ring', 60, 28);

  g.clear();
  g.fillStyle(0x141018, 1).fillTriangle(0, 0, 18, 0, 9, 12);
  g.fillStyle(0xffffff, 1).fillTriangle(3, 1.5, 15, 1.5, 9, 9);
  g.generateTexture('arrow', 18, 12);
  g.destroy();

  // Cifre bianche (si tingono col colore del bordo maglia) con contorno scuro.
  if (!scene.textures.exists('digits')) {
    const tex = scene.textures.createCanvas('digits', DIGIT_W * 10, DIGIT_H)!;
    const ctx = tex.getContext();
    DIGITS.forEach((rows, d) => {
      const ox = d * DIGIT_W + 1;
      ctx.fillStyle = '#141018';
      rows.forEach((r, y) => [...r].forEach((c, x) => c === '1' && ctx.fillRect(ox + x - 1, y, 3, 3)));
      ctx.fillStyle = '#ffffff';
      rows.forEach((r, y) => [...r].forEach((c, x) => c === '1' && ctx.fillRect(ox + x, y + 1, 1, 1)));
      tex.add(String(d), 0, d * DIGIT_W, 0, DIGIT_W, DIGIT_H);
    });
    tex.refresh();
  }
}
