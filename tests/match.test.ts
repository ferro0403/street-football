import { describe, expect, it } from 'vitest';
import { CENTER_Y, FIELD, RULES } from '../src/shared/constants';
import { createMatch, stepMatch } from '../src/shared/match';
import { shoot, resolveTackle, startTackle } from '../src/shared/actions';
import { updateKeeper } from '../src/shared/keeper';
import { stepBall } from '../src/shared/ball';
import { TEAMS } from '../src/shared/teams';
import { overall, tackleChance } from '../src/shared/stats';
import type { MatchState } from '../src/shared/types';
import { input, newMatch, parkOthers, run, toPlay, withStats } from './helpers';

function controlled(s: MatchState, id = 'p1') {
  const c = s.controllers.find((x) => x.id === id)!;
  return s.players[c.player];
}

describe('partita: flusso', () => {
  it('parte dal calcio d\'inizio e poi si gioca', () => {
    const s = newMatch({ human: true });
    expect(s.phase).toBe('kickoff');
    toPlay(s);
    expect(s.phase).toBe('play');
    expect(s.ball.owner).toBe(4); // attaccante della squadra 0
    expect(controlled(s).idx).toBe(4);
  });

  it('il timer finisce la partita', () => {
    const s = newMatch({ duration: 5 });
    let end = false;
    for (let i = 0; i < 60 * 60 && s.phase !== 'ended'; i++) {
      stepMatch(s, {});
      if (s.events.some((e) => e.type === 'end')) end = true;
    }
    expect(s.phase).toBe('ended');
    expect(end).toBe(true);
    expect(s.clock).toBe(0);
  });

  it('CPU contro CPU: partita completa senza valori non validi', () => {
    const s = newMatch({ seed: 2024 });
    let guard = 0;
    while (s.phase !== 'ended' && guard++ < 60 * 60 * 10) stepMatch(s, {});
    expect(s.phase).toBe('ended');
    for (const p of s.players) {
      expect(Number.isFinite(p.x + p.y + p.vx + p.vy)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(FIELD.length);
    }
    const goals = s.score[0] + s.score[1];
    expect(goals).toBeGreaterThan(0);
    expect(goals).toBeLessThan(30);
    expect(s.stats[0].passes + s.stats[1].passes).toBeGreaterThan(40);
  });

  it('dopo un gol: esultanza, poi batte chi ha subito', () => {
    const s = newMatch({ seed: 5 });
    toPlay(s);
    const p = s.players[4];
    s.ball.owner = p.idx;
    p.x = 31;
    p.y = CENTER_Y;
    parkOthers(s, [4]);
    shoot(s, p, 0.6, 0);
    let goal = false;
    for (let i = 0; i < 120 && !goal; i++) {
      stepMatch(s, {});
      goal = s.events.some((e) => e.type === 'goal');
    }
    expect(goal).toBe(true);
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('goal');
    expect(s.players[4].action.kind).toBe('celebrate');
    run(s, Math.ceil(RULES.goalPhaseSec * 60) + 2);
    expect(s.phase).toBe('kickoff');
    expect(s.kickoffTeam).toBe(1);
  });
});

describe('controlli umani', () => {
  it('tenere premuto tiro carica la potenza e al rilascio tira', () => {
    const fast = newMatch({ human: true, seed: 11 });
    const slow = newMatch({ human: true, seed: 11 });
    toPlay(fast);
    toPlay(slow);
    parkOthers(fast, [4]);
    parkOthers(slow, [4]);
    run(fast, 50, { p1: input({ shoot: true }) });
    run(slow, 5, { p1: input({ shoot: true }) });
    expect(controlled(fast).charge).toBeGreaterThan(0.5);
    stepMatch(fast, { p1: input() });
    stepMatch(slow, { p1: input() });
    expect(fast.ball.owner).toBe(-1);
    expect(slow.ball.owner).toBe(-1);
    const v = (s: MatchState) => Math.hypot(s.ball.vx, s.ball.vy);
    expect(v(fast)).toBeGreaterThan(v(slow) + 5);
  });

  it('il passaggio va a un compagno e il controllo passa a lui', () => {
    const s = newMatch({ human: true, seed: 12 });
    toPlay(s);
    const before = controlled(s).idx;
    stepMatch(s, { p1: input({ pass: true, mx: -1 }) });
    stepMatch(s, { p1: input() });
    const ev = s.ball.passTarget;
    expect(ev).toBeGreaterThanOrEqual(0);
    expect(s.players[ev].team).toBe(0);
    expect(controlled(s).idx).toBe(ev);
    expect(controlled(s).idx).not.toBe(before);
  });

  it('tasto cambio: passa a un altro giocatore della squadra (mai al portiere)', () => {
    const s = newMatch({ human: true, seed: 13 });
    toPlay(s);
    const a = controlled(s).idx;
    stepMatch(s, { p1: input({ switch: true }) });
    const b = controlled(s);
    expect(b.idx).not.toBe(a);
    expect(b.team).toBe(0);
    expect(b.role).toBe('field');
  });

  it('senza palla, tiro = contrasto', () => {
    const s = newMatch({ human: true, seed: 14 });
    toPlay(s);
    // Diamo la palla agli avversari.
    s.ball.owner = 9;
    stepMatch(s, { p1: input({ switch: true }) });
    stepMatch(s, { p1: input() });
    const me = controlled(s);
    stepMatch(s, { p1: input({ shoot: true }) });
    expect(me.action.kind).toBe('tackle');
  });

  it('cooperativa: due umani nella stessa squadra guidano giocatori diversi', () => {
    const s = createMatch({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 1,
      humans: [
        { id: 'a', team: 0 },
        { id: 'b', team: 0 },
      ],
    });
    toPlay(s);
    const pa = controlled(s, 'a');
    const pb = controlled(s, 'b');
    expect(pa.idx).not.toBe(pb.idx);
    run(s, 30, { a: input({ mx: 0, my: 1 }), b: input({ mx: 0, my: -1 }) });
    expect(pa.vy).toBeGreaterThan(0);
    expect(pb.vy).toBeLessThan(0);
  });
});

describe('le statistiche contano', () => {
  it('overall: media pesata', () => {
    expect(overall({ speed: 80, shooting: 80, passing: 80, dribbling: 80, defense: 80, strength: 80 }, 'field')).toBe(80);
    expect(overall({ speed: 50, shooting: 10, passing: 50, dribbling: 10, defense: 90, strength: 60 }, 'gk')).toBe(78);
  });

  it('un giocatore più veloce copre più strada', () => {
    const fast = newMatch({ human: true, home: withStats(TEAMS[0], { speed: 95 }) });
    const slow = newMatch({ human: true, home: withStats(TEAMS[0], { speed: 40 }) });
    for (const s of [fast, slow]) {
      toPlay(s);
      s.ball.owner = 9; // il mio giocatore corre senza palla
      stepMatch(s, { p1: input() });
    }
    const a = controlled(fast);
    const b = controlled(slow);
    const ax = a.x;
    const bx = b.x;
    run(fast, 60, { p1: input({ mx: 0, my: 1 }) });
    run(slow, 60, { p1: input({ mx: 0, my: 1 }) });
    expect(Math.abs(a.y - 11) + Math.abs(a.x - ax)).toBeGreaterThan(Math.abs(b.y - 11) + Math.abs(b.x - bx) + 1);
  });

  it('un tiratore migliore calcia più forte', () => {
    const strong = newMatch({ home: withStats(TEAMS[0], { shooting: 95 }) });
    const weak = newMatch({ home: withStats(TEAMS[0], { shooting: 40 }) });
    for (const s of [strong, weak]) {
      toPlay(s);
      shoot(s, s.players[4], 1, 0);
    }
    expect(Math.hypot(strong.ball.vx, strong.ball.vy)).toBeGreaterThan(Math.hypot(weak.ball.vx, weak.ball.vy) + 4);
  });

  it('un tiratore migliore è più preciso', () => {
    const spread = (shooting: number) => {
      const s = newMatch({ seed: 77, home: withStats(TEAMS[0], { shooting }) });
      toPlay(s);
      let sum = 0;
      for (let i = 0; i < 200; i++) {
        const p = s.players[4];
        s.ball.owner = p.idx;
        p.x = 24;
        p.y = CENTER_Y;
        shoot(s, p, 0.7, 0);
        sum += Math.abs(s.ball.vy / s.ball.vx);
      }
      return sum / 200;
    };
    expect(spread(95)).toBeLessThan(spread(40) * 0.6);
  });

  it('contrasti: la difesa alta vince più spesso del dribbling basso', () => {
    const strongDef = tackleChance({ speed: 50, shooting: 50, passing: 50, dribbling: 50, defense: 90, strength: 60 }, { speed: 50, shooting: 50, passing: 50, dribbling: 50, defense: 50, strength: 60 });
    const weakDef = tackleChance({ speed: 50, shooting: 50, passing: 50, dribbling: 50, defense: 50, strength: 60 }, { speed: 50, shooting: 50, passing: 50, dribbling: 90, defense: 50, strength: 60 });
    expect(strongDef).toBeGreaterThan(0.75);
    expect(weakDef).toBeLessThan(0.25);

    // E nel gioco vero: 100 contrasti simulati.
    const wins = (def: number, drib: number) => {
      const s = newMatch({ seed: 9, home: withStats(TEAMS[0], { defense: def }), away: withStats(TEAMS[1], { dribbling: drib }) });
      toPlay(s);
      let w = 0;
      for (let i = 0; i < 100; i++) {
        const d = s.players[1];
        const c = s.players[9];
        Object.assign(c, { x: 18, y: 11, evade: 0, stun: 0 });
        Object.assign(d, { x: 17, y: 11, tackleCd: 0, stun: 0, action: { kind: 'none', t: 0, dur: 0, dx: 0, dy: 0, done: false } });
        s.ball.owner = 9;
        startTackle(s, d);
        d.action.t = 0.2;
        resolveTackle(s, d);
        if (s.ball.owner !== 9) w++;
      }
      return w;
    };
    expect(wins(92, 45)).toBeGreaterThan(wins(45, 92) + 30);
  });

  it('la finta schiva il contrasto', () => {
    const s = newMatch({ seed: 10, human: true });
    toPlay(s);
    const d = s.players[6];
    const me = controlled(s);
    Object.assign(d, { x: me.x + 1, y: me.y, tackleCd: 0, stun: 0 });
    stepMatch(s, { p1: input({ feint: true }) });
    expect(me.evade).toBeGreaterThan(0);
    startTackle(s, d);
    d.action.t = 0.2;
    Object.assign(d, { x: me.x + 0.8, y: me.y });
    resolveTackle(s, d);
    expect(s.ball.owner).toBe(me.idx);
    expect(d.stun).toBeGreaterThan(0);
  });
});

describe('portiere', () => {
  function shotsSaved(gkDefense: number, aim: number, n = 60): number {
    const s = newMatch({ seed: 31, away: withStats(TEAMS[1], {}, { defense: gkDefense }) });
    toPlay(s);
    let saved = 0;
    for (let i = 0; i < n; i++) {
      const shooter = s.players[4];
      const k = s.players[5];
      parkOthers(s, [4, 5]);
      Object.assign(k, { x: FIELD.length - 0.9, y: CENTER_Y, vx: 0, vy: 0, stun: 0 });
      k.action.kind = 'none';
      Object.assign(shooter, { x: 26, y: CENTER_Y, stun: 0 });
      Object.assign(s.ball, { owner: 4, inGoal: -1 });
      s.phase = 'play';
      shoot(s, shooter, 0.6, aim);
      for (let t = 0; t < 90; t++) {
        s.events = [];
        // Solo palla + portiere: niente altri giocatori.
        const r = updateKeeper(s, k);
        k.x += r.mx * r.speed / 60;
        k.y += r.my * r.speed / 60;
        if (s.ball.owner >= 0) break;
        stepBall(s);
        if (s.ball.inGoal >= 0) break;
      }
      if (s.ball.inGoal < 0) saved++;
    }
    return saved;
  }

  it('para molti tiri centrali ma non tutti', () => {
    const saved = shotsSaved(85, 0);
    expect(saved).toBeGreaterThan(30);
    expect(saved).toBeLessThan(60);
  });

  it('un portiere migliore para di più', () => {
    expect(shotsSaved(95, 0.7)).toBeGreaterThan(shotsSaved(40, 0.7) + 5);
  });
});

describe('skill speciali', () => {
  for (const team of TEAMS) {
    it(`${team.nation}: ${team.style} parte e ha un tempo di ricarica`, () => {
      const s = newMatch({ human: true, home: team, away: TEAMS.find((t) => t.id !== team.id)!, seed: 21 });
      toPlay(s);
      const me = controlled(s);
      // Avversario davanti (serve al tunnel) e porta vicina (serve alla rabona).
      me.x = 24;
      me.y = CENTER_Y;
      me.fx = 1;
      me.fy = 0;
      const opp = s.players[6];
      Object.assign(opp, { x: 25.5, y: CENTER_Y, stun: 0 });
      stepMatch(s, { p1: input({ skill: true }) });
      expect(s.events.some((e) => e.type === 'special' && e.skill === team.style)).toBe(true);
      expect(me.skillCd).toBeGreaterThan(0);
    });
  }
});
