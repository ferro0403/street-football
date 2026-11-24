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
  - `actions.ts`: tiro, passaggio, contrasto in piedi, scivolata (niente falli)
  - `tune.ts`: regolazioni del pannello debug (F2)
  - `ai.ts`: IA di compagni e avversari · `keeper.ts`: portiere CPU
  - `stats.ts`: come le statistiche (velocità, tiro, passaggio, dribbling, difesa, forza)
    diventano numeri di gioco: tutto il bilanciamento
  - `teams.ts`: squadre di prova (nomi inventati)
- `src/game/`: client Phaser (disegno isometrico, input, HUD, effetti, replay).
- `tests/`: test Vitest della logica condivisa.

## Comandi di gioco

| Azione | Tastiera | Controller | Touch |
|---|---|---|---|
| Movimento | WASD / frecce | levetta sinistra / croce | joystick (appare dove appoggi il pollice, metà sinistra) |
| Passaggio rasoterra al compagno verso cui punti (un tocco) | J (o Z) | A / Croce | PASSA |
| Tiro verso la porta (tieni = più forte, levetta = lato) | K (o X) | B / Cerchio | TIRA |
| Contrasto in piedi | L (o C) | X / Quadrato | CONTRASTO |
| Scivolata | U (o V) | Y / Triangolo | SCIVOLATA (o trascina CONTRASTO) |
| Protezione palla (tieni premuto) | I (o B) | LT / L2 | PROTEGGI (il pulsante CONTRASTO quando hai palla) |
| Scatto | Shift / Spazio | RT / RB | SCATTO |
| Cambio giocatore | Q | LB / L1 | PASSA senza palla (CAMBIO) |
| Pausa | Esc / P | Start | II in alto |
| Pannello debug (velocità, contrasto, passaggi, tiri) | F2 | – | – |

Niente arbitro, niente falli, niente fuorigioco: la gabbia tiene la palla sempre in gioco.
Il giocatore che controlli fa **solo** quello che premi: nessun contrasto automatico.

**Contrasti fisici, senza dadi**: il contrasto riesce se il piede arriva sulla palla nel momento
del contatto. A ogni tocco la palla si stacca un po' dal piede: è lì che si ruba. Da dietro (o
contro chi protegge) il corpo fa da scudo. Un "!" sopra un difensore CPU vuol dire che sta per
entrare: un cambio di direzione secco o uno scatto in quel momento lo manda a vuoto.

**Passaggi**: rasoterra veloce alla posizione attuale del compagno (linea tratteggiata = a chi
passi). Senza compagni in quella direzione va al più libero; contro il muro solo se lo punti.

## Pubblicazione

`netlify.toml` è pronto: build `npm run build`, cartella `dist`.
