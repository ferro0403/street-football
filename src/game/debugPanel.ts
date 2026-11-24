// Pannello debug (F2, o PAUSA → DEBUG su telefono): regola in tempo reale i parametri della
// partita (velocità, contrasti, rimbalzi, trucchi...). I valori finiscono in state.tune, quindi la
// simulazione resta deterministica; vengono anche salvati sul dispositivo per le partite successive.
import { DEFAULT_TUNE, sanitizeTune, TUNE_INFO, type Tuning } from '../shared/tune';

const KEY = 'sc-tune';
const AIM_KEY = 'sc-aimline';

export function loadTune(): Tuning {
  try {
    return sanitizeTune(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Tuning>);
  } catch {
    return { ...DEFAULT_TUNE };
  }
}

function saveTune(t: Tuning): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignora */
  }
}

/** Linea di mira con il rimbalzo sul muro (si può disattivare). */
export function aimLineEnabled(): boolean {
  try {
    return localStorage.getItem(AIM_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAimLine(on: boolean): void {
  try {
    localStorage.setItem(AIM_KEY, on ? '1' : '0');
  } catch {
    /* ignora */
  }
}

let panel: HTMLDivElement | null = null;

export function isDebugOpen(): boolean {
  return !!panel;
}

export function closeDebug(): void {
  panel?.remove();
  panel = null;
}

/** Apre o chiude il pannello, collegato ai parametri della partita in corso. */
export function toggleDebug(getTune: () => Tuning | null): void {
  if (panel) {
    closeDebug();
    return;
  }
  const tune = getTune();
  if (!tune) return;
  const el = document.createElement('div');
  el.id = 'debug-panel';
  el.style.cssText =
    'position:fixed;right:8px;top:8px;z-index:30;width:min(320px,90vw);max-height:92vh;overflow:auto;' +
    'background:#0d0b14f0;color:#fff;border:2px solid #ffd21f;padding:10px 12px;font:12px/1.4 monospace;' +
    'touch-action:auto;user-select:none;';
  const title = document.createElement('div');
  title.innerHTML = '<b style="color:#ffd21f">DEBUG · regolazioni</b> <span style="opacity:.6">(F2 per chiudere)</span>';
  el.appendChild(title);

  const refreshers: (() => void)[] = [];
  for (const info of TUNE_INFO) {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin-top:8px';
    const name = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(info.min);
    input.max = String(info.max);
    input.step = String(info.step);
    input.style.cssText = 'width:100%';
    const show = () => {
      input.value = String(tune[info.key]);
      name.textContent = `${info.label}: ${tune[info.key].toFixed(2)}`;
    };
    input.addEventListener('input', () => {
      tune[info.key] = Number(input.value);
      show();
      saveTune(tune);
    });
    show();
    refreshers.push(show);
    row.append(name, input);
    el.appendChild(row);
  }

  const aim = document.createElement('label');
  aim.style.cssText = 'display:block;margin-top:10px';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = aimLineEnabled();
  box.addEventListener('change', () => setAimLine(box.checked));
  aim.append(box, document.createTextNode(' Linea di mira (rimbalzi sul muro)'));
  el.appendChild(aim);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:10px';
  const reset = document.createElement('button');
  reset.textContent = 'Valori iniziali';
  reset.onclick = () => {
    Object.assign(tune, DEFAULT_TUNE);
    saveTune(tune);
    refreshers.forEach((f) => f());
  };
  const close = document.createElement('button');
  close.textContent = 'Chiudi';
  close.onclick = () => closeDebug();
  for (const b of [reset, close]) b.style.cssText = 'flex:1;padding:8px;background:#1b1726;color:#fff;border:1px solid #fff8;font:12px monospace';
  btns.append(reset, close);
  el.appendChild(btns);
  // Il pannello non deve passare i tocchi al gioco.
  for (const ev of ['pointerdown', 'touchstart', 'keydown']) el.addEventListener(ev, (e) => e.stopPropagation());
  document.body.appendChild(el);
  panel = el;
}
