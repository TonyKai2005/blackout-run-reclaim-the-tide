import * as pc from 'playcanvas';
import { GameUI, type UIView, type UISettings, type ResultView } from './ui';
import { GameAudio } from './game/audio';
import { crewDialogue } from './game/crewDialogue';
import { readSave, writeSave, type SaveEnvelope, type SaveSlot } from './game/save';
import {
  ITEMS, LOCATIONS, applyCommand, createGameState, deriveGuidance, deriveResult,
  restoreGameState, serviceStatus, tickGame, type GameCommand, type GameState,
  type Guidance, type ItemId, type StationId
} from './game/state';
import { WORLD_POINTS, World3D, type WorldAction, type WorldItemView, type WorldPose } from './game/world';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing 3D canvas.');

let world: World3D | null = null;
let state: GameState = createGameState();
let latestResume: SaveEnvelope | null = null;
let latestCheckpoint: SaveEnvelope | null = null;
let isPlaying = false;
let awaitingPointerLock = false;
let pointerLockExitPending = false;
let browserLockRequestPending = false;
let pointerLockRequestId = 0;
let missionAccepted = false;
let lastRenderedAt = 0;
let lastWorldLabelsAt = 0;
let gameTickSeconds = 0;
let lastSavedAt = 0;
let lastEventSerial = 0;
let failureRecovery = false;
let saveQueue: Promise<void> = Promise.resolve();
let warnedSaveFailure = false;
const crewVisits = new Map<string, number>();

const ui = new GameUI({
  onStart: () => startNewMission(),
  onContinue: () => continueMission(),
  onBegin: () => resumeMission(true),
  onPause: () => pauseMission(),
  onResume: () => resumeMission(false),
  onRestart: () => startNewMission(),
  onJournalOpen: () => pauseMission(),
  onJournalClose: () => resumeMission(false),
  onExitToTitle: () => exitToTitle(),
  onSettingsChange: settings => updateSettings(settings)
});
const audio = new GameAudio(ui.getSettings());
ui.showLoading('Preparing the island and physics…');

function updateSettings(settings: UISettings): void {
  world?.setSettings(settings.mouseSensitivity, settings.fieldOfView, settings.reducedEffects);
  audio.setSettings(settings);
  renderUI();
}

function checkpointEnvelope(): SaveEnvelope | null {
  if (!world) return null;
  const snapshot = structuredClone(state);
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    if (snapshot.items[id].status === 'world') snapshot.items[id].position = world.getItemPosition(id);
  }
  return { version: 1, savedAt: new Date().toISOString(), state: snapshot, playerPose: world.getPose(), robots: world.getBots() };
}

function persist(slot: SaveSlot): void {
  const snapshot = checkpointEnvelope();
  if (!snapshot) return;
  if (slot === 'resume') latestResume = snapshot;
  else latestCheckpoint = snapshot;
  saveQueue = saveQueue.catch(() => undefined).then(() => writeSave(slot, snapshot)).catch(() => {
    if (!warnedSaveFailure) {
      warnedSaveFailure = true;
      ui.showToast('Browser storage is unavailable. Progress will last only this session.', 6500);
    }
  });
  lastSavedAt = performance.now();
}

function restoreEnvelope(envelope: SaveEnvelope): void {
  if (!world) return;
  state = restoreGameState(envelope.state);
  const pose: WorldPose = envelope.playerPose ?? { position: [WORLD_POINTS.spawn.x, WORLD_POINTS.spawn.y, WORLD_POINTS.spawn.z], yaw: 0.55, pitch: 0 };
  world.setPose(pose);
  world.resetBots();
  if (Array.isArray(envelope.robots)) world.setBots(envelope.robots);
  world.sync(worldView(), true);
  audio.setMood(state.phase);
  lastEventSerial = state.eventSerial;
  renderUI();
}

function startNewMission(): void {
  if (!world) { ui.showFatal('The island is still loading. Please restart the launcher.'); return; }
  pointerLockRequestId++;
  awaitingPointerLock = false;
  isPlaying = false;
  missionAccepted = false;
  world.setActive(false);
  pointerLockExitPending = document.pointerLockElement === canvas;
  world.releasePointerLock();
  audio.stop();
  state = createGameState();
  crewVisits.clear();
  world.setPose({ position: [WORLD_POINTS.spawn.x, WORLD_POINTS.spawn.y, WORLD_POINTS.spawn.z], yaw: 0.55, pitch: 0 });
  world.resetBots();
  world.sync(worldView(), true);
  lastEventSerial = 0;
  gameTickSeconds = 0;
  renderUI();
}

function continueMission(): void {
  if (!world || !latestResume) { ui.showHome(); ui.showToast('No saved mission is available yet.'); return; }
  const snapshot = latestResume.state.status === 'failed' ? latestCheckpoint : latestResume;
  if (!snapshot || snapshot.state.status === 'failed') {
    startNewMission();
    ui.showJournal(true);
    return;
  }
  try {
    restoreEnvelope(snapshot);
    missionAccepted = true;
  } catch {
    ui.showHome();
    ui.showToast('The saved mission is damaged. Start a new mission.');
    return;
  }
  if (state.status === 'complete') {
    showResults();
    return;
  }
  persist('resume');
  resumeMission(false);
}

function resumeMission(firstStart: boolean): void {
  if (!world) return;
  if (firstStart) {
    missionAccepted = true;
    persist('resume');
    persist('checkpoint');
  }
  if (pointerLockExitPending || browserLockRequestPending) {
    ui.showPause();
    ui.showToast('Mouse capture is finishing. Click Resume Mission again.', 4300);
    return;
  }
  isPlaying = false;
  awaitingPointerLock = true;
  const requestId = ++pointerLockRequestId;
  ui.showGame();
  world.setActive(false);
  browserLockRequestPending = true;
  void world.requestPointerLock().then(locked => {
    browserLockRequestPending = false;
    if (requestId !== pointerLockRequestId) return;
    if (!awaitingPointerLock) {
      if (locked && !isPlaying) world?.releasePointerLock();
      return;
    }
    if (locked && document.pointerLockElement === canvas) activateLockedPlay();
    else {
      awaitingPointerLock = false;
      isPlaying = false;
      world?.setActive(false);
      ui.showPause();
      ui.showToast('Click Resume Mission to capture the mouse.', 5600);
    }
  });
  void audio.unlock();
  if (firstStart) {
    ui.showToast('WASD move · Mouse look · E pick up. Follow the top-left marker.', 5700);
  }
  renderUI();
}

function activateLockedPlay(): void {
  if (!awaitingPointerLock || !world || document.pointerLockElement !== canvas) return;
  awaitingPointerLock = false;
  isPlaying = true;
  world.setActive(true);
  renderUI();
}

function pauseMission(): void {
  if (!world) return;
  pointerLockRequestId++;
  awaitingPointerLock = false;
  isPlaying = false;
  world.setActive(false);
  pointerLockExitPending = document.pointerLockElement === canvas;
  world.releasePointerLock();
  if (missionAccepted) persist('resume');
}

function exitToTitle(): void {
  pauseMission();
  audio.stop();
  ui.showHome();
  renderUI();
}

function worldView() {
  const services = serviceStatus(state);
  const guidance = deriveGuidance(state);
  return {
    phase: state.phase,
    items: state.items as unknown as Record<string, WorldItemView>,
    targetId: guidance.targetId,
    canInteractTarget: guidance.action !== 'wait' && guidance.action !== 'shoot',
    sorterOnline: services.recovery,
    waterOnline: services.water,
    windOnline: services.wind,
    bossLeftDown: state.goals.bossLeftDisabled,
    bossRightDown: state.goals.bossRightDisabled,
    captured: state.goals.bossContained,
    repeaterAvailable: state.phase >= 2
  };
}

function objectiveView(guide: Guidance): UIView['objective'] {
  const nav = world?.getGuidanceNav();
  const marker = world?.projectTarget();
  return {
    action: guide.title,
    pickUp: guide.itemLabel,
    from: guide.sourceLabel,
    deliverTo: guide.destinationLabel,
    target: guide.targetLabel,
    distanceMeters: nav?.distanceMeters,
    bearingDegrees: nav?.bearingDegrees,
    markerX: marker?.x,
    markerY: marker?.y,
    progress: guide.progress ? `${guide.progress.current}/${guide.progress.total}` : undefined,
    stableSecondsRemaining: guide.remainingSeconds
  };
}

function interactionView(guide: Guidance): UIView['interaction'] {
  const nearby = world?.getInteraction();
  if (!nearby) return null;
  if (nearby.action === 'Drop' || nearby.action === 'Talk') return nearby;
  if (guide.action === 'wait' || guide.action === 'shoot') return null;
  if (guide.action === 'drop') return { action: 'Drop', target: 'carried cargo' };
  let action = 'Activate';
  if (guide.action === 'pickup') action = 'Pick up';
  else if (guide.action === 'deliver') action = guide.targetId === 'sorter_chute' ? 'Deliver' : 'Install';
  else if (guide.action === 'extract') action = 'Extract';
  else if (guide.targetId === 'sorter_jam' || guide.targetId.startsWith('intake')) action = 'Clear';
  return { action, target: guide.targetLabel };
}

function renderUI(): void {
  const guide = deriveGuidance(state);
  const services = serviceStatus(state);
  const view: UIView = {
    canContinue: latestResume !== null,
    phaseNumber: state.phase,
    phaseTitle: guide.phaseTitle.replace(/^\d\d\s*·\s*/, ''),
    objective: objectiveView(guide),
    interaction: interactionView(guide),
    health: state.playerHealth,
    maxHealth: 100,
    weapon: world?.weaponName ?? 'Pod Burst',
    services: { recycling: services.recovery, water: services.water, wind: services.wind },
    energy: {
      storedKWh: state.grid.batteryKwh,
      capacityKWh: state.grid.capacityKwh,
      importedKWh: state.grid.importedKwh,
      windGeneratedKWh: state.grid.generatedKwh,
      generationKW: state.grid.generationKw,
      demandKW: Object.values(state.grid.loads).filter(load => load.enabled).reduce((sum, load) => sum + load.demandKw, 0)
    }
  };
  ui.render(view);
}

function showResults(): void {
  const result = deriveResult(state);
  const summary: ResultView = {
    recoveredItems: result.wasteBundlesProcessed + result.reusedComponents,
    serviceSeconds: result.waterPoweredSeconds,
    windGeneratedKWh: result.windGeneratedKwh,
    importedKWh: result.importedBatteryKwh,
    headline: 'THE ISLAND IS ONLINE'
  };
  pointerLockRequestId++;
  awaitingPointerLock = false;
  pointerLockExitPending = document.pointerLockElement === canvas;
  world?.setActive(false);
  world?.releasePointerLock();
  isPlaying = false;
  audio.stop();
  ui.showResults(summary);
  persist('resume');
}

function applyGameCommand(command: GameCommand): void {
  if (!world || !isPlaying) return;
  const before = state;
  const beforeGuide = deriveGuidance(state);
  state = applyCommand(state, command);
  handleStateChange(before, beforeGuide);
}

function handleStateChange(previous: GameState, previousGuide: Guidance): void {
  if (!world) return;
  const guide = deriveGuidance(state);
  world.sync(worldView());
  if (state.lastEvent && state.lastEvent.serial !== lastEventSerial) {
    lastEventSerial = state.lastEvent.serial;
    if (state.lastEvent.kind === 'blocked') ui.showToast(state.lastEvent.message);
    else if (state.lastEvent.kind === 'success' || state.lastEvent.kind === 'interrupted') ui.showToast(state.lastEvent.message);
    if (state.lastEvent.kind === 'phase') {
      ui.showToast(state.lastEvent.message, 5100);
      void audio.play('checkpoint', 0.75);
      if (state.phase > previous.phase) {
        audio.setMood(state.phase);
        if (state.phase === 2) window.setTimeout(() => ui.showToast('SEED REPEATER UNLOCKED · Press 2 to equip.', 5000), 2300);
      }
    }
    if (state.lastEvent.kind === 'complete') void audio.play('extract', 0.9);
  }
  if (state.status !== 'failed' && (previousGuide.goalId !== guide.goalId || previous.phase !== state.phase || state.status === 'readyToExtract')) persist('checkpoint');
  if (previous !== state) persist('resume');
  renderUI();
  if (state.status === 'failed' && !failureRecovery) void recoverFromFailure();
  else if (state.status === 'complete') showResults();
}

async function recoverFromFailure(): Promise<void> {
  if (!world) return;
  failureRecovery = true;
  pauseMission();
  ui.showPause();
  ui.showToast('Returning to your last objective checkpoint. Select Resume when ready.', 6000);
  try {
    await saveQueue;
    const saved = await readSave('checkpoint');
    if (saved && saved.state.status !== 'failed') restoreEnvelope(saved);
    else {
      startNewMission();
      missionAccepted = true;
      persist('checkpoint');
    }
    state = applyCommand(state, { type: 'heal', amount: 100 });
    world.sync(worldView());
    persist('resume');
    renderUI();
  } catch {
    startNewMission();
    ui.showPause();
  } finally {
    failureRecovery = false;
  }
}

function handleWorldAction(action: WorldAction): void {
  if (!world || !isPlaying) return;
  if (action.type === 'interact') {
    if (action.id in ITEMS) {
      if (state.heldItemId) applyGameCommand({ type: 'drop', position: world.getItemPosition(state.heldItemId) });
      else { applyGameCommand({ type: 'pickup', itemId: action.id as ItemId }); void audio.play('grab', 0.65); }
    } else if (action.id in LOCATIONS) {
      applyGameCommand({ type: 'interact', stationId: action.id as StationId });
      if (action.id.includes('switch') || action.id === 'grid_socket') void audio.play('power_on', 0.48);
      else if (action.id.startsWith('intake')) void audio.play('metal_impact', 0.56);
      else if (action.id === 'sorter_chute') void audio.play('sorter_start', 0.55);
      else void audio.play('grab', 0.38);
    }
  } else if (action.type === 'drop') {
    if (state.heldItemId) applyGameCommand({ type: 'drop', position: world.getItemPosition(state.heldItemId) });
    void audio.play('release', 0.45);
  } else if (action.type === 'recover') {
    if (action.id in ITEMS) applyGameCommand({ type: 'recoverItem', itemId: action.id as ItemId });
  } else if (action.type === 'talk') {
    const visit = crewVisits.get(action.id) ?? 0;
    ui.showCrewMessage(action.name, crewDialogue(action.id, state, visit));
    crewVisits.set(action.id, visit + 1);
    return;
  } else if (action.type === 'fire') {
    void audio.play(action.weapon === 'Pod Burst' ? 'pod_burst' : 'seed_repeater', action.weapon === 'Pod Burst' ? 0.67 : 0.46);
    return;
  } else if (action.type === 'shoot') {
    void audio.play('trash_hit', 0.57);
    if (action.id === 'boss_node_left' || action.id === 'boss_node_right') applyGameCommand({ type: 'hitBossNode', nodeId: action.id });
  } else if (action.type === 'damage') {
    applyGameCommand({ type: 'damage', amount: action.amount });
    void audio.play('hurt', 0.78);
  } else if (action.type === 'footstep') { audio.foot(); return; }
  else if (action.type === 'drone') {
    const guide = deriveGuidance(state);
    ui.showToast(`DRONE SCAN · ${guide.detail}`, 5100);
    void audio.play('drone_scan', 0.62);
  } else if (action.type === 'weapon') ui.showToast(`${action.weapon.toUpperCase()} EQUIPPED · Unlimited seed pods.`, 2300);
  renderUI();
}

async function loadPhysics(): Promise<void> {
  pc.WasmModule.setConfig('Ammo', {
    glueUrl: 'assets/ammo/ammo.wasm.js',
    wasmUrl: 'assets/ammo/ammo.wasm.wasm',
    fallbackUrl: 'assets/ammo/ammo.js'
  });
  await Promise.race([
    new Promise<void>((resolve) => pc.WasmModule.getInstance('Ammo', () => resolve())),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Physics did not load in time.')), 22000))
  ]);
}

async function initialize(): Promise<void> {
  await loadPhysics();
  const app = new pc.Application(canvas!, { graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' } });
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.start();
  window.addEventListener('resize', () => app.resizeCanvas());
  world = new World3D(app, canvas!, handleWorldAction);
  world.setSettings(ui.settings.mouseSensitivity, ui.settings.fieldOfView, ui.settings.reducedEffects);
  world.sync(worldView(), true);
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      if (awaitingPointerLock) activateLockedPlay();
      else if (!isPlaying) {
        pointerLockExitPending = true;
        world?.releasePointerLock();
      }
    } else {
      pointerLockExitPending = false;
      if (isPlaying) {
        isPlaying = false;
        world?.setActive(false);
        persist('resume');
        ui.showPause();
      }
    }
  });
  app.on('update', (dt: number) => {
    if (!isPlaying || !world) return;
    gameTickSeconds += Math.min(dt, 0.08);
    if (gameTickSeconds >= 0.2) {
      const before = state;
      const beforeGuide = deriveGuidance(state);
      state = tickGame(state, gameTickSeconds);
      gameTickSeconds = 0;
      if (state.eventSerial !== before.eventSerial || state.phase !== before.phase || Math.floor(state.elapsedSeconds) !== Math.floor(before.elapsedSeconds)) handleStateChange(before, beforeGuide);
    }
    const now = performance.now();
    if (now - lastWorldLabelsAt >= 34) {
      ui.updateWorldLabels(world.getWorldLabels());
      lastWorldLabelsAt = now;
    }
    if (now - lastRenderedAt >= 115) { renderUI(); lastRenderedAt = now; }
    if (now - lastSavedAt > 8000) persist('resume');
  });
  try {
    const saved = await readSave('resume');
    if (saved) { restoreGameState(saved.state); latestResume = saved; }
  } catch { /* A corrupt resume does not prevent a new mission. */ }
  try {
    const saved = await readSave('checkpoint');
    if (saved && saved.state.status !== 'failed') { restoreGameState(saved.state); latestCheckpoint = saved; }
  } catch { /* A corrupt checkpoint does not prevent a new mission. */ }
  renderUI();
  ui.showHome();
}

void initialize().catch(error => {
  console.error('Reclaim the Tide initialization failed', error);
  ui.showFatal(error instanceof Error ? error.message : 'This browser could not start the 3D world.');
});
