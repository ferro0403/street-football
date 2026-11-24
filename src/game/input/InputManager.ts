// Unisce tastiera, controller (Gamepad API) e comandi touch in azioni con nome.
// Produce input "di schermo" (destra = +x, giù = +y); la scena li converte nel mondo isometrico.
import Phaser from 'phaser';

export interface ScreenInput {
  sx: number;
  sy: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  feint: boolean;
  skill: boolean;
  switch: boolean;
  pause: boolean;
}

/** Stato scritto dai comandi touch (HudScene) e letto qui. */
export const touchState = {
  sx: 0,
  sy: 0,
  sprint: false,
  pass: false,
  shoot: false,
  feint: false,
  skill: false,
  pause: false,
};

export type Device = 'keyboard' | 'gamepad' | 'touch';

const DEADZONE = 0.22;

/** Deadzone radiale con riscalatura (skill input-systems): niente drift, diagonali piene. */
export function radialDeadzone(x: number, y: number, dead = DEADZONE): [number, number] {
  const m = Math.sqrt(x * x + y * y);
  if (m <= dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

// Mappatura "standard" della Gamepad API (Xbox / PlayStation).
const PAD = {
  A: 0, // A / Croce → passaggio
  B: 1, // B / Cerchio → tiro / contrasto
  X: 2, // X / Quadrato → finta
  Y: 3, // Y / Triangolo → skill
  LB: 4, // cambio giocatore
  RB: 5, // scatto
  LT: 6,
  RT: 7, // scatto
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

export class InputManager {
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private latched = new Set<string>();
  lastDevice: Device = 'keyboard';

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      const map: Record<string, number> = {
        w: K.W,
        a: K.A,
        s: K.S,
        d: K.D,
        up: K.UP,
        down: K.DOWN,
        left: K.LEFT,
        right: K.RIGHT,
        pass: K.J,
        shoot: K.K,
        feint: K.L,
        skill: K.I,
        sprint: K.SHIFT,
        sprint2: K.SPACE,
        switch: K.Q,
        pause: K.ESC,
        pause2: K.P,
        // Alternativa per chi gioca con le frecce: Z/X/C/V.
        pass2: K.Z,
        shoot2: K.X,
        feint2: K.C,
        skill2: K.V,
      };
      for (const [name, code] of Object.entries(map)) {
        const key = kb.addKey(code, true, false);
        this.keys[name] = key;
        // Un tocco rapidissimo (giù e su nello stesso fotogramma) non deve andare perso.
        key.on('down', () => this.latched.add(name));
      }
      kb.on('keydown', () => (this.lastDevice = 'keyboard'));
    }
  }

  private down(...names: string[]): boolean {
    return names.some((n) => this.keys[n]?.isDown || this.latched.has(n));
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  read(): ScreenInput {
    // Tastiera.
    let sx = (this.down('d', 'right') ? 1 : 0) - (this.down('a', 'left') ? 1 : 0);
    let sy = (this.down('s', 'down') ? 1 : 0) - (this.down('w', 'up') ? 1 : 0);
    if (sx !== 0 && sy !== 0) {
      sx *= Math.SQRT1_2;
      sy *= Math.SQRT1_2;
    }
    const out: ScreenInput = {
      sx,
      sy,
      sprint: this.down('sprint', 'sprint2'),
      pass: this.down('pass', 'pass2'),
      shoot: this.down('shoot', 'shoot2'),
      feint: this.down('feint', 'feint2'),
      skill: this.down('skill', 'skill2'),
      switch: this.down('switch'),
      pause: this.down('pause', 'pause2'),
    };

    // Controller.
    const p = this.pad();
    if (p) {
      const b = (i: number) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4);
      let [px, py] = radialDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0);
      const dx = (b(PAD.RIGHT) ? 1 : 0) - (b(PAD.LEFT) ? 1 : 0);
      const dy = (b(PAD.DOWN) ? 1 : 0) - (b(PAD.UP) ? 1 : 0);
      if (dx || dy) {
        const l = Math.hypot(dx, dy);
        px = dx / l;
        py = dy / l;
      }
      const any = px !== 0 || py !== 0 || p.buttons.some((x) => x.pressed);
      if (any) this.lastDevice = 'gamepad';
      if (px !== 0 || py !== 0) {
        out.sx = px;
        out.sy = py;
      }
      out.pass ||= b(PAD.A);
      out.shoot ||= b(PAD.B);
      out.feint ||= b(PAD.X);
      out.skill ||= b(PAD.Y);
      out.switch ||= b(PAD.LB);
      out.sprint ||= b(PAD.RB) || b(PAD.RT) || b(PAD.LT);
      out.pause ||= b(PAD.START);
    }

    // Touch.
    const t = touchState;
    if (t.sx !== 0 || t.sy !== 0) {
      out.sx = t.sx;
      out.sy = t.sy;
    }
    out.sprint ||= t.sprint;
    out.pass ||= t.pass;
    out.shoot ||= t.shoot;
    out.feint ||= t.feint;
    out.skill ||= t.skill;
    out.pause ||= t.pause;
    this.latched.clear();
    return out;
  }

  /** Input per i menu: frecce/levetta/croce, conferma, indietro. */
  menu(): { x: number; y: number; ok: boolean; back: boolean } {
    const kbOk = this.down('pass', 'pass2') || this.keyEnter();
    const kbBack = this.down('pause', 'pause2');
    const r = this.read();
    return {
      x: Math.abs(r.sx) > 0.5 ? Math.sign(r.sx) : 0,
      y: Math.abs(r.sy) > 0.5 ? Math.sign(r.sy) : 0,
      ok: kbOk || (this.pad()?.buttons[PAD.A]?.pressed ?? false) || (this.pad()?.buttons[PAD.START]?.pressed ?? false),
      back: kbBack || (this.pad()?.buttons[PAD.B]?.pressed ?? false),
    };
  }

  private enterKey: Phaser.Input.Keyboard.Key | null = null;
  bindEnter(scene: Phaser.Scene): void {
    this.enterKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER, true, false) ?? null;
    this.enterKey?.on('down', () => this.latched.add('enter'));
  }
  private keyEnter(): boolean {
    return !!this.enterKey?.isDown || this.latched.has('enter');
  }
}

/** Vero sui dispositivi con touch come input principale (telefoni, tablet). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
