// Contrasti fisici e leggibili (niente dadi), protezione palla, schivata, difesa CPU.
import { describe, expect, it } from 'vitest';
import { CENTER_Y, DT } from '../src/shared/constants';
import { stepMatch } from '../src/shared/match';
import { predictTackle, tackleOutcome } from '../src/shared/actions';
import { tackleReach } from '../src/shared/stats';
import { TEAMS } from '../src/shared/teams';
import type { MatchState } from '../src/shared/types';
import { humansOn, input, newMatch, run, withStats } from './helpers';

/** Attaccante (idx 9, umano "c") che conduce verso la porta di sinistra, difensore umano (idx 1, "d"). */
function duel(seed: number, defStats = {}, carStats = {}) {
  const s = humansOn(seed, 1, 9, withStats(TEAMS[0], defStats), withStats(TEAMS[1], carStats));
  const c = s.players[9];
  const d = s.players[1];
  Object.assign(c, { x: 24, y: CENTER_Y, fx: -1, fy: 0, vx: 0, vy: 0, stun: 0 });
  Object.assign(d, { x: 10, y: CENTER_Y, fx: 1, fy: 0, vx: 0, vy: 0, stun: 0, tackleCd: 0 });
  s.ball.owner = 9;
  return { s, c, d };
}

const walk = (extra = {}) => ({ c: input({ mx: -1, ...extra }) });
const won = (s: MatchState) => s.ball.owner !== 9;

/** Lascia andare il contrasto fino in fondo e dice se la palla è stata tolta. */
function resolve(s: MatchState, cInput = walk()): boolean {
  for (let t = 0; t < 20; t++) stepMatch(s, cInput);
  return won(s);
}

describe('contrasto in piedi: conta dove sono piede, palla e corpo', () => {
  it('di fronte nel momento giusto (palla lontana dal piede): quasi sicuro', () => {
    let tries = 0;
    let ok = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { s, c, d } = duel(seed);
      run(s, 20 + (seed % 9), walk()); // fasi del tocco diverse
      // Il difensore si piazza davanti e aspetta il tocco lungo.
      d.x = c.x - 1.15;
      d.y = c.y;
      for (let t = 0; t < 90; t++) {
        if (predictTackle(s, d, c, 0) === 'steal') {
          stepMatch(s, { ...walk(), d: input({ tackle: true }) });
          tries++;
          if (resolve(s)) ok++;
          break;
        }
        stepMatch(s, walk());
        d.x = c.x - 1.15;
      }
    }
    expect(tries).toBeGreaterThan(30);
    expect(ok / tries).toBeGreaterThan(0.85);
  });

  it('di fronte con la palla attaccata al piede: di solito no', () => {
    let tries = 0;
    let ok = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { s, c, d } = duel(100 + seed);
      run(s, 20 + (seed % 9), walk());
      d.x = c.x - 1.0;
      d.y = c.y;
      for (let t = 0; t < 90; t++) {
        if (predictTackle(s, d, c, 0) === 'glued') {
          stepMatch(s, { ...walk(), d: input({ tackle: true }) });
          tries++;
          if (resolve(s)) ok++;
          break;
        }
        stepMatch(s, walk());
        d.x = c.x - 1.0;
      }
    }
    expect(tries).toBeGreaterThan(20);
    expect(ok / tries).toBeLessThan(0.2);
  });

  it('da dietro: non riesce (quasi) mai, in qualsiasi momento', () => {
    let ok = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const { s, c, d } = duel(200 + i);
      run(s, 10 + (i % 23), walk());
      Object.assign(d, { x: c.x + 0.9, y: c.y + ((i % 5) - 2) * 0.12, vx: c.vx, vy: 0 });
      stepMatch(s, { ...walk(), d: input({ tackle: true, mx: -1 }) });
      if (resolve(s)) ok++;
    }
    expect(ok / N).toBeLessThan(0.05);
  });

  it('esiti visibili: rubata, palla libera (50/50) o a vuoto con il difensore sbilanciato', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const { s, c, d } = duel(300 + i);
      run(s, 15 + (i % 31), walk());
      Object.assign(d, { x: c.x - 0.95 - (i % 4) * 0.12, y: c.y + ((i % 3) - 1) * 0.3 });
      stepMatch(s, { ...walk(), d: input({ tackle: true }) });
      for (let t = 0; t < 12; t++) {
        stepMatch(s, walk());
        for (const e of s.events) {
          if (e.type === 'tackle') seen.add('rubata');
          if (e.type === 'tackleLoose') seen.add('libera');
          if (e.type === 'tackleMiss') {
            seen.add('vuoto');
            expect(d.action.kind).toBe('stagger');
            expect(d.stun).toBeGreaterThan(0);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['libera', 'rubata', 'vuoto']);
  });

  it('nessun dado: stesse posizioni = stesso esito', () => {
    for (let i = 0; i < 10; i++) {
      const a = duel(400 + i);
      const b = duel(9000 + i); // seme diverso
      for (const m of [a, b]) {
        run(m.s, 17 + i, walk());
        Object.assign(m.d, { x: m.c.x - 1.05, y: m.c.y });
      }
      const oa = tackleOutcome(a.s, a.d.x, a.d.y, tackleReach(a.d.stats), a.c);
      const ob = tackleOutcome(b.s, b.d.x, b.d.y, tackleReach(b.d.stats), b.c);
      expect(oa).toBe(ob);
    }
  });

  it('le statistiche spostano le finestre: più difesa = piede più lungo, più dribbling = palla più coperta', () => {
    const rate = (def: number, drib: number) => {
      let ok = 0;
      for (let i = 0; i < 60; i++) {
        const { s, c, d } = duel(500 + i, { defense: def }, { dribbling: drib });
        run(s, 10 + (i % 29), walk());
        Object.assign(d, { x: c.x - 1.1, y: c.y });
        stepMatch(s, { ...walk(), d: input({ tackle: true }) });
        if (resolve(s)) ok++;
      }
      return ok;
    };
    expect(rate(95, 40)).toBeGreaterThan(rate(40, 95) + 10);
  });
});

describe('chi ha palla si difende', () => {
  it('protezione: contro un difensore CPU tiene palla in media almeno 4,5 s', () => {
    let total = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const s = humansOn(600 + i, 1, 9);
      // Il difensore è CPU.
      s.players[1].human = null;
      s.controllers = s.controllers.filter((c) => c.id !== 'd');
      Object.assign(s.players[9], { x: 22, y: CENTER_Y - 2 + (i % 5), stun: 0 });
      Object.assign(s.players[1], { x: 16, y: CENTER_Y, stun: 0 });
      s.ball.owner = 9;
      let held = 0;
      while (held < 10 && s.ball.owner === 9) {
        // Protegge e si muove piano, a zig-zag, come farebbe una persona.
        stepMatch(s, { c: input({ shield: true, mx: -0.3, my: Math.floor(held / 1.5) % 2 ? 0.4 : -0.4 }) });
        held += DT;
      }
      total += held;
    }
    expect(total / N).toBeGreaterThan(4.5);
  });

  it('protezione: più lento ma la palla resta tra i piedi, dalla parte opposta al difensore', () => {
    const { s, c, d } = duel(700);
    Object.assign(d, { x: c.x - 1.6, y: c.y + 0.5 });
    run(s, 40, { c: input({ shield: true, mx: 0.3 }) });
    expect(c.shielding).toBe(true);
    const free = duel(700);
    run(free.s, 40, { c: input({ mx: 0.3 }) });
    expect(Math.abs(c.vx)).toBeLessThan(Math.abs(free.c.vx) * 0.7);
    // Palla dall'altra parte rispetto al difensore.
    expect((s.ball.x - c.x) * (d.x - c.x) + (s.ball.y - c.y) * (d.y - c.y)).toBeLessThan(0);
  });

  it('dribbling secco quando il difensore CPU entra: il contrasto va a vuoto', () => {
    let windups = 0;
    let lost = 0;
    for (let i = 0; i < 30; i++) {
      const s = humansOn(800 + i, 1, 9);
      s.players[1].human = null;
      s.controllers = s.controllers.filter((c) => c.id !== 'd');
      Object.assign(s.players[9], { x: 22, y: CENTER_Y, stun: 0 });
      Object.assign(s.players[1], { x: 17, y: CENTER_Y, stun: 0 });
      s.ball.owner = 9;
      let cutAt = -1;
      for (let t = 0; t < 60 * 6 && s.ball.owner === 9; t++) {
        // Al segnale reagisce dopo 0,12 s con un cambio di direzione secco.
        const cutting = cutAt >= 0 && t >= cutAt && t < cutAt + 25;
        stepMatch(s, { c: input(cutting ? { mx: 0, my: (i % 2) * 2 - 1 } : { mx: -1, my: 0.2 * (((t / 40) | 0) % 2 ? 1 : -1) }) });
        if (s.events.some((e) => e.type === 'windup')) {
          windups++;
          cutAt = t + 7;
        }
      }
      if (s.ball.owner !== 9) lost++;
    }
    expect(windups).toBeGreaterThan(10);
    expect(lost / 30).toBeLessThan(0.35);
  });

  it('senza reagire al segnale, il difensore CPU nel momento giusto la ruba spesso', () => {
    let lost = 0;
    for (let i = 0; i < 30; i++) {
      const s = humansOn(900 + i, 1, 9);
      s.players[1].human = null;
      s.controllers = s.controllers.filter((c) => c.id !== 'd');
      Object.assign(s.players[9], { x: 26, y: CENTER_Y, stun: 0 });
      Object.assign(s.players[1], { x: 15, y: CENTER_Y, stun: 0 });
      s.ball.owner = 9;
      for (let t = 0; t < 60 * 5 && s.ball.owner === 9; t++) stepMatch(s, { c: input({ mx: -1 }) });
      if (s.ball.owner !== 9) lost++;
    }
    expect(lost / 30).toBeGreaterThan(0.5);
  });
});

describe('difesa CPU: contiene e aspetta', () => {
  it('ogni difensore CPU tenta al massimo un contrasto ogni 1,5 s, e prima lo segnala', () => {
    let attempts = 0;
    for (let m = 0; m < 6; m++) {
      const s = newMatch({ seed: 1000 + m });
      const last = new Map<number, number>();
      const pendingWindup = new Set<number>();
      while (s.phase !== 'ended') {
        stepMatch(s, {});
        for (const e of s.events) {
          if (e.type === 'windup' && e.p !== undefined) {
            pendingWindup.add(e.p);
            const prev = last.get(e.p);
            if (prev !== undefined) expect((s.tick - prev) * DT).toBeGreaterThan(1.45);
            last.set(e.p, s.tick);
            attempts++;
          }
        }
        // Un contrasto in piedi CPU parte solo dopo il segnale.
        for (const p of s.players) {
          if (p.action.kind === 'tackle' && p.action.t === DT && !p.human) {
            expect(pendingWindup.has(p.idx)).toBe(true);
            pendingWindup.delete(p.idx);
          }
        }
      }
    }
    expect(attempts).toBeGreaterThan(20);
  });

  it('niente contrasti per-tick: a contatto stretto il difensore non entra se il momento è sbagliato', () => {
    // Attaccante che protegge fermo con il difensore CPU attaccato: nessun contrasto a ripetizione.
    const s = humansOn(1100, 1, 9);
    s.players[1].human = null;
    s.controllers = s.controllers.filter((c) => c.id !== 'd');
    Object.assign(s.players[9], { x: 22, y: CENTER_Y });
    Object.assign(s.players[1], { x: 21, y: CENTER_Y });
    s.ball.owner = 9;
    let tackles = 0;
    for (let t = 0; t < 60 * 4; t++) {
      stepMatch(s, { c: input({ shield: true }) });
      if (s.players[1].action.kind === 'tackle' && s.players[1].action.t === DT) tackles++;
    }
    expect(tackles).toBeLessThanOrEqual(3);
  });

  it("l'aggressività (pannello F2) cambia quanto spesso entrano", () => {
    const count = (aggression: number) => {
      let n = 0;
      for (let m = 0; m < 3; m++) {
        const s = newMatch({ seed: 1200 + m });
        s.tune.aggression = aggression;
        while (s.phase !== 'ended') {
          stepMatch(s, {});
          n += s.events.filter((e) => e.type === 'windup').length;
        }
      }
      return n;
    };
    expect(count(1.8)).toBeGreaterThan(count(0.5) * 1.5);
  });

  it("l'IA fa scivolate, ma con moderazione", () => {
    let slides = 0;
    let tackles = 0;
    for (let i = 0; i < 6; i++) {
      const s = newMatch({ seed: 700 + i });
      while (s.phase !== 'ended') {
        stepMatch(s, {});
        for (const e of s.events) {
          if (e.type === 'slide') slides++;
          if (e.type === 'windup') tackles++;
        }
      }
    }
    expect(slides).toBeGreaterThan(0);
    expect(slides / 6).toBeLessThan(6);
    expect(tackles).toBeGreaterThan(slides * 2);
  });
});
