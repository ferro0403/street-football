// Rasterizzatore pixel art: per ogni pixel lancia un raggio isometrico (la stessa proiezione del
// gioco) contro i volumi del corpo (signed distance field), trova materiale e normale, poi
// applica ombra a fasce, contorno colorato e linee interne. Niente antialiasing: pixel netti.
import { HH, HW, ZPX } from '../../src/game/iso';
import { FACE, buildHair, dot, mt, mv, sub, vnorm, type Built, type HairStyle, type Prim, type Role, type V3 } from './rig';

export const FRAME_W = 88;
export const FRAME_H = 92;
export const ANCHOR_X = 44;
export const ANCHOR_Y = 78;

/** Livelli in scala di grigi: in gioco ognuno viene tinto col suo colore. */
export const LAYERS = ['skin', 'socks', 'shoes', 'shorts', 'shirt', 'trim', 'gloves', 'fixed'] as const;
export type Layer = (typeof LAYERS)[number];

const ROLE_LAYER: Record<Role, Layer | 'hair'> = {
  skin: 'skin',
  mouth: 'skin',
  shirt: 'shirt',
  trim: 'trim',
  shorts: 'shorts',
  socks: 'socks',
  shoes: 'shoes',
  gloves: 'gloves',
  eye: 'fixed',
  hair: 'hair',
};

// Direzione di vista (verso lo schermo) e verso la camera.
const VIEW: V3 = vnorm([1, -1, -(2 * HH) / ZPX]);
const CAM: V3 = [-VIEW[0], -VIEW[1], -VIEW[2]];
// Luce dall'alto a sinistra dello schermo.
const LIGHT: V3 = vnorm([-0.75, -0.1, 1.3]);

const OUTLINE = 0.26;
const INNER = 0.44;

function quantize(ndl: number): number {
  if (ndl > 0.62) return 1.0;
  if (ndl > 0.25) return 0.86;
  if (ndl > -0.12) return 0.71;
  return 0.57;
}

// --- SDF -----------------------------------------------------------------------------

interface Hit {
  d: number;
  t: number; // parametro lungo la capsula (per le fasce di colore)
}

function sdPrim(pr: Prim, p: V3, out: Hit): void {
  switch (pr.k) {
    case 'cap': {
      const ab = sub(pr.b, pr.a);
      const ap = sub(p, pr.a);
      let t = dot(ap, ab) / dot(ab, ab);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ap[0] - ab[0] * t;
      const dy = ap[1] - ab[1] * t;
      const dz = ap[2] - ab[2] * t;
      out.d = Math.sqrt(dx * dx + dy * dy + dz * dz) - pr.r;
      out.t = t;
      return;
    }
    case 'sph': {
      const q = sub(p, pr.c);
      out.d = Math.sqrt(dot(q, q)) - pr.r - (pr.bump ? bump(p, pr.bump) : 0);
      out.t = 0;
      return;
    }
    case 'cut': {
      const q = sub(p, pr.c);
      const ds = Math.sqrt(dot(q, q)) - pr.r - (pr.bump ? bump(p, pr.bump) : 0);
      out.d = Math.max(ds, pr.off - dot(pr.n, q));
      out.t = 0;
      return;
    }
    case 'box': {
      const q = mv(mt(pr.R), sub(p, pr.c));
      const qx = Math.abs(q[0]) - pr.h[0];
      const qy = Math.abs(q[1]) - pr.h[1];
      const qz = Math.abs(q[2]) - pr.h[2];
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const oz = Math.max(qz, 0);
      out.d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - pr.r;
      out.t = q[2]; // per il colletto
      return;
    }
  }
}

function bump(p: V3, a: number): number {
  return a * Math.sin(p[0] * 61) * Math.sin(p[1] * 59) * Math.sin(p[2] * 67);
}

function bound(pr: Prim): { c: V3; r: number } {
  switch (pr.k) {
    case 'cap':
      return { c: [(pr.a[0] + pr.b[0]) / 2, (pr.a[1] + pr.b[1]) / 2, (pr.a[2] + pr.b[2]) / 2], r: Math.sqrt(dot(sub(pr.b, pr.a), sub(pr.b, pr.a))) / 2 + pr.r };
    case 'sph':
    case 'cut':
      return { c: pr.c, r: pr.r + 0.03 };
    case 'box':
      return { c: pr.c, r: Math.sqrt(dot(pr.h, pr.h)) + pr.r };
  }
}

/** Punto del piano z=0 che sullo schermo cade nel pixel (sx, sy) rispetto all'ancora. */
function rayOrigin(sx: number, sy: number): V3 {
  return [(sx / HW - sy / HH) / 2, (sx / HW + sy / HH) / 2, 0];
}

export function project(p: V3): [number, number] {
  return [ANCHOR_X + (p[0] + p[1]) * HW, ANCHOR_Y + (p[1] - p[0]) * HH - p[2] * ZPX];
}

interface MarchResult {
  hit: boolean;
  t: number;
  prim: number;
  pt: V3;
  u: number;
}

const tmp: Hit = { d: 0, t: 0 };

function march(prims: Prim[], bounds: { c: V3; r: number }[], o: V3): MarchResult {
  // Candidati: volumi il cui guscio sferico è attraversato dal raggio.
  let t0 = Infinity;
  let t1 = -Infinity;
  const cand: number[] = [];
  for (let i = 0; i < prims.length; i++) {
    const b = bounds[i];
    const oc = sub(o, b.c);
    const bq = dot(oc, VIEW);
    const cq = dot(oc, oc) - b.r * b.r;
    const disc = bq * bq - cq;
    if (disc < 0) continue;
    const s = Math.sqrt(disc);
    cand.push(i);
    t0 = Math.min(t0, -bq - s);
    t1 = Math.max(t1, -bq + s);
  }
  const res: MarchResult = { hit: false, t: 0, prim: -1, pt: [0, 0, 0], u: 0 };
  if (!cand.length) return res;
  let t = t0;
  for (let it = 0; it < 120 && t <= t1; it++) {
    const p: V3 = [o[0] + VIEW[0] * t, o[1] + VIEW[1] * t, o[2] + VIEW[2] * t];
    let best = Infinity;
    let bi = -1;
    let bu = 0;
    for (const i of cand) {
      sdPrim(prims[i], p, tmp);
      if (tmp.d < best) {
        best = tmp.d;
        bi = i;
        bu = tmp.t;
      }
    }
    if (best < 0.0025) {
      res.hit = true;
      res.t = t;
      res.prim = bi;
      res.pt = p;
      res.u = bu;
      return res;
    }
    t += Math.max(best, 0.004);
  }
  return res;
}

function normalAt(pr: Prim, p: V3): V3 {
  const e = 0.004;
  const f = (x: number, y: number, z: number) => {
    sdPrim(pr, [x, y, z], tmp);
    return tmp.d;
  };
  return vnorm([
    f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]),
    f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]),
    f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e),
  ]);
}

function roleAt(pr: Prim, u: number, p: V3, built: Built): Role {
  switch (pr.k) {
    case 'cap':
      for (const [end, role] of pr.bands) if (u <= end) return role;
      return pr.bands[pr.bands.length - 1][1];
    case 'box':
      // Colletto: fascia in alto, attorno al collo.
      if (pr.collar && u > pr.h[2] + pr.r - pr.collar) {
        const q = mv(mt(pr.R), sub(p, pr.c));
        if (Math.abs(q[1]) < 0.1) return 'trim';
      }
      return pr.role;
    default:
      if (pr.id === 'head') {
        const q = mv(mt(built.headR), sub(p, built.headC));
        for (const e of FACE.eyes) {
          const d = sub(q, e);
          if (d[0] * d[0] * 0.3 + d[1] * d[1] + d[2] * d[2] * 0.55 < FACE.eyeR * FACE.eyeR) return 'eye';
        }
        const m = sub(q, FACE.mouth);
        if (q[0] > 0.1 && Math.abs(m[2]) < 0.014 && Math.abs(m[1]) < 0.05) return 'mouth';
      }
      return pr.role;
  }
}

// --- Fotogramma ------------------------------------------------------------------------------

export interface FrameOut {
  /** Per livello: grigio 0..1 per pixel (-1 = vuoto). */
  layers: Record<string, Float32Array>;
  /** Posizione del numero di maglia nel fotogramma, o null se non si vede. */
  number: [number, number] | null;
}

export function renderFrame(built: Built, hairStyles: readonly HairStyle[]): FrameOut {
  const N = FRAME_W * FRAME_H;
  const prims = built.prims;
  const bounds = prims.map(bound);
  const role = new Int16Array(N).fill(-1);
  const depth = new Float32Array(N).fill(-Infinity);
  const gray = new Float32Array(N).fill(-1);
  const roleList: Role[] = [];
  const roleIdx = (r: Role) => {
    let i = roleList.indexOf(r);
    if (i < 0) {
      roleList.push(r);
      i = roleList.length - 1;
    }
    return i;
  };

  // Rettangolo dello schermo occupato (per non tracciare pixel vuoti).
  let minX = FRAME_W;
  let minY = FRAME_H;
  let maxX = 0;
  let maxY = 0;
  for (const b of bounds) {
    const [x, y] = project(b.c);
    const rx = b.r * (HW + 2);
    const ry = b.r * (ZPX + 2);
    minX = Math.min(minX, x - rx);
    maxX = Math.max(maxX, x + rx);
    minY = Math.min(minY, y - ry);
    maxY = Math.max(maxY, y + ry);
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(FRAME_W - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(FRAME_H - 1, Math.ceil(maxY));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = rayOrigin(x + 0.5 - ANCHOR_X, y + 0.5 - ANCHOR_Y);
      // Si parte da davanti al modello (lontano verso la camera).
      const start: V3 = [o[0] - VIEW[0] * 6, o[1] - VIEW[1] * 6, o[2] - VIEW[2] * 6];
      const r = march(prims, bounds, start);
      if (!r.hit) continue;
      const pr = prims[r.prim];
      const ro = roleAt(pr, r.u, r.pt, built);
      const n = normalAt(pr, r.pt);
      const i = y * FRAME_W + x;
      role[i] = roleIdx(ro);
      depth[i] = -r.t;
      let g = quantize(dot(n, LIGHT));
      if (ro === 'mouth') g = 0.58;
      if (ro === 'eye') g = 0;
      gray[i] = g;
    }
  }

  // Linee interne: dove una parte copre un'altra molto più indietro.
  const inner = new Uint8Array(N);
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const i = y * FRAME_W + x;
      if (role[i] < 0 || roleList[role[i]] === 'eye') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= FRAME_W || ny >= FRAME_H) continue;
        const j = ny * FRAME_W + nx;
        if (role[j] >= 0 && depth[j] - depth[i] > 0.16) inner[i] = 1;
      }
    }
  }

  const layers: Record<string, Float32Array> = {};
  const layerOf = (r: Role) => ROLE_LAYER[r] as string;
  for (const L of LAYERS) layers[L] = new Float32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (role[i] < 0) continue;
    const ro = roleList[role[i]];
    let g = gray[i];
    if (inner[i] && ro !== 'eye') g = Math.min(g, INNER);
    layers[layerOf(ro)][i] = g;
  }

  // Contorno esterno "selout": colore scuro della parte confinante.
  const outlineInto = (solid: (i: number) => boolean, pick: (i: number) => string | null, skipAlso?: (i: number) => boolean) => {
    for (let y = 0; y < FRAME_H; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        const i = y * FRAME_W + x;
        if (solid(i) || (skipAlso && skipAlso(i))) continue;
        let bestJ = -1;
        let bestD = -Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= FRAME_W || ny >= FRAME_H) continue;
          const j = ny * FRAME_W + nx;
          if (!solid(j)) continue;
          if (depth[j] > bestD || bestJ < 0) {
            bestD = depth[j];
            bestJ = j;
          }
        }
        if (bestJ < 0) continue;
        const L = pick(bestJ);
        if (L) layers[L][i] = OUTLINE;
      }
    }
  };
  outlineInto(
    (i) => role[i] >= 0,
    (j) => {
      const ro = roleList[role[j]];
      return ro === 'eye' ? 'skin' : layerOf(ro);
    },
  );

  // Capelli: un livello per taglio, visibili solo dove stanno davanti al corpo.
  for (const st of hairStyles) {
    const name = `hair_${st}`;
    const hl = new Float32Array(N).fill(-1);
    layers[name] = hl;
    const hp = buildHair(st, built.headR, built.headC);
    if (!hp.length) continue;
    const hb = hp.map(bound);
    const hdepth = new Float32Array(N).fill(-Infinity);
    const [cx, cy] = project(built.headC);
    const R = 0.42;
    const hx0 = Math.max(0, Math.floor(cx - R * (HW + 4)));
    const hx1 = Math.min(FRAME_W - 1, Math.ceil(cx + R * (HW + 4)));
    const hy0 = Math.max(0, Math.floor(cy - R * (ZPX + 4)));
    const hy1 = Math.min(FRAME_H - 1, Math.ceil(cy + R * (ZPX + 8)));
    for (let y = hy0; y <= hy1; y++) {
      for (let x = hx0; x <= hx1; x++) {
        const o = rayOrigin(x + 0.5 - ANCHOR_X, y + 0.5 - ANCHOR_Y);
        const start: V3 = [o[0] - VIEW[0] * 6, o[1] - VIEW[1] * 6, o[2] - VIEW[2] * 6];
        const r = march(hp, hb, start);
        if (!r.hit) continue;
        const i = y * FRAME_W + x;
        const dHair = -r.t;
        if (role[i] >= 0 && depth[i] > dHair + 0.001) continue; // il corpo è davanti
        const n = normalAt(hp[r.prim], r.pt);
        // Ciocche: piccola variazione per dare texture.
        const streak = (x * 7 + y * 3) % 5 === 0 ? -0.08 : 0;
        hl[i] = Math.max(0.5, quantize(dot(n, LIGHT)) + streak);
        hdepth[i] = dHair;
      }
    }
    // Linea dove i capelli finiscono sulla fronte e contorno esterno dei capelli.
    for (let y = 0; y < FRAME_H; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        const i = y * FRAME_W + x;
        if (hl[i] >= 0 || hdepth[i] !== -Infinity) continue;
        if (role[i] >= 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= FRAME_W || ny >= FRAME_H) continue;
          const j = ny * FRAME_W + nx;
          if (hl[j] > OUTLINE) {
            hl[i] = OUTLINE;
            break;
          }
        }
      }
    }
  }

  // Numero di maglia: visibile se la schiena guarda la camera e non è coperta.
  let number: [number, number] | null = null;
  if (dot(built.numN, CAM) > 0.25) {
    const [nx, ny] = project(built.numP);
    const xi = Math.round(nx);
    const yi = Math.round(ny);
    if (xi >= 2 && yi >= 3 && xi < FRAME_W - 2 && yi < FRAME_H - 3) {
      const i = yi * FRAME_W + xi;
      if (role[i] >= 0 && roleList[role[i]] === 'shirt') number = [xi, yi];
    }
  }
  return { layers, number };
}
