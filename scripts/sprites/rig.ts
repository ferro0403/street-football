// Scheletro del calciatore e volumi (capsule, sfere, box arrotondati) in metri.
// Sistema locale: x avanti, y sinistra, z su. Le pose sono angoli: cambiare un numero qui
// cambia l'animazione in tutte le 8 direzioni.

export type V3 = [number, number, number];
export type M3 = [number, number, number, number, number, number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a: V3): number => Math.sqrt(dot(a, a));
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mm(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
export function mv(m: M3, v: V3): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
/** Trasposta = inversa per le rotazioni. */
export function mt(m: M3): M3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
export function rotX(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
/** Positivo = inclina in avanti (l'asse z va verso +x). */
export function rotY(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotZ(a: number): M3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export type Role = 'skin' | 'shirt' | 'trim' | 'shorts' | 'socks' | 'shoes' | 'gloves' | 'hair' | 'eye' | 'mouth';

export type Prim =
  | { k: 'cap'; a: V3; b: V3; r: number; bands: [number, Role][]; id: string }
  | { k: 'sph'; c: V3; r: number; role: Role; id: string; bump?: number }
  | { k: 'box'; c: V3; R: M3; h: V3; r: number; role: Role; id: string; collar?: number }
  /** Sfera ritagliata da un semispazio (capelli): tiene i punti con n·(p-c) > off. */
  | { k: 'cut'; c: V3; r: number; n: V3; off: number; role: Role; id: string; bump?: number };

export interface Pose {
  bob: number; // spostamento verticale del bacino (m)
  lean: number; // busto in avanti (rad)
  side: number; // busto di lato (rad)
  twist: number; // busto ruotato rispetto alle anche (rad)
  yaw: number; // tutto il corpo ruotato (rad), per le giravolte
  pitch: number; // tutto il corpo inclinato avanti/indietro (rad), attorno al bacino
  roll: number; // tutto il corpo inclinato di lato (rad), attorno al bacino
  lift: number; // tutto il corpo alzato (m)
  hipL: [number, number]; // [avanti, fuori]
  hipR: [number, number];
  kneeL: number;
  kneeR: number;
  footL: number;
  footR: number;
  shL: [number, number]; // spalla [avanti, fuori]
  shR: [number, number];
  elL: number;
  elR: number;
  head: [number, number]; // [chinata, girata]
}

export const REST: Pose = {
  bob: 0,
  lean: 0,
  side: 0,
  twist: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  lift: 0,
  hipL: [0, 0.05],
  hipR: [0, 0.05],
  kneeL: 0.05,
  kneeR: 0.05,
  footL: 0,
  footR: 0,
  shL: [0.05, 0.18],
  shR: [0.05, 0.18],
  elL: 0.25,
  elR: 0.25,
  head: [0, 0],
};

export function pose(p: Partial<Pose>): Pose {
  return { ...REST, ...p };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  const l2 = (x: [number, number], y: [number, number]): [number, number] => [l(x[0], y[0]), l(x[1], y[1])];
  return {
    bob: l(a.bob, b.bob),
    lean: l(a.lean, b.lean),
    side: l(a.side, b.side),
    twist: l(a.twist, b.twist),
    yaw: l(a.yaw, b.yaw),
    pitch: l(a.pitch, b.pitch),
    roll: l(a.roll, b.roll),
    lift: l(a.lift, b.lift),
    hipL: l2(a.hipL, b.hipL),
    hipR: l2(a.hipR, b.hipR),
    kneeL: l(a.kneeL, b.kneeL),
    kneeR: l(a.kneeR, b.kneeR),
    footL: l(a.footL, b.footL),
    footR: l(a.footR, b.footR),
    shL: l2(a.shL, b.shL),
    shR: l2(a.shR, b.shR),
    elL: l(a.elL, b.elL),
    elR: l(a.elR, b.elR),
    head: l2(a.head, b.head),
  };
}

// --- Proporzioni (stilizzate: testa grande, leggibile anche piccola) ---------------
export const BODY = {
  pelvisZ: 0.9,
  thigh: 0.41,
  shin: 0.41,
  foot: 0.21,
  upperArm: 0.28,
  foreArm: 0.26,
  torsoH: 0.46,
  headR: 0.19,
};

export interface Built {
  prims: Prim[];
  /** Matrice e centro della testa (per i capelli). */
  headR: M3;
  headC: V3;
  /** Punto e normale dove va il numero sulla schiena. */
  numP: V3;
  numN: V3;
  /** Mani (per la palla in mano del portiere). */
  handL: V3;
  handR: V3;
}

/** Costruisce i volumi del corpo nella posa data. */
export function buildBody(p: Pose, gk: boolean): Built {
  const B = BODY;
  const prims: Prim[] = [];
  const P: V3 = [0, 0, B.pelvisZ + p.bob];
  const Rt = mm(rotZ(p.twist), mm(rotX(-p.side), rotY(p.lean)));
  const Rh = rotY(p.lean * 0.25);

  // Trasformazione globale: giravolta, inclinazione attorno al bacino, sollevamento.
  const Rg = mm(rotZ(p.yaw), mm(rotX(p.roll), rotY(p.pitch)));
  const G = (v: V3): V3 => add(add(mv(Rg, sub(v, P)), P), [0, 0, p.lift]);
  const GR = (m: M3): M3 => mm(Rg, m);

  const legDir = (pitch: number, abd: number, sgn: number): V3 => mv(rotX(sgn * abd), mv(rotY(-pitch), [0, 0, -1]));
  const cap = (a: V3, b: V3, r: number, bands: [number, Role][], id: string) =>
    prims.push({ k: 'cap', a: G(a), b: G(b), r, bands, id });

  // Gambe.
  const leg = (sgn: number, hip: [number, number], knee: number, footA: number, side: string) => {
    const H = add(P, mv(Rh, [0, 0.11 * sgn, -0.02]));
    const K = add(H, mv(Rh, mul(legDir(hip[0], hip[1], sgn), B.thigh)));
    const A = add(K, mv(Rh, mul(legDir(hip[0] - knee, hip[1], sgn), B.shin)));
    const fd = mv(rotX(sgn * hip[1]), mv(rotY(-(hip[0] - knee + footA)), [1, 0, 0]));
    const T = add(A, mv(Rh, mul(fd, B.foot)));
    const heel = add(A, mv(Rh, mul(fd, -0.04)));
    cap(H, K, 0.118, [[0.5, 'shorts'], [1, 'skin']], `thigh${side}`);
    cap(K, A, 0.09, [[0.14, 'skin'], [1, 'socks']], `shin${side}`);
    cap(add(heel, [0, 0, -0.02]), add(T, [0, 0, -0.02]), 0.074, [[1, 'shoes']], `foot${side}`);
  };
  leg(1, p.hipL, p.kneeL, p.footL, 'L');
  leg(-1, p.hipR, p.kneeR, p.footR, 'R');

  // Bacino (pantaloncini) e busto (maglia con colletto).
  prims.push({ k: 'box', c: G(add(P, [0, 0, 0.02])), R: GR(Rh), h: [0.1, 0.17, 0.08], r: 0.065, role: 'shorts', id: 'pelvis' });
  const chestC = add(P, mv(Rt, [0, 0, 0.26]));
  prims.push({ k: 'box', c: G(chestC), R: GR(Rt), h: [0.1, 0.17, 0.19], r: 0.075, role: 'shirt', id: 'torso', collar: 0.04 });

  // Collo e testa.
  const N = add(P, mv(Rt, [0, 0, B.torsoH]));
  const Rhead = mm(Rt, mm(rotZ(p.head[1]), rotY(p.head[0] - p.lean * 0.6)));
  const Hc = add(N, mv(Rhead, [0.01, 0, 0.17]));
  cap(N, add(N, mv(Rhead, [0, 0, 0.08])), 0.075, [[1, 'skin']], 'neck');
  prims.push({ k: 'sph', c: G(Hc), r: B.headR, role: 'skin', id: 'head' });
  for (const s of [1, -1]) prims.push({ k: 'sph', c: G(add(Hc, mv(Rhead, [-0.01, s * 0.18, -0.01]))), r: 0.045, role: 'skin', id: `ear${s}` });
  prims.push({ k: 'sph', c: G(add(Hc, mv(Rhead, [0.18, 0, -0.03]))), r: 0.035, role: 'skin', id: 'nose' });

  // Braccia.
  const hands: V3[] = [];
  const arm = (sgn: number, sh: [number, number], el: number, side: string) => {
    const S = add(P, mv(Rt, [0, 0.235 * sgn, 0.4]));
    const ud = mv(rotX(sgn * sh[1]), mv(rotY(-sh[0]), [0, 0, -1]));
    const E = add(S, mv(Rt, mul(ud, B.upperArm)));
    const fd = mv(rotX(sgn * sh[1]), mv(rotY(-(sh[0] + el)), [0, 0, -1]));
    const Hd = add(E, mv(Rt, mul(fd, B.foreArm)));
    cap(S, E, 0.082, gk ? [[1, 'shirt']] : [[0.55, 'shirt'], [0.7, 'trim'], [1, 'skin']], `upper${side}`);
    cap(E, Hd, 0.07, gk ? [[0.82, 'shirt'], [1, 'trim']] : [[1, 'skin']], `fore${side}`);
    prims.push({ k: 'sph', c: G(add(Hd, mv(Rt, mul(fd, 0.03)))), r: gk ? 0.098 : 0.074, role: gk ? 'gloves' : 'skin', id: `hand${side}` });
    hands.push(G(Hd));
  };
  arm(1, p.shL, p.elL, 'L');
  arm(-1, p.shR, p.elR, 'R');

  const numLocal = add(P, mv(Rt, [-0.19, 0, 0.3]));
  return {
    prims,
    headR: GR(Rhead),
    headC: G(Hc),
    numP: G(numLocal),
    numN: mv(GR(Rt), [-1, 0, 0]),
    handL: hands[0],
    handR: hands[1],
  };
}

export const HAIR_STYLES = ['bald', 'buzz', 'short', 'curly', 'mohawk', 'long'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Volumi dei capelli nel sistema della testa (x avanti, z su), poi portati nel mondo. */
export function buildHair(style: HairStyle, R: M3, C: V3): Prim[] {
  const W = (v: V3): V3 => add(C, mv(R, v));
  const N = (v: V3): V3 => vnorm(mv(R, v));
  const out: Prim[] = [];
  switch (style) {
    case 'bald':
      break;
    case 'buzz':
      out.push({ k: 'cut', c: W([0, 0, 0]), r: 0.2, n: N([-0.5, 0, 1]), off: -0.025, role: 'hair', id: 'hair' });
      break;
    case 'short':
      out.push({ k: 'cut', c: W([-0.005, 0, 0.012]), r: 0.214, n: N([-0.45, 0, 1]), off: -0.05, role: 'hair', id: 'hair' });
      out.push({ k: 'cut', c: W([0.02, 0, 0.03]), r: 0.205, n: N([0.2, 0, 1]), off: 0.07, role: 'hair', id: 'fringe' });
      break;
    case 'curly':
      out.push({ k: 'cut', c: W([-0.03, 0, 0.06]), r: 0.26, n: N([-0.65, 0, 1]), off: -0.08, role: 'hair', id: 'hair', bump: 0.018 });
      break;
    case 'mohawk':
      out.push({ k: 'cap', a: W([0.13, 0, 0.15]), b: W([-0.17, 0, 0.11]), r: 0.055, bands: [[1, 'hair']], id: 'hair' });
      out.push({ k: 'cap', a: W([0.06, 0, 0.21]), b: W([-0.1, 0, 0.19]), r: 0.05, bands: [[1, 'hair']], id: 'hair2' });
      break;
    case 'long':
      out.push({ k: 'cut', c: W([-0.005, 0, 0.015]), r: 0.215, n: N([-0.55, 0, 1]), off: -0.06, role: 'hair', id: 'hair' });
      out.push({ k: 'cap', a: W([-0.1, 0, 0.02]), b: W([-0.15, 0, -0.26]), r: 0.11, bands: [[1, 'hair']], id: 'back' });
      for (const s of [1, -1]) {
        out.push({ k: 'cap', a: W([-0.03, s * 0.17, 0.05]), b: W([-0.07, s * 0.16, -0.2]), r: 0.05, bands: [[1, 'hair']], id: `lock${s}` });
      }
      break;
  }
  return out;
}

/** Posizione degli occhi e della bocca sulla testa (sistema della testa). */
export const FACE = {
  eyes: [
    [0.165, 0.07, 0.025],
    [0.165, -0.07, 0.025],
  ] as V3[],
  eyeR: 0.042,
  mouth: [0.17, 0, -0.085] as V3,
};
