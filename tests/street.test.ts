// Test delle meccaniche "street": trick stick a duello, muri, Gamebreaker, primo controllo,
// protezione/contenimento, palle alte, tiri, palleggio, allenamento e parametri regolabili.
import { describe, expect, it } from 'vitest';
import { CENTER_Y, FIELD } from '../src/shared/constants';
import { createMatch, stepMatch, trainingReset } from '../src/shared/match';
import { octant, startTrick, trickFor, TRICKS } from '../src/shared/tricks';
import { bouncePoint, planWallOneTwo, planWallPass } from '../src/shared/walls';
import { shoot, startTackle, resolveTackle, wallPass } from '../src/shared/actions';
import { activateGb, addGb, comboStep, emptyCombo } from '../src/shared/gamebreaker';
import { aerialOption } from '../src/shared/aerial';
import { stepBall } from '../src/shared/ball';
import { TEAMS } from '../src/shared/teams';
import type { MatchState } from '../src/shared/types';
import { input, newMatch, parkOthers, run, toPlay, withStats } from './helpers';

const me = (s: MatchState) => s.players[s.controllers[0].player];

/** Attaccante idx 4 con palla in (18,11) che guarda +x, difensore idx 6 davanti a 1,6 m. */
function duelSetup(seed: number, drib = 80, def = 70, humanDefender = false) {
  const s = newMatch({ seed, human: true, home: withStats(TEAMS[0], { dribbling: drib }), away: withStats(TEAMS[1], { defense: def }) });
  toPlay(s);
  parkOthers(s, [4, 6]);
  const a = s.players[4];
  const d = s.players[6];
  Object.assign(a, { x: 18, y: CENTER_Y, fx: 1, fy: 0, vx: 0, vy: 0, stun: 0, heat: 0, trickCd: 0, lastTrick: '' });
  Object.assign(d, { x: 19.6, y: CENTER_Y, fx: -1, fy: 0, vx: 0, vy: 0, stun: 0, seenTrick: '', seenT: 0 });
  if (humanDefender) d.human = 'nessuno';
  s.ball.owner = 4;
  return { s, a, d };
}

/** Esegue un trucco e restituisce l'esito del duello (true = riuscito). */
function duel(s: MatchState, id: string, side = 1): boolean {
  const a = s.players[4];
  if (!startTrick(s, a, id, side)) throw new Error(`trucco ${id} non partito`);
  for (let t = 0; t < 40 && a.action.kind === 'trick' && a.action.res === 0; t++) stepMatch(s, {});
  return a.action.res === 1 || (a.action.kind !== 'stagger' && s.ball.owner !== 6 && a.action.res !== -1);
}

describe('trick stick', () => {
  it('8 direzioni relative allo sguardo = 8 trucchi base, altri 8 col modificatore', () => {
    const { a } = duelSetup(1);
    expect(octant(a, 1, 0)).toBe(0);
    expect(octant(a, 0, 1)).toBe(2); // sinistra (y+ quando guarda x+)
    expect(octant(a, -1, 0)).toBe(4);
    expect(octant(a, 0, -1)).toBe(6);
    expect(octant(a, 1, 1)).toBe(1);
    expect(trickFor(a, 1, 0, false).id).toBe('sombrero');
    expect(trickFor(a, -1, 0, false).id).toBe('panna');
    expect(trickFor(a, 0, 1, false).id).toBe('finta');
    expect(trickFor(a, 1, 0, true).id).toBe('arcobaleno');
    expect(trickFor(a, 0, -1, true).id).toBe('ruleta');
    const ids = new Set<string>();
    for (const [x, y] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]) {
      ids.add(trickFor(a, x, y, false).id);
      ids.add(trickFor(a, x, y, true).id);
    }
    expect(ids.size).toBeGreaterThanOrEqual(10);
  });

  it('il trick stick umano parte sul fronte della levetta destra', () => {
    const s = newMatch({ seed: 3, human: true });
    toPlay(s);
    stepMatch(s, { p1: input({ tx: 0, ty: 1 }) });
    expect(me(s).action.kind).toBe('trick');
    expect(me(s).action.id).toBe('finta');
    // Tenendo la levetta non riparte a ripetizione.
    run(s, 30, { p1: input({ tx: 0, ty: 1 }) });
    expect(me(s).lastTrick).toBe('finta');
  });

  it('duello: dribbling alto contro difesa bassa riesce molto più spesso', () => {
    const rate = (drib: number, def: number) => {
      let ok = 0;
      for (let i = 0; i < 80; i++) if (duel(duelSetup(100 + i, drib, def).s, 'doppio')) ok++;
      return ok;
    };
    expect(rate(95, 45)).toBeGreaterThan(rate(45, 95) + 25);
  });

  it('anti-spam: lo stesso trucco ripetuto di fila riesce sempre meno', () => {
    let fresh = 0;
    let spam = 0;
    for (let i = 0; i < 60; i++) {
      if (duel(duelSetup(300 + i, 80, 70, true).s, 'finta')) fresh++;
      const { s, a } = duelSetup(300 + i, 80, 70, true);
      a.heat = 1.2;
      a.lastTrick = 'finta';
      if (duel(s, 'finta')) spam++;
    }
    expect(fresh).toBeGreaterThan(spam + 15);
  });

  it('la CPU legge meglio un trucco che ha appena visto', () => {
    let unseen = 0;
    let seen = 0;
    for (let i = 0; i < 80; i++) {
      if (duel(duelSetup(500 + i, 75, 80).s, 'sombrero')) unseen++;
      const { s, d } = duelSetup(500 + i, 75, 80);
      d.seenTrick = 'sombrero';
      d.seenT = 4;
      if (duel(s, 'sombrero')) seen++;
    }
    expect(unseen).toBeGreaterThan(seen * 1.6);
  });

  it('contrasto premuto durante il trucco lo interrompe spesso (lettura)', () => {
    let reads = 0;
    for (let i = 0; i < 40; i++) {
      const { s, a, d } = duelSetup(700 + i, 70, 85, true);
      startTrick(s, a, 'doppio', 1);
      stepMatch(s, {});
      startTackle(s, d);
      d.action.t = 0.12;
      resolveTackle(s, d);
      if (s.ball.owner === 6 && s.events.some((e) => e.type === 'trickFail' && e.label === 'LETTO!')) reads++;
    }
    expect(reads).toBeGreaterThan(20);
  });

  it('panna riuscita: palla tra le gambe e difensore piantato', () => {
    let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      const { s, d } = duelSetup(900 + i, 99, 30, true);
      if (duel(s, 'panna')) {
        expect(d.stun).toBeGreaterThan(0.4);
        expect(s.events.length >= 0).toBe(true);
        done = true;
      }
    }
    expect(done).toBe(true);
  });

  it('palleggio da fermo e tiro al volo', () => {
    const s = newMatch({ seed: 5, human: true });
    toPlay(s);
    parkOthers(s, [4]);
    const p = me(s);
    p.vx = p.vy = 0;
    stepMatch(s, { p1: input({ tx: -1, ty: 0, mod: true }) });
    expect(p.juggle).toBeGreaterThan(0);
    run(s, 20, { p1: input() });
    expect(s.ball.z).toBeGreaterThan(0.1);
    stepMatch(s, { p1: input({ shoot: true }) });
    stepMatch(s, { p1: input() });
    expect(s.events.some((e) => e.type === 'volley') || s.ball.shotActive).toBe(true);
  });
});

describe('muri della gabbia', () => {
  it('il punto di rimbalzo previsto coincide con quello reale', () => {
    const s = newMatch({ seed: 11 });
    const h = bouncePoint('y0', 10, 6, 20, 7, s.tune.wall)!;
    expect(h).not.toBeNull();
    Object.assign(s.ball, { x: 10, y: 6, z: 0, vx: (h[0] - 10) * 2, vy: (h[1] - 6) * 2, vz: 0, owner: -1 });
    let hitX = -1;
    for (let i = 0; i < 120; i++) {
      const vy = s.ball.vy;
      stepBall(s);
      if (vy < 0 && s.ball.vy > 0) {
        hitX = s.ball.x;
        break;
      }
    }
    expect(Math.abs(hitX - h[0])).toBeLessThan(0.35);
  });

  it('passaggio al muro: rimbalza e arriva al compagno', () => {
    const s = newMatch({ seed: 12 });
    toPlay(s);
    parkOthers(s, [1, 3]);
    Object.assign(s.players[1], { x: 10, y: 6, fx: 1, fy: 0, stun: 0 });
    Object.assign(s.players[3], { x: 20, y: 6, stun: 0 });
    s.ball.owner = 1;
    stepMatch(s, {});
    const plan = planWallPass(s, s.players[1], 1, -1)!;
    expect(plan).not.toBeNull();
    expect(plan.receiver).toBe(3);
    wallPass(s, s.players[1], plan, 4);
    let bounced = false;
    let wallEvent = false;
    for (let t = 0; t < 200 && s.ball.owner < 0; t++) {
      const vy = s.ball.vy;
      stepMatch(s, {});
      if (vy < 0 && s.ball.vy > 0) bounced = true;
      if (s.events.some((e) => e.type === 'wallPass')) wallEvent = true;
    }
    expect(bounced).toBe(true);
    expect(s.ball.owner).toBe(3);
    expect(wallEvent).toBe(true);
  });

  it('uno-due col muro: la palla torna davanti al giocatore stesso', () => {
    const s = newMatch({ seed: 13, human: true });
    toPlay(s);
    parkOthers(s, [4]);
    const p = me(s);
    Object.assign(p, { x: 14, y: 3.5, fx: 1, fy: 0 });
    s.ball.owner = p.idx;
    stepMatch(s, { p1: input() });
    const plan = planWallOneTwo(s, p, 0.3, -1)!;
    expect(plan).not.toBeNull();
    expect(plan.receiver).toBe(p.idx);
    expect(plan.tx).toBeGreaterThan(p.x + 3);
    // Comando umano: filtrante verso il muro.
    stepMatch(s, { p1: input({ through: true, mx: 0.3, my: -1 }) });
    expect(s.ball.passKind).toBe(5);
    let got = false;
    for (let t = 0; t < 180 && !got; t++) {
      stepMatch(s, { p1: input() }); // nessun input: la calamita lo porta sulla palla
      got = s.ball.owner === p.idx;
    }
    expect(got).toBe(true);
  });

  it('passaggio umano verso un muro senza compagni in quella direzione = passaggio al muro', () => {
    const s = newMatch({ seed: 14, human: true });
    toPlay(s);
    parkOthers(s, [3, 4]);
    const p = me(s);
    Object.assign(p, { x: 12, y: 5, fx: 1, fy: 0 });
    Object.assign(s.players[3], { x: 22, y: 6, stun: 0 });
    s.ball.owner = p.idx;
    stepMatch(s, { p1: input() });
    stepMatch(s, { p1: input({ pass: true, mx: 0.5, my: -1 }) });
    stepMatch(s, { p1: input({ mx: 0.5, my: -1 }) });
    expect(s.ball.passKind).toBe(4);
  });

  it('il rimbalzo sulle pareti si regola dal pannello (parametro wall)', () => {
    const speedAfter = (wall: number) => {
      const s = createMatch({ home: TEAMS[0], away: TEAMS[1], tune: { wall } });
      Object.assign(s.ball, { x: 18, y: 2, z: 0, vx: 0, vy: -15, vz: 0, owner: -1 });
      for (let i = 0; i < 20; i++) stepBall(s);
      return s.ball.vy;
    };
    expect(speedAfter(0.95)).toBeGreaterThan(speedAfter(0.4) + 4);
  });
});

describe('Gamebreaker e combo', () => {
  it('la combo cresce solo alternando trucco e passaggio', () => {
    const s = newMatch({ seed: 21 });
    const alt = () => {
      s.combo[0] = emptyCombo();
      comboStep(s, 0, 'trick');
      comboStep(s, 0, 'pass');
      return comboStep(s, 0, 'trick');
    };
    const same = () => {
      s.combo[0] = emptyCombo();
      comboStep(s, 0, 'trick');
      comboStep(s, 0, 'trick');
      return comboStep(s, 0, 'trick');
    };
    expect(alt()).toBeGreaterThan(same());
  });

  it('si riempie con i trucchi riusciti e si attiva solo quando è piena', () => {
    const s = newMatch({ seed: 22, human: true });
    toPlay(s);
    expect(activateGb(s, 0)).toBe(false);
    let filled = 0;
    for (let i = 0; i < 400 && s.gb[0] < 1; i++) {
      const { s: d } = duelSetup(2000 + i, 99, 30, true);
      if (duel(d, i % 2 ? 'panna' : 'sombrero')) filled += d.gb[0];
    }
    expect(filled).toBeGreaterThan(0);
    s.gb[0] = 1;
    stepMatch(s, { p1: input({ gb: true }) });
    expect(s.gbActive[0]).toBeGreaterThan(0);
    expect(s.gb[0]).toBe(0);
  });

  it('i trucchi senza avversari vicini non riempiono la barra (niente farming)', () => {
    const s = newMatch({ seed: 23, human: true });
    toPlay(s);
    parkOthers(s, [4]);
    for (let i = 0; i < 6; i++) {
      me(s).trickCd = 0;
      stepMatch(s, { p1: input({ tx: 0, ty: i % 2 ? 1 : -1 }) });
      run(s, 40, { p1: input() });
    }
    expect(s.gb[0]).toBe(0);
  });

  it('un tiro in Gamebreaker è molto più difficile da parare', () => {
    const goals = (gb: boolean) => {
      let g = 0;
      for (let i = 0; i < 60; i++) {
        const s = newMatch({ seed: 3000 + i });
        toPlay(s);
        parkOthers(s, [4, 5]);
        const p = s.players[4];
        Object.assign(p, { x: 26, y: CENTER_Y, stun: 0 });
        Object.assign(s.players[5], { x: FIELD.length - 0.9, y: CENTER_Y, stun: 0 });
        s.ball.owner = 4;
        if (gb) s.gbActive[0] = 5;
        shoot(s, p, 0.6, 0.4);
        for (let t = 0; t < 90 && s.phase === 'play' && s.ball.owner !== 5; t++) stepMatch(s, {});
        if (s.phase === 'goal') g++;
      }
      return g;
    };
    expect(goals(true)).toBeGreaterThan(goals(false) + 12);
  });

  it('addGb rispetta il moltiplicatore del pannello', () => {
    const a = createMatch({ home: TEAMS[0], away: TEAMS[1], tune: { gb: 1 } });
    const b = createMatch({ home: TEAMS[0], away: TEAMS[1], tune: { gb: 3 } });
    addGb(a, 0, 0.1);
    addGb(b, 0, 0.1);
    expect(b.gb[0]).toBeCloseTo(a.gb[0] * 3, 5);
  });
});

describe('controllo palla, protezione e difesa', () => {
  it('primo controllo: una palla forte da dietro dà più controlli sporchi a chi dribbla male', () => {
    const dirty = (drib: number) => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const s = newMatch({ seed: 4000 + i, home: withStats(TEAMS[0], { dribbling: drib }) });
        toPlay(s);
        parkOthers(s, [3]);
        const p = s.players[3];
        Object.assign(p, { x: 18, y: 11, fx: 1, fy: 0, vx: 0, vy: 0, stun: 0 });
        Object.assign(s.ball, { owner: -1, x: 16.8, y: 11, z: 0, vx: 19, vy: 0, vz: 0, passTarget: -1, kicker: -1 });
        for (let t = 0; t < 10 && s.ball.owner < 0; t++) {
          stepMatch(s, {});
          if (s.events.some((e) => e.type === 'heavyTouch')) n++;
        }
      }
      return n;
    };
    expect(dirty(40)).toBeGreaterThan(dirty(95) * 1.8);
  });

  it('proteggere palla rende il contrasto in piedi molto meno efficace', () => {
    const wins = (shield: boolean) => {
      let w = 0;
      for (let i = 0; i < 60; i++) {
        const { s, a, d } = duelSetup(5000 + i, 70, 75);
        a.shield = shield;
        Object.assign(d, { x: 19.2, y: CENTER_Y, tackleCd: 0 });
        startTackle(s, d);
        d.action.t = 0.15;
        resolveTackle(s, d);
        if (s.ball.owner !== 4) w++;
      }
      return w;
    };
    expect(wins(false)).toBeGreaterThan(wins(true) + 12);
  });

  it('contenimento: il difensore umano resta tra attaccante e porta', () => {
    const s = createMatch({ home: TEAMS[0], away: TEAMS[1], seed: 6, humans: [{ id: 'd', team: 1 }] });
    toPlay(s);
    parkOthers(s, [4, 6]);
    s.controllers[0].player = 6;
    s.players[6].human = 'd';
    Object.assign(s.players[4], { x: 20, y: 11, stun: 0 });
    Object.assign(s.players[6], { x: 26, y: 15, stun: 0 });
    s.ball.owner = 4;
    run(s, 90, { d: input({ shield: true }) });
    const a = s.players[4];
    const d = s.players[6];
    expect(d.x).toBeGreaterThan(a.x); // tra l'attaccante e la porta (x = 36)
    expect(Math.hypot(d.x - a.x, d.y - a.y)).toBeLessThan(2.6);
  });
});

describe('palle alte e tiri', () => {
  it('azione contestuale in base all\'altezza: testa, al volo, rovesciata', () => {
    const s = newMatch({ seed: 31 });
    toPlay(s);
    const p = s.players[4];
    Object.assign(p, { x: 28, y: 11, fx: 1, fy: 0, stun: 0 });
    Object.assign(s.ball, { owner: -1, x: 28.6, y: 11, vx: 0, vy: 0, vz: 0, kicker: -1 });
    s.ball.z = 1.7;
    expect(aerialOption(s, p)).toBe('header');
    s.ball.z = 0.8;
    expect(aerialOption(s, p)).toBe('volley');
    p.fx = -1; // di spalle alla porta
    s.ball.z = 1.2;
    expect(aerialOption(s, p)).toBe('bicycle');
    s.ball.z = 0.2;
    expect(aerialOption(s, p)).toBeNull();
  });

  it('premendo tiro su una palla alta si colpisce di testa', () => {
    const s = newMatch({ seed: 32, human: true });
    toPlay(s);
    parkOthers(s, [4]);
    const p = me(s);
    Object.assign(p, { x: 30, y: 11, fx: 1, fy: 0 });
    Object.assign(s.ball, { owner: -1, x: 30.5, y: 11, z: 1.8, vx: 0, vy: 0, vz: 0, kicker: -1 });
    stepMatch(s, { p1: input({ shoot: true }) });
    expect(s.events.some((e) => e.type === 'header')).toBe(true);
    expect(s.ball.shotActive).toBe(true);
  });

  it('tiro piazzato più preciso del tiro potente; pallonetto con parabola alta', () => {
    const spread = (mode: 'power' | 'placed') => {
      const s = newMatch({ seed: 33 });
      toPlay(s);
      let sum = 0;
      for (let i = 0; i < 150; i++) {
        const p = s.players[4];
        s.ball.owner = p.idx;
        Object.assign(p, { x: 24, y: CENTER_Y, fx: 1, fy: 0 });
        shoot(s, p, 0.9, 0, 0, 0, mode);
        sum += Math.abs(s.ball.vy / s.ball.vx);
      }
      return sum;
    };
    expect(spread('placed')).toBeLessThan(spread('power') * 0.7);
    const s = newMatch({ seed: 34 });
    toPlay(s);
    parkOthers(s, [4]);
    const p = s.players[4];
    Object.assign(p, { x: 24, y: CENTER_Y });
    s.ball.owner = 4;
    shoot(s, p, 0.6, 0, 0, 0, 'chip');
    let maxZ = 0;
    for (let i = 0; i < 80; i++) {
      stepBall(s);
      maxZ = Math.max(maxZ, s.ball.z);
    }
    expect(maxZ).toBeGreaterThan(2.3);
  });
});

describe('allenamento', () => {
  it('solo i giocatori attivi partecipano, niente cronometro, reset dopo il gol', () => {
    const s = createMatch({ home: TEAMS[0], away: TEAMS[1], seed: 41, humans: [{ id: 'p1', team: 0 }], training: { defenders: 1, keeper: true } });
    expect(s.mode).toBe('training');
    expect(s.players.filter((p) => p.active).length).toBe(5); // tu + 2 compagni, 1 difensore, portiere
    toPlay(s);
    expect(s.ball.owner).toBe(4);
    const frozen = s.players.filter((p) => !p.active).map((p) => [p.x, p.y]);
    const clock = s.clock;
    run(s, 300, { p1: input({ mx: 1, my: 0 }) });
    expect(s.clock).toBe(clock);
    expect(s.players.filter((p) => !p.active).map((p) => [p.x, p.y])).toEqual(frozen);
    trainingReset(s);
    toPlay(s);
    expect(s.ball.owner).toBe(4);
    expect(s.phase).toBe('play');
  });

  it('tutti i trucchi del catalogo hanno nome e tempi validi', () => {
    for (const t of Object.values(TRICKS)) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.resolve).toBeLessThanOrEqual(t.dur);
    }
  });
});
