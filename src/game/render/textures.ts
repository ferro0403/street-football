// Grafica provvisoria generata da codice, stile retro: giocatori a blocchi con colori pieni,
// ombreggiatura a due toni e contorno scuro. Ogni giocatore ha una sua texture con tutti i frame.
import Phaser from 'phaser';
import type { Kit, PlayerLook } from '../../shared/types';

export const FRAME_W = 40;
/** Il personaggio è largo 24 px: margine per le pose distese (contrasto, a terra). */
const PAD_X = 8;
export const FRAME_H = 36;
export const FRAMES = ['idle', 'run1', 'run2', 'kick', 'slide', 'cheer', 'down', 'spin'] as const;
export type FrameName = (typeof FRAMES)[number];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function shade(c: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

// Cifre 3x5 per i numeri di maglia.
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

interface Paint {
  ctx: CanvasRenderingContext2D;
  ox: number;
  oy: number;
}

function rect(p: Paint, x: number, y: number, w: number, h: number, color: number): void {
  p.ctx.fillStyle = hex(color);
  p.ctx.fillRect(p.ox + x, p.oy + y, w, h);
}

/** Rettangolo con contorno scuro e lato destro in ombra: il look "low-poly" piatto. */
function block(p: Paint, x: number, y: number, w: number, h: number, color: number): void {
  rect(p, x - 1, y - 1, w + 2, h + 2, 0x141018);
  rect(p, x, y, w, h, color);
  if (w > 2) rect(p, x + w - Math.max(1, Math.floor(w / 3)), y, Math.max(1, Math.floor(w / 3)), h, shade(color, 0.72));
  if (h > 3) rect(p, x, y, w - Math.max(1, Math.floor(w / 3)), 1, shade(color, 1.18));
}

function drawNumber(p: Paint, n: number, cx: number, y: number, color: number): void {
  const s = String(n);
  const w = s.length * 4 - 1;
  let x = Math.round(cx - w / 2);
  for (const ch of s) {
    const g = DIGITS[ch];
    if (!g) continue;
    g.forEach((row, ry) => {
      for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') rect(p, x + rx, y + ry, 1, 1, color);
    });
    x += 4;
  }
}

interface Pose {
  legL: [number, number]; // offset x, sollevamento
  legR: [number, number];
  armL: number; // -1 giù indietro, 0 giù, 1 avanti, 2 alzato
  armR: number;
  bodyY: number;
  kickLeg?: boolean;
}

const POSES: Record<Exclude<FrameName, 'down' | 'slide' | 'spin'>, Pose> = {
  idle: { legL: [0, 0], legR: [0, 0], armL: 0, armR: 0, bodyY: 0 },
  run1: { legL: [-2, 2], legR: [2, 0], armL: 1, armR: -1, bodyY: -1 },
  run2: { legL: [2, 0], legR: [-2, 2], armL: -1, armR: 1, bodyY: -1 },
  kick: { legL: [0, 0], legR: [5, 4], armL: 1, armR: -1, bodyY: 0, kickLeg: true },
  cheer: { legL: [-1, 0], legR: [1, 0], armL: 2, armR: 2, bodyY: -2 },
};

function drawPlayer(
  p: Paint,
  kit: Kit,
  look: PlayerLook,
  num: number,
  back: boolean,
  pose: Pose,
): void {
  const by = pose.bodyY;
  const sock = kit.socks;
  const boot = 0x1a1a1a;
  // Gambe.
  const leg = (bx: number, [dx, lift]: [number, number], kick: boolean) => {
    const x = bx + dx;
    const top = 24 + by;
    if (kick) {
      block(p, x, top, 3, 4, look.skin);
      block(p, x + 1, top + 4 - lift, 5, 3, sock);
      rect(p, x + 5, top + 4 - lift, 2, 3, boot);
      return;
    }
    block(p, x, top, 3, 3, look.skin);
    block(p, x, top + 3, 3, 6 - lift, sock);
    block(p, x - (back ? 0 : 0), top + 9 - lift, 4, 2, boot);
  };
  leg(8, pose.legL, false);
  leg(13, pose.legR, !!pose.kickLeg);

  // Braccia (dietro il busto se abbassate).
  const arm = (x: number, a: number, left: boolean) => {
    if (a === 2) {
      block(p, x, 4 + by, 3, 4, look.skin);
      block(p, x, 8 + by, 3, 4, kit.shirt);
      return;
    }
    const swing = a === 1 ? (left ? 1 : -1) : a === -1 ? (left ? -1 : 1) : 0;
    block(p, x + swing, 12 + by, 3, 4, kit.shirt);
    block(p, x + swing, 16 + by, 3, 4, look.skin);
  };
  arm(4, pose.armL, true);
  arm(17, pose.armR, false);

  // Pantaloncini e maglia.
  block(p, 7, 20 + by, 10, 5, kit.shorts);
  block(p, 6, 11 + by, 12, 10, kit.shirt);
  // Fascia di colore secondario.
  rect(p, 6, 11 + by, 12, 2, kit.trim);
  if (back) {
    drawNumber(p, num, 12, 14 + by, kit.trim === kit.shirt ? 0xffffff : kit.trim);
  } else {
    rect(p, 11, 13 + by, 2, 6, kit.trim);
  }

  // Testa.
  block(p, 8, 2 + by, 8, 9, look.skin);
  const hy = 2 + by;
  switch (look.hairStyle) {
    case 0: // rasato
      rect(p, 8, hy, 8, 1, look.hair);
      if (back) rect(p, 8, hy, 8, 3, look.hair);
      break;
    case 1: // corti
      rect(p, 8, hy - 1, 8, 3, look.hair);
      if (back) rect(p, 8, hy, 8, 6, look.hair);
      else rect(p, 8, hy + 2, 1, 2, look.hair);
      break;
    case 2: // ricci
      rect(p, 7, hy - 2, 10, 4, look.hair);
      rect(p, 7, hy + 2, 1, 3, look.hair);
      rect(p, 16, hy + 2, 1, 3, look.hair);
      if (back) rect(p, 7, hy, 10, 7, look.hair);
      break;
    default: // cresta
      rect(p, 10, hy - 3, 4, 4, look.hair);
      if (back) rect(p, 10, hy, 4, 6, look.hair);
  }
  if (!back) {
    rect(p, 10, 6 + by, 1, 2, 0x141018);
    rect(p, 14, 6 + by, 1, 2, 0x141018);
    rect(p, 11, 9 + by, 3, 1, shade(look.skin, 0.7));
  }
}

/** Genera (una volta) la texture con tutti i frame di un giocatore. */
export function makePlayerTexture(
  scene: Phaser.Scene,
  key: string,
  kit: Kit,
  look: PlayerLook,
  num: number,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, FRAME_W * FRAMES.length, FRAME_H * 2)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  FRAMES.forEach((f, i) => {
    for (let row = 0; row < 2; row++) {
      const back = row === 1;
      const ox = i * FRAME_W;
      const oy = row * FRAME_H;
      const p: Paint = { ctx, ox: ox + PAD_X, oy };
      ctx.save();
      // Ogni frame resta nel suo riquadro: niente sbavature sui frame vicini.
      ctx.beginPath();
      ctx.rect(ox, oy, FRAME_W, FRAME_H);
      ctx.clip();
      if (f === 'down' || f === 'slide') {
        // Corpo disteso: ruotiamo un frame base di 90°.
        const tmp = document.createElement('canvas');
        tmp.width = 24;
        tmp.height = FRAME_H;
        const tctx = tmp.getContext('2d')!;
        drawPlayer({ ctx: tctx, ox: 0, oy: 0 }, kit, look, num, back, f === 'slide' ? POSES.kick : POSES.idle);
        ctx.translate(ox + FRAME_W / 2, oy + FRAME_H - 13);
        ctx.rotate(f === 'slide' ? -Math.PI / 2.6 : -Math.PI / 2);
        ctx.drawImage(tmp, -12, -FRAME_H / 2);
      } else if (f === 'spin') {
        // Veronica: alterna fronte e spalle, riusa la posa di corsa.
        drawPlayer(p, kit, look, num, !back, POSES.run1);
      } else {
        drawPlayer(p, kit, look, num, back, POSES[f]);
      }
      ctx.restore();
      tex.add(`${f}${back ? '_b' : ''}`, 0, ox, oy, FRAME_W, FRAME_H);
    }
  });
  tex.refresh();
}

/** Texture piccole condivise: palla, ombre, particelle, anello del giocatore controllato. */
export function makeCommonTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Palla 10x10 con "pentagoni".
  g.clear();
  g.fillStyle(0x141018, 1).fillCircle(5, 5, 5);
  g.fillStyle(0xffffff, 1).fillCircle(5, 5, 4);
  g.fillStyle(0x222222, 1).fillRect(4, 3, 2, 2).fillRect(1, 5, 2, 2).fillRect(7, 6, 2, 2).fillRect(5, 8, 1, 1);
  g.generateTexture('ball', 10, 10);

  g.clear();
  g.fillStyle(0x000000, 0.35).fillEllipse(12, 5, 24, 10);
  g.generateTexture('shadow', 24, 10);

  g.clear();
  g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4);
  g.generateTexture('px', 4, 4);

  g.clear();
  g.fillStyle(0xffffff, 0.9).fillCircle(6, 6, 6);
  g.generateTexture('puff', 12, 12);

  // Anello isometrico sotto il giocatore controllato.
  g.clear();
  g.lineStyle(3, 0xffffff, 1).strokeEllipse(20, 10, 36, 16);
  g.generateTexture('ring', 40, 20);

  // Freccia sopra la testa.
  g.clear();
  g.fillStyle(0x141018, 1).fillTriangle(0, 0, 14, 0, 7, 9);
  g.fillStyle(0xffffff, 1).fillTriangle(2, 1, 12, 1, 7, 7);
  g.generateTexture('arrow', 14, 10);

  g.destroy();
}
