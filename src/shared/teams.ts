// Squadre di prova per la Fase 1. Nomi tutti inventati: niente giocatori, loghi o maglie reali.
import type { Kit, PlayerDef, PlayerLook, PlayerStats, SpecialSkill, TeamDef } from './types';

type Row = [name: string, num: number, spd: number, sho: number, pas: number, dri: number, def: number, str: number, look: PlayerLook];

const SKIN = { light: 0xf1c7a1, tan: 0xd59a6c, brown: 0xa86b42, dark: 0x6e4428 } as const;
const HAIR = { black: 0x1b1410, brown: 0x5a3520, blond: 0xe0b84a, red: 0xa2401c, white: 0xdcdcdc } as const;

function look(skin: number, hair: number, hairStyle: PlayerLook['hairStyle']): PlayerLook {
  return { skin, hair, hairStyle };
}

function makeTeam(
  id: string,
  name: string,
  short: string,
  nation: string,
  style: SpecialSkill,
  kit: Kit,
  gkKit: Kit,
  rows: Row[],
): TeamDef {
  const players: PlayerDef[] = rows.map(([pname, num, spd, sho, pas, dri, def, str, lk], i) => {
    const stats: PlayerStats = { speed: spd, shooting: sho, passing: pas, dribbling: dri, defense: def, strength: str };
    return {
      id: `${id}-${num}`,
      name: pname,
      number: num,
      role: i === 0 ? 'gk' : 'field',
      stats,
      special: i === 0 ? null : style,
      look: lk,
    };
  });
  return { id, name, short, nation, style, kit, gkKit, players };
}

export const TEAMS: TeamDef[] = [
  makeTeam(
    'bra',
    'Favela Samba',
    'BRA',
    'Brasile',
    'veronica',
    { shirt: 0xffd21f, trim: 0x139b48, shorts: 0x1f4fd1, socks: 0xffffff },
    { shirt: 0x2a2a2a, trim: 0xffd21f, shorts: 0x2a2a2a, socks: 0x2a2a2a },
    [
      ['Bigode', 1, 60, 30, 62, 40, 80, 75, look(SKIN.brown, HAIR.black, 1)],
      ['Zezinho', 4, 72, 58, 72, 70, 78, 80, look(SKIN.tan, HAIR.black, 2)],
      ['Pirulito', 7, 88, 76, 78, 90, 52, 58, look(SKIN.dark, HAIR.black, 0)],
      ['Canarinho', 8, 80, 72, 86, 86, 60, 62, look(SKIN.brown, HAIR.blond, 3)],
      ['Tiziu', 10, 84, 88, 76, 92, 45, 66, look(SKIN.tan, HAIR.black, 1)],
    ],
  ),
  makeTeam(
    'fra',
    'Banlieue Bleue',
    'FRA',
    'Francia',
    'rabona',
    { shirt: 0x1f3fb0, trim: 0xffffff, shorts: 0xffffff, socks: 0xd8202a },
    { shirt: 0x26b36b, trim: 0x111111, shorts: 0x111111, socks: 0x26b36b },
    [
      ['Lafleur', 16, 62, 30, 60, 40, 82, 78, look(SKIN.light, HAIR.brown, 1)],
      ['Mbossa', 5, 82, 55, 70, 66, 82, 88, look(SKIN.dark, HAIR.black, 0)],
      ['Garnier', 6, 76, 70, 88, 80, 66, 64, look(SKIN.light, HAIR.blond, 1)],
      ['Dukassé', 11, 92, 80, 72, 86, 48, 70, look(SKIN.dark, HAIR.black, 3)],
      ['Berthou', 9, 80, 90, 70, 78, 50, 84, look(SKIN.tan, HAIR.black, 2)],
    ],
  ),
  makeTeam(
    'ita',
    'Vicolo Azzurro',
    'ITA',
    'Italia',
    'tunnel',
    { shirt: 0x2b7bd6, trim: 0xffffff, shorts: 0xffffff, socks: 0x2b7bd6 },
    { shirt: 0xff8a1f, trim: 0x111111, shorts: 0x111111, socks: 0xff8a1f },
    [
      ['Saracinesca', 1, 60, 30, 64, 40, 88, 80, look(SKIN.light, HAIR.black, 0)],
      ['Mastino', 3, 70, 50, 70, 60, 90, 90, look(SKIN.tan, HAIR.black, 1)],
      ['Regista', 21, 66, 74, 92, 82, 70, 60, look(SKIN.light, HAIR.brown, 2)],
      ['Scugnizzo', 7, 86, 78, 74, 88, 56, 62, look(SKIN.tan, HAIR.black, 3)],
      ['Bomber', 9, 78, 90, 66, 74, 52, 86, look(SKIN.light, HAIR.red, 1)],
    ],
  ),
  makeTeam(
    'arg',
    'Potrero Celeste',
    'ARG',
    'Argentina',
    'sombrero',
    { shirt: 0x8fd0ff, trim: 0xffffff, shorts: 0x111a3a, socks: 0xffffff },
    { shirt: 0xc0ff2e, trim: 0x111111, shorts: 0x111111, socks: 0xc0ff2e },
    [
      ['Pulpo', 1, 62, 30, 60, 40, 84, 76, look(SKIN.tan, HAIR.black, 1)],
      ['Garra', 2, 74, 52, 66, 62, 86, 86, look(SKIN.tan, HAIR.black, 0)],
      ['Pibe', 10, 84, 84, 88, 94, 44, 55, look(SKIN.light, HAIR.brown, 1)],
      ['Gambeta', 22, 90, 76, 74, 88, 50, 60, look(SKIN.tan, HAIR.black, 2)],
      ['Tanque', 9, 74, 88, 62, 70, 60, 92, look(SKIN.brown, HAIR.black, 3)],
    ],
  ),
  makeTeam(
    'por',
    'Bairro Alto',
    'POR',
    'Portogallo',
    'elastico',
    { shirt: 0xc8102e, trim: 0x0a6b3a, shorts: 0x0a6b3a, socks: 0xc8102e },
    { shirt: 0x6a2bd6, trim: 0xffffff, shorts: 0x111111, socks: 0x6a2bd6 },
    [
      ['Muralha', 1, 60, 30, 62, 40, 80, 77, look(SKIN.light, HAIR.black, 1)],
      ['Rocha', 4, 72, 54, 70, 60, 84, 87, look(SKIN.tan, HAIR.brown, 0)],
      ['Maestro', 8, 74, 76, 90, 84, 62, 63, look(SKIN.light, HAIR.brown, 2)],
      ['Foguete', 17, 92, 80, 70, 88, 46, 66, look(SKIN.brown, HAIR.black, 3)],
      ['Canhão', 7, 82, 92, 72, 86, 48, 80, look(SKIN.tan, HAIR.black, 1)],
    ],
  ),
];

export function teamById(id: string): TeamDef {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`Squadra sconosciuta: ${id}`);
  return t;
}
