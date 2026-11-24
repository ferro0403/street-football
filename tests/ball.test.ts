import { describe, expect, it } from 'vitest';
import { CENTER_Y, FIELD, PHYS } from '../src/shared/constants';
import { stepBall } from '../src/shared/ball';
import { nextRandom } from '../src/shared/rng';
import type { MatchState } from '../src/shared/types';
import { newMatch } from './helpers';

function freeBall(s: MatchState, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
  Object.assign(s.ball, { x, y, z, vx, vy, vz, owner: -1, inGoal: -1 });
}

describe('fisica della palla', () => {
  it('rimbalza sulle pareti laterali e resta nella gabbia', () => {
    const s = newMatch();
    freeBall(s, 18, 3, 0, 0, -20, 0);
    for (let i = 0; i < 30; i++) stepBall(s);
    expect(s.ball.vy).toBeGreaterThan(0);
    expect(s.ball.y).toBeGreaterThanOrEqual(PHYS.ballRadius);
  });

  it('un tiro fuori dallo specchio rimbalza sulla parete di fondo', () => {
    const s = newMatch();
    freeBall(s, 30, 3, 0, 25, 0, 0);
    let scored = -1;
    for (let i = 0; i < 60 && scored < 0; i++) scored = stepBall(s);
    expect(scored).toBe(-1);
    expect(s.ball.vx).toBeLessThan(0);
    expect(s.ball.x).toBeLessThanOrEqual(FIELD.length);
  });

  it('un tiro sopra la traversa non è gol', () => {
    const s = newMatch();
    freeBall(s, 33, CENTER_Y, 2.5, 20, 0, 0.5);
    let scored = -1;
    for (let i = 0; i < 40 && scored < 0; i++) scored = stepBall(s);
    expect(scored).toBe(-1);
  });

  it('un tiro basso nello specchio è gol e la rete trattiene la palla', () => {
    const s = newMatch();
    freeBall(s, 30, CENTER_Y + 0.5, 0.3, 22, 0, 0);
    let scored = -1;
    for (let i = 0; i < 60 && scored < 0; i++) scored = stepBall(s);
    expect(scored).toBe(0); // porta a x = length → segna la squadra 0
    for (let i = 0; i < 120; i++) stepBall(s);
    expect(s.ball.x).toBeGreaterThan(FIELD.length);
    expect(s.ball.x).toBeLessThanOrEqual(FIELD.length + FIELD.goalDepth);
    expect(Math.abs(s.ball.y - CENTER_Y)).toBeLessThan(FIELD.goalWidth / 2);
  });

  it('a sinistra segna la squadra 1', () => {
    const s = newMatch();
    freeBall(s, 5, CENTER_Y, 0.2, -20, 0.5, 0);
    let scored = -1;
    for (let i = 0; i < 60 && scored < 0; i++) scored = stepBall(s);
    expect(scored).toBe(1);
  });

  it('attrito: una palla rasoterra si ferma', () => {
    const s = newMatch();
    freeBall(s, 10, 11, 0, 8, 0, 0);
    for (let i = 0; i < 60 * 6; i++) stepBall(s);
    expect(Math.abs(s.ball.vx)).toBeLessThan(0.01);
  });

  it('gravità e rimbalzi: un pallonetto ricade e smette di saltare', () => {
    const s = newMatch();
    freeBall(s, 10, 11, 0.1, 3, 0, 9);
    let maxZ = 0;
    let bounces = 0;
    for (let i = 0; i < 60 * 5; i++) {
      s.events = [];
      stepBall(s);
      maxZ = Math.max(maxZ, s.ball.z);
      bounces += s.events.filter((e) => e.type === 'bounce').length;
    }
    expect(maxZ).toBeGreaterThan(1.5);
    expect(bounces).toBeGreaterThan(0);
    expect(s.ball.z).toBe(0);
  });

  it('fuzz: con tiri casuali la palla non esce mai dalla gabbia', () => {
    const s = newMatch({ seed: 123 });
    for (let k = 0; k < 400; k++) {
      const r = () => nextRandom(s);
      freeBall(s, 1 + r() * 34, 1 + r() * 20, r() * 3, (r() * 2 - 1) * 40, (r() * 2 - 1) * 40, (r() * 2 - 1) * 15);
      for (let i = 0; i < 90; i++) {
        stepBall(s);
        const b = s.ball;
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(FIELD.width);
        expect(b.z).toBeGreaterThanOrEqual(0);
        expect(b.z).toBeLessThanOrEqual(FIELD.roofHeight);
        expect(b.x).toBeGreaterThanOrEqual(-FIELD.goalDepth);
        expect(b.x).toBeLessThanOrEqual(FIELD.length + FIELD.goalDepth);
        if (b.x < 0 || b.x > FIELD.length) {
          // Oltre la linea solo dentro la porta.
          expect(Math.abs(b.y - CENTER_Y)).toBeLessThan(FIELD.goalWidth / 2);
          expect(b.z).toBeLessThan(FIELD.goalHeight);
        }
      }
    }
  });
});
