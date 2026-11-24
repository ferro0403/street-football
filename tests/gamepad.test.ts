// Calibrazione del controller: le cause tipiche del "si muove da solo".
import { beforeEach, describe, expect, it } from 'vitest';
import { GamepadHub, radialDeadzone } from '../src/game/input/gamepad';

type FakePad = { index: number; id: string; connected: boolean; mapping: string; axes: number[]; buttons: { pressed: boolean; value: number }[] };
let pads: (FakePad | null)[] = [];

function pad(index: number, axes: number[], pressed: number[] = [], mapping = 'standard'): FakePad {
  return {
    index,
    id: `Pad ${index}`,
    connected: true,
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
  };
}

beforeEach(() => {
  pads = [];
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
});

describe('controller', () => {
  it('deadzone radiale: il drift piccolo è zero, le diagonali restano piene', () => {
    expect(radialDeadzone(0.2, 0.1)).toEqual([0, 0]);
    expect(radialDeadzone(NaN, 0)).toEqual([0, 0]);
    const [x, y] = radialDeadzone(0.7071, 0.7071);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 2);
  });

  it('un controller collegato ma mai toccato non muove nessuno', () => {
    const h = new GamepadHub();
    pads = [pad(0, [0.3, -0.4, 0, 0])]; // levetta con drift forte
    for (let i = 0; i < 10; i++) expect(h.poll()).toBeNull();
  });

  it('un asse che a riposo vale -1 (grilletto letto come asse) viene ignorato', () => {
    const h = new GamepadHub();
    // axes[1] bloccato a -1: mai visto al centro → non deve contare.
    pads = [pad(0, [0, -1, 0, 0])];
    h.poll();
    pads = [pad(0, [0, -1, 0, 0], [0])]; // preme A: diventa attivo
    h.poll(); // A è stato visto premuto ma mai rilasciato prima: non attiva
    pads = [pad(0, [0, -1, 0, 0])];
    h.poll();
    pads = [pad(0, [0, -1, 0, 0], [0])];
    const r = h.poll();
    expect(r).not.toBeNull();
    expect(r!.cal.centered[1]).toBe(false);
  });

  it('un tasto già premuto al collegamento non conta finché non viene rilasciato', () => {
    const h = new GamepadHub();
    pads = [pad(0, [0, 0, 0, 0], [7])]; // RT bloccato
    const r = h.poll();
    expect(r).toBeNull();
  });

  it('con due controller vale quello usato per ultimo', () => {
    const h = new GamepadHub();
    pads = [pad(0, [0, 0]), pad(1, [0, 0])];
    h.poll();
    pads = [pad(0, [0, 0]), pad(1, [0.9, 0])];
    expect(h.poll()!.gp.index).toBe(1);
    pads = [pad(0, [0, 0], [0]), pad(1, [0, 0])];
    expect(h.poll()!.gp.index).toBe(0);
  });

  it('controller scollegato: nessun input residuo', () => {
    const h = new GamepadHub();
    pads = [pad(0, [0, 0])];
    h.poll();
    pads = [pad(0, [0.9, 0])];
    expect(h.poll()).not.toBeNull();
    pads = [null];
    expect(h.poll()).toBeNull();
  });
});
