// Galleria degli sprite: tutte le animazioni in 8 direzioni, giocatori della squadra scelta o
// aspetti casuali (pelle, capelli, maglia, scarpe, numero). Serve a controllare la grafica e
// sarà la base dell'editor dell'avatar.
import Phaser from 'phaser';
import { TEAMS } from '../../shared/teams';
import type { HairStyle, Kit, PlayerLook } from '../../shared/types';
import { PlayerSprite, type SpriteMeta } from '../render/playerSprite';
import { COLORS, button, hexColor, restartOnResize, text, view } from '../ui';
import { InputManager } from '../input/InputManager';
import { MenuNav } from '../input/MenuNav';

const SKINS = [0xf6d3b3, 0xf1c7a1, 0xd59a6c, 0xa86b42, 0x6e4428, 0x4a2c1a];
const HAIRS = [0x1b1410, 0x5a3520, 0xe0b84a, 0xa2401c, 0xdcdcdc, 0x2a5bd7, 0xff4d6d];
const STYLES: HairStyle[] = ['bald', 'buzz', 'short', 'curly', 'mohawk', 'long'];
const KITS = [0xffd21f, 0x1f3fb0, 0xc8102e, 0x8fd0ff, 0x26b36b, 0xff8a1f, 0xffffff, 0x111111, 0x9b5de5];

export class GalleryScene extends Phaser.Scene {
  private sprites: PlayerSprite[] = [];
  private animList: { set: 'field' | 'gk'; name: string }[] = [];
  private animIdx = 0;
  private teamIdx = 0;
  private random = false;
  private label!: Phaser.GameObjects.Text;
  private nav!: MenuNav;
  private seed = 1;

  constructor() {
    super('gallery');
  }

  init(d: { team?: number }): void {
    if (typeof d?.team === 'number') this.teamIdx = d.team;
  }

  create(): void {
    const { w, h } = view(this);
    const g = this.add.graphics();
    // Pavimento a lastre come in campo.
    for (let y = 0; y < h; y += 24) for (let x = 0; x < w; x += 24) g.fillStyle((x / 24 + y / 24) % 2 ? 0x4a4f5c : 0x434855, 1).fillRect(x, y, 24, 24);
    const meta = this.cache.json.get('players-meta') as SpriteMeta;
    this.animList = [
      ...Object.keys(meta.sets.field).map((name) => ({ set: 'field' as const, name })),
      ...Object.keys(meta.sets.gk).filter((n) => !meta.sets.field[n]).map((name) => ({ set: 'gk' as const, name })),
    ];
    text(this, w / 2, 26, 'GIOCATORI', 22, hexColor(COLORS.yellow));
    this.label = text(this, w / 2, 58, '', 11);
    const y = h - 40;
    const items: [string, () => void][] = [
      ['◀ ANIM', () => this.step(-1)],
      ['ANIM ▶', () => this.step(1)],
      ['SQUADRA', () => this.cycleTeam()],
      ['CASUALI', () => this.randomize()],
      ['MENU', () => this.scene.start('menu')],
    ];
    const bw = Math.min(170, (w - 40) / items.length - 10);
    items.forEach(([l, fn], i) => button(this, w / 2 + (i - (items.length - 1) / 2) * (bw + 10), y, bw, 46, l, fn));
    const input = new InputManager(this);
    input.bindEnter(this);
    this.nav = new MenuNav(input);
    this.build();
    restartOnResize(this, { team: this.teamIdx });
  }

  private looks(): { look: PlayerLook; kit: Kit; number: number; gk: boolean }[] {
    if (!this.random) {
      const t = TEAMS[this.teamIdx];
      return t.players.map((p, i) => ({ look: p.look, kit: i === 0 ? t.gkKit : t.kit, number: p.number, gk: i === 0 }));
    }
    const r = () => {
      this.seed = (this.seed * 16807) % 2147483647;
      return this.seed / 2147483647;
    };
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    return [0, 1, 2, 3, 4].map((i) => ({
      look: { skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(STYLES), boots: pick(KITS) },
      kit: { shirt: pick(KITS), trim: pick(KITS), shorts: pick(KITS), socks: pick(KITS) },
      number: 1 + Math.floor(r() * 99),
      gk: i === 0,
    }));
  }

  private build(): void {
    this.sprites.forEach((s) => s.destroy());
    this.sprites = [];
    const { w, h } = view(this);
    const list = this.looks();
    const gap = Math.min(190, (w - 40) / list.length);
    list.forEach((a, i) => {
      const ps = new PlayerSprite(this, a);
      ps.scaleK = gap >= 170 && h >= 520 ? 3 : 2;
      ps.setPosition(w / 2 + (i - 2) * gap, h / 2 + 70);
      this.sprites.push(ps);
    });
  }

  private step(d: number): void {
    this.animIdx = Phaser.Math.Wrap(this.animIdx + d, 0, this.animList.length);
  }

  private cycleTeam(): void {
    this.random = false;
    this.teamIdx = (this.teamIdx + 1) % TEAMS.length;
    this.build();
  }

  private randomize(): void {
    this.random = true;
    this.seed = (Date.now() % 100000) + 1;
    this.build();
  }

  update(t: number, dt: number): void {
    const ev = this.nav.update(dt);
    if (ev.dx) this.step(ev.dx);
    if (ev.back) this.scene.start('menu');
    if (ev.ok) this.randomize();
    const a = this.animList[this.animIdx];
    const meta = this.cache.json.get('players-meta') as SpriteMeta;
    const dir = Math.floor(t / 1200) % 8;
    const names = ['S', 'SE', 'E', 'NE', 'N', 'NO', 'O', 'SO'];
    this.label.setText(`${a.name.toUpperCase()}${a.set === 'gk' ? ' (PORTIERE)' : ''} · DIREZIONE ${names[dir]}`);
    this.sprites.forEach((ps, i) => {
      // Il portiere mostra le sue animazioni; se manca, la versione da giocatore di movimento.
      const set = i === 0 ? 'gk' : 'field';
      const def = meta.sets[set][a.name] ?? meta.sets[set].idle;
      const name = meta.sets[set][a.name] ? a.name : 'idle';
      const fps = def.loop ? def.fps : Math.max(8, def.fps * 0.6);
      const frame = Math.floor((t / 1000) * fps) % (def.frames + (def.loop ? 0 : 4));
      ps.show(name, Math.min(def.frames - 1, frame), dir);
    });
  }
}
