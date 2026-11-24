import { describe, expect, it } from 'vitest';
import { cloneState, hashState, stepMatch } from '../src/shared/match';
import type { InputMap } from '../src/shared/types';
import { input, newMatch, run } from './helpers';

/** Input "umano" scriptato e ripetibile. */
function script(t: number): InputMap {
  const phase = Math.floor(t / 40) % 6;
  return {
    p1: input({
      mx: [1, 0.7, 0, -0.7, 1, 0][phase],
      my: [0, 0.7, 1, 0.7, -0.5, 0][phase],
      sprint: phase % 2 === 0,
      shoot: t % 97 > 70,
      pass: t % 61 > 50,
      tx: t % 53 === 0 ? 1 : 0,
      ty: 0,
      mod: t % 106 === 0,
      shield: t % 400 > 380,
      skill: t % 211 === 0,
      switch: t % 300 === 0,
    }),
  };
}

describe('determinismo e serializzazione', () => {
  it('stesso seme e stessi input producono lo stesso stato', () => {
    const a = newMatch({ seed: 7, human: true });
    const b = newMatch({ seed: 7, human: true });
    for (let t = 0; t < 3000; t++) {
      stepMatch(a, script(t));
      stepMatch(b, script(t));
      if (t % 500 === 0) expect(hashState(a)).toBe(hashState(b));
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('semi diversi producono partite diverse', () => {
    const a = newMatch({ seed: 1 });
    const b = newMatch({ seed: 2 });
    run(a, 2000);
    run(b, 2000);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('lo stato è JSON puro e riprende identico dopo serializzazione', () => {
    const a = newMatch({ seed: 99, human: true });
    for (let t = 0; t < 900; t++) stepMatch(a, script(t));
    // Ogni numero deve essere finito: NaN e Infinity diventerebbero null in JSON.
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(a);
    const b = cloneState(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    for (let t = 900; t < 2500; t++) {
      stepMatch(a, script(t));
      stepMatch(b, script(t));
    }
    expect(hashState(b)).toBe(hashState(a));
  });

  it('gli input sono per ID: un ID sconosciuto non cambia nulla', () => {
    const a = newMatch({ seed: 3, human: true });
    const b = newMatch({ seed: 3, human: true });
    for (let t = 0; t < 600; t++) {
      stepMatch(a, {});
      stepMatch(b, { intruso: input({ shoot: true, mx: 1 }) });
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('input non validi (NaN) non rompono la simulazione', () => {
    const s = newMatch({ seed: 4, human: true });
    run(s, 600, { p1: input({ mx: NaN, my: Infinity, sprint: true }) });
    for (const p of s.players) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
