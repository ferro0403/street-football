# Direzione artistica: giocatori

Brief secondo la skill `create-game-assets` (vedi `.claude/skills/create-game-assets`).

## Quadro di gioco
- **Motore**: Phaser 3.90, WebGL, filtro *nearest* (`pixelArt: true`).
- **Vista**: isometrica 2:1, la stessa del campo (`src/game/iso.ts`: 24/12 px per metro, 27 px per metro in altezza).
- **Dimensione a schermo**: giocatore ~50 px di altezza (1,8 m) prima dello zoom della camera
  (~1,2× su PC, ~1,7× su telefono).
- **Fotogramma**: 88×92 px, ancora ai piedi in (44, 78). Ritagliato nell'atlas (spriteSourceSize).

## Sistema visivo
- **Forme**: corpo "robusto" anni PS2, testa grande (raggio 0,19 m) per leggere viso e capelli da telefono.
- **Valori**: 4 fasce di luce quantizzate (1,0 / 0,86 / 0,71 / 0,57), niente sfumature né antialiasing.
- **Luce**: dall'alto a sinistra dello schermo, uguale per tutti i fotogrammi.
- **Contorni**: *selout*, contorno scuro del colore della parte confinante (0,26), linee interne (0,44)
  dove una parte ne copre un'altra.
- **Colori**: ogni materiale è un livello in scala di grigi tinto in gioco (moltiplicazione):
  pelle, maglia, bordi (colletto e polsini), pantaloncini, calzettoni, scarpe, guanti; capelli con un
  livello per taglio. Occhi in colore fisso. Il numero di maglia è disegnato in gioco nel punto
  calcolato per ogni fotogramma.
- **Esclusioni**: nessun nome, logo o maglia reale; nessuna immagine esterna.

## Animazioni (5 direzioni disegnate + 3 specchiate = 8)
Giocatori: idle 4, run 8, sprint 8, pass 5, shoot 6, tackle 4, shoulder 3, slide 5, fall 6,
stagger 4, celebrate 6, rabona 6, veronica 8, elastico 5, sombrero 5, tunnel 4, feint 4.
Portiere (guanti, maniche lunghe): idle, ready, run, pass, shoot, diveL 6, diveR 6, save 4, hold 2,
fall, celebrate.

## Come si modificano
- Proporzioni e volumi: `scripts/sprites/rig.ts` (`BODY`, `buildBody`, `buildHair`).
- Pose e numero di fotogrammi: `scripts/sprites/anims.ts`.
- Luce, fasce, contorni, dimensione del fotogramma: `scripts/sprites/render.ts`.
- Poi `npm run sprites` e controlla `docs/art/players-preview.png` e la galleria GIOCATORI nel menu.

## Controlli
```bash
npm run sprites
python3 .claude/skills/create-game-assets/scripts/asset_report.py public/assets/sprites/*.png --require-alpha --json
```
