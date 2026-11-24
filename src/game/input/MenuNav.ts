// Navigazione dei menu con tastiera/controller: fronti di salita e ripetizione tenendo premuto.
import type { InputManager } from './InputManager';

export interface NavEvents {
  dx: number;
  dy: number;
  ok: boolean;
  back: boolean;
}

export class MenuNav {
  private prev = { x: 0, y: 0, ok: true, back: true }; // true: ignora il tasto ancora premuto all'ingresso
  private repeat = 0;

  constructor(private input: InputManager) {}

  update(dtMs: number): NavEvents {
    const m = this.input.menu();
    const ev: NavEvents = { dx: 0, dy: 0, ok: m.ok && !this.prev.ok, back: m.back && !this.prev.back };
    if (m.x !== this.prev.x || m.y !== this.prev.y) {
      ev.dx = m.x;
      ev.dy = m.y;
      this.repeat = 380;
    } else if (m.x || m.y) {
      this.repeat -= dtMs;
      if (this.repeat <= 0) {
        ev.dx = m.x;
        ev.dy = m.y;
        this.repeat = 140;
      }
    }
    this.prev = { x: m.x, y: m.y, ok: m.ok, back: m.back };
    return ev;
  }
}
