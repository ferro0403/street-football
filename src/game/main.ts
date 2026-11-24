import Phaser from 'phaser';
import '@fontsource/press-start-2p/400.css';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { MatchScene } from './scenes/MatchScene';
import { HudScene } from './scenes/HudScene';
import { PauseScene } from './scenes/PauseScene';
import { EndScene } from './scenes/EndScene';
import { GAME_H, GAME_W } from './ui';
import { setPadMessageHandler } from './input/InputManager';
import { toast } from './fullscreen';

async function start() {
  // Il font pixel va caricato prima che Phaser disegni i testi.
  try {
    await Promise.race([document.fonts.load('16px "Press Start 2P"'), new Promise((r) => setTimeout(r, 2000))]);
  } catch {
    /* si usa il font di riserva */
  }

  setPadMessageHandler((msg) => toast(msg));

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_W,
    height: GAME_H,
    backgroundColor: '#0d0b14',
    pixelArt: true,
    scale: {
      // EXPAND: riempie tutto lo schermo senza bande nere; l'area 960x540 resta sempre visibile.
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 6 },
    fps: { target: 60 },
    scene: [BootScene, MenuScene, MatchScene, HudScene, PauseScene, EndScene],
  });
  Object.assign(window, { game });

  // Le barre del browser su telefono cambiano l'area visibile senza un vero "resize".
  const refresh = () => game.scale.refresh();
  window.visualViewport?.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', () => setTimeout(refresh, 250));
}

void start();
