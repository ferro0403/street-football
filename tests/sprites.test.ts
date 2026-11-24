// Coerenza degli sprite generati (npm run sprites) con ciò che il gioco usa.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEAMS } from '../src/shared/teams';

const atlas = JSON.parse(readFileSync('public/assets/sprites/players.json', 'utf8')) as {
  textures: { image: string; size: { w: number; h: number }; frames: { filename: string; spriteSourceSize: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } }[] }[];
};
const meta = JSON.parse(readFileSync('public/assets/sprites/players-meta.json', 'utf8')) as {
  dirs: number;
  frameW: number;
  frameH: number;
  sets: Record<string, Record<string, { frames: number }>>;
  numbers: Record<string, [number, number]>;
};
const names = new Set(atlas.textures.flatMap((t) => t.frames.map((f) => f.filename)));
const BODY = ['skin', 'socks', 'shoes', 'shorts', 'shirt', 'trim', 'fixed'];
const HAIR = ['buzz', 'short', 'curly', 'mohawk', 'long'];

describe('sprite dei giocatori', () => {
  it('ogni animazione ha tutti i livelli in tutte le direzioni e i fotogrammi', () => {
    let missing = 0;
    for (const [set, anims] of Object.entries(meta.sets)) {
      const layers = [...BODY, ...(set === 'gk' ? ['gloves'] : []), ...HAIR.map((h) => `hair_${h}`)];
      for (const [anim, def] of Object.entries(anims)) {
        for (let d = 0; d < meta.dirs; d++) {
          for (let i = 0; i < def.frames; i++) {
            for (const L of layers) if (!names.has(`${L}/${set}_${anim}_${d}_${i}`)) missing++;
          }
        }
      }
    }
    expect(missing).toBe(0);
  });

  it('le animazioni usate dal gioco esistono', () => {
    const field = ['idle', 'run', 'sprint', 'pass', 'shoot', 'tackle', 'shoulder', 'slide', 'fall', 'stagger', 'celebrate', 'rabona', 'veronica', 'elastico', 'sombrero', 'tunnel', 'feint'];
    const gk = ['idle', 'ready', 'run', 'pass', 'shoot', 'diveL', 'diveR', 'save', 'hold', 'fall', 'celebrate'];
    for (const a of field) expect(meta.sets.field[a], a).toBeDefined();
    for (const a of gk) expect(meta.sets.gk[a], a).toBeDefined();
  });

  it('i ritagli stanno nel fotogramma e nelle pagine (max 2048 per i telefoni)', () => {
    for (const t of atlas.textures) {
      expect(t.size.w).toBeLessThanOrEqual(2048);
      expect(t.size.h).toBeLessThanOrEqual(2048);
      for (const f of t.frames) {
        const s = f.spriteSourceSize;
        expect(s.x + s.w).toBeLessThanOrEqual(meta.frameW);
        expect(s.y + s.h).toBeLessThanOrEqual(meta.frameH);
      }
    }
  });

  it('il numero di maglia si vede quando il giocatore è di spalle', () => {
    // Direzione 4 = verso il fondo (di spalle) in corsa: il numero deve esserci.
    expect(meta.numbers['field_run_4_0']).toBeDefined();
    // Direzione 0 = verso la camera: niente numero sulla pancia.
    expect(meta.numbers['field_idle_0_0']).toBeUndefined();
  });

  it('ogni giocatore delle squadre ha un aspetto disegnabile', () => {
    const styles = new Set(['bald', ...HAIR]);
    for (const t of TEAMS) {
      for (const p of t.players) {
        expect(styles.has(p.look.hairStyle)).toBe(true);
        expect(typeof p.look.boots).toBe('number');
      }
    }
  });
});
