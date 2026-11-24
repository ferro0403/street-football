// Schermo intero + blocco dell'orientamento orizzontale, dove il browser lo consente.
// iPhone (Safari) non permette il Fullscreen API sulle pagine: lì si suggerisce
// "Aggiungi a Home", che apre il gioco a tutto schermo grazie al manifest.
import Phaser from 'phaser';

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };

export function fullscreenSupported(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Già lanciato come app installata (standalone/fullscreen). */
export function isStandalone(): boolean {
  // Attenzione: anche lo schermo intero del browser fa scattare "display-mode: fullscreen".
  const fsMode = window.matchMedia?.('(display-mode: fullscreen)').matches && !isFullscreen();
  return (
    fsMode ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function lockLandscape(): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => undefined);
  } catch {
    /* non supportato */
  }
}

/** Va chiamata dentro un gesto dell'utente (pointerup / tasto). */
export function toggleFullscreen(scene: Phaser.Scene): void {
  if (isFullscreen()) {
    scene.scale.stopFullscreen();
    return;
  }
  if (!fullscreenSupported()) return;
  scene.scale.startFullscreen({ navigationUI: 'hide' });
  // Il blocco dell'orientamento funziona solo in schermo intero: un attimo dopo.
  setTimeout(lockLandscape, 150);
  lockLandscape();
}

/** Messaggio a comparsa in alto (DOM: indipendente dalle scene). */
let toastTimer = 0;
export function toast(msg: string, ms = 2600): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

/** Margini dell'area sicura (notch) in pixel CSS. */
export function safeInsetsCss(): { l: number; r: number; t: number; b: number } {
  const el = document.getElementById('safe-probe');
  if (!el) return { l: 0, r: 0, t: 0, b: 0 };
  const cs = getComputedStyle(el);
  return {
    l: parseFloat(cs.paddingLeft) || 0,
    r: parseFloat(cs.paddingRight) || 0,
    t: parseFloat(cs.paddingTop) || 0,
    b: parseFloat(cs.paddingBottom) || 0,
  };
}
