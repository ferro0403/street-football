import { createMatch, stepMatch, NEUTRAL_INPUT } from '../src/shared/match';
import { TEAMS } from '../src/shared/teams';
import type { InputMap, MatchState, PlayerInput, TeamDef } from '../src/shared/types';

export function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NEUTRAL_INPUT, ...over };
}

export function newMatch(opts: { seed?: number; human?: boolean; duration?: number; home?: TeamDef; away?: TeamDef } = {}) {
  return createMatch({
    home: opts.home ?? TEAMS[0],
    away: opts.away ?? TEAMS[1],
    seed: opts.seed ?? 42,
    durationSec: opts.duration,
    humans: opts.human ? [{ id: 'p1', team: 0 }] : [],
  });
}

/** Porta la partita in fase di gioco (dopo il calcio d'inizio). */
export function toPlay(s: MatchState, inputs: InputMap = {}): void {
  let guard = 0;
  while (s.phase !== 'play' && guard++ < 1000) stepMatch(s, inputs);
}

export function run(s: MatchState, ticks: number, inputs: InputMap | ((t: number) => InputMap) = {}): void {
  for (let i = 0; i < ticks; i++) stepMatch(s, typeof inputs === 'function' ? inputs(i) : inputs);
}

/** Copia una squadra cambiando le statistiche di tutti i giocatori di movimento. */
export function withStats(team: TeamDef, stats: Partial<TeamDef['players'][number]['stats']>, gk?: Partial<TeamDef['players'][number]['stats']>): TeamDef {
  return {
    ...team,
    players: team.players.map((p) => ({
      ...p,
      stats: { ...p.stats, ...(p.role === 'gk' ? gk ?? {} : stats) },
    })),
  };
}

/** Toglie tutti dal campo tranne i giocatori indicati (li manda in un angolo, fermi). */
export function parkOthers(s: MatchState, keep: number[]): void {
  for (const p of s.players) {
    if (keep.includes(p.idx)) continue;
    p.x = p.team === 0 ? 1 : 35;
    p.y = 0.5 + (p.idx % 5) * 0.9;
    p.stun = 1e6; // fermi per tutto il test
  }
}
