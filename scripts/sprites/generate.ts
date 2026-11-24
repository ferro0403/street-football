// Genera gli sprite sheet dei giocatori, della palla e dell'ombra.
//
//   npm run sprites
//
// Uscita (in public/assets/sprites, caricata dal gioco):
//   players.json + players-N.png  multiatlas Phaser con fotogrammi ritagliati
//   players-meta.json             animazioni, direzioni, ancora, posizione del numero di maglia
//   ball.png, shadow.png          palla che rotola (16 fotogrammi) e ombra
// e un'anteprima in docs/art/players-preview.png con giocatori personalizzati.
//
// Tutto è disegnato da questo codice: nessuna immagine esterna, nessuna licenza di terzi.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenToWorldDir } from '../../src/game/iso';
import { encodePNG } from './png';
import { buildBody, HAIR_STYLES, type HairStyle } from './rig';
import { SETS } from './anims';
import { ANCHOR_X, ANCHOR_Y, FRAME_H, FRAME_W, LAYERS, renderFrame } from './render';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'sprites');
const DOCS = join(ROOT, 'docs', 'art');
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });

/** Direzioni disegnate (sullo schermo): S, SE, E, NE, N. Le altre 3 sono specchiate in gioco. */
export const DIRS: [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
];

const FIXED_RGB = [26, 20, 24];

interface Sprite {
  name: string;
  w: number;
  h: number;
  ox: number; // posizione del ritaglio nel fotogramma intero
  oy: number;
  rgba: Uint8Array;
}

const sprites: Sprite[] = [];
const meta = {
  frameW: FRAME_W,
  frameH: FRAME_H,
  anchorX: ANCHOR_X,
  anchorY: ANCHOR_Y,
  dirs: DIRS.length,
  layers: [...LAYERS] as string[],
  hairStyles: [...HAIR_STYLES] as string[],
  sets: {} as Record<string, Record<string, { frames: number; loop: boolean; fps: number }>>,
  /** set_anim_dir_i → [x, y] del numero di maglia nel fotogramma (assente = non visibile). */
  numbers: {} as Record<string, [number, number]>,
};

/** Ritaglia un livello (grigi -1..1) al rettangolo minimo e lo converte in RGBA. */
function trimLayer(name: string, g: Float32Array, fixed: boolean): void {
  let x0 = FRAME_W;
  let y0 = FRAME_H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (g[y * FRAME_W + x] < 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) {
    sprites.push({ name, w: 1, h: 1, ox: 0, oy: 0, rgba: new Uint8Array(4) });
    return;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g[(y + y0) * FRAME_W + x + x0];
      if (v < 0) continue;
      const k = (y * w + x) * 4;
      if (fixed) {
        rgba[k] = FIXED_RGB[0];
        rgba[k + 1] = FIXED_RGB[1];
        rgba[k + 2] = FIXED_RGB[2];
      } else {
        const c = Math.round(Math.min(1, v) * 255);
        rgba[k] = c;
        rgba[k + 1] = c;
        rgba[k + 2] = c;
      }
      rgba[k + 3] = 255;
    }
  }
  sprites.push({ name, w, h, ox: x0, oy: y0, rgba });
}

// --- Rendering di tutte le animazioni ---------------------------------------------------------

const t0 = Date.now();
let count = 0;
for (const [set, anims] of Object.entries(SETS)) {
  meta.sets[set] = {};
  const gk = set === 'gk';
  const layers = gk ? LAYERS : LAYERS.filter((l) => l !== 'gloves');
  for (const [anim, def] of Object.entries(anims)) {
    meta.sets[set][anim] = { frames: def.frames, loop: def.loop, fps: def.fps };
    for (let d = 0; d < DIRS.length; d++) {
      const [wx, wy] = screenToWorldDir(DIRS[d][0], DIRS[d][1]);
      const facing = Math.atan2(wy, wx);
      for (let i = 0; i < def.frames; i++) {
        const p = def.at(i, def.frames);
        const built = buildBody({ ...p, yaw: p.yaw + facing }, gk);
        const out = renderFrame(built, HAIR_STYLES);
        const id = `${set}_${anim}_${d}_${i}`;
        for (const L of layers) trimLayer(`${L}/${id}`, out.layers[L], L === 'fixed');
        for (const st of HAIR_STYLES) if (st !== 'bald') trimLayer(`hair_${st}/${id}`, out.layers[`hair_${st}`], false);
        if (out.number) meta.numbers[id] = out.number;
        count++;
      }
    }
  }
}
console.log(`fotogrammi: ${count} (${sprites.length} ritagli) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- Impacchettamento (scaffali) in pagine da max 2048×2048 ----------------------------------------

const PAGE = 2048;
const PAD = 2;
interface Placed extends Sprite {
  page: number;
  x: number;
  y: number;
}
const order = [...sprites].sort((a, b) => b.h - a.h || b.w - a.w);
const placed: Placed[] = [];
const pages: { w: number; h: number }[] = [];
let page = 0;
let cx = PAD;
let cy = PAD;
let rowH = 0;
pages.push({ w: 0, h: 0 });
for (const s of order) {
  if (cx + s.w + PAD > PAGE) {
    cx = PAD;
    cy += rowH + PAD;
    rowH = 0;
  }
  if (cy + s.h + PAD > PAGE) {
    page++;
    pages.push({ w: 0, h: 0 });
    cx = PAD;
    cy = PAD;
    rowH = 0;
  }
  placed.push({ ...s, page, x: cx, y: cy });
  pages[page].w = Math.max(pages[page].w, cx + s.w + PAD);
  pages[page].h = Math.max(pages[page].h, cy + s.h + PAD);
  cx += s.w + PAD;
  rowH = Math.max(rowH, s.h);
}

const textures = pages.map((pg, pi) => {
  // Dimensioni multiple di 4 (compressione a blocchi).
  const w = Math.ceil(pg.w / 4) * 4;
  const h = Math.ceil(pg.h / 4) * 4;
  const img = new Uint8Array(w * h * 4);
  const frames = [];
  for (const s of placed.filter((p) => p.page === pi)) {
    for (let y = 0; y < s.h; y++) img.set(s.rgba.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((s.y + y) * w + s.x) * 4);
    frames.push({
      filename: s.name,
      rotated: false,
      trimmed: true,
      sourceSize: { w: FRAME_W, h: FRAME_H },
      spriteSourceSize: { x: s.ox, y: s.oy, w: s.w, h: s.h },
      frame: { x: s.x, y: s.y, w: s.w, h: s.h },
    });
  }
  const file = `players-${pi}.png`;
  writeFileSync(join(OUT, file), encodePNG(w, h, img));
  console.log(`${file}: ${w}×${h}, ${frames.length} fotogrammi`);
  return { image: file, format: 'RGBA8888', size: { w, h }, scale: 1, frames };
});
writeFileSync(join(OUT, 'players.json'), JSON.stringify({ textures, meta: { app: 'scripts/sprites/generate.ts', version: '1' } }));
writeFileSync(join(OUT, 'players-meta.json'), JSON.stringify(meta));

// --- Palla (16 fotogrammi che rotolano verso destra) e ombra ----------------------------------------

const BALL = 16;
const BALL_FRAMES = 16;
{
  // Centri delle "pezze" scure: vertici di un icosaedro.
  const g = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-g, g]) verts.push([0, a, b], [a, b, 0], [b, 0, a]);
  const vn = verts.map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  const img = new Uint8Array(BALL * BALL_FRAMES * BALL * 4);
  const R = 6.4;
  for (let f = 0; f < BALL_FRAMES; f++) {
    const ang = (f / BALL_FRAMES) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let y = 0; y < BALL; y++) {
      for (let x = 0; x < BALL; x++) {
        const px = x + 0.5 - BALL / 2;
        const py = y + 0.5 - BALL / 2;
        const k = ((y * BALL_FRAMES + f) * BALL + x) * 4;
        const d2 = px * px + py * py;
        if (d2 > (R + 1) * (R + 1)) continue;
        if (d2 > R * R) {
          img.set([20, 18, 26, 255], k);
          continue;
        }
        const nz = Math.sqrt(R * R - d2) / R;
        const nx = px / R;
        const ny = py / R;
        // Rotazione attorno all'asse verticale dello schermo: la palla rotola verso destra.
        const rx = nx * ca - nz * sa;
        const rz = nx * sa + nz * ca;
        let patch = false;
        for (const v of vn) if (rx * v[0] + ny * v[1] + rz * v[2] > 0.93) patch = true;
        const light = -0.45 * nx - 0.6 * ny + 0.65 * nz;
        const shade = light > 0.45 ? 1 : light > 0.05 ? 0.85 : 0.68;
        const base = patch ? 40 : 245;
        const c = Math.round(base * shade);
        img.set([c, c, patch ? c + 4 : c, 255], k);
      }
    }
  }
  writeFileSync(join(OUT, 'ball.png'), encodePNG(BALL * BALL_FRAMES, BALL, img));
}
{
  // Ombra ellittica a pixel, con bordo retinato.
  const W = 40;
  const H = 16;
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2);
      const dy = (y + 0.5 - H / 2) / (H / 2);
      const r = dx * dx + dy * dy;
      if (r > 1) continue;
      const edge = r > 0.62;
      if (edge && (x + y) % 2 === 1) continue;
      img.set([0, 0, 0, edge ? 70 : 105], (y * W + x) * 4);
    }
  }
  writeFileSync(join(OUT, 'shadow.png'), encodePNG(W, H, img));
}
writeFileSync(join(OUT, 'ball-meta.json'), JSON.stringify({ size: BALL, frames: BALL_FRAMES, radiusPx: 6.4 }));

// --- Anteprima: giocatori personalizzati, varie animazioni e direzioni -----------------------------------

interface Look {
  skin: number;
  hair: number;
  style: HairStyle;
  shirt: number;
  trim: number;
  shorts: number;
  socks: number;
  boots: number;
  gk?: boolean;
}
const LOOKS: Look[] = [
  { skin: 0xa86b42, hair: 0x1b1410, style: 'curly', shirt: 0xffd21f, trim: 0x139b48, shorts: 0x1f4fd1, socks: 0xffffff, boots: 0x111111 },
  { skin: 0xf1c7a1, hair: 0xe0b84a, style: 'short', shirt: 0x1f3fb0, trim: 0xffffff, shorts: 0xffffff, socks: 0xd8202a, boots: 0xff4d6d },
  { skin: 0x6e4428, hair: 0x1b1410, style: 'mohawk', shirt: 0xc8102e, trim: 0x0a6b3a, shorts: 0x0a6b3a, socks: 0xc8102e, boots: 0x2ec4b6 },
  { skin: 0xd59a6c, hair: 0x5a3520, style: 'long', shirt: 0x8fd0ff, trim: 0xffffff, shorts: 0x111a3a, socks: 0xffffff, boots: 0xffffff },
  { skin: 0xf1c7a1, hair: 0xa2401c, style: 'buzz', shirt: 0x2b7bd6, trim: 0xffffff, shorts: 0xffffff, socks: 0x2b7bd6, boots: 0xffd21f },
  { skin: 0xd59a6c, hair: 0x1b1410, style: 'bald', shirt: 0x26b36b, trim: 0x111111, shorts: 0x111111, socks: 0x26b36b, boots: 0x111111, gk: true },
];

const byName = new Map(sprites.map((s) => [s.name, s]));
function composite(dst: Uint8Array, dw: number, dx: number, dy: number, scale: number, look: Look, id: string): void {
  const tints: [string, number | null][] = [
    ['skin', look.skin],
    ['socks', look.socks],
    ['shoes', look.boots],
    ['shorts', look.shorts],
    ['shirt', look.shirt],
    ['trim', look.trim],
    ['gloves', look.trim],
    ['fixed', null],
    [`hair_${look.style}`, look.hair],
  ];
  for (const [L, tint] of tints) {
    const s = byName.get(`${L}/${id}`);
    if (!s || s.w === 1) continue;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const k = (y * s.w + x) * 4;
        if (!s.rgba[k + 3]) continue;
        let r = s.rgba[k];
        let g = s.rgba[k + 1];
        let b = s.rgba[k + 2];
        if (tint !== null) {
          r = Math.round((r * ((tint >> 16) & 255)) / 255);
          g = Math.round((g * ((tint >> 8) & 255)) / 255);
          b = Math.round((b * (tint & 255)) / 255);
        }
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const X = dx + (s.ox + x) * scale + sx;
            const Y = dy + (s.oy + y) * scale + sy;
            const o = (Y * dw + X) * 4;
            dst[o] = r;
            dst[o + 1] = g;
            dst[o + 2] = b;
            dst[o + 3] = 255;
          }
        }
      }
    }
  }
}

{
  const S = 2;
  const cellW = FRAME_W * S;
  const cellH = FRAME_H * S;
  const rows: { look: Look; set: string; anim: string; frame: number }[] = [];
  const show = ['idle', 'run', 'sprint', 'pass', 'shoot', 'tackle', 'slide', 'fall', 'celebrate', 'rabona', 'veronica', 'elastico'];
  const showGk = ['ready', 'diveL', 'diveR', 'save', 'hold', 'run', 'shoot', 'fall', 'celebrate', 'idle', 'pass', 'ready'];
  LOOKS.forEach((look, li) => {
    const list = look.gk ? showGk : show;
    list.forEach((anim) => {
      const def = SETS[look.gk ? 'gk' : 'field'][anim];
      rows.push({ look, set: look.gk ? 'gk' : 'field', anim, frame: Math.floor(def.frames / 2) - (li % 2) * 0 });
    });
  });
  const cols = 12;
  // Riga extra: corsa nelle 8 direzioni (5 disegnate + 3 specchiate in gioco).
  const W = cols * cellW;
  const H = (LOOKS.length + 1) * cellH;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) img.set((Math.floor((i % W) / 16) + Math.floor(Math.floor(i / W) / 16)) % 2 ? [74, 79, 92, 255] : [67, 72, 85, 255], i * 4);
  rows.forEach((r, i) => {
    const c = i % cols;
    const rr = Math.floor(i / cols);
    composite(img, W, c * cellW, rr * cellH, S, r.look, `${r.set}_${r.anim}_${(i + rr) % 5}_${r.frame}`);
  });
  for (let d = 0; d < 5; d++) {
    for (let f = 0; f < 2; f++) composite(img, W, (d * 2 + f) * cellW, LOOKS.length * cellH, S, LOOKS[d % 5], `field_run_${d}_${f * 3}`);
  }
  writeFileSync(join(DOCS, 'players-preview.png'), encodePNG(W, H, img));
  console.log('anteprima: docs/art/players-preview.png');
}
