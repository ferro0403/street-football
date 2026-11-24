// Passaggi: veloci, diretti alla posizione attuale del compagno, mai nel vuoto.
import { describe, expect, it } from 'vitest';
import { CENTER_Y } from '../src/shared/constants';
import { stepMatch } from '../src/shared/match';
import { pass } from '../src/shared/actions';
import { TEAMS } from '../src/shared/teams';
import { laneClear } from '../src/shared/world';
import { humansOn, input, newMatch } from './helpers';

describe('passaggi', () => {
  it('in partita il 90% dei passaggi con la linea libera arriva al compagno', () => {
    let clear = 0;
    let arrived = 0;
    for (let m = 0; m < 8; m++) {
      const s = newMatch({ seed: 1300 + m, home: TEAMS[m % TEAMS.length], away: TEAMS[(m + 1) % TEAMS.length] });
      let pending: { target: number } | null = null;
      while (s.phase !== 'ended') {
        const before = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
        stepMatch(s, {});
        const ev = s.events.find((e) => e.type === 'pass');
        if (ev && before && s.ball.passTarget >= 0) {
          const r = s.players[s.ball.passTarget];
          if (laneClear(s, before.team, before.x, before.y, r.x, r.y, 0.9)) {
            pending = { target: r.idx };
            clear++;
          } else pending = null;
          continue;
        }
        if (pending && (s.ball.owner >= 0 || s.phase !== 'play')) {
          if (s.ball.owner === pending.target) arrived++;
          pending = null;
        }
      }
    }
    expect(clear).toBeGreaterThan(200);
    expect(arrived / clear).toBeGreaterThan(0.9);
  }, 60000);

  it('il compagno non scappa: appena parte il passaggio va incontro alla palla', () => {
    for (let i = 0; i < 10; i++) {
      const s = humansOn(1400 + i, 1, 9);
      const a = s.players[1];
      const r = s.players[3];
      r.stun = 0;
      Object.assign(a, { x: 6, y: CENTER_Y });
      Object.assign(r, { x: 16, y: 4 + i, vx: 6, vy: 0 }); // sta correndo via
      s.players[9].x = 34;
      s.ball.owner = 1;
      pass(s, a, 3);
      let prevD = Infinity;
      for (let t = 0; t < 120 && s.ball.owner !== 3; t++) {
        stepMatch(s, {});
        const d = Math.hypot(s.ball.x - r.x, s.ball.y - r.y);
        if (t > 8) expect(d).toBeLessThan(prevD + 0.02); // sempre più vicini
        prevD = d;
      }
      expect(s.ball.owner).toBe(3);
    }
  });

  it('diretto alla posizione ATTUALE del compagno (niente anticipo)', () => {
    const s = humansOn(1500, 1, 9);
    const a = s.players[1];
    const r = s.players[3];
    Object.assign(a, { x: 6, y: CENTER_Y });
    Object.assign(r, { x: 16, y: CENTER_Y, vx: 0, vy: 6 });
    s.ball.owner = 1;
    pass(s, a, 3);
    // Direzione della palla = direzione verso dove sta ADESSO (errore minimo).
    expect(Math.abs(s.ball.vy / s.ball.vx)).toBeLessThan(0.04);
  });

  it('cono largo: punta un po\' di lato e va comunque al compagno da quella parte', () => {
    const s = humansOn(1600, 1, 9);
    const a = s.players[1];
    Object.assign(a, { x: 10, y: CENTER_Y });
    Object.assign(s.players[3], { x: 16, y: CENTER_Y + 6, stun: 0 }); // ~45° in basso a destra
    Object.assign(s.players[2], { x: 4, y: 2, stun: 0 });
    s.ball.owner = 1;
    stepMatch(s, { d: input({ pass: true, mx: 1, my: 0.15 }) });
    expect(s.ball.passTarget).toBe(3);
  });

  it('mai nel vuoto: verso lo spazio vuoto (muro lontano) passa al compagno più libero', () => {
    const s = humansOn(1700, 1, 9);
    const a = s.players[1];
    Object.assign(a, { x: 18, y: CENTER_Y });
    // Tutti i compagni alle spalle.
    Object.assign(s.players[2], { x: 10, y: 5, stun: 0 });
    Object.assign(s.players[3], { x: 9, y: 16, stun: 0 });
    Object.assign(s.players[4], { x: 12, y: 11, stun: 0 });
    s.ball.owner = 1;
    stepMatch(s, { d: input({ pass: true, mx: 1, my: 0 }) });
    expect(s.ball.passTarget).toBeGreaterThanOrEqual(0);
    expect(s.players[s.ball.passTarget].team).toBe(0);
  });

  it('intercetto solo se un avversario è davvero sulla linea; vicino al passatore la palla rimbalza sul piede', () => {
    const setup = (oppX: number, oppY: number, receiverStill = true) => {
      const s = humansOn(1800, 1, 9);
      const a = s.players[1];
      const r = s.players[3];
      Object.assign(a, { x: 6, y: CENTER_Y });
      Object.assign(r, { x: 20, y: CENTER_Y, stun: 1e6 }); // fermo
      Object.assign(s.players[9], { x: oppX, y: oppY, stun: 0 });
      s.ball.owner = 1;
      pass(s, a, 3);
      if (!receiverStill) r.stun = 0;
      let deflected = false;
      for (let t = 0; t < 150 && s.ball.owner < 0; t++) {
        stepMatch(s, {});
        if (s.ball.passTarget < 0 && s.ball.owner < 0) deflected = true;
      }
      return { owner: s.ball.owner, deflected };
    };
    // Sulla linea, vicino al compagno (palla più lenta): intercettata.
    expect(setup(18, CENTER_Y + 0.2).owner).toBe(9);
    // Un metro fuori linea: passa.
    expect(setup(14, CENTER_Y + 1.1, false).owner).toBe(3);
    // Sulla linea ma a un passo dal passatore (palla velocissima): non la ferma, rimbalza.
    const near = setup(8, CENTER_Y + 0.15);
    expect(near.owner).not.toBe(9);
    expect(near.deflected).toBe(true);
  });
});
