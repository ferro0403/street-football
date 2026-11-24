import { describe, expect, it } from 'vitest';
import { CENTER_Y, FIELD, RULES } from '../src/shared/constants';
import { createMatch, stepMatch } from '../src/shared/match';
import { shoot } from '../src/shared/actions';
import { TEAMS } from '../src/shared/teams';
import { overall } from '../src/shared/stats';
import type { MatchState } from '../src/shared/types';
import { input, newMatch, parkOthers, run, toPlay, withStats } from './helpers';

export function controlled(s: MatchState, id = 'p1') {
  const c = s.controllers.find((x) => x.id === id)!;
  return s.players[c.player];
}

describe('partita: flusso', () => {
  it("parte dal calcio d'inizio e poi si gioca", () => {
    const s = newMatch({ human: true });
    expect(s.phase).toBe('kickoff');
    toPlay(s);
    expect(s.phase).toBe('play');
    expect(s.ball.owner).toBe(4);
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
    expect(s.stats[0].passes + s.stats[1].passes).toBeGreaterThan(40);
  });

  it('niente arbitro: nessun fallo, nessun fischio durante il gioco', () => {
    const s = newMatch({ seed: 77 });
    toPlay(s);
    const types = new Set<string>();
    let whistlesInPlay = 0;
    while (s.phase !== 'ended') {
      const wasPlay = s.phase === 'play';
      stepMatch(s, {});
      for (const e of s.events) {
        types.add(e.type);
        // Fischio solo all'inizio (kickoff) e alla fine della partita.
        if (e.type === 'whistle' && wasPlay && s.phase === 'play') whistlesInPlay++;
      }
    }
    expect(types.has('foul' as never)).toBe(false);
    expect(whistlesInPlay).toBe(0);
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
    expect(s.players[4].action.kind).toBe('celebrate');
    run(s, Math.ceil(RULES.goalPhaseSec * 60) + 2);
    expect(s.phase).toBe('kickoff');
    expect(s.kickoffTeam).toBe(1);
  });
});

describe('controlli e cambio giocatore', () => {
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

  it('senza palla, PASSA = cambio giocatore', () => {
    const s = newMatch({ human: true, seed: 14 });
    toPlay(s);
    s.ball.owner = 9;
    const a = controlled(s).idx;
    stepMatch(s, { p1: input({ pass: true }) });
    expect(controlled(s).idx).not.toBe(a);
  });

  it('cooperativa: due umani nella stessa squadra guidano giocatori diversi', () => {
    const s = createMatch({ home: TEAMS[0], away: TEAMS[1], seed: 1, humans: [{ id: 'a', team: 0 }, { id: 'b', team: 0 }] });
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
  });

  it('un giocatore più veloce copre più strada', () => {
    const fast = newMatch({ human: true, home: withStats(TEAMS[0], { speed: 95 }) });
    const slow = newMatch({ human: true, home: withStats(TEAMS[0], { speed: 40 }) });
    const moved: number[] = [];
    for (const s of [fast, slow]) {
      toPlay(s);
      parkOthers(s, [4]);
      const me = controlled(s);
      const y0 = me.y;
      run(s, 60, { p1: input({ mx: 0, my: 1 }) });
      moved.push(me.y - y0);
    }
    expect(moved[0]).toBeGreaterThan(moved[1] + 1);
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
});
