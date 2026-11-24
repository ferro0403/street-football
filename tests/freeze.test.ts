// Anti-blocco: in 50 partite CPU contro CPU nessun giocatore di movimento deve restare
// immobile, o nella stessa azione, per più di 2 secondi senza essere stordito.
import { describe, expect, it } from 'vitest';
import { createMatch, stepMatch } from '../src/shared/match';
import { TEAMS } from '../src/shared/teams';
import { DT } from '../src/shared/constants';
import { len } from '../src/shared/math';

export function findFreezes(seed: number, duration = 90): string[] {
  const s = createMatch({ home: TEAMS[seed % TEAMS.length], away: TEAMS[(seed + 1) % TEAMS.length], seed, durationSec: duration });
  const still = new Array(s.players.length).fill(0);
  const inAction = new Array(s.players.length).fill(0);
  const out: string[] = [];
  let guard = 0;
  while (s.phase !== 'ended' && guard++ < 60 * 60 * 5) {
    stepMatch(s, {});
    if (s.phase !== 'play') {
      still.fill(0);
      inAction.fill(0);
      continue;
    }
    for (const p of s.players) {
      if (p.role === 'gk') continue;
      if (p.stun > 0) {
        still[p.idx] = 0;
        inAction[p.idx] = 0;
        continue;
      }
      still[p.idx] = len(p.vx, p.vy) < 0.2 ? still[p.idx] + DT : 0;
      inAction[p.idx] = p.action.kind !== 'none' ? inAction[p.idx] + DT : 0;
      if (still[p.idx] > 2 || inAction[p.idx] > 2) {
        out.push(`seed ${seed} t=${s.tick} ${p.name}: ${still[p.idx] > 2 ? 'fermo' : 'bloccato'} (azione=${p.action.kind})`);
        still[p.idx] = 0;
        inAction[p.idx] = 0;
      }
    }
  }
  return out;
}

describe('nessun giocatore si blocca', () => {
  it('50 partite CPU contro CPU senza giocatori fermi o bloccati per più di 2 s', () => {
    const all: string[] = [];
    for (let i = 0; i < 50; i++) all.push(...findFreezes(500 + i));
    expect(all).toEqual([]);
  }, 300_000);
});
