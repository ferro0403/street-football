// Test dei comportamenti "realistici" della Fase 1.1: passaggi, portiere, contrasti,
// dribbling, tiri a giro e skill.
import { describe, expect, it } from 'vitest';
import { CENTER_Y, FIELD } from '../src/shared/constants';
import { stepMatch } from '../src/shared/match';
import { groundPass, lobPass, throughPass, shoot, special, startSlide, startTackle, resolveTackle } from '../src/shared/actions';
import { groundSpeedFor, rollDistance } from '../src/shared/ball';
import { TEAMS } from '../src/shared/teams';
import type { MatchState } from '../src/shared/types';
import { input, newMatch, parkOthers, run, toPlay, withStats } from './helpers';

const sp = (s: MatchState) => Math.hypot(s.ball.vx, s.ball.vy);

/** Prepara: passatore #1 (idx 1) con palla in (x,y), ricevitore idx 3 in (rx,ry), tutti gli altri parcheggiati. */
function passSetup(seed: number, x: number, y: number, rx: number, ry: number) {
  const s = newMatch({ seed });
  toPlay(s);
  parkOthers(s, [1, 3]);
  const a = s.players[1];
  const r = s.players[3];
  Object.assign(a, { x, y, vx: 0, vy: 0, stun: 0 });
  Object.assign(r, { x: rx, y: ry, vx: 0, vy: 0, stun: 1e6 }); // fermo: verifichiamo che la palla arrivi da sola
  s.ball.owner = 1;
  return { s, a, r };
}

describe('passaggi', () => {
  it('velocità del rasoterra: la fisica simulata arriva alla distanza giusta', () => {
    for (const d of [3, 8, 15, 25]) {
      const v0 = groundSpeedFor(d, 5);
      expect(Math.abs(rollDistance(v0, 5) - d)).toBeLessThan(0.15);
    }
  });

  it('il rasoterra arriva SEMPRE al compagno, a ogni distanza e carica', () => {
    let seed = 1;
    for (const d of [3, 6, 10, 16, 24]) {
      for (const charge of [0, 0.5, 1]) {
        const { s, r } = passSetup(seed++, 6, 11, 6 + d, 11 + (seed % 3) - 1);
        r.stun = 0; // può controllare, ma non si muove (nessun input: è CPU ma lo teniamo fermo)
        r.human = 'x';
        s.controllers.push({ id: 'x', team: 0, player: 3, prev: input() });
        groundPass(s, s.players[1], 3, charge);
        expect(s.ball.z).toBe(0);
        let got = false;
        for (let t = 0; t < 60 * 5 && !got; t++) {
          stepMatch(s, { x: input() });
          expect(s.ball.z).toBeLessThan(0.01); // resta a terra
          got = s.ball.owner === 3;
        }
        expect(got, `distanza ${d} carica ${charge}`).toBe(true);
      }
    }
  });

  it('la carica cambia solo la velocità, non la direzione', () => {
    const a = passSetup(5, 6, 11, 18, 14);
    const b = passSetup(5, 6, 11, 18, 14);
    groundPass(a.s, a.a, 3, 0);
    groundPass(b.s, b.a, 3, 1);
    const da = Math.atan2(a.s.ball.vy, a.s.ball.vx);
    const db = Math.atan2(b.s.ball.vy, b.s.ball.vx);
    expect(Math.abs(da - db)).toBeLessThan(0.06);
    expect(sp(b.s)).toBeGreaterThan(sp(a.s) + 1.5);
    expect(a.s.ball.vz).toBe(0);
    expect(b.s.ball.vz).toBe(0);
  });

  it('il lancio alto vola sopra gli avversari e ricade vicino al compagno', () => {
    const { s } = passSetup(6, 6, 11, 20, 11);
    lobPass(s, s.players[1], 3);
    let maxZ = 0;
    let landX = 0;
    for (let t = 0; t < 180; t++) {
      const z0 = s.ball.z;
      stepMatch(s, {});
      maxZ = Math.max(maxZ, s.ball.z);
      if (z0 > 0.001 && s.ball.z <= 0.001 && !landX) landX = s.ball.x;
    }
    expect(maxZ).toBeGreaterThan(2);
    expect(Math.abs(landX - 20)).toBeLessThan(3);
  });

  it('il filtrante va nello spazio davanti al compagno, verso la porta', () => {
    const { s } = passSetup(7, 10, 11, 18, 8);
    throughPass(s, s.players[1], 3, 1, 0);
    expect(s.ball.passKind).toBe(3);
    expect(s.ball.passTx).toBeGreaterThan(20); // davanti al compagno (che è a x=18)
    expect(s.ball.vz).toBe(0);
  });

  it('comandi: tocco J = rasoterra, lancio separato, filtrante separato', () => {
    const s = newMatch({ human: true, seed: 8 });
    toPlay(s);
    stepMatch(s, { p1: input({ lob: true, mx: -1 }) });
    expect(s.ball.passKind).toBe(2);
    const s2 = newMatch({ human: true, seed: 8 });
    toPlay(s2);
    stepMatch(s2, { p1: input({ pass: true, mx: -1 }) });
    stepMatch(s2, { p1: input({ mx: -1 }) });
    expect(s2.ball.passKind).toBe(1);
    expect(s2.ball.vz).toBe(0);
    const s3 = newMatch({ human: true, seed: 8 });
    toPlay(s3);
    stepMatch(s3, { p1: input({ through: true, mx: 1 }) });
    expect(s3.ball.passKind).toBe(3);
  });
});

describe('portiere', () => {
  it('non ruba la palla dai piedi di chi dribbla a passo normale', () => {
    const s = newMatch({ seed: 11, human: true });
    toPlay(s);
    parkOthers(s, [4, 5]);
    const me = s.players[4];
    Object.assign(me, { x: 31, y: CENTER_Y, stun: 0 });
    s.ball.owner = 4;
    // Cammina (senza scatto) verso la porta e ci gira intorno per 3 secondi.
    let lost = false;
    for (let t = 0; t < 180; t++) {
      const k = s.players[5];
      const [dx, dy] = [k.x - me.x, k.y - me.y + 0.8];
      const l = Math.hypot(dx, dy) || 1;
      stepMatch(s, { p1: input({ mx: dx / l, my: dy / l }) });
      if (s.ball.owner !== 4) lost = true;
    }
    expect(lost).toBe(false);
  });

  it('resta in porta quando l\'attaccante è lontano', () => {
    const s = newMatch({ seed: 12 });
    toPlay(s);
    run(s, 300);
    for (let i = 0; i < 600; i++) {
      stepMatch(s, {});
      for (const k of [s.players[0], s.players[5]]) {
        const fromLine = k.team === 0 ? k.x : FIELD.length - k.x;
        expect(fromLine).toBeLessThan(6.5);
      }
    }
  });

  it('si tuffa sui tiri angolati e a volte respinge invece di bloccare', () => {
    const s = newMatch({ seed: 13 });
    toPlay(s);
    let dives = 0;
    let saves = 0;
    let catches = 0;
    for (let i = 0; i < 80; i++) {
      parkOthers(s, [4, 5]);
      const k = s.players[5];
      Object.assign(k, { x: FIELD.length - 0.9, y: CENTER_Y, vx: 0, vy: 0, stun: 0 });
      k.action.kind = 'none';
      const sh = s.players[4];
      Object.assign(sh, { x: 24, y: CENTER_Y - 3 + (i % 7), stun: 0 });
      Object.assign(s.ball, { owner: 4, inGoal: -1 });
      s.phase = 'play';
      shoot(s, sh, 0.55 + (i % 4) * 0.1, i % 2 ? 0.85 : -0.85);
      for (let t = 0; t < 70 && s.phase === 'play'; t++) {
        stepMatch(s, {});
        for (const e of s.events) {
          if (e.type === 'dive') dives++;
          if (e.type === 'save') saves++;
          if (e.type === 'catch') catches++;
        }
        if (s.ball.owner >= 0 && s.ball.owner !== 5) break;
      }
      if ((s.phase as string) === 'goal') {
        s.phase = 'play';
        s.ball.inGoal = -1;
      }
    }
    expect(dives).toBeGreaterThan(20);
    expect(saves).toBeGreaterThan(3); // respinte
    expect(catches).toBeGreaterThan(3); // prese
  });
});

describe('contrasti', () => {
  function duel(seed: number, from: 'front' | 'side' | 'behind', defStats = {}, carStats = {}) {
    const s = newMatch({ seed, home: withStats(TEAMS[0], defStats), away: withStats(TEAMS[1], carStats) });
    toPlay(s);
    parkOthers(s, [1, 9]);
    const c = s.players[9];
    const d = s.players[1];
    Object.assign(c, { x: 18, y: 11, fx: -1, fy: 0, vx: 0, vy: 0, stun: 0, evade: 0 });
    const pos = { front: [17, 11], side: [18, 10.1], behind: [19, 11] }[from];
    Object.assign(d, { x: pos[0], y: pos[1], stun: 0, tackleCd: 0, slideCd: 0 });
    s.ball.owner = 9;
    stepMatch(s, {}); // aggancia la palla
    Object.assign(c, { x: 18, y: 11, fx: -1, fy: 0, vx: 0, vy: 0, stun: 0, evade: 0 });
    Object.assign(d, { x: pos[0], y: pos[1], vx: 0, vy: 0, stun: 0, tackleCd: 0, slideCd: 0 });
    d.action.kind = 'none';
    c.action.kind = 'none';
    s.ball.owner = 9;
    return { s, c, d };
  }

  it('entrando da dietro si fa spesso fallo: chi lo subisce tiene palla', () => {
    let fouls = 0;
    for (let i = 0; i < 40; i++) {
      const { s, d } = duel(100 + i, 'behind');
      startTackle(s, d);
      d.action.t = 0.15;
      resolveTackle(s, d);
      if (s.events.some((e) => e.type === 'foul')) {
        fouls++;
        expect(s.ball.owner).toBe(9);
      }
    }
    expect(fouls).toBeGreaterThan(8);
  });

  it('di lato è una spallata: conta la forza', () => {
    const win = (dstr: number, cstr: number) => {
      let w = 0;
      for (let i = 0; i < 60; i++) {
        const { s, d } = duel(200 + i, 'side', { strength: dstr }, { strength: cstr });
        startTackle(s, d);
        d.action.t = 0.15;
        resolveTackle(s, d);
        if (s.ball.owner !== 9) w++;
      }
      return w;
    };
    expect(win(95, 45)).toBeGreaterThan(win(45, 95) + 15);
  });

  it('scivolata a vuoto: resti a terra fuori tempo', () => {
    const { s, d } = duel(300, 'front');
    s.ball.owner = -1;
    Object.assign(s.ball, { x: 30, y: 3, vx: 0, vy: 0 }); // palla lontanissima
    startSlide(s, d);
    run(s, 50);
    expect(['fall', 'none']).toContain(d.action.kind);
    // Nei 0,65 s di scivolata + 0,55 a terra non può fare nulla.
    const s2 = duel(301, 'front');
    s2.s.ball.owner = -1;
    Object.assign(s2.s.ball, { x: 30, y: 3, vx: 0, vy: 0 });
    startSlide(s2.s, s2.d);
    run(s2.s, 42);
    expect(s2.d.action.kind).toBe('fall');
    expect(s2.d.stun).toBeGreaterThan(0);
  });

  it('scivolata pulita da davanti: palla via', () => {
    let won = 0;
    for (let i = 0; i < 30; i++) {
      const { s, d } = duel(400 + i, 'front');
      d.x = 16;
      startSlide(s, d);
      run(s, 30);
      if (s.ball.owner !== 9) won++;
    }
    expect(won).toBeGreaterThan(15);
  });
});

describe('dribbling', () => {
  function ballOffsets(drib: number, sprint: boolean) {
    const s = newMatch({ seed: 21, human: true, home: withStats(TEAMS[0], { dribbling: drib }) });
    toPlay(s);
    parkOthers(s, [4]);
    let max = 0;
    for (let t = 0; t < 120; t++) {
      stepMatch(s, { p1: input({ mx: 0, my: t % 240 < 120 ? 1 : -1, sprint }) });
      max = Math.max(max, s.players[4].ballOff);
    }
    return max;
  }

  it('palla vicina a passo normale, si allunga in scatto; chi dribbla male la allunga di più', () => {
    expect(ballOffsets(90, false)).toBeLessThan(0.6);
    expect(ballOffsets(90, true)).toBeGreaterThan(ballOffsets(90, false) + 0.25);
    expect(ballOffsets(40, true)).toBeGreaterThan(ballOffsets(95, true) + 0.25);
  });

  it('cambi di direzione bruschi in scatto: chi dribbla male perde palla più spesso', () => {
    const losses = (drib: number) => {
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const s = newMatch({ seed: 500 + i, human: true, home: withStats(TEAMS[0], { dribbling: drib }) });
        toPlay(s);
        parkOthers(s, [4]);
        Object.assign(s.players[4], { x: 18, y: 4 });
        run(s, 50, { p1: input({ mx: 0, my: 1, sprint: true }) });
        run(s, 12, { p1: input({ mx: 0, my: -1, sprint: true }) });
        if (s.events.some((e) => e.type === 'heavyTouch') || s.ball.owner !== 4) n++;
      }
      return n;
    };
    expect(losses(40)).toBeGreaterThan(losses(95) + 5);
  });
});

describe('tiri', () => {
  it('il tiro a giro ha effetto e curva verso la porta', () => {
    const s = newMatch({ seed: 31 });
    toPlay(s);
    parkOthers(s, [4]);
    const p = s.players[4];
    Object.assign(p, { x: 22, y: CENTER_Y });
    s.ball.owner = 4;
    shoot(s, p, 0.6, 0.9, 1);
    expect(s.ball.spin).not.toBe(0);
    const vy0 = s.ball.vy;
    run(s, 15);
    // La componente laterale cambia sotto l'effetto (la palla curva).
    expect(Math.abs(s.ball.vy - vy0)).toBeGreaterThan(0.8);
  });
});

describe('skill', () => {
  it('veronica: il giocatore gira intorno al difensore e finisce alle sue spalle', () => {
    const s = newMatch({ seed: 41, human: true });
    toPlay(s);
    parkOthers(s, [4, 6]);
    const me = s.players[4];
    const d = s.players[6];
    Object.assign(me, { x: 20, y: CENTER_Y, fx: 1, fy: 0, vx: 0, vy: 0 });
    Object.assign(d, { x: 21.3, y: CENTER_Y, stun: 0 });
    s.ball.owner = 4;
    special(s, me, 0);
    expect(me.action.kind).toBe('veronica');
    run(s, 32, { p1: input() });
    expect(me.x).toBeGreaterThan(d.x + 0.6); // ora è oltre il difensore
    expect(s.ball.owner).toBe(4);
  });

  it('tunnel: la palla passa tra le gambe del difensore, che resta piantato', () => {
    const s = newMatch({ seed: 42, home: TEAMS[2], human: true });
    toPlay(s);
    parkOthers(s, [4, 6]);
    const me = s.players[4];
    const d = s.players[6];
    Object.assign(me, { x: 20, y: CENTER_Y, fx: 1, fy: 0 });
    Object.assign(d, { x: 22, y: CENTER_Y, stun: 0 });
    s.ball.owner = 4;
    special(s, me, 1);
    expect(d.stun).toBeGreaterThan(0.5);
    run(s, 40, { p1: input() });
    expect(s.ball.x).toBeGreaterThan(d.x);
  });
});

describe('bilanciamento', () => {
  it('CPU contro CPU: in media 3-7 gol a partita da 3 minuti', () => {
    let goals = 0;
    const N = 10;
    for (let i = 0; i < N; i++) {
      const s = newMatch({ seed: 900 + i, home: TEAMS[i % 5], away: TEAMS[(i + 2) % 5] });
      let g = 0;
      while (s.phase !== 'ended' && g++ < 60 * 60 * 6) stepMatch(s, {});
      goals += s.score[0] + s.score[1];
    }
    const avg = goals / N;
    expect(avg).toBeGreaterThanOrEqual(3);
    expect(avg).toBeLessThanOrEqual(7.5);
  }, 60000);
});
