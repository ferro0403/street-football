// Pannello debug (F2): regola in tempo reale velocità, forza del contrasto, potenza di passaggi
// e tiri. Scrive in state.tune (la simulazione resta deterministica) e ricorda i valori.
import { DEFAULT_TUNE, TUNE_INFO, sanitizeTune } from '../shared/tune';
import type { MatchState, Tuning } from '../shared/types';

const STORE_KEY = 'sc-tune';

export function loadTune(): Tuning {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return sanitizeTune(raw ? (JSON.parse(raw) as Partial<Tuning>) : undefined);
  } catch {
    return { ...DEFAULT_TUNE };
  }
}

function saveTune(t: Tuning): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(t));
  } catch {
    /* storage non disponibile: pazienza */
  }
}

export class DebugPanel {
  private root: HTMLDivElement | null = null;
  private stats: HTMLDivElement | null = null;

  constructor(private getState: () => MatchState) {}

  get open(): boolean {
    return this.root !== null;
  }

  toggle(): void {
    if (this.root) this.close();
    else this.show();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.stats = null;
  }

  /** Aggiorna le righe informative (chiamato ogni fotogramma se aperto). */
  refresh(): void {
    if (!this.stats) return;
    const s = this.getState();
    const owner = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
    const me = s.controllers[0] && s.controllers[0].player >= 0 ? s.players[s.controllers[0].player] : null;
    this.stats.textContent =
      `fase ${s.phase} · tick ${s.tick} · palla ${owner ? owner.name : 'libera'} · v ${Math.hypot(s.ball.vx, s.ball.vy).toFixed(1)} m/s` +
      (me ? ` · tu: ${me.name} ${me.action.kind}${me.charging ? ` carica ${(me.charge * 100) | 0}%` : ''}` : '');
  }

  private show(): void {
    const s = this.getState();
    const root = document.createElement('div');
    root.id = 'debug-panel';
    Object.assign(root.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '50',
      background: 'rgba(13,11,20,0.88)',
      color: '#fff',
      font: '12px monospace',
      padding: '10px 12px',
      border: '2px solid #ffd21f',
      borderRadius: '6px',
      width: 'min(320px, calc(100vw - 32px))',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    const title = document.createElement('div');
    title.textContent = 'DEBUG (F2) — regolazioni';
    title.style.cssText = 'color:#ffd21f;font-weight:bold;margin-bottom:8px';
    root.appendChild(title);

    for (const info of TUNE_INFO) {
      const row = document.createElement('label');
      row.style.cssText = 'display:block;margin:6px 0';
      const name = document.createElement('div');
      const val = document.createElement('span');
      val.style.color = '#7cff6b';
      name.textContent = `${info.label}: `;
      name.appendChild(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(info.min);
      input.max = String(info.max);
      input.step = String(info.step);
      input.value = String(s.tune[info.key]);
      input.dataset.key = info.key;
      input.style.width = '100%';
      const sync = () => {
        const st = this.getState();
        st.tune[info.key] = Number(input.value);
        st.tune = sanitizeTune(st.tune);
        val.textContent = `×${st.tune[info.key].toFixed(2)}`;
        saveTune(st.tune);
      };
      input.addEventListener('input', sync);
      val.textContent = `×${s.tune[info.key].toFixed(2)}`;
      row.append(name, input);
      root.appendChild(row);
    }

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const reset = document.createElement('button');
    reset.textContent = 'Valori standard';
    reset.onclick = () => {
      const st = this.getState();
      st.tune = { ...DEFAULT_TUNE };
      saveTune(st.tune);
      this.close();
      this.show();
    };
    const close = document.createElement('button');
    close.textContent = 'Chiudi';
    close.onclick = () => this.close();
    buttons.append(reset, close);
    root.appendChild(buttons);

    this.stats = document.createElement('div');
    this.stats.style.cssText = 'margin-top:8px;color:#cfc8e0;font-size:11px;line-height:1.4';
    root.appendChild(this.stats);
    // I tasti dentro al pannello non devono muovere il giocatore.
    root.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(root);
    this.root = root;
    this.refresh();
  }
}
