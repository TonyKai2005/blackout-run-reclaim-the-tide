import './style.css';

import type { WorldLabel } from './game/world';

export type GuidanceMode = 'full' | 'minimal';

export interface UISettings {
  musicVolume: number;
  effectsVolume: number;
  mouseSensitivity: number;
  fieldOfView: number;
  reducedEffects: boolean;
  guidance: GuidanceMode;
}

export interface ObjectiveView {
  /** The immediate action, such as "Recover the reusable battery". */
  action: string;
  /** Cargo name, when the current step involves carrying something. */
  pickUp?: string;
  /** Where the cargo can currently be found. */
  from?: string;
  /** Where cargo should be installed or delivered. */
  deliverTo?: string;
  /** The location or object that the compass is currently pointing at. */
  target?: string;
  distanceMeters?: number;
  /** Bearing relative to camera: 0 is straight ahead, 90 points right. */
  bearingDegrees?: number;
  /** Optional projected marker position in viewport fractions (0..1). */
  markerX?: number;
  markerY?: number;
  progress?: string;
  stableSecondsRemaining?: number;
}

export interface EnergyView {
  storedKWh: number;
  capacityKWh: number;
  importedKWh: number;
  windGeneratedKWh: number;
  generationKW: number;
  demandKW: number;
}

export interface ResultView {
  recoveredItems: number;
  serviceSeconds: number;
  windGeneratedKWh: number;
  importedKWh: number;
  headline?: string;
}

export interface UIView {
  canContinue?: boolean;
  phaseNumber?: number;
  phaseTitle?: string;
  objective?: ObjectiveView;
  /** Shown only while the target is actually in interaction range. */
  interaction?: { action: string; target?: string } | null;
  health?: number;
  maxHealth?: number;
  weapon?: string;
  services?: { recycling: boolean; water: boolean; wind: boolean };
  energy?: EnergyView;
  result?: ResultView;
  /** A changed string displays briefly; send empty string to clear. */
  toast?: string;
}

export interface UICallbacks {
  onStart?: () => void;
  onContinue?: () => void;
  onBegin?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onJournalOpen?: () => void;
  onJournalClose?: () => void;
  onExitToTitle?: () => void;
  onSettingsChange?: (settings: UISettings) => void;
}

type Screen = 'home' | 'journal' | 'game' | 'pause' | 'results' | 'loading' | 'fatal';

const STORAGE_KEY = 'reclaim-the-tide-ui-settings-v1';
const DEFAULT_SETTINGS: UISettings = {
  musicVolume: 0.72,
  effectsVolume: 0.85,
  mouseSensitivity: 1,
  fieldOfView: 80,
  reducedEffects: false,
  guidance: 'full',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function savedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function readSettings(): UISettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<UISettings>;
    return {
      musicVolume: savedNumber(saved.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      effectsVolume: savedNumber(saved.effectsVolume, DEFAULT_SETTINGS.effectsVolume, 0, 1),
      mouseSensitivity: savedNumber(saved.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 0.25, 2),
      fieldOfView: savedNumber(saved.fieldOfView, DEFAULT_SETTINGS.fieldOfView, 65, 105),
      reducedEffects: saved.reducedEffects === true,
      guidance: saved.guidance === 'minimal' ? 'minimal' : 'full',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function text(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.0';
}

/** DOM interface only. The engine owns simulation and calls render with its latest snapshot. */
export class GameUI {
  readonly settings: UISettings = readSettings();
  private readonly host: HTMLElement;
  private readonly callbacks: UICallbacks;
  private screen: Screen = 'home';
  private settingsReturnScreen: Screen = 'home';
  private settingsOpen = false;
  private energyOpen = false;
  private journalFirstOpen = true;
  private lastToast = '';
  private toastTimeout: number | undefined;
  private crewMessageTimeout: number | undefined;
  private keyListener: (event: KeyboardEvent) => void;
  private readonly labelNodes = new Map<string, HTMLElement>();

  constructor(callbacks: UICallbacks = {}, host: HTMLElement | null = document.getElementById('app')) {
    if (!host) throw new Error('Missing #app UI mount element');
    this.host = host;
    this.callbacks = callbacks;
    this.host.className = 'ui-root';
    this.host.innerHTML = `
      <section class="home-screen screen" id="home-screen" aria-labelledby="home-title">
        <div class="home-shade"></div>
        <div class="home-copy">
          <div class="brand-rule" aria-hidden="true"></div>
          <h1 id="home-title"><span>BLACKOUT RUN</span><strong>RECLAIM<br>THE TIDE</strong></h1>
          <p>Restore the systems. Reclaim the coast.</p>
          <div class="home-actions">
            <button class="button button-primary" id="start-button" type="button"><span>START MISSION</span><span aria-hidden="true">↗</span></button>
            <button class="button button-secondary is-hidden" id="continue-button" type="button">CONTINUE</button>
            <button class="button button-quiet" id="home-settings-button" type="button">SETTINGS <span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <div class="home-footer"><span>AN ISLAND TO BRING BACK</span><span>WASD · MOUSE · E</span></div>
      </section>

      <section class="journal-screen screen is-hidden" id="journal-screen" aria-labelledby="journal-title" role="dialog" aria-modal="true">
        <div class="journal-backdrop"></div>
        <div class="journal-book">
          <button class="journal-exit" id="journal-exit" type="button" aria-label="Return to title">×</button>
          <div class="journal-page journal-page-left">
            <div class="journal-topline"><span>ISLAND OPERATIONS</span><span>01 / 03</span></div>
            <div class="journal-rule"></div>
            <p class="journal-kicker">FIELD JOURNAL · DAY 01</p>
            <h2 id="journal-title" tabindex="-1">The work begins<br>after the storm.</h2>
            <p class="journal-story">The storm has passed, but the island’s backup systems are failing. Debris has jammed the recycling line and water intake. The wind turbines remain in protective shutdown, while tangled cleanup machines roam the docks.</p>
            <div class="journal-drawing" aria-hidden="true"><span>WIND</span><i></i><span>WATER</span><i></i><span>REUSE</span></div>
            <div class="journal-page-no">01</div>
          </div>
          <div class="journal-page journal-page-right">
            <div class="journal-topline"><span>RECOVERY NOTES</span><span>POST-STORM</span></div>
            <div class="journal-rule"></div>
            <h3>TODAY’S ROUTE</h3>
            <ol class="journal-steps">
              <li><span>01</span><p>Recover a reusable battery and restart the sorter.</p></li>
              <li><span>02</span><p>Clear the intake and restore water treatment.</p></li>
              <li><span>03</span><p>Repair wind control, restart generation when conditions are safe, then extract.</p></li>
            </ol>
            <div class="journal-note">
              <h3>TO THE NEXT ENGINEER</h3>
              <p>Every part you rescue can be useful again. Every system you restore gives the island a little more time. Follow one marker at a time, and make it home.</p>
              <span>— Island Operations</span>
            </div>
            <button class="button button-primary journal-action" id="journal-action" type="button"><span>BEGIN MISSION</span><span aria-hidden="true">→</span></button>
            <div class="journal-page-no">02</div>
          </div>
        </div>
      </section>

      <main class="game-hud screen is-hidden" id="game-hud" aria-label="Game status">
        <div class="world-label-layer" id="world-label-layer" aria-hidden="true"></div>
        <aside class="objective-card" aria-live="polite">
          <div class="objective-header"><span id="phase-label">01 · SORT THE TIDE</span><span class="objective-progress" id="objective-progress"></span></div>
          <h2 id="objective-action">Find the reusable battery</h2>
          <div class="objective-route" id="objective-route">
            <div class="objective-row" id="pickup-row"><span>PICK UP</span><strong id="pickup-value"></strong></div>
            <div class="objective-row" id="from-row"><span>FROM</span><strong id="from-value"></strong></div>
            <div class="objective-row" id="deliver-row"><span>DELIVER TO</span><strong id="deliver-value"></strong></div>
          </div>
          <div class="objective-target" id="objective-target"><span class="compass-arrow" id="compass-arrow" aria-hidden="true">↑</span><span id="target-value"></span><strong id="distance-value"></strong></div>
          <div class="objective-timer is-hidden" id="objective-timer"><span class="timer-pulse"></span><span id="timer-value"></span></div>
        </aside>

        <aside class="service-status" aria-label="Island systems">
          <div class="service-item" id="service-recycling"><span class="service-dot"></span><span>RECYCLING</span></div>
          <div class="service-item" id="service-water"><span class="service-dot"></span><span>WATER</span></div>
          <div class="service-item" id="service-wind"><span class="service-dot"></span><span>WIND</span></div>
        </aside>

        <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
        <div class="target-marker is-hidden" id="target-marker" aria-hidden="true"><div class="target-marker-core">◆</div><div id="marker-distance"></div></div>
        <div class="interaction-prompt is-hidden" id="interaction-prompt"><kbd>E</kbd><span id="interaction-text"></span></div>
        <div class="crew-message is-hidden" id="crew-message" role="status" aria-live="polite"><span>ISLAND CREW</span><strong id="crew-message-name"></strong><p id="crew-message-text"></p><small>TALK AGAIN FOR MORE HINTS</small></div>
        <div class="toast is-hidden" id="toast" role="status" aria-live="polite"></div>
        <div class="hud-bottom">
          <div class="health-card"><div class="health-title"><span>SUIT INTEGRITY</span><strong id="health-number">100</strong></div><div class="health-track"><div class="health-fill" id="health-fill"></div></div></div>
          <div class="key-hints">G DROP <span>·</span> J JOURNAL <span>·</span> TAB GRID <span>·</span> Q DRONE</div>
          <div class="weapon-card"><span>PLANT TOOL</span><strong id="weapon-name">POD BURST</strong><small>∞ SEED PODS</small></div>
        </div>
      </main>

      <section class="pause-screen screen is-hidden" id="pause-screen" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <div class="glass-panel pause-panel">
          <span class="panel-rule"></span><h2 id="pause-title">MISSION PAUSED</h2>
          <p>Click Resume Mission to capture your mouse and continue.</p>
          <button class="button button-primary" id="resume-button" type="button">RESUME MISSION <span aria-hidden="true">→</span></button>
          <button class="button button-secondary" id="pause-journal-button" type="button">FIELD JOURNAL</button>
          <button class="button button-secondary" id="pause-settings-button" type="button">SETTINGS</button>
          <button class="button button-quiet" id="home-button" type="button">RETURN TO TITLE</button>
        </div>
      </section>

      <section class="results-screen screen is-hidden" id="results-screen" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <div class="glass-panel results-panel"><span class="panel-rule"></span><h2 id="result-title">THE ISLAND IS ONLINE</h2>
          <p>What you restored will keep working after you leave.</p>
          <div class="results-grid">
            <div><span>ITEMS RECOVERED</span><strong id="result-items">0</strong></div>
            <div><span>SERVICES RUNNING</span><strong id="result-service">0 s</strong></div>
            <div><span>WIND GENERATED</span><strong id="result-wind">0.0 kWh</strong></div>
            <div><span>IMPORTED ENERGY</span><strong id="result-imported">0.0 kWh</strong></div>
          </div>
          <small>EDUCATIONAL GAME SIMULATION</small>
          <button class="button button-primary" id="restart-button" type="button">PLAY AGAIN <span aria-hidden="true">→</span></button>
          <button class="button button-secondary" id="results-home-button" type="button">RETURN TO TITLE</button>
        </div>
      </section>

      <section class="utility-screen screen is-hidden" id="loading-screen" role="status"><div class="glass-panel"><span class="loading-ring"></span><h2>PREPARING THE ISLAND</h2><p id="loading-message">Loading the mission…</p></div></section>
      <section class="utility-screen screen is-hidden" id="fatal-screen" role="alert"><div class="glass-panel"><span class="panel-rule"></span><h2>MISSION COULD NOT LOAD</h2><p id="fatal-message"></p><button class="button button-primary" id="fatal-home-button" type="button">RETURN TO TITLE</button></div></section>

      <section class="settings-overlay is-hidden" id="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="glass-panel settings-panel">
          <div class="settings-heading"><div><span class="panel-rule"></span><h2 id="settings-title">SETTINGS</h2></div><button class="icon-button" id="close-settings-button" type="button" aria-label="Close settings">×</button></div>
          <div class="setting-row"><label for="music-volume">Music volume</label><input id="music-volume" type="range" min="0" max="100" step="1"><output id="music-output"></output></div>
          <div class="setting-row"><label for="effects-volume">Effects volume</label><input id="effects-volume" type="range" min="0" max="100" step="1"><output id="effects-output"></output></div>
          <div class="setting-row"><label for="mouse-sensitivity">Mouse sensitivity</label><input id="mouse-sensitivity" type="range" min="25" max="200" step="5"><output id="sensitivity-output"></output></div>
          <div class="setting-row"><label for="field-of-view">Field of view</label><input id="field-of-view" type="range" min="65" max="105" step="1"><output id="fov-output"></output></div>
          <div class="setting-row setting-row-select"><label for="guidance-mode">Guidance</label><select id="guidance-mode"><option value="full">Full directions</option><option value="minimal">Minimal</option></select></div>
          <label class="setting-check"><input id="reduced-effects" type="checkbox"><span>Reduce flashes &amp; camera shake</span></label>
          <button class="button button-primary" id="settings-done-button" type="button">DONE <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <section class="energy-overlay is-hidden" id="energy-overlay" aria-label="Microgrid overview">
        <div class="energy-heading"><span>ISLAND MICROGRID</span><span>TAB TO CLOSE</span></div>
        <h2>Energy in motion.</h2>
        <div class="energy-grid">
          <div><span>BATTERY STORED</span><strong id="energy-stored">0.0 / 0.0 kWh</strong></div>
          <div><span>IMPORTED ENERGY</span><strong id="energy-imported">0.0 kWh</strong></div>
          <div><span>WIND GENERATED</span><strong id="energy-wind">0.0 kWh</strong></div>
          <div><span>GENERATION / LOAD</span><strong id="energy-flow">0.0 / 0.0 kW</strong></div>
        </div>
        <small>EDUCATIONAL GAME SIMULATION</small>
      </section>
    `;
    this.bind();
    this.syncSettingsControls();
    this.keyListener = (event) => this.onKeyDown(event);
    document.addEventListener('keydown', this.keyListener);
    this.showHome();
  }

  getSettings(): UISettings {
    return { ...this.settings };
  }

  updateWorldLabels(labels: readonly WorldLabel[]): void {
    if (this.screen !== 'game') return;
    const layer = this.host.querySelector<HTMLElement>('#world-label-layer');
    if (!layer) return;
    const visible = new Set<string>();
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    for (const label of labels) {
      let node = this.labelNodes.get(label.id);
      if (!node) {
        node = document.createElement('div');
        node.className = `world-label world-label--${label.kind}`;
        layer.appendChild(node);
        this.labelNodes.set(label.id, node);
      }
      if (node.textContent !== label.text) node.textContent = label.text;
      node.style.transform = `translate3d(${Math.round(label.x * width)}px, ${Math.round(label.y * height)}px, 0) translate(-50%, -100%)`;
      node.style.opacity = label.opacity.toFixed(2);
      node.style.display = 'block';
      visible.add(label.id);
    }
    for (const [id, node] of this.labelNodes) if (!visible.has(id)) node.style.display = 'none';
  }

  render(view: UIView): void {
    const q = (selector: string) => this.host.querySelector(selector);
    const objective = view.objective;
    text(q('#phase-label'), `${String(view.phaseNumber ?? 1).padStart(2, '0')} · ${view.phaseTitle ?? 'SORT THE TIDE'}`);
    text(q('#objective-action'), objective?.action ?? 'Follow the island recovery plan');
    text(q('#objective-progress'), objective?.progress ?? '');
    this.setRow('#pickup-row', '#pickup-value', objective?.pickUp);
    this.setRow('#from-row', '#from-value', objective?.from);
    this.setRow('#deliver-row', '#deliver-value', objective?.deliverTo);
    text(q('#target-value'), objective?.target ?? '');
    text(q('#distance-value'), objective?.distanceMeters === undefined ? '' : `${Math.max(0, Math.round(objective.distanceMeters))} m`);
    this.toggle('#objective-target', Boolean(objective?.target));
    const arrow = q('#compass-arrow') as HTMLElement | null;
    if (arrow) arrow.style.transform = `rotate(${objective?.bearingDegrees ?? 0}deg)`;
    this.toggle('#objective-timer', objective?.stableSecondsRemaining !== undefined);
    text(q('#timer-value'), objective?.stableSecondsRemaining === undefined ? '' : `STABLE FOR ${Math.ceil(objective.stableSecondsRemaining)} s MORE`);
    const marker = q('#target-marker') as HTMLElement | null;
    const showMarker = Boolean(objective?.target) && objective?.markerX !== undefined && objective.markerY !== undefined && this.settings.guidance === 'full';
    this.toggle('#target-marker', showMarker);
    if (marker && showMarker) {
      marker.style.left = `${clamp(objective!.markerX!, 0.05, 0.95) * 100}%`;
      marker.style.top = `${clamp(objective!.markerY!, 0.08, 0.86) * 100}%`;
    }
    text(q('#marker-distance'), objective?.distanceMeters === undefined ? '' : `${Math.round(objective.distanceMeters)} m`);
    this.host.classList.toggle('guidance-minimal', this.settings.guidance === 'minimal');
    this.host.classList.toggle('reduced-effects', this.settings.reducedEffects);
    this.toggle('#continue-button', view.canContinue === true);

    const health = clamp(view.health ?? 100, 0, view.maxHealth || 100);
    const maxHealth = Math.max(1, view.maxHealth || 100);
    text(q('#health-number'), String(Math.round(health)));
    const healthFill = q('#health-fill') as HTMLElement | null;
    if (healthFill) {
      healthFill.style.width = `${100 * health / maxHealth}%`;
      healthFill.classList.toggle('is-critical', health / maxHealth < 0.3);
    }
    text(q('#weapon-name'), (view.weapon ?? 'POD BURST').toUpperCase());
    this.setService('#service-recycling', view.services?.recycling === true);
    this.setService('#service-water', view.services?.water === true);
    this.setService('#service-wind', view.services?.wind === true);
    this.toggle('#interaction-prompt', Boolean(view.interaction?.action));
    text(q('#interaction-text'), view.interaction ? `${view.interaction.action}${view.interaction.target ? ` · ${view.interaction.target}` : ''}` : '');

    const energy = view.energy;
    text(q('#energy-stored'), `${formatNumber(energy?.storedKWh ?? 0)} / ${formatNumber(energy?.capacityKWh ?? 0)} kWh`);
    text(q('#energy-imported'), `${formatNumber(energy?.importedKWh ?? 0)} kWh`);
    text(q('#energy-wind'), `${formatNumber(energy?.windGeneratedKWh ?? 0)} kWh`);
    text(q('#energy-flow'), `${formatNumber(energy?.generationKW ?? 0)} / ${formatNumber(energy?.demandKW ?? 0)} kW`);
    if (view.result) this.renderResult(view.result);
    if (view.toast !== undefined && view.toast !== this.lastToast) {
      this.lastToast = view.toast;
      if (view.toast) this.showToast(view.toast);
      else this.toggle('#toast', false);
    }
  }

  showHome(): void {
    this.screen = 'home';
    this.settingsOpen = false;
    this.energyOpen = false;
    this.hideCrewMessage();
    this.updateScreens();
  }

  showJournal(firstOpen = true): void {
    this.screen = 'journal';
    this.journalFirstOpen = firstOpen;
    this.hideCrewMessage();
    text(this.host.querySelector('#journal-action span'), firstOpen ? 'BEGIN MISSION' : 'RETURN TO MISSION');
    this.updateScreens();
    this.focus('#journal-title');
  }

  showGame(): void {
    this.screen = 'game';
    this.energyOpen = false;
    this.updateScreens();
  }

  showPause(): void {
    this.screen = 'pause';
    this.energyOpen = false;
    this.hideCrewMessage();
    this.updateScreens();
    this.focus('#resume-button');
  }

  showResults(result?: ResultView): void {
    if (result) this.renderResult(result);
    this.screen = 'results';
    this.energyOpen = false;
    this.hideCrewMessage();
    this.updateScreens();
    this.focus('#restart-button');
  }

  showLoading(message = 'Loading the mission…'): void {
    text(this.host.querySelector('#loading-message'), message);
    this.screen = 'loading';
    this.updateScreens();
  }

  showFatal(message: string): void {
    text(this.host.querySelector('#fatal-message'), message);
    this.screen = 'fatal';
    this.updateScreens();
    this.focus('#fatal-home-button');
  }

  showToast(message: string, milliseconds = 3500): void {
    text(this.host.querySelector('#toast'), message);
    this.toggle('#toast', true);
    if (this.toastTimeout !== undefined) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.toggle('#toast', false), milliseconds);
  }

  showCrewMessage(name: string, message: string): void {
    text(this.host.querySelector('#crew-message-name'), name);
    text(this.host.querySelector('#crew-message-text'), message);
    this.toggle('#crew-message', true);
    if (this.crewMessageTimeout !== undefined) window.clearTimeout(this.crewMessageTimeout);
    this.crewMessageTimeout = window.setTimeout(() => this.hideCrewMessage(), 7600);
  }

  private hideCrewMessage(): void {
    this.toggle('#crew-message', false);
    if (this.crewMessageTimeout !== undefined) window.clearTimeout(this.crewMessageTimeout);
    this.crewMessageTimeout = undefined;
  }

  destroy(): void {
    document.removeEventListener('keydown', this.keyListener);
    if (this.toastTimeout !== undefined) window.clearTimeout(this.toastTimeout);
    if (this.crewMessageTimeout !== undefined) window.clearTimeout(this.crewMessageTimeout);
    this.host.replaceChildren();
  }

  private bind(): void {
    const click = (id: string, fn: () => void) => this.host.querySelector(id)?.addEventListener('click', fn);
    click('#start-button', () => {
      this.callbacks.onStart?.();
      this.showJournal(true);
    });
    click('#continue-button', () => {
      this.showGame();
      this.callbacks.onContinue?.();
    });
    click('#journal-action', () => {
      this.showGame();
      if (this.journalFirstOpen) this.callbacks.onBegin?.();
      else this.callbacks.onJournalClose?.();
    });
    click('#journal-exit', () => {
      if (this.journalFirstOpen) this.returnToTitle();
      else this.showPause();
    });
    click('#home-settings-button', () => this.openSettings());
    click('#pause-settings-button', () => this.openSettings());
    click('#close-settings-button', () => this.closeSettings());
    click('#settings-done-button', () => this.closeSettings());
    click('#resume-button', () => this.resume());
    click('#pause-journal-button', () => {
      this.callbacks.onJournalOpen?.();
      this.showJournal(false);
    });
    click('#home-button', () => this.returnToTitle());
    click('#results-home-button', () => this.returnToTitle());
    click('#fatal-home-button', () => this.returnToTitle());
    click('#restart-button', () => {
      this.callbacks.onRestart?.();
      this.showJournal(true);
    });
    for (const id of ['music-volume', 'effects-volume', 'mouse-sensitivity', 'field-of-view', 'guidance-mode', 'reduced-effects']) {
      this.host.querySelector('#' + id)?.addEventListener('input', () => this.updateSettingsFromControls());
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const isForm = event.target instanceof HTMLElement && Boolean(event.target.closest('input, select, textarea'));
    if (event.key === 'Escape') {
      if (this.settingsOpen) {
        event.preventDefault();
        this.closeSettings();
      } else if (this.screen === 'game') {
        event.preventDefault();
        this.callbacks.onPause?.();
        this.showPause();
      } else if (this.screen === 'pause') {
        event.preventDefault();
        this.focus('#resume-button');
      } else if (this.screen === 'journal' && !this.journalFirstOpen) {
        event.preventDefault();
        this.showPause();
      } else if (this.screen === 'journal') {
        event.preventDefault();
        this.returnToTitle();
      }
    }
    if (isForm || this.settingsOpen || this.screen !== 'game') return;
    if (event.key.toLowerCase() === 'j') {
      event.preventDefault();
      this.callbacks.onJournalOpen?.();
      this.showJournal(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.energyOpen = !this.energyOpen;
      this.updateScreens();
    }
  }

  private resume(): void {
    this.showGame();
    this.callbacks.onResume?.();
  }

  private returnToTitle(): void {
    this.callbacks.onExitToTitle?.();
    this.showHome();
  }

  private openSettings(): void {
    this.settingsReturnScreen = this.screen;
    this.settingsOpen = true;
    this.syncSettingsControls();
    this.updateScreens();
    this.focus('#close-settings-button');
  }

  private closeSettings(): void {
    this.settingsOpen = false;
    this.screen = this.settingsReturnScreen;
    this.updateScreens();
    this.focus(this.screen === 'pause' ? '#resume-button' : '#start-button');
  }

  private syncSettingsControls(): void {
    const setValue = (id: string, value: string) => {
      const el = this.host.querySelector(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    setValue('#music-volume', String(Math.round(this.settings.musicVolume * 100)));
    setValue('#effects-volume', String(Math.round(this.settings.effectsVolume * 100)));
    setValue('#mouse-sensitivity', String(Math.round(this.settings.mouseSensitivity * 100)));
    setValue('#field-of-view', String(this.settings.fieldOfView));
    setValue('#guidance-mode', this.settings.guidance);
    const checkbox = this.host.querySelector('#reduced-effects') as HTMLInputElement | null;
    if (checkbox) checkbox.checked = this.settings.reducedEffects;
    this.updateSettingsLabels();
  }

  private updateSettingsFromControls(): void {
    const value = (id: string) => Number((this.host.querySelector(id) as HTMLInputElement).value);
    this.settings.musicVolume = value('#music-volume') / 100;
    this.settings.effectsVolume = value('#effects-volume') / 100;
    this.settings.mouseSensitivity = value('#mouse-sensitivity') / 100;
    this.settings.fieldOfView = value('#field-of-view');
    this.settings.guidance = (this.host.querySelector('#guidance-mode') as HTMLSelectElement).value as GuidanceMode;
    this.settings.reducedEffects = (this.host.querySelector('#reduced-effects') as HTMLInputElement).checked;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* Storage can be unavailable in private mode. */ }
    this.updateSettingsLabels();
    this.host.classList.toggle('guidance-minimal', this.settings.guidance === 'minimal');
    this.host.classList.toggle('reduced-effects', this.settings.reducedEffects);
    this.callbacks.onSettingsChange?.(this.getSettings());
  }

  private updateSettingsLabels(): void {
    text(this.host.querySelector('#music-output'), `${Math.round(this.settings.musicVolume * 100)}%`);
    text(this.host.querySelector('#effects-output'), `${Math.round(this.settings.effectsVolume * 100)}%`);
    text(this.host.querySelector('#sensitivity-output'), `${this.settings.mouseSensitivity.toFixed(2)}×`);
    text(this.host.querySelector('#fov-output'), `${this.settings.fieldOfView}°`);
  }

  private renderResult(result: ResultView): void {
    text(this.host.querySelector('#result-title'), result.headline || 'THE ISLAND IS ONLINE');
    text(this.host.querySelector('#result-items'), String(result.recoveredItems));
    text(this.host.querySelector('#result-service'), `${Math.round(result.serviceSeconds)} s`);
    text(this.host.querySelector('#result-wind'), `${formatNumber(result.windGeneratedKWh)} kWh`);
    text(this.host.querySelector('#result-imported'), `${formatNumber(result.importedKWh)} kWh`);
  }

  private setRow(rowSelector: string, valueSelector: string, value: string | undefined): void {
    this.toggle(rowSelector, Boolean(value));
    text(this.host.querySelector(valueSelector), value || '');
  }

  private setService(selector: string, online: boolean): void {
    const el = this.host.querySelector(selector);
    el?.classList.toggle('is-online', online);
    el?.setAttribute('aria-label', `${el?.textContent?.trim() || 'Service'} ${online ? 'online' : 'offline'}`);
  }

  private toggle(selector: string, visible: boolean): void {
    this.host.querySelector(selector)?.classList.toggle('is-hidden', !visible);
  }

  private updateScreens(): void {
    for (const screen of ['home', 'journal', 'game', 'pause', 'results', 'loading', 'fatal'] as Screen[]) {
      this.toggle('#' + (screen === 'game' ? 'game-hud' : screen + '-screen'), this.screen === screen);
    }
    this.toggle('#settings-overlay', this.settingsOpen);
    this.toggle('#energy-overlay', this.energyOpen && this.screen === 'game');
    this.host.dataset.screen = this.screen;
    this.host.classList.toggle('guidance-minimal', this.settings.guidance === 'minimal');
    this.host.classList.toggle('reduced-effects', this.settings.reducedEffects);
  }

  private focus(selector: string): void {
    window.requestAnimationFrame(() => (this.host.querySelector(selector) as HTMLElement | null)?.focus());
  }
}
