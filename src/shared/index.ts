// Punto d'ingresso della logica condivisa (client e, in futuro, server Node).
export * from './constants';
export * from './types';
export * from './stats';
export * from './teams';
export { createMatch, stepMatch, addController, cloneState, hashState, NEUTRAL_INPUT } from './match';
export type { MatchConfig } from './match';
