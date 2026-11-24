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

## Struttura

- `src/shared/`: **logica di gioco senza Phaser**. Passo fisso a 60 Hz, deterministica
  (RNG con seme nello stato, solo `+ - * /` e `Math.sqrt`), input per ID giocatore,
  stato JSON puro. È pensata per girare identica su un server Node (fase online).
  - `match.ts`: ciclo della partita, controller umani, cambio giocatore, gol, timer
  - `ball.ts`: fisica della palla (gravità, rimbalzi, attrito, pareti, pali, reti)
  - `actions.ts`: tiro, passaggio, contrasto, finta, skill speciali
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
| Passaggio rasoterra (tieni = più teso) | J (o Z) | A / Croce | PASSA |
| Lancio alto | U (o C) | X / Quadrato | LANCIO |
| Filtrante nello spazio | O (o V) | Y / Triangolo | FILTRANTE |
| Tiro (tieni = più forte; levetta verso un angolo = a giro) | K (o X) | B / Cerchio | TIRA |
| Scatto | Shift / Spazio | RT / R2 | SCATTO |
| Finta | L (o B) | LT / L2 | FINTA |
| Skill speciale | I (o N) | RB / R1 | SKILL |
| Cambio giocatore | Q | LB / L1 | PASSA senza palla |
| Pausa | Esc / P | Start | II in alto |

Senza palla: TIRO = contrasto in piedi, LANCIO = scivolata, PASSAGGIO = cambio giocatore.
Entrando da dietro si fa fallo; di lato il contrasto diventa una spallata (conta la forza).

## Pubblicazione

`netlify.toml` è pronto: build `npm run build`, cartella `dist`.
