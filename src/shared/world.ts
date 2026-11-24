// Utilità geometriche sullo stato: porte, avversari più vicini, linee di passaggio.
import { CENTER_Y, FIELD } from './constants';
import { dist, segmentDistance } from './math';
import type { MatchState, PlayerState, TeamIndex } from './types';

/** La squadra 0 attacca verso x = length, la squadra 1 verso x = 0. */
export const attackDir = (team: TeamIndex): 1 | -1 => (team === 0 ? 1 : -1);
export const oppGoalX = (team: TeamIndex): number => (team === 0 ? FIELD.length : 0);
export const ownGoalX = (team: TeamIndex): number => (team === 0 ? 0 : FIELD.length);
export const other = (team: TeamIndex): TeamIndex => (team === 0 ? 1 : 0);

export function teamPlayers(s: MatchState, team: TeamIndex): PlayerState[] {
  return s.players.filter((p) => p.team === team);
}

export function keeperOf(s: MatchState, team: TeamIndex): PlayerState {
  return s.players[team === 0 ? 0 : 5];
}

export function nearestOpponent(
  s: MatchState,
  p: PlayerState,
  includeKeeper = true,
): { p: PlayerState | null; d: number } {
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (const q of s.players) {
    if (q.team === p.team) continue;
    if (!includeKeeper && q.role === 'gk') continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return { p: best, d: bd };
}

/** Distanza dal più vicino avversario a un punto (spazio libero). */
export function openness(s: MatchState, team: TeamIndex, x: number, y: number, cap = 6): number {
  let bd = cap;
  for (const q of s.players) {
    if (q.team === team) continue;
    const d = dist(x, y, q.x, q.y);
    if (d < bd) bd = d;
  }
  return bd;
}

/** Vero se nessun avversario (escluso eventualmente il portiere) taglia la linea. */
export function laneClear(
  s: MatchState,
  team: TeamIndex,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  ignoreKeeper = false,
): boolean {
  for (const q of s.players) {
    if (q.team === team) continue;
    if (ignoreKeeper && q.role === 'gk') continue;
    const { d, t } = segmentDistance(ax, ay, bx, by, q.x, q.y);
    if (t > 0.05 && t < 0.98 && d < width) return false;
  }
  return true;
}

export function distToOppGoal(p: PlayerState): number {
  return dist(p.x, p.y, oppGoalX(p.team), CENTER_Y);
}

/** Squadra che "ha" l'azione: chi possiede la palla o a chi è diretto il passaggio. */
export function attackingTeam(s: MatchState): TeamIndex | -1 {
  const b = s.ball;
  if (b.owner >= 0) return s.players[b.owner].team;
  if (b.passTarget >= 0) return s.players[b.passTarget].team;
  if (b.lastTouch >= 0) return s.players[b.lastTouch].team;
  return -1;
}
