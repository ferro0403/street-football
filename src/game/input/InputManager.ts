// Unisce tastiera, controller (Gamepad API) e comandi touch in azioni con nome (skill input-systems).
// Produce input "di schermo" (destra = +x, giù = +y); la scena li converte nel mondo isometrico.
import Phaser from 'phaser';
import { PAD, hub, radialDeadzone } from './gamepad';
export { PAD, radialDeadzone, setPadMessageHandler } from './gamepad';

export interface ScreenInput {
  sx: number;
  sy: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  tackle: boolean;
  slide: boolean;
  shield: boolean;
  switch: boolean;
  pause: boolean;
  debug: boolean;
}

export type TouchKey = 'pass' | 'shoot' | 'sprint' | 'tackle' | 'slide';

/** Stato scritto dai comandi touch (HudScene, a eventi: nessun ritardo) e letto qui. */
export const touchState = {
  sx: 0,
  sy: 0,
  pass: false,
  shoot: false,
  sprint: false,
  tackle: false,
  slide: false,
  pause: false,
};
/** Tocchi rapidissimi (giù e su prima del fotogramma successivo): non vanno persi. */
export const touchLatch = new Set<TouchKey>();

export type Device = 'keyboard' | 'gamepad' | 'touch';

export class InputManager {
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private latched = new Set<string>();
  private enterKey: Phaser.Input.Keyboard.Key | null = null;
  lastDevice: Device = 'keyboard';

  constructor(scene: Phaser.Scene) {
    hub.init();
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
        // Mano destra: J passa, K tira, L contrasto, U scivolata, I protegge palla.
        pass: K.J,
        shoot: K.K,
        tackle: K.L,
        slide: K.U,
        shield: K.I,
        sprint: K.SHIFT,
        sprint2: K.SPACE,
        switch: K.Q,
        pause: K.ESC,
        pause2: K.P,
        debug: K.F2,
        // Alternativa per chi muove con le frecce: Z X C V.
        pass2: K.Z,
        shoot2: K.X,
        tackle2: K.C,
        slide2: K.V,
        shield2: K.B,
      };
      for (const [name, code] of Object.entries(map)) {
        const key = kb.addKey(code, true, false);
        this.keys[name] = key;
        key.on('down', () => {
          this.latched.add(name);
          this.lastDevice = 'keyboard';
        });
      }
      // Se la finestra perde il fuoco, nessun tasto resta "premuto".
      scene.game.events.on(Phaser.Core.Events.BLUR, () => kb.resetKeys());
    }
  }

  private down(...names: string[]): boolean {
    return names.some((n) => this.keys[n]?.isDown || this.latched.has(n));
  }

  read(): ScreenInput {
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
      tackle: this.down('tackle', 'tackle2'),
      slide: this.down('slide', 'slide2'),
      shield: this.down('shield', 'shield2'),
      switch: this.down('switch'),
      pause: this.down('pause', 'pause2'),
      debug: this.down('debug'),
    };

    // Controller (solo quello attivo, calibrato).
    const pad = hub.poll();
    if (pad) {
      const { gp, cal } = pad;
      const b = (i: number) => {
        const btn = gp.buttons[i];
        return !!btn && cal.released[i] && (btn.pressed || btn.value > 0.5);
      };
      const ax = (i: number) => (cal.centered[i] ? (gp.axes[i] ?? 0) : 0);
      let [px, py] = radialDeadzone(ax(0), ax(1));
      if (cal.standard) {
        const dx = (b(PAD.RIGHT) ? 1 : 0) - (b(PAD.LEFT) ? 1 : 0);
        const dy = (b(PAD.DOWN) ? 1 : 0) - (b(PAD.UP) ? 1 : 0);
        if (dx || dy) {
          const l = Math.hypot(dx, dy);
          px = dx / l;
          py = dy / l;
        }
      }
      if (px !== 0 || py !== 0) {
        out.sx = px;
        out.sy = py;
        this.lastDevice = 'gamepad';
      }
      out.pass ||= b(PAD.A);
      out.shoot ||= b(PAD.B);
      out.tackle ||= b(PAD.X);
      out.slide ||= b(PAD.Y);
      out.shield ||= b(PAD.LT);
      out.switch ||= b(PAD.LB);
      out.sprint ||= b(PAD.RT) || b(PAD.RB) || b(PAD.L3);
      out.pause ||= b(PAD.START);
      if (out.pass || out.shoot || out.tackle || out.slide) this.lastDevice = 'gamepad';
    }

    // Touch.
    const t = touchState;
    if (t.sx !== 0 || t.sy !== 0) {
      out.sx = t.sx;
      out.sy = t.sy;
    }
    out.sprint ||= t.sprint || touchLatch.has('sprint');
    out.pass ||= t.pass || touchLatch.has('pass');
    out.shoot ||= t.shoot || touchLatch.has('shoot');
    out.tackle ||= t.tackle || touchLatch.has('tackle');
    out.slide ||= t.slide || touchLatch.has('slide');
    // Il pulsante CONTRASTO con la palla diventa PROTEGGI (tenuto premuto).
    out.shield ||= t.tackle;
    out.pause ||= t.pause;
    touchLatch.clear();
    this.latched.clear();
    return out;
  }

  /** Input per i menu: frecce/levetta/croce, conferma, indietro. */
  menu(): { x: number; y: number; ok: boolean; back: boolean } {
    const kbOk = this.down('pass', 'pass2') || !!this.enterKey?.isDown || this.latched.has('enter');
    const kbBack = this.down('pause', 'pause2');
    let padOk = false;
    let padBack = false;
    const pad = hub.poll();
    if (pad) {
      const { gp, cal } = pad;
      const b = (i: number) => !!gp.buttons[i] && cal.released[i] && gp.buttons[i].pressed;
      padOk = b(PAD.A) || b(PAD.START);
      padBack = b(PAD.B);
    }
    const r = this.read();
    return {
      x: Math.abs(r.sx) > 0.5 ? Math.sign(r.sx) : 0,
      y: Math.abs(r.sy) > 0.5 ? Math.sign(r.sy) : 0,
      ok: kbOk || padOk,
      back: kbBack || padBack,
    };
  }

  bindEnter(scene: Phaser.Scene): void {
    this.enterKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER, true, false) ?? null;
    this.enterKey?.on('down', () => this.latched.add('enter'));
  }
}

/** Vero sui dispositivi con touch come input principale (telefoni, tablet). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
