// Animazioni: per ognuna, numero di fotogrammi, se è ciclica e la posa di ogni fotogramma.
// Le pose sono angoli in radianti (vedi Pose in rig.ts). Per modificare un movimento basta
// cambiare questi numeri e rilanciare `npm run sprites`.
import { lerpPose, pose, type Pose } from './rig';

export interface AnimDef {
  frames: number;
  loop: boolean;
  /** Fotogrammi al secondo consigliati per le animazioni a tempo (non legate alla corsa). */
  fps: number;
  at: (i: number, n: number) => Pose;
}

const TAU = Math.PI * 2;

/** Interpola una sequenza di pose chiave su n fotogrammi. */
function keys(...ks: Pose[]): (i: number, n: number) => Pose {
  return (i, n) => {
    if (ks.length === 1 || n <= 1) return ks[0];
    const t = (i / (n - 1)) * (ks.length - 1);
    const a = Math.min(ks.length - 2, Math.floor(t));
    return lerpPose(ks[a], ks[a + 1], t - a);
  };
}

function runCycle(amp: number, kneeMax: number, lean: number, arm: number, elbow: number, bob: number) {
  return (i: number, n: number): Pose => {
    const ph = (i / n) * TAU;
    const legPitch = (s: number) => amp * Math.sin(ph + s);
    // Il ginocchio si piega nella fase di richiamo (gamba che torna avanti).
    const knee = (s: number) => 0.18 + kneeMax * (0.5 + 0.5 * Math.cos(ph + s + 0.5)) ** 1.6;
    return pose({
      lean,
      bob: -0.02 + bob * Math.abs(Math.cos(ph)),
      hipL: [legPitch(0), 0.04],
      hipR: [legPitch(Math.PI), 0.04],
      kneeL: knee(0),
      kneeR: knee(Math.PI),
      footL: 0.1 * Math.sin(ph),
      footR: 0.1 * Math.sin(ph + Math.PI),
      shL: [-arm * Math.sin(ph), 0.14],
      shR: [-arm * Math.sin(ph + Math.PI), 0.14],
      elL: elbow,
      elR: elbow,
      twist: -0.12 * Math.sin(ph),
      head: [-0.05, 0.08 * Math.sin(ph)],
    });
  };
}

const crouch = pose({ bob: -0.12, lean: 0.32, hipL: [0.35, 0.12], hipR: [0.35, 0.12], kneeL: 0.75, kneeR: 0.75, footL: 0.3, footR: 0.3 });

// --- Giocatori di movimento ----------------------------------------------------------------

export const FIELD_ANIMS: Record<string, AnimDef> = {
  idle: {
    frames: 4,
    loop: true,
    fps: 4,
    at: (i, n) => {
      const b = Math.sin((i / n) * TAU);
      return pose({ bob: -0.01 + 0.012 * b, lean: 0.05, hipL: [0.05, 0.1], hipR: [-0.02, 0.1], kneeL: 0.15, kneeR: 0.12, shL: [0.1, 0.2 + 0.02 * b], shR: [0.05, 0.2 + 0.02 * b], elL: 0.35, elR: 0.3, head: [-0.03 * b, 0] });
    },
  },
  run: { frames: 8, loop: true, fps: 12, at: runCycle(0.62, 1.0, 0.14, 0.6, 1.25, 0.035) },
  sprint: { frames: 8, loop: true, fps: 14, at: runCycle(0.95, 1.55, 0.34, 0.95, 1.45, 0.055) },
  pass: {
    frames: 5,
    loop: false,
    fps: 16,
    at: keys(
      pose({ lean: 0.1, hipR: [-0.45, 0.05], kneeR: 0.7, kneeL: 0.25, shL: [0.3, 0.45], shR: [-0.2, 0.4], elL: 0.4 }),
      pose({ lean: 0.12, hipR: [0.2, -0.2], kneeR: 0.35, kneeL: 0.3, shL: [0.35, 0.5], shR: [-0.1, 0.45], twist: 0.15 }),
      pose({ lean: 0.15, hipR: [0.65, -0.25], kneeR: 0.12, kneeL: 0.3, shL: [0.2, 0.5], shR: [0.1, 0.45], twist: 0.25 }),
      pose({ lean: 0.12, hipR: [0.85, -0.15], kneeR: 0.3, kneeL: 0.25, shL: [0.1, 0.35], shR: [0.2, 0.35], twist: 0.2 }),
      pose({ lean: 0.08, hipR: [0.2, 0.05], kneeR: 0.3, kneeL: 0.15 }),
    ),
  },
  shoot: {
    frames: 6,
    loop: false,
    fps: 16,
    at: keys(
      pose({ lean: -0.02, hipR: [-0.95, 0.05], kneeR: 1.45, kneeL: 0.35, bob: -0.04, shL: [0.5, 0.75], shR: [-0.7, 0.55], elL: 0.3, twist: -0.25 }),
      pose({ lean: 0.05, hipR: [-0.2, 0.05], kneeR: 1.1, kneeL: 0.35, bob: -0.05, shL: [0.5, 0.8], shR: [-0.5, 0.6], twist: -0.1 }),
      pose({ lean: 0.18, hipR: [0.75, 0.0], kneeR: 0.12, kneeL: 0.3, bob: -0.03, shL: [0.1, 0.9], shR: [0.2, 0.7], twist: 0.2 }),
      pose({ lean: 0.22, hipR: [1.45, 0.0], kneeR: 0.15, kneeL: 0.2, lift: 0.05, shL: [-0.2, 0.85], shR: [0.4, 0.75], twist: 0.3 }),
      pose({ lean: 0.18, hipR: [1.2, 0.0], kneeR: 0.4, kneeL: 0.2, lift: 0.03, shL: [-0.1, 0.6], shR: [0.3, 0.5], twist: 0.25 }),
      pose({ lean: 0.1, hipR: [0.3, 0.05], kneeR: 0.35, kneeL: 0.15 }),
    ),
  },
  tackle: {
    frames: 4,
    loop: false,
    fps: 14,
    at: keys(
      pose({ lean: 0.3, bob: -0.08, hipL: [0.35, 0.1], kneeL: 0.7, hipR: [0.4, 0.05], kneeR: 0.6, shL: [0.3, 0.6], shR: [0.1, 0.6] }),
      pose({ lean: 0.4, bob: -0.16, hipL: [0.45, 0.1], kneeL: 1.0, hipR: [1.15, -0.05], kneeR: 0.08, footR: -0.3, shL: [0.1, 0.8], shR: [0.4, 0.7] }),
      pose({ lean: 0.42, bob: -0.18, hipL: [0.5, 0.1], kneeL: 1.05, hipR: [1.25, -0.1], kneeR: 0.05, footR: -0.3, shL: [0.0, 0.85], shR: [0.5, 0.75] }),
      pose({ lean: 0.25, bob: -0.08, hipL: [0.3, 0.1], kneeL: 0.6, hipR: [0.5, 0.0], kneeR: 0.4, shL: [0.2, 0.5], shR: [0.2, 0.5] }),
    ),
  },
  shoulder: {
    frames: 3,
    loop: false,
    fps: 12,
    at: keys(
      pose({ lean: 0.2, side: 0.15, twist: 0.3, bob: -0.06, hipL: [0.3, 0.2], kneeL: 0.5, hipR: [-0.2, 0.05], kneeR: 0.4, shL: [0.1, 0.15], shR: [0.4, 0.3], elL: 1.6, elR: 1.0 }),
      pose({ lean: 0.25, side: 0.38, twist: 0.45, bob: -0.08, hipL: [0.35, 0.25], kneeL: 0.6, hipR: [-0.25, 0.05], kneeR: 0.4, shL: [0.0, 0.1], shR: [0.5, 0.35], elL: 1.8, elR: 1.0 }),
      pose({ lean: 0.18, side: 0.2, twist: 0.2, bob: -0.05, hipL: [0.2, 0.15], kneeL: 0.4, kneeR: 0.3, elL: 1.2 }),
    ),
  },
  slide: {
    frames: 5,
    loop: false,
    fps: 10,
    at: keys(
      pose({ pitch: -0.55, lift: -0.25, hipR: [1.0, 0.0], kneeR: 0.2, hipL: [0.6, 0.1], kneeL: 1.2, shL: [-0.6, 0.5], shR: [0.5, 0.6] }),
      pose({ pitch: -1.15, lift: -0.62, hipR: [1.05, 0.0], kneeR: 0.0, footR: 0.3, hipL: [0.85, 0.12], kneeL: 1.5, shL: [-1.0, 0.45], elL: 0.1, shR: [0.6, 0.7], head: [0.6, 0] }),
      pose({ pitch: -1.2, lift: -0.65, hipR: [1.08, 0.0], kneeR: 0.0, footR: 0.3, hipL: [0.9, 0.12], kneeL: 1.5, shL: [-1.05, 0.45], elL: 0.1, shR: [0.7, 0.75], head: [0.65, 0] }),
      pose({ pitch: -1.15, lift: -0.62, hipR: [1.0, 0.0], kneeR: 0.1, hipL: [0.85, 0.12], kneeL: 1.4, shL: [-1.0, 0.45], elL: 0.15, shR: [0.6, 0.7], head: [0.55, 0] }),
      pose({ pitch: -0.9, lift: -0.5, hipR: [1.0, 0.05], kneeR: 0.5, hipL: [0.9, 0.12], kneeL: 1.6, shL: [-0.8, 0.5], elL: 0.3, shR: [0.4, 0.5], head: [0.4, 0] }),
    ),
  },
  fall: {
    frames: 6,
    loop: false,
    fps: 12,
    at: keys(
      pose({ lean: 0.4, bob: -0.05, hipL: [0.3, 0.1], kneeL: 0.4, hipR: [-0.4, 0.1], kneeR: 0.6, shL: [0.9, 0.6], shR: [0.7, 0.6], head: [-0.3, 0] }),
      pose({ pitch: 0.55, lean: 0.3, lift: -0.08, hipL: [0.1, 0.12], kneeL: 0.6, hipR: [-0.5, 0.12], kneeR: 0.9, shL: [1.3, 0.5], shR: [1.1, 0.5], head: [-0.4, 0] }),
      pose({ pitch: 1.05, lean: 0.15, lift: -0.35, hipL: [-0.1, 0.12], kneeL: 0.5, hipR: [-0.3, 0.12], kneeR: 0.7, shL: [1.6, 0.4], shR: [1.5, 0.45], head: [-0.6, 0] }),
      pose({ pitch: 1.45, lean: 0.05, lift: -0.68, hipL: [-0.15, 0.12], kneeL: 0.3, hipR: [-0.2, 0.15], kneeR: 0.5, shL: [2.0, 0.5], shR: [1.9, 0.55], elL: 0.4, elR: 0.5, head: [-0.8, 0] }),
      pose({ pitch: 1.52, lift: -0.74, hipL: [-0.05, 0.12], kneeL: 0.25, hipR: [-0.1, 0.15], kneeR: 0.6, shL: [2.3, 0.6], shR: [2.2, 0.55], elL: 0.6, elR: 0.7, head: [-0.85, 0.2] }),
      pose({ pitch: 1.52, lift: -0.74, hipL: [-0.05, 0.12], kneeL: 0.3, hipR: [-0.1, 0.15], kneeR: 0.9, shL: [2.3, 0.65], shR: [2.25, 0.6], elL: 0.7, elR: 0.8, head: [-0.9, -0.2] }),
    ),
  },
  stagger: {
    frames: 4,
    loop: true,
    fps: 10,
    at: (i, n) => {
      const s = Math.sin((i / n) * TAU);
      return pose({ roll: 0.16 * s, lean: 0.1, bob: -0.04, hipL: [0.15 * s, 0.2], hipR: [-0.15 * s, 0.2], kneeL: 0.35, kneeR: 0.35, shL: [0.4 + 0.3 * s, 1.1], shR: [0.4 - 0.3 * s, 1.1], elL: 0.5, elR: 0.5, head: [0.15, 0.2 * s] });
    },
  },
  celebrate: {
    frames: 6,
    loop: true,
    fps: 8,
    at: keys(
      pose({ bob: -0.12, hipL: [0.3, 0.15], hipR: [0.3, 0.15], kneeL: 0.7, kneeR: 0.7, lean: 0.15, shL: [0.3, 1.8], shR: [0.3, 1.8], elL: 1.2, elR: 1.2 }),
      pose({ lift: 0.12, hipL: [0.1, 0.08], hipR: [-0.1, 0.08], kneeL: 0.2, kneeR: 0.3, shL: [0.2, 2.7], shR: [0.2, 2.7], elL: 0.2, elR: 0.2, head: [-0.3, 0] }),
      pose({ lift: 0.26, hipL: [0.4, 0.1], hipR: [-0.2, 0.1], kneeL: 0.9, kneeR: 0.4, footL: 0.4, shL: [0.1, 2.9], shR: [0.1, 2.9], elL: 0.1, elR: 0.1, head: [-0.4, 0] }),
      pose({ lift: 0.16, hipL: [0.2, 0.1], hipR: [0.0, 0.1], kneeL: 0.6, kneeR: 0.4, shL: [0.2, 2.6], shR: [0.2, 2.6], elL: 0.6, elR: 0.6, head: [-0.3, 0] }),
      pose({ bob: -0.06, hipL: [0.2, 0.12], hipR: [0.2, 0.12], kneeL: 0.45, kneeR: 0.45, shL: [0.3, 2.2], shR: [0.3, 2.2], elL: 1.4, elR: 1.4 }),
      pose({ bob: -0.12, hipL: [0.3, 0.15], hipR: [0.3, 0.15], kneeL: 0.7, kneeR: 0.7, lean: 0.15, shL: [0.3, 1.8], shR: [0.3, 1.8], elL: 1.2, elR: 1.2 }),
    ),
  },
  // --- Skill -------------------------------------------------------------------------------
  rabona: {
    frames: 6,
    loop: false,
    fps: 14,
    at: keys(
      pose({ lean: 0.1, twist: -0.25, hipL: [0.1, 0.1], kneeL: 0.3, hipR: [-0.4, -0.35], kneeR: 1.3, shL: [0.3, 0.8], shR: [-0.4, 0.7] }),
      pose({ lean: 0.12, twist: -0.35, hipL: [0.12, 0.1], kneeL: 0.35, hipR: [-0.5, -0.55], kneeR: 1.55, shL: [0.4, 0.9], shR: [-0.5, 0.8] }),
      pose({ lean: 0.15, twist: -0.2, hipL: [0.15, 0.1], kneeL: 0.35, hipR: [0.1, -0.6], kneeR: 0.9, shL: [0.3, 0.9], shR: [-0.2, 0.8] }),
      pose({ lean: 0.18, twist: 0.05, hipL: [0.15, 0.1], kneeL: 0.3, hipR: [0.55, -0.55], kneeR: 0.4, shL: [0.1, 0.9], shR: [0.2, 0.8] }),
      pose({ lean: 0.15, twist: 0.15, hipL: [0.1, 0.1], kneeL: 0.25, hipR: [0.75, -0.4], kneeR: 0.35, shL: [0.0, 0.7], shR: [0.3, 0.6] }),
      pose({ lean: 0.08, hipR: [0.2, 0.0], kneeR: 0.3, kneeL: 0.15 }),
    ),
  },
  veronica: {
    frames: 8,
    loop: false,
    fps: 16,
    // Giravolta completa sulla palla: il corpo ruota di 360°.
    at: (i, n) => ({ ...crouch, yaw: -(i / n) * TAU, hipR: [0.25, 0.1], kneeR: 0.5, shL: [0.3, 0.9], shR: [0.3, 0.9], elL: 0.5, elR: 0.5 }),
  },
  elastico: {
    frames: 5,
    loop: false,
    fps: 14,
    at: keys(
      pose({ lean: 0.2, bob: -0.05, hipL: [0.1, 0.12], kneeL: 0.4, hipR: [0.3, 0.1], kneeR: 0.35, shL: [0.2, 0.6], shR: [0.2, 0.6] }),
      pose({ lean: 0.22, roll: 0.1, bob: -0.06, hipL: [0.1, 0.12], kneeL: 0.45, hipR: [0.35, 0.5], kneeR: 0.25, footR: 0.2, shL: [0.2, 0.9], shR: [0.1, 0.5] }),
      pose({ lean: 0.22, roll: -0.05, bob: -0.06, hipL: [0.1, 0.12], kneeL: 0.45, hipR: [0.35, -0.45], kneeR: 0.25, shL: [0.1, 0.5], shR: [0.2, 0.9] }),
      pose({ lean: 0.25, roll: -0.18, side: -0.15, bob: -0.04, hipL: [0.3, 0.3], kneeL: 0.5, hipR: [-0.2, -0.1], kneeR: 0.6, shL: [0.0, 0.7], shR: [0.4, 0.9] }),
      pose({ lean: 0.2, roll: -0.08, hipL: [0.3, 0.15], kneeL: 0.4, hipR: [-0.1, 0.05], kneeR: 0.5 }),
    ),
  },
  sombrero: {
    frames: 5,
    loop: false,
    fps: 12,
    at: keys(
      pose({ lean: 0.15, hipL: [0.1, 0.1], kneeL: 0.4, hipR: [0.2, 0.05], kneeR: 0.4, shL: [0.3, 0.6], shR: [0.3, 0.6] }),
      pose({ lean: 0.2, hipL: [0.15, 0.1], kneeL: 0.5, hipR: [-0.55, 0.05], kneeR: 1.9, footR: 0.4, shL: [0.5, 1.0], shR: [0.4, 1.0] }),
      pose({ lean: 0.1, lift: 0.08, hipL: [0.1, 0.1], kneeL: 0.3, hipR: [-0.35, 0.05], kneeR: 1.6, shL: [0.3, 1.2], shR: [0.3, 1.2], head: [-0.4, 0] }),
      pose({ lean: 0.2, lift: 0.04, hipL: [0.4, 0.1], kneeL: 0.6, hipR: [-0.3, 0.05], kneeR: 0.7, shL: [-0.3, 0.6], shR: [0.4, 0.6], head: [-0.3, 0] }),
      pose({ lean: 0.25, hipL: [0.4, 0.05], kneeL: 0.7, hipR: [-0.4, 0.05], kneeR: 0.8, shL: [-0.4, 0.2], shR: [0.4, 0.2], elL: 1.2, elR: 1.2 }),
    ),
  },
  tunnel: {
    frames: 4,
    loop: false,
    fps: 12,
    at: keys(
      pose({ lean: 0.3, bob: -0.08, hipL: [0.2, 0.12], kneeL: 0.7, hipR: [0.3, 0.05], kneeR: 0.5, shL: [0.3, 0.6], shR: [0.2, 0.6] }),
      pose({ lean: 0.38, bob: -0.12, hipL: [0.25, 0.12], kneeL: 0.85, hipR: [0.85, -0.05], kneeR: 0.2, footR: -0.2, shL: [0.0, 0.7], shR: [0.4, 0.6] }),
      pose({ lean: 0.35, bob: -0.1, side: 0.15, hipL: [-0.3, 0.12], kneeL: 0.9, hipR: [0.6, 0.2], kneeR: 0.5, shL: [-0.4, 0.5], shR: [0.6, 0.6], elL: 1.3, elR: 1.3 }),
      pose({ lean: 0.3, bob: -0.04, hipL: [0.5, 0.05], kneeL: 1.0, hipR: [-0.5, 0.05], kneeR: 0.6, shL: [-0.6, 0.2], shR: [0.6, 0.2], elL: 1.4, elR: 1.4 }),
    ),
  },
  feint: {
    frames: 4,
    loop: false,
    fps: 12,
    at: keys(
      pose({ lean: 0.15, roll: -0.18, side: -0.15, bob: -0.06, hipL: [0.05, 0.05], kneeL: 0.6, hipR: [0.05, 0.35], kneeR: 0.3, shL: [0.2, 0.4], shR: [0.1, 0.9] }),
      pose({ lean: 0.18, roll: -0.25, side: -0.2, bob: -0.08, hipL: [0.05, 0.0], kneeL: 0.7, hipR: [0.1, 0.45], kneeR: 0.3, shL: [0.2, 0.3], shR: [0.1, 1.1] }),
      pose({ lean: 0.18, roll: 0.2, side: 0.2, bob: -0.06, hipL: [0.15, 0.4], kneeL: 0.3, hipR: [0.0, 0.05], kneeR: 0.6, shL: [0.1, 1.0], shR: [0.2, 0.3] }),
      pose({ lean: 0.15, roll: 0.08, hipL: [0.3, 0.15], kneeL: 0.4, hipR: [-0.2, 0.05], kneeR: 0.5 }),
    ),
  },
};

// --- Portiere (guanti, maniche lunghe) -------------------------------------------------------

const ready = (b: number) =>
  pose({ bob: -0.13 + b, lean: 0.35, hipL: [0.38, 0.2], hipR: [0.38, 0.2], kneeL: 0.8, kneeR: 0.8, footL: 0.35, footR: 0.35, shL: [0.95, 0.45], shR: [0.95, 0.45], elL: 0.45, elR: 0.45, head: [-0.25, 0] });

function dive(dir: 1 | -1): AnimDef {
  // dir 1 = tuffo alla propria destra (roll positivo), -1 = sinistra.
  const arms = (a: number) => ({ shL: [0.35, 2.85] as [number, number], shR: [0.35, 2.85] as [number, number], elL: a, elR: a });
  return {
    frames: 6,
    loop: false,
    fps: 10,
    at: keys(
      pose({ ...ready(0), roll: 0.25 * dir, lean: 0.3, ...arms(0.5), hipL: [0.3, 0.3], hipR: [0.3, 0.3] }),
      pose({ roll: 0.85 * dir, lift: 0.08, lean: 0.1, ...arms(0.2), hipL: [0.1, 0.25], hipR: [0.15, 0.1], kneeL: 0.5, kneeR: 0.2 }),
      pose({ roll: 1.3 * dir, lift: 0.04, ...arms(0.1), hipL: [0.05, 0.25], hipR: [0.1, 0.1], kneeL: 0.6, kneeR: 0.25 }),
      pose({ roll: 1.45 * dir, lift: -0.22, ...arms(0.1), hipL: [0.0, 0.2], hipR: [0.1, 0.1], kneeL: 0.6, kneeR: 0.3 }),
      pose({ roll: 1.52 * dir, lift: -0.55, ...arms(0.3), hipL: [0.0, 0.15], hipR: [0.1, 0.1], kneeL: 0.7, kneeR: 0.4 }),
      pose({ roll: 1.55 * dir, lift: -0.72, ...arms(0.5), hipL: [0.2, 0.1], hipR: [0.3, 0.1], kneeL: 1.0, kneeR: 0.8, head: [0.2, 0] }),
    ),
  };
}

export const GK_ANIMS: Record<string, AnimDef> = {
  idle: FIELD_ANIMS.idle,
  ready: { frames: 4, loop: true, fps: 6, at: (i, n) => ready(0.02 * Math.sin((i / n) * TAU)) },
  run: FIELD_ANIMS.run,
  pass: FIELD_ANIMS.pass,
  shoot: FIELD_ANIMS.shoot,
  diveL: dive(-1),
  diveR: dive(1),
  save: {
    frames: 4,
    loop: false,
    fps: 12,
    at: keys(
      ready(0),
      pose({ lean: 0.1, lift: 0.08, hipL: [0.2, 0.15], hipR: [0.1, 0.15], kneeL: 0.5, kneeR: 0.3, shL: [2.3, 0.35], shR: [2.3, 0.35], elL: 0.35, elR: 0.35, head: [-0.4, 0] }),
      pose({ lean: 0.15, lift: 0.03, hipL: [0.2, 0.15], hipR: [0.15, 0.15], kneeL: 0.5, kneeR: 0.4, shL: [1.6, 0.3], shR: [1.6, 0.3], elL: 0.9, elR: 0.9, head: [-0.1, 0] }),
      pose({ lean: 0.12, hipL: [0.1, 0.12], hipR: [0.1, 0.12], kneeL: 0.3, kneeR: 0.3, shL: [0.9, 0.18], shR: [0.9, 0.18], elL: 1.45, elR: 1.45 }),
    ),
  },
  hold: {
    frames: 2,
    loop: true,
    fps: 3,
    at: (i) => pose({ bob: -0.01 * i, lean: 0.08, hipL: [0.05, 0.1], hipR: [0.0, 0.1], kneeL: 0.15, kneeR: 0.12, shL: [0.9, 0.18], shR: [0.9, 0.18], elL: 1.45, elR: 1.45 }),
  },
  fall: FIELD_ANIMS.fall,
  celebrate: FIELD_ANIMS.celebrate,
};

export const SETS: Record<'field' | 'gk', Record<string, AnimDef>> = { field: FIELD_ANIMS, gk: GK_ANIMS };
