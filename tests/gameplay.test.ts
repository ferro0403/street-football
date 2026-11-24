// Passo 1 — base solida in stile FIFA Street: possesso, passaggi, tiri, contrasti su comando,
// IA, portiere. Niente falli.
import { describe, expect, it } from 'vitest';
import { CENTER_Y, DT, FIELD } from '../src/shared/constants';
import { createMatch, stepMatch } from '../src/shared/match';
import { pass, shoot, startSlide } from '../src/shared/actions';
import { groundSpeedFor, rollDistance } from '../src/shared/ball';
import { updateKeeper } from '../src/shared/keeper';
import { runSpeed } from '../src/shared/stats';
import { stepBall } from '../src/shared/ball';
import { TEAMS } from '../src/shared/teams';
import type { MatchState, TeamIndex } from '../src/shared/types';
import { humansOn, input, newMatch, parkOthers, run, toPlay } from './helpers';

const speed = (s: MatchState) => Math.hypot(s.ball.vx, s.ball.vy);

describe('possesso e movimento', () => {
  it('reattivo: velocità piena in meno di 0,2 s e inversione immediata', () => {
    const s = newMatch({ human: true, seed: 3 });
    toPlay(s);
    parkOthers(s, [4]);
    const me = s.players[4];
    run(s, 12, { p1: input({ mx: 0, my: 1 }) });
    const top = runSpeed(me.stats) * 0.9 * 0.9;
    expect(me.vy).toBeGreaterThan(top);
    run(s, 10, { p1: input({ mx: 0, my: -1 }) });
    expect(me.vy).toBeLessThan(-top * 0.8);
    expect(me.fy).toBeLessThan(-0.95); // guarda subito dove va
  });

  it('palla incollata ai piedi a velocità normale, anche cambiando direzione', () => {
    const s = newMatch({ human: true, seed: 4 });
    toPlay(s);
    parkOthers(s, [4]);
    const me = s.players[4];
    let maxD = 0;
    for (let t = 0; t < 240; t++) {
      const k = Math.floor(t / 30) % 4;
      const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][k];
      stepMatch(s, { p1: input({ mx: dir[0], my: dir[1] }) });
      expect(s.ball.owner).toBe(4);
      maxD = Math.max(maxD, Math.hypot(s.ball.x - me.x, s.ball.y - me.y));
    }
    expect(maxD).toBeLessThan(0.9); // a ogni tocco si allontana un po', mai di più
  });

  it('lo scatto è più veloce della corsa', () => {
    const a = newMatch({ human: true, seed: 5 });
    const b = newMatch({ human: true, seed: 5 });
    for (const s of [a, b]) {
      toPlay(s);
      parkOthers(s, [4]);
    }
    run(a, 40, { p1: input({ mx: 0, my: 1, sprint: true }) });
    run(b, 40, { p1: input({ mx: 0, my: 1 }) });
    expect(a.players[4].vy).toBeGreaterThan(b.players[4].vy * 1.25);
  });

  it('la regolazione della velocità (pannello F2) cambia la corsa', () => {
    const s = createMatch({ home: TEAMS[0], away: TEAMS[1], seed: 1, humans: [{ id: 'p1', team: 0 }], tune: { speed: 1.4 } });
    const n = newMatch({ human: true, seed: 1 });
    for (const m of [s, n]) {
      toPlay(m);
      parkOthers(m, [4]);
      run(m, 30, { p1: input({ mx: 0, my: 1 }) });
    }
    expect(s.players[4].vy).toBeGreaterThan(n.players[4].vy * 1.3);
  });
});

describe('passaggi', () => {
  it('la fisica del rasoterra arriva alla distanza giusta', () => {
    for (const d of [3, 8, 15, 25]) {
      const v0 = groundSpeedFor(d, 6);
      expect(Math.abs(rollDistance(v0, 6) - d)).toBeLessThan(0.15);
    }
  });

  it('un tocco = rasoterra che ARRIVA SEMPRE al compagno nella direzione indicata, con la velocità giusta', () => {
    let seed = 1;
    for (const d of [3, 6, 10, 16, 26]) {
      for (const [dx, dy] of [[1, 0], [0.8, 0.6], [1, -0.3]]) {
        const s = humansOn(seed++, 1, 9);
        const a = s.players[1];
        const r = s.players[3];
        const [ux, uy] = [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)];
        Object.assign(a, { x: 5, y: CENTER_Y, vx: 0, vy: 0, stun: 0 });
        Object.assign(r, { x: 5 + ux * d, y: CENTER_Y + uy * d * 0.5, vx: 0, vy: 0, stun: 0 });
        r.y = Math.max(1, Math.min(FIELD.width - 1, r.y));
        s.players[9].x = 34; // avversario lontano
        s.ball.owner = 1;
        stepMatch(s, { d: input({ mx: ux, my: uy, pass: true }) });
        expect(s.ball.passTarget, `d=${d}`).toBe(3);
        expect(s.ball.z).toBe(0);
        let got = false;
        let arrival = 0;
        for (let t = 0; t < 60 * 5 && !got; t++) {
          arrival = speed(s);
          stepMatch(s, {});
          got = s.ball.owner === 3;
        }
        expect(got, `distanza ${d}`).toBe(true);
        expect(arrival).toBeGreaterThan(5); // veloce
        expect(arrival).toBeLessThan(13);
      }
    }
  });

  it('passaggio verso un compagno che corre: arriva comunque', () => {
    for (let i = 0; i < 20; i++) {
      const s = humansOn(40 + i, 1, 9);
      const a = s.players[1];
      const r = s.players[2];
      r.stun = 0;
      r.human = null;
      Object.assign(a, { x: 6, y: CENTER_Y, vx: 0, vy: 0 });
      Object.assign(r, { x: 14 + (i % 5) * 2, y: 5 + (i % 3) * 6, vx: 0, vy: 0 });
      s.ball.owner = 1;
      pass(s, a, 2);
      let got = false;
      for (let t = 0; t < 60 * 5 && !got; t++) {
        stepMatch(s, {});
        got = s.ball.owner === 2;
      }
      expect(got).toBe(true);
    }
  });

  it('verso il muro senza compagni: la palla rimbalza in modo prevedibile (angolo speculare)', () => {
    const s = humansOn(7, 1, 9);
    const a = s.players[1];
    for (const q of s.players) if (q.team === 0 && q.idx !== 1) q.x = 0.6;
    Object.assign(a, { x: 12, y: 4, vx: 0, vy: 0 });
    s.ball.owner = 1;
    const [ux, uy] = [0.6, -0.8];
    stepMatch(s, { d: input({ mx: ux, my: uy, pass: true }) });
    expect(s.ball.passTarget).toBe(-1);
    const vx0 = s.ball.vx;
    const vy0 = s.ball.vy;
    expect(vy0).toBeLessThan(0);
    let bounced = false;
    for (let t = 0; t < 120 && !bounced; t++) {
      stepMatch(s, {});
      if (s.events.some((e) => e.type === 'wall')) bounced = true;
    }
    expect(bounced).toBe(true);
    run(s, 2);
    // Dopo il rimbalzo: vy cambia segno, vx resta concorde (riflessione speculare).
    expect(s.ball.vy).toBeGreaterThan(0);
    expect(Math.sign(s.ball.vx)).toBe(Math.sign(vx0));
    expect(Math.abs(s.ball.vy / s.ball.vx)).toBeGreaterThan(Math.abs(vy0 / vx0) * 0.5);
  });

  it('la regolazione della potenza dei passaggi cambia la velocità', () => {
    const v = (k: number) => {
      const s = createMatch({ home: TEAMS[0], away: TEAMS[1], seed: 2, tune: { pass: k } });
      toPlay(s);
      parkOthers(s, [1, 3]);
      Object.assign(s.players[1], { x: 5, y: CENTER_Y });
      Object.assign(s.players[3], { x: 20, y: CENTER_Y });
      s.ball.owner = 1;
      pass(s, s.players[1], 3);
      return speed(s);
    };
    expect(v(1.4)).toBeGreaterThan(v(1) + 0.5);
  });
});

describe('tiro', () => {
  it('premi = tiro verso la porta; tenendo premuto è più potente', () => {
    const shot = (hold: number) => {
      const s = newMatch({ human: true, seed: 11 });
      toPlay(s);
      parkOthers(s, [4]);
      run(s, hold, { p1: input({ shoot: true }) });
      expect(s.ball.owner).toBe(4); // si carica: ancora nessun tiro
      stepMatch(s, { p1: input() });
      expect(s.ball.owner).toBe(-1);
      expect(s.ball.shotActive).toBe(true);
      expect(s.ball.vx).toBeGreaterThan(0); // verso la porta avversaria
      return speed(s);
    };
    expect(shot(50)).toBeGreaterThan(shot(2) + 5);
  });

  it('la levetta sceglie il lato della porta', () => {
    const side = (my: number) => {
      const s = newMatch({ human: true, seed: 12 });
      toPlay(s);
      parkOthers(s, [4]);
      Object.assign(s.players[4], { x: 26, y: CENTER_Y });
      stepMatch(s, { p1: input({ shoot: true, my }) });
      stepMatch(s, { p1: input({ my }) });
      return s.ball.vy;
    };
    expect(side(1)).toBeGreaterThan(0.5);
    expect(side(-1)).toBeLessThan(-0.5);
  });
});

describe('contrasti: solo su comando, niente falli', () => {
  it('il mio giocatore non fa MAI contrasti o scivolate da solo', () => {
    for (let seed = 0; seed < 5; seed++) {
      const s = newMatch({ human: true, seed: 600 + seed });
      toPlay(s);
      let mine = 0;
      // 60 s di partita senza premere nulla, mentre gli avversari attaccano.
      for (let t = 0; t < 60 * 60; t++) {
        const me = s.players.find((p) => p.human === 'p1')!;
        stepMatch(s, { p1: input() });
        const a = me.action.kind;
        if (a === 'tackle' || a === 'slide' || a === 'kick' || a === 'shoot') mine++;
        for (const e of s.events) if ((e.type === 'tackle' || e.type === 'slide' || e.type === 'tackleMiss') && e.p === me.idx) mine++;
      }
      expect(mine, `seed ${seed}`).toBe(0);
    }
  });

  it('cambiando giocatore, un contrasto iniziato dalla CPU viene annullato', () => {
    const s = newMatch({ human: true, seed: 15 });
    toPlay(s);
    s.ball.owner = 9;
    const other = s.players.find((p) => p.team === 0 && p.role === 'field' && !p.human)!;
    startSlide(s, other);
    for (const p of s.players) if (p.team === 0 && p.role === 'field' && p !== other) p.x = 0.6; // lui il più vicino alla palla
    Object.assign(other, { x: s.ball.x - 1, y: s.ball.y });
    stepMatch(s, { p1: input({ switch: true }) });
    expect(other.human).toBe('p1');
    expect(other.action.kind).toBe('none');
  });
});

describe('IA', () => {
  it('un difensore va sul portatore e gli altri non stanno a guardare', () => {
    const s = newMatch({ seed: 21 });
    toPlay(s);
    run(s, 120);
    let pressure = 0;
    let samples = 0;
    for (let t = 0; t < 1200; t++) {
      stepMatch(s, {});
      if (s.phase !== 'play' || s.ball.owner < 0) continue;
      const c = s.players[s.ball.owner];
      if (c.role === 'gk') continue;
      samples++;
      const near = s.players.some((q) => q.team !== c.team && q.role === 'field' && Math.hypot(q.x - c.x, q.y - c.y) < 3.5);
      if (near) pressure++;
    }
    expect(pressure / samples).toBeGreaterThan(0.5);
  });
});

describe('portiere', () => {
  function saveRate(aim: number, charge: number, n = 60): number {
    const s = newMatch({ seed: 31 });
    toPlay(s);
    let saved = 0;
    for (let i = 0; i < n; i++) {
      const shooter = s.players[4];
      const k = s.players[5];
      parkOthers(s, [4, 5]);
      Object.assign(k, { x: FIELD.length - 0.9, y: CENTER_Y, vx: 0, vy: 0, stun: 0 });
      k.action = { kind: 'none', t: 0, dur: 0, dx: 0, dy: 0, done: false };
      Object.assign(shooter, { x: 24, y: CENTER_Y, stun: 0 });
      Object.assign(s.ball, { owner: 4, inGoal: -1 });
      shoot(s, shooter, charge, aim);
      for (let t = 0; t < 90; t++) {
        const r = updateKeeper(s, k);
        k.x += (r.mx * r.speed + (k.action.kind === 'dive' ? k.vx : 0)) * DT;
        k.y += (k.action.kind === 'dive' ? k.vy : r.my * r.speed) * DT;
        if (k.action.kind === 'dive') {
          k.action.t += DT;
          if (k.action.t > k.action.dur) k.action.kind = 'none';
        }
        if (s.ball.owner >= 0) break;
        stepBall(s);
        if (s.ball.inGoal >= 0) break;
      }
      if (s.ball.inGoal < 0) saved++;
    }
    return saved / n;
  }

  it('para i tiri centrali e deboli, prende gol su quelli angolati e potenti', () => {
    const easy = saveRate(0, 0.1);
    const hard = saveRate(0.95, 1);
    expect(easy).toBeGreaterThan(0.85);
    expect(hard).toBeLessThan(0.65);
    expect(easy).toBeGreaterThan(hard + 0.25);
  });

  it('mai contrasti sul portatore: chi dribbla vicino alla porta non perde palla', () => {
    const s = newMatch({ seed: 11, human: true });
    toPlay(s);
    parkOthers(s, [4, 5]);
    const me = s.players[4];
    Object.assign(me, { x: 31, y: CENTER_Y, stun: 0 });
    s.ball.owner = 4;
    for (let t = 0; t < 180; t++) {
      const k = s.players[5];
      const [dx, dy] = [k.x - me.x, k.y - me.y + 0.8];
      const l = Math.hypot(dx, dy) || 1;
      stepMatch(s, { p1: input({ mx: dx / l, my: dy / l }) });
      expect(s.ball.owner).toBe(4);
    }
  });

  it('resta in porta: non esce mai lontano', () => {
    const s = newMatch({ seed: 12 });
    toPlay(s);
    for (let i = 0; i < 60 * 90 && s.phase !== 'ended'; i++) {
      stepMatch(s, {});
      for (const k of [s.players[0], s.players[5]]) {
        const fromLine = k.team === 0 ? k.x : FIELD.length - k.x;
        expect(fromLine).toBeLessThan(4.5);
      }
    }
  });

  it('esce su una palla vagante vicinissima e la prende', () => {
    const s = newMatch({ seed: 13 });
    toPlay(s);
    parkOthers(s, [0]);
    const k = s.players[0];
    Object.assign(k, { x: 0.9, y: CENTER_Y });
    Object.assign(s.ball, { owner: -1, x: 2.8, y: CENTER_Y + 1.5, vx: 0, vy: 0, z: 0 });
    let caught = false;
    for (let t = 0; t < 90 && !caught; t++) {
      stepMatch(s, {});
      caught = s.ball.owner === 0;
    }
    expect(caught).toBe(true);
  });
});

describe('bilanciamento', () => {
  it('CPU contro CPU: in media 3-7 gol a partita', () => {
    let goals = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const s = newMatch({ seed: 900 + i, home: TEAMS[i % TEAMS.length], away: TEAMS[(i + 2) % TEAMS.length] });
      let g = 0;
      while (s.phase !== 'ended' && g++ < 60 * 60 * 6) stepMatch(s, {});
      goals += s.score[0] + s.score[1];
    }
    const avg = goals / N;
    expect(avg).toBeGreaterThanOrEqual(3);
    expect(avg).toBeLessThanOrEqual(7);
  }, 60000);
});

export type { TeamIndex };
