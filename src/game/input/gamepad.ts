// Lettura calibrata dei controller (Gamepad API), senza Phaser: testabile in Node.
const STICK_DEADZONE = 0.25;
const CENTER_GATE = 0.15;

/** Deadzone radiale con riscalatura: niente drift, diagonali piene. */
export function radialDeadzone(x: number, y: number, dead = STICK_DEADZONE): [number, number] {
  const m = Math.sqrt(x * x + y * y);
  if (!(m > dead)) return [0, 0]; // gestisce anche NaN
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

// Mappatura "standard" della Gamepad API (Xbox / PlayStation), stile FIFA.
export const PAD = {
  A: 0, // A / Croce → passaggio (senza palla: cambio)
  B: 1, // B / Cerchio → tiro (senza palla: contrasto)
  X: 2, // X / Quadrato → lancio alto (senza palla: scivolata)
  Y: 3, // Y / Triangolo → filtrante
  LB: 4, // cambio giocatore
  RB: 5, // skill
  LT: 6, // finta
  RT: 7, // scatto
  SELECT: 8,
  START: 9,
  L3: 10,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

interface PadCal {
  /** Asse visto almeno una volta al centro: solo allora lo leggiamo (niente grilletti a -1). */
  centered: boolean[];
  /** Tasto visto almeno una volta rilasciato: solo allora conta (niente tasti "bloccati"). */
  released: boolean[];
  lastActive: number;
  standard: boolean;
}

/**
 * Calibrazione dei controller, condivisa da tutte le scene.
 * Cause del "si muove da solo" che risolve:
 * - grilletti o leve esposti come assi che a riposo valgono -1/+1 → ignorati finché non centrati;
 * - più controller (o uno virtuale) → vale quello toccato per ultimo, gli altri sono ignorati;
 * - drift della levetta → deadzone radiale 0,25;
 * - controller scollegato → stato azzerato.
 */
export class GamepadHub {
  private cal = new Map<number, PadCal>();
  private active = -1;
  private listeners = false;

  init(): void {
    if (this.listeners || typeof window === 'undefined') return;
    this.listeners = true;
    window.addEventListener('gamepadconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.cal.delete(gp.index);
      const name = gp.id.replace(/\(.*?\)/g, '').trim().slice(0, 36) || 'Controller';
      const std = gp.mapping === 'standard';
      onPadMessage(`🎮 ${name} collegato${std ? '' : ' (tasti non standard)'}\nPremi un tasto per usarlo`);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.cal.delete(gp.index);
      if (this.active === gp.index) this.active = -1;
      onPadMessage('🎮 Controller scollegato');
    });
  }

  private calFor(gp: Gamepad): PadCal {
    let c = this.cal.get(gp.index);
    if (!c) {
      c = { centered: gp.axes.map(() => false), released: gp.buttons.map(() => false), lastActive: 0, standard: gp.mapping === 'standard' };
      this.cal.set(gp.index, c);
    }
    return c;
  }

  /** Aggiorna la calibrazione e restituisce il controller attivo (o null). */
  poll(): { gp: Gamepad; cal: PadCal } | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const c = this.calFor(gp);
      let activity = false;
      gp.axes.forEach((v, i) => {
        if (Math.abs(v) < CENTER_GATE) c.centered[i] = true;
        else if (c.centered[i] && Math.abs(v) > 0.6 && i < 2) activity = true;
      });
      gp.buttons.forEach((b, i) => {
        const down = b.pressed || b.value > 0.5;
        if (!down) c.released[i] = true;
        else if (c.released[i]) activity = true;
      });
      if (activity) {
        c.lastActive = now;
        this.active = gp.index;
      }
    }
    if (this.active < 0) return null;
    const gp = pads[this.active];
    if (!gp || !gp.connected) {
      this.active = -1;
      return null;
    }
    return { gp, cal: this.calFor(gp) };
  }
}

export const hub = new GamepadHub();

let padMessageHandler: (msg: string) => void = () => undefined;
function onPadMessage(msg: string): void {
  padMessageHandler(msg);
}
export function setPadMessageHandler(fn: (msg: string) => void): void {
  padMessageHandler = fn;
  hub.init();
}

