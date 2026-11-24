// Disegna la gabbia: asfalto a lastre, linee, pareti con rete metallica, porte piccole
// e qualche palazzo sullo sfondo. Tutto da codice, in proiezione isometrica.
import Phaser from 'phaser';
import { CENTER_Y, FIELD } from '../../shared/constants';
import { HH, HW, isoDepth, isoX, isoY } from '../iso';

const L = FIELD.length;
const W = FIELD.width;
const WALL_H = 3.2;
const KERB_H = 0.55;

type P3 = [number, number, number];
const pt = (x: number, y: number, z = 0) => new Phaser.Math.Vector2(isoX(x, y), isoY(x, y, z));

function poly(g: Phaser.GameObjects.Graphics, pts: P3[], color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(
    pts.map(([x, y, z]) => pt(x, y, z)),
    true,
  );
}

function line(g: Phaser.GameObjects.Graphics, a: P3, b: P3): void {
  g.lineBetween(isoX(a[0], a[1]), isoY(a[0], a[1], a[2]), isoX(b[0], b[1]), isoY(b[0], b[1], b[2]));
}

/** Parallelepipedo isometrico (palazzi, cordoli). Disegna solo le facce visibili. */
function box(
  g: Phaser.GameObjects.Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h: number,
  color: number,
): void {
  const top = Phaser.Display.Color.IntegerToColor(color);
  const dark = Phaser.Display.Color.GetColor(top.red * 0.55, top.green * 0.55, top.blue * 0.55);
  const mid = Phaser.Display.Color.GetColor(top.red * 0.78, top.green * 0.78, top.blue * 0.78);
  // Faccia verso la camera lungo y = y1 (in basso a destra) e x = x0 (in basso a sinistra).
  poly(g, [[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]], mid);
  poly(g, [[x0, y0, 0], [x0, y1, 0], [x0, y1, h], [x0, y0, h]], dark);
  poly(g, [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], color);
}

function windows(g: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number, h: number, seed: number): void {
  // Finestre accese sulla facciata y = y (rivolta alla camera).
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let z = 1.2; z < h - 0.8; z += 1.6) {
    for (let x = x0 + 0.6; x < x1 - 0.6; x += 1.4) {
      const on = rnd() > 0.45;
      poly(g, [[x, y, z], [x + 0.7, y, z], [x + 0.7, y, z + 0.8], [x, y, z + 0.8]], on ? 0xffd77a : 0x2a2440, on ? 0.9 : 1);
    }
  }
}

export interface FieldLayers {
  back: Phaser.GameObjects.Graphics;
  front: Phaser.GameObjects.Graphics;
  goalBack: Phaser.GameObjects.Graphics;
  goalFront: Phaser.GameObjects.Graphics;
}

export function drawField(scene: Phaser.Scene): FieldLayers {
  const back = scene.add.graphics().setDepth(0);

  // --- Sfondo: strada e palazzi oltre le pareti di fondo (x = L e y = 0). ---
  poly(back, [[-12, -14, 0], [L + 14, -14, 0], [L + 14, W + 12, 0], [-12, W + 12, 0]], 0x1d1a26);
  // Marciapiede attorno alla gabbia.
  poly(back, [[-3, -3, 0], [L + 3, -3, 0], [L + 3, W + 3, 0], [-3, W + 3, 0]], 0x34303d);
  // Palazzi dietro la parete y = 0 (in alto a sinistra).
  const bcol = [0x6b3d5e, 0x3d5a7a, 0x7a5a3d, 0x45406b, 0x5e6b3d];
  for (let i = 0; i < 6; i++) {
    const x0 = -6 + i * 7.5;
    const h = 7 + ((i * 37) % 6);
    box(back, x0, -13, x0 + 6.5, -7, h, bcol[i % bcol.length]);
    windows(back, x0, x0 + 6.5, -7, h, i * 17 + 3);
  }
  // Palazzi dietro la parete x = L (in alto a destra).
  for (let i = 0; i < 4; i++) {
    const y0 = -6 + i * 7;
    const h = 6 + ((i * 53) % 7);
    box(back, L + 6, y0, L + 12, y0 + 6, h, bcol[(i + 2) % bcol.length]);
  }

  // --- Terreno della gabbia: lastre di cemento alternate. ---
  const slab = 2;
  for (let x = 0; x < L; x += slab) {
    for (let y = 0; y < W; y += slab) {
      const odd = ((x / slab) + (y / slab)) % 2 === 0;
      poly(back, [[x, y, 0], [x + slab, y, 0], [x + slab, y + slab, 0], [x, y + slab, 0]], odd ? 0x4a4f5c : 0x434855);
    }
  }
  // Area di rigore colorata davanti alle porte.
  for (const gx of [0, L]) {
    const dir = gx === 0 ? 1 : -1;
    const pts: P3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 16;
      pts.push([gx + dir * Math.cos(a) * 5, CENTER_Y + Math.sin(a) * 5, 0]);
    }
    poly(back, pts, 0xc0392b, 0.35);
  }
  // Cerchio di centrocampo pieno.
  const circle: P3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (Math.PI * 2 * i) / 32;
    circle.push([L / 2 + Math.cos(a) * 3.5, CENTER_Y + Math.sin(a) * 3.5, 0]);
  }
  poly(back, circle, 0x2f6fbf, 0.35);

  // Linee bianche.
  back.lineStyle(2, 0xf2f2f2, 0.85);
  line(back, [0, 0, 0], [L, 0, 0]);
  line(back, [L, 0, 0], [L, W, 0]);
  line(back, [L, W, 0], [0, W, 0]);
  line(back, [0, W, 0], [0, 0, 0]);
  line(back, [L / 2, 0, 0], [L / 2, W, 0]);
  back.strokePoints(circle.map(([x, y, z]) => pt(x, y, z)), true);
  for (const gx of [0, L]) {
    const dir = gx === 0 ? 1 : -1;
    const arc: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 16;
      arc.push(pt(gx + dir * Math.cos(a) * 5, CENTER_Y + Math.sin(a) * 5, 0));
    }
    back.strokePoints(arc, false);
  }
  back.fillStyle(0xf2f2f2, 1).fillCircle(isoX(L / 2, CENTER_Y), isoY(L / 2, CENTER_Y), 2);

  // --- Pareti di fondo (dietro i giocatori): y = 0 e x = L. ---
  wall(back, [0, 0], [L, 0], false);
  wall(back, [L, 0], [L, W], false);

  // --- Porte: quella di fondo dietro ai giocatori, quella davanti sopra. ---
  const goalBack = scene.add.graphics().setDepth(isoDepth(L, CENTER_Y) - 3);
  drawGoal(goalBack, L, false);
  const goalFront = scene.add.graphics().setDepth(isoDepth(-FIELD.goalDepth, CENTER_Y + FIELD.goalWidth / 2) + 2);
  drawGoal(goalFront, 0, true);

  // --- Pareti davanti (sopra ai giocatori, semitrasparenti): x = 0 e y = W. ---
  const front = scene.add.graphics().setDepth(5000);
  wall(front, [0, 0], [0, W], true);
  wall(front, [0, W], [L, W], true);

  // Lampioni negli angoli in fondo.
  for (const [x, y] of [
    [-1.5, -1.5],
    [L + 1.5, -1.5],
    [L + 1.5, W + 1.5],
  ] as [number, number][]) {
    back.lineStyle(3, 0x1a1820, 1);
    line(back, [x, y, 0], [x, y, 6.5]);
    back.fillStyle(0xfff2b0, 1).fillRect(isoX(x, y) - 5, isoY(x, y, 6.6) - 3, 10, 5);
    back.fillStyle(0xfff2b0, 0.08).fillCircle(isoX(x, y), isoY(x, y, 6.5), 60);
  }

  return { back, front, goalBack, goalFront };
}

/** Parete: cordolo di cemento, montanti e rete metallica a rombi. */
function wall(g: Phaser.GameObjects.Graphics, a: [number, number], b: [number, number], front: boolean): void {
  const [ax, ay] = a;
  const [bx, by] = b;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const isGoalWall = ax === bx && (ax === 0 || ax === L);
  const gx = ax;
  const gy0 = CENTER_Y - FIELD.goalWidth / 2;
  const gy1 = CENTER_Y + FIELD.goalWidth / 2;
  const fenceA = front ? 0.22 : 0.5;

  // Cordolo (interrotto davanti alla porta).
  const kerbCol = front ? 0x8a8496 : 0x6e6878;
  const seg = (s0: number, s1: number) => {
    poly(
      g,
      [
        [ax + ux * s0, ay + uy * s0, 0],
        [ax + ux * s1, ay + uy * s1, 0],
        [ax + ux * s1, ay + uy * s1, KERB_H],
        [ax + ux * s0, ay + uy * s0, KERB_H],
      ],
      kerbCol,
      front ? 0.55 : 1,
    );
  };
  if (isGoalWall) {
    seg(0, gy0);
    seg(gy1, len);
  } else {
    seg(0, len);
  }
  // Scritte/pannelli colorati sul cordolo di fondo.
  if (!front && !isGoalWall) {
    const cols = [0xff4d6d, 0xffd21f, 0x2ec4b6, 0x9b5de5];
    for (let s = 2, i = 0; s < len - 3; s += 6, i++) {
      poly(
        g,
        [
          [ax + ux * s, ay + uy * s, 0.08],
          [ax + ux * (s + 4), ay + uy * (s + 4), 0.08],
          [ax + ux * (s + 4), ay + uy * (s + 4), KERB_H - 0.08],
          [ax + ux * s, ay + uy * s, KERB_H - 0.08],
        ],
        cols[i % cols.length],
        0.9,
      );
    }
  }

  // Rete metallica: diagonali incrociate.
  g.lineStyle(1, 0xc9d1e0, fenceA);
  const step = 0.7;
  for (let s = -WALL_H; s < len; s += step) {
    const s0 = Math.max(0, s);
    const z0 = KERB_H + (s0 - s);
    const s1 = Math.min(len, s + WALL_H - KERB_H);
    const z1 = KERB_H + (s1 - s);
    if (z0 <= WALL_H && s1 > s0) line(g, [ax + ux * s0, ay + uy * s0, z0], [ax + ux * s1, ay + uy * s1, Math.min(WALL_H, z1)]);
    const t0 = Math.max(0, s);
    const tz0 = WALL_H - (t0 - s);
    const t1 = Math.min(len, s + WALL_H - KERB_H);
    const tz1 = WALL_H - (t1 - s);
    if (tz0 >= KERB_H && t1 > t0) line(g, [ax + ux * t0, ay + uy * t0, tz0], [ax + ux * t1, ay + uy * t1, Math.max(KERB_H, tz1)]);
  }
  // Montanti e tubo in alto.
  g.lineStyle(2, 0x2b2733, front ? 0.6 : 1);
  for (let s = 0; s <= len + 0.01; s += 4) {
    const sx = Math.min(s, len);
    line(g, [ax + ux * sx, ay + uy * sx, 0], [ax + ux * sx, ay + uy * sx, WALL_H]);
  }
  line(g, [ax, ay, WALL_H], [bx, by, WALL_H]);
  if (isGoalWall) {
    // Apertura della porta: niente rete sotto la traversa (copre la porta il suo disegno).
    void gx;
  }
}

function drawGoal(g: Phaser.GameObjects.Graphics, gx: number, front: boolean): void {
  const out = gx === 0 ? -1 : 1;
  const d = FIELD.goalDepth;
  const h = FIELD.goalHeight;
  const y0 = CENTER_Y - FIELD.goalWidth / 2;
  const y1 = CENTER_Y + FIELD.goalWidth / 2;
  const bx = gx + out * d;

  // Fondo scuro dentro la porta.
  poly(g, [[gx, y0, 0], [bx, y0, 0], [bx, y1, 0], [gx, y1, 0]], 0x1d1a26, 0.9);

  const net = () => {
    g.lineStyle(1, 0xffffff, front ? 0.35 : 0.55);
    for (let y = y0; y <= y1 + 0.01; y += 0.3) line(g, [bx, y, 0], [bx, y, h * 0.85]);
    for (let z = 0; z <= h * 0.85 + 0.01; z += 0.3) line(g, [bx, y0, z], [bx, y1, z]);
    for (let x = 0; x <= d + 0.01; x += 0.3) {
      line(g, [gx + out * x, y0, 0], [gx + out * x, y0, h - (h * 0.15 * x) / d]);
      line(g, [gx + out * x, y1, 0], [gx + out * x, y1, h - (h * 0.15 * x) / d]);
      line(g, [gx + out * x, y0, h - (h * 0.15 * x) / d], [gx + out * x, y1, h - (h * 0.15 * x) / d]);
    }
  };
  const frame = () => {
    g.lineStyle(4, 0x141018, 1);
    line(g, [gx, y0, 0], [gx, y0, h]);
    line(g, [gx, y1, 0], [gx, y1, h]);
    line(g, [gx, y0, h], [gx, y1, h]);
    g.lineStyle(2, 0xffffff, 1);
    line(g, [gx, y0, 0], [gx, y0, h]);
    line(g, [gx, y1, 0], [gx, y1, h]);
    line(g, [gx, y0, h], [gx, y1, h]);
    g.lineStyle(2, 0xdddddd, 1);
    line(g, [gx, y0, h], [bx, y0, h * 0.85]);
    line(g, [gx, y1, h], [bx, y1, h * 0.85]);
  };
  // La porta di fondo: la rete è dietro la cornice. Quella davanti: la rete è più vicina a noi.
  if (front) {
    frame();
    net();
  } else {
    net();
    frame();
  }
}

/** Limiti del mondo in pixel (per la camera). */
export function worldBounds(): Phaser.Geom.Rectangle {
  const xs = [isoX(-3, -3), isoX(L + 3, -3), isoX(L + 3, W + 3), isoX(-3, W + 3)];
  const ys = [isoY(-3, -3), isoY(L + 3, -3, 8), isoY(L + 3, W + 3), isoY(-3, W + 3)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys) - 120;
  const maxY = Math.max(...ys) + 40;
  return new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY);
}

export { HW, HH };
