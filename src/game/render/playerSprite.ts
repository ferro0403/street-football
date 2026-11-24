// Giocatore disegnato con gli sprite sheet a livelli (scripts/sprites/generate.ts).
// Ogni livello è in scala di grigi e viene tinto: pelle, maglia, bordi, pantaloncini,
// calzettoni, scarpe, guanti, capelli (un livello per taglio). Il numero di maglia è disegnato
// sopra, nel punto calcolato per ogni fotogramma. Una sola texture serve tutti i giocatori.
import Phaser from 'phaser';
import type { Kit, PlayerLook } from '../../shared/types';
import { DIGIT_W } from './textures';

export interface SpriteMeta {
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  dirs: number;
  sets: Record<string, Record<string, { frames: number; loop: boolean; fps: number }>>;
  numbers: Record<string, [number, number]>;
}

export interface PlayerAppearance {
  look: PlayerLook;
  kit: Kit;
  number: number;
  gk: boolean;
}

const BODY_LAYERS = ['skin', 'socks', 'shoes', 'shorts', 'shirt', 'trim', 'gloves', 'fixed'] as const;

/** Direzione sullo schermo (8) da un vettore schermo. 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW. */
export function dir8(sx: number, sy: number): number {
  const k = Math.round(Math.atan2(sy, sx) / (Math.PI / 4));
  const m = ((k % 8) + 8) % 8; // 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE
  return [2, 1, 0, 7, 6, 5, 4, 3][m];
}

/** Luminanza percepita: per scegliere un numero leggibile sulla maglia. */
function lum(c: number): number {
  return (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
}

export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private layers: Phaser.GameObjects.Image[] = [];
  private names: string[] = [];
  private digits: Phaser.GameObjects.Image[] = [];
  private set: 'field' | 'gk';
  private meta: SpriteMeta;
  anim = 'idle';
  frame = 0;
  dir = 0;
  /** Ingrandimento (es. anteprime nei menu). */
  scaleK = 1;

  constructor(scene: Phaser.Scene, app: PlayerAppearance) {
    this.meta = scene.cache.json.get('players-meta') as SpriteMeta;
    this.set = app.gk ? 'gk' : 'field';
    this.container = scene.add.container(0, 0);
    const ox = this.meta.anchorX / this.meta.frameW;
    const oy = this.meta.anchorY / this.meta.frameH;
    const { look, kit } = app;
    const tints: Record<string, number> = {
      skin: look.skin,
      socks: kit.socks,
      shoes: look.boots,
      shorts: kit.shorts,
      shirt: kit.shirt,
      trim: kit.trim,
      gloves: kit.trim === kit.shirt ? 0xffffff : kit.trim,
    };
    const layers: string[] = BODY_LAYERS.filter((l) => l !== 'gloves' || app.gk);
    if (look.hairStyle !== 'bald') layers.push(`hair_${look.hairStyle}`);
    for (const L of layers) {
      const img = scene.add.image(0, 0, 'players', `${L}/${this.set}_idle_0_0`).setOrigin(ox, oy);
      if (L.startsWith('hair_')) img.setTint(look.hair);
      else if (tints[L] !== undefined) img.setTint(tints[L]);
      this.layers.push(img);
      this.names.push(L);
    }
    this.container.add(this.layers);

    // Numero di maglia: colore del bordo se si legge, altrimenti bianco o nero.
    let numColor = kit.trim;
    if (Math.abs(lum(kit.trim) - lum(kit.shirt)) < 0.3) numColor = lum(kit.shirt) > 0.55 ? 0x141018 : 0xffffff;
    for (const ch of String(app.number).slice(0, 2)) {
      const d = scene.add.image(0, 0, 'digits', ch).setTint(numColor).setOrigin(0.5, 0.5);
      this.digits.push(d);
    }
    this.container.add(this.digits);
  }

  get frames(): Record<string, { frames: number; loop: boolean; fps: number }> {
    return this.meta.sets[this.set];
  }

  has(anim: string): boolean {
    return !!this.meta.sets[this.set][anim];
  }

  /** Mostra un fotogramma. dir: 0..7 (sullo schermo). */
  show(anim: string, frame: number, dir: number): void {
    if (!this.has(anim)) anim = 'idle';
    const n = this.meta.sets[this.set][anim].frames;
    frame = Phaser.Math.Clamp(Math.floor(frame), 0, n - 1);
    if (anim === this.anim && frame === this.frame && dir === this.dir) return;
    this.anim = anim;
    this.frame = frame;
    this.dir = dir;
    const mirror = dir >= 5;
    const d5 = mirror ? 8 - dir : dir;
    const id = `${this.set}_${anim}_${d5}_${frame}`;
    for (let i = 0; i < this.layers.length; i++) this.layers[i].setFrame(`${this.names[i]}/${id}`, true, true);
    this.container.setScale((mirror ? -1 : 1) * this.scaleK, this.scaleK);

    const np = this.meta.numbers[id];
    const visible = !!np;
    const total = this.digits.length * (DIGIT_W - 1);
    this.digits.forEach((dg, i) => {
      dg.setVisible(visible);
      if (!np) return;
      const x = np[0] - this.meta.anchorX - total / 2 + (DIGIT_W - 1) * (i + 0.5);
      dg.setPosition(x, np[1] - this.meta.anchorY);
      // Doppio specchio: la cifra resta leggibile anche quando il corpo è girato.
      dg.setScale(mirror ? -1 : 1, 1);
    });
    if (mirror) {
      // Con il contenitore specchiato le cifre vanno anche in ordine inverso.
      this.digits.forEach((dg, i) => {
        if (!np) return;
        const j = this.digits.length - 1 - i;
        dg.setX(np[0] - this.meta.anchorX - total / 2 + (DIGIT_W - 1) * (j + 0.5));
      });
    }
  }

  /** Copia "fantasma" del fotogramma attuale, tutta di un colore (scia delle skill). */
  ghost(tint: number): Phaser.GameObjects.Container {
    const scene = this.container.scene;
    const c = scene.add.container(this.container.x, this.container.y);
    this.layers.forEach((img, i) => {
      if (this.names[i] === 'fixed') return;
      const g = scene.add.image(0, 0, 'players', img.frame.name).setOrigin(img.originX, img.originY).setTintFill(tint);
      c.add(g);
    });
    c.setScale(this.container.scaleX, this.container.scaleY).setAngle(this.container.angle);
    return c;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  setDepth(d: number): this {
    this.container.setDepth(d);
    return this;
  }

  setAlpha(a: number): this {
    this.container.setAlpha(a);
    return this;
  }

  setAngle(a: number): this {
    this.container.setAngle(a);
    return this;
  }

  destroy(): void {
    this.container.destroy();
  }
}
