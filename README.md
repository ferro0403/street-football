# Street Cage

Calcio di strada 5 contro 5 in gabbia, isometrico con grafica retro, nel browser.
Phaser 3 + Vite + TypeScript.

## Comandi rapidi

```bash
npm install
npm run dev      # gioco su http://localhost:5173 (anche dal telefono nella stessa rete)
npm test         # test della logica di gioco
npm run build    # build di produzione in dist/
```

Simulare partite CPU contro CPU senza grafica (bilanciamento):

```bash
npx tsx scripts/sim.ts 10
```

## Grafica dei giocatori (sprite generati)

Gli sprite sheet sono generati da codice, nessun asset esterno:

```bash
npm run sprites
```

- `scripts/sprites/rig.ts`: scheletro, proporzioni, volumi del corpo e dei 6 tagli di capelli
- `scripts/sprites/anims.ts`: pose di ogni animazione (giocatori e portiere)
- `scripts/sprites/render.ts`: rasterizzatore pixel art isometrico (luce, fasce, contorni)
- `scripts/sprites/generate.ts`: 5 direzioni (+3 specchiate), atlas Phaser, palla, ombra, anteprima

Ogni materiale è un livello in scala di grigi tinto in gioco: pelle, capelli (taglio e colore),
maglia, bordi, pantaloncini, calzettoni, scarpe, guanti e numero sono personalizzabili per giocatore
(`PlayerLook` + `Kit` in `src/shared/types.ts`). Anteprima in `docs/art/players-preview.png`,
galleria animata dal menu (GIOCATORI). Direzione artistica e provenienza: `docs/art/`.

## Struttura

- `src/shared/`: **logica di gioco senza Phaser**. Passo fisso a 60 Hz, deterministica
  (RNG con seme nello stato, solo `+ - * /` e `Math.sqrt`), input per ID giocatore,
  stato JSON puro. È pensata per girare identica su un server Node (fase online).
  - `match.ts`: ciclo della partita, controller umani, cambio giocatore, gol, timer
  - `ball.ts`: fisica della palla (gravità, rimbalzi, attrito, pareti, pali, reti)
  - `actions.ts`: tiro, passaggio, contrasto, finta, skill speciali
  - `ai.ts`: IA di compagni e avversari · `keeper.ts`: portiere CPU
  - `tricks.ts`: trick stick, trucchi a duello, anti-spam · `walls.ts`: muri della gabbia
  - `gamebreaker.ts`: barra e combo · `aerial.ts`: palle alte · `tune.ts`: parametri del pannello F2
  - `stats.ts`: come le statistiche (velocità, tiro, passaggio, dribbling, difesa, forza)
    diventano numeri di gioco: tutto il bilanciamento
  - `teams.ts`: squadre di prova (nomi inventati)
- `src/game/`: client Phaser (disegno isometrico, input, HUD, effetti, replay).
- `tests/`: test Vitest della logica condivisa.

## Comandi di gioco

| Azione | Tastiera | Controller | Telefono |
|---|---|---|---|
| Movimento | WASD / frecce | levetta sinistra / croce | joystick (dove appoggi il pollice, a sinistra) |
| Passaggio (tieni = più teso) | J (Z) | A / Croce | PASSA |
| Lancio alto | U (C) | X / Quadrato | LANCIO |
| Filtrante | O (V) | Y / Triangolo | FILTRANTE |
| Tiro (tieni = più forte) | K (X) | B / Cerchio | TIRA |
| Tiro piazzato / pallonetto | Spazio + K / U + K | RB + B / X + B | - |
| **Trucchi** (8 direzioni) | L + direzione | levetta destra | swipe a destra |
| **Trucchi avanzati** | Spazio + L + direzione | RB + levetta destra | swipe lungo |
| Skill della nazione | I (N) | LB / L1 | SKILL |
| Proteggi palla / contenimento | E (M), tieni | LT / L2, tieni | PROTEGGI / CONTIENI |
| Gamebreaker (barra piena) | G | View / Select | GB! |
| Scatto | Shift | RT / R2 | SCATTO |
| Cambio giocatore | Q | A senza palla | PASSA senza palla |
| Pausa · Reset allenamento · Debug | Esc · R · F2 | Start | II → RESET / DEBUG |

Senza palla: TIRO = contrasto in piedi (premuto durante un trucco lo legge), LANCIO = scivolata,
PROTEGGI = contenimento. Da dietro è fallo, di lato è una spallata.

Muri: passaggio verso una parete = **wall pass**, filtrante verso la parete = **uno-due col muro**,
tiro verso la parete laterale vicina = **tiro di sponda**. La linea di mira mostra il rimbalzo
(si disattiva in pausa o nel pannello debug).

Palle alte: TIRO = colpo di testa, tiro al volo o rovesciata (dipende da altezza e posizione).

## Pubblicazione

`netlify.toml` è pronto: build `npm run build`, cartella `dist`.
