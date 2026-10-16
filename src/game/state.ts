/**
 * Browser campaign rules. This module has no renderer, audio, browser-storage,
 * or DOM dependency. World objects use the IDs below and supply their own 3D
 * coordinates. All energy numbers are an educational game simulation.
 */

export const LOCATIONS = {
  grid_socket: 'Dock Grid Slot',
  sorter_jam: 'Jammed Recovery Line',
  sorter_chute: 'Sorting Chute',
  sorter_switch: 'Recovery Line Switch',
  comms_switch: 'Communications Switch',
  intake_a: 'West Water Intake',
  intake_b: 'East Water Intake',
  filter_socket: 'Filter Bay',
  water_switch: 'Water Treatment Switch',
  wind_socket: 'Upper Turbine Controls',
  wind_switch: 'Wind Restart Console',
  boss_node_left: 'Left Exposed Node',
  boss_node_right: 'Right Exposed Node',
  capture_switch: 'Recovery Capture Console',
  extraction: 'Extraction Boat',
} as const;

export type StationId = keyof typeof LOCATIONS;

export const ITEMS = {
  battery: { label: 'Reusable Battery', sourceLabel: 'North Storage Bay', destinationId: 'grid_socket', unlockPhase: 1 },
  waste_a: { label: 'Mixed Waste Bundle 1', sourceLabel: 'South Quay', destinationId: 'sorter_chute', unlockPhase: 1 },
  waste_b: { label: 'Mixed Waste Bundle 2', sourceLabel: 'Sea Wall', destinationId: 'sorter_chute', unlockPhase: 1 },
  filter_frame: { label: 'Reusable Filter Frame', sourceLabel: 'Maintenance Shed', destinationId: 'filter_socket', unlockPhase: 2 },
  filter_cartridge: { label: 'Fresh Filter Cartridge', sourceLabel: 'Clean Parts Locker', destinationId: 'filter_socket', unlockPhase: 2 },
  wind_converter: { label: 'Wind Control Module', sourceLabel: 'Turbine Service Deck', destinationId: 'wind_socket', unlockPhase: 3 },
} as const;

export type ItemId = keyof typeof ITEMS;
export type Phase = 1 | 2 | 3;
export type LoadId = 'Comms' | 'Water' | 'Recovery' | 'Utility' | 'Security';
export type Vector3 = [number, number, number];
export type ItemStatus = 'world' | 'held' | 'installed' | 'delivered' | 'processed';

export interface ItemState {
  status: ItemStatus;
  /** Updated by the world after a physical drop. Null means use authored spawn. */
  position: Vector3 | null;
  wasDropped: boolean;
}

export interface EnergyLoadState {
  demandKw: number;
  priority: number;
  enabled: boolean;
  faulted: boolean;
  powered: boolean;
}

export interface EnergyGridState {
  batteryKwh: number;
  capacityKwh: number;
  maxDischargeKw: number;
  generationKw: number;
  initialBatteryKwh: number;
  importedKwh: number;
  generatedKwh: number;
  consumedKwh: number;
  spilledKwh: number;
  unservedKwh: number;
  elapsedSeconds: number;
  loads: Record<LoadId, EnergyLoadState>;
}

export interface ChapterGoalState {
  sorterJamCleared: boolean;
  intakeACleared: boolean;
  intakeBCleared: boolean;
  sorterStarted: boolean;
  waterStarted: boolean;
  windStarted: boolean;
  bossLeftDisabled: boolean;
  bossRightDisabled: boolean;
  bossContained: boolean;
  /** Consecutive seconds for the current phase; reset after an interruption. */
  stableSeconds: number;
  /** Fractional processing time toward the next delivered waste bundle. */
  processingSeconds: number;
  waterPoweredSeconds: number;
}

export interface GameEvent {
  serial: number;
  kind: 'success' | 'blocked' | 'phase' | 'interrupted' | 'failed' | 'complete';
  message: string;
}

export interface GameState {
  version: 1;
  phase: Phase;
  status: 'playing' | 'readyToExtract' | 'failed' | 'complete';
  playerHealth: number;
  heldItemId: ItemId | null;
  items: Record<ItemId, ItemState>;
  goals: ChapterGoalState;
  grid: EnergyGridState;
  /** Active-play seconds only. Calling tickGame while paused is the caller's error. */
  elapsedSeconds: number;
  phaseElapsedSeconds: number;
  tickRemainderSeconds: number;
  eventSerial: number;
  lastEvent: GameEvent | null;
}

export type GameCommand =
  | { type: 'pickup'; itemId: ItemId }
  | { type: 'drop'; position?: Vector3 }
  | { type: 'setItemPosition'; itemId: ItemId; position: Vector3 }
  | { type: 'recoverItem'; itemId: ItemId }
  | { type: 'install'; itemId: ItemId; stationId: StationId }
  | { type: 'interact'; stationId: StationId }
  | { type: 'hitBossNode'; nodeId: 'boss_node_left' | 'boss_node_right' }
  | { type: 'setLoadEnabled'; loadId: LoadId; enabled: boolean }
  | { type: 'setLoadFault'; loadId: LoadId; faulted: boolean }
  | { type: 'damage'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'extract' };

export interface Guidance {
  phase: Phase;
  phaseTitle: string;
  goalId: string;
  action: 'pickup' | 'drop' | 'deliver' | 'interact' | 'shoot' | 'wait' | 'extract';
  title: string;
  detail: string;
  /** Scene entity ID. Its position supplies the distance and direction arrow. */
  targetId: ItemId | StationId;
  targetLabel: string;
  itemLabel?: string;
  sourceLabel?: string;
  destinationLabel?: string;
  progress?: { current: number; total: number };
  remainingSeconds?: number;
}

export interface GameResult {
  complete: boolean;
  elapsedSeconds: number;
  wasteBundlesProcessed: number;
  reusedComponents: number;
  waterPoweredSeconds: number;
  windGeneratedKwh: number;
  importedBatteryKwh: number;
  unservedDemandKwh: number;
  energyBalanceErrorKwh: number;
  disclosure: 'Educational game simulation';
}

const PHASE_TITLES = {
  1: '01 · SORT THE TIDE',
  2: '02 · FLOW AGAIN',
  3: '03 · RETURN OF THE WIND',
} as const;

const LOAD_ORDER: LoadId[] = ['Comms', 'Water', 'Recovery', 'Utility', 'Security'];
const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
const EPSILON = 1e-9;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function event(state: GameState, kind: GameEvent['kind'], message: string): void {
  state.lastEvent = { serial: ++state.eventSerial, kind, message };
}

function blocked(state: GameState, message: string): void {
  event(state, 'blocked', message);
}

function dispatch(grid: EnergyGridState, availableKw: number): number {
  let suppliedKw = 0;
  for (const id of LOAD_ORDER) {
    const load = grid.loads[id];
    load.powered = load.enabled && !load.faulted && load.demandKw <= availableKw + EPSILON;
    if (load.powered) {
      suppliedKw += load.demandKw;
      availableKw = Math.max(0, availableKw - load.demandKw);
    }
  }
  return suppliedKw;
}

function refreshPower(grid: EnergyGridState): void {
  dispatch(grid, grid.generationKw + (grid.batteryKwh > EPSILON ? grid.maxDischargeKw : 0));
}

function stepGrid(grid: EnergyGridState): void {
  const hours = 1 / 3600;
  const generated = grid.generationKw * hours;
  const requestedKw = LOAD_ORDER.reduce((sum, id) => sum + (grid.loads[id].enabled ? grid.loads[id].demandKw : 0), 0);
  const availableKw = grid.generationKw + Math.min(grid.maxDischargeKw, grid.batteryKwh / hours);
  const suppliedKw = dispatch(grid, availableKw);
  const consumed = suppliedKw * hours;
  const balance = grid.batteryKwh + generated - consumed;
  if (balance < -EPSILON) throw new Error('Grid dispatch exceeded available energy.');
  const spill = Math.max(0, balance - grid.capacityKwh);
  grid.batteryKwh = Math.max(0, Math.min(grid.capacityKwh, balance));
  grid.generatedKwh += generated;
  grid.consumedKwh += consumed;
  grid.spilledKwh += spill;
  grid.unservedKwh += Math.max(0, (requestedKw - suppliedKw) * hours);
  grid.elapsedSeconds++;
}

export function createGameState(): GameState {
  const items = {} as Record<ItemId, ItemState>;
  for (const id of ITEM_IDS) items[id] = { status: 'world', position: null, wasDropped: false };
  const grid: EnergyGridState = {
    batteryKwh: 0.25, capacityKwh: 0.5, maxDischargeKw: 8, generationKw: 0,
    initialBatteryKwh: 0.25, importedKwh: 0, generatedKwh: 0,
    consumedKwh: 0, spilledKwh: 0, unservedKwh: 0, elapsedSeconds: 0,
    loads: {
      Comms: { demandKw: 2, priority: 0, enabled: false, faulted: false, powered: false },
      Water: { demandKw: 5, priority: 1, enabled: false, faulted: false, powered: false },
      Recovery: { demandKw: 3, priority: 2, enabled: false, faulted: false, powered: false },
      Utility: { demandKw: 4, priority: 3, enabled: false, faulted: false, powered: false },
      Security: { demandKw: 2, priority: 4, enabled: false, faulted: false, powered: false },
    },
  };
  return {
    version: 1, phase: 1, status: 'playing', playerHealth: 100, heldItemId: null, items,
    goals: {
      sorterJamCleared: false, intakeACleared: false, intakeBCleared: false,
      sorterStarted: false, waterStarted: false, windStarted: false,
      bossLeftDisabled: false, bossRightDisabled: false, bossContained: false,
      stableSeconds: 0, processingSeconds: 0, waterPoweredSeconds: 0,
    },
    grid, elapsedSeconds: 0, phaseElapsedSeconds: 0, tickRemainderSeconds: 0,
    eventSerial: 0, lastEvent: null,
  };
}

export function windSpeedMps(state: GameState): number {
  return state.phase < 3 ? 31 : 31 - 12 * Math.min(1, state.phaseElapsedSeconds / 90);
}

export function isPowered(state: GameState, id: LoadId): boolean {
  return state.grid.loads[id].powered;
}

export function serviceStatus(state: GameState): { communications: boolean; recovery: boolean; water: boolean; wind: boolean } {
  return {
    communications: isPowered(state, 'Comms'),
    recovery: state.goals.sorterJamCleared && state.goals.sorterStarted && isPowered(state, 'Recovery'),
    water: state.goals.waterStarted && state.goals.intakeACleared && state.goals.intakeBCleared &&
      state.items.filter_frame.status === 'installed' && state.items.filter_cartridge.status === 'installed' && isPowered(state, 'Water'),
    wind: state.goals.windStarted && state.grid.generationKw > 0,
  };
}

function deliveredCount(state: GameState): number {
  return (['delivered', 'processed'].includes(state.items.waste_a.status) ? 1 : 0) +
    (['delivered', 'processed'].includes(state.items.waste_b.status) ? 1 : 0);
}

function processedCount(state: GameState): number {
  return (state.items.waste_a.status === 'processed' ? 1 : 0) + (state.items.waste_b.status === 'processed' ? 1 : 0);
}

function phaseRequirementsMet(state: GameState): boolean {
  const services = serviceStatus(state);
  if (!services.communications) return false;
  if (state.phase === 1) return state.items.battery.status === 'installed' && services.recovery && processedCount(state) === 2;
  if (state.phase === 2) return services.water;
  return services.wind && services.water && services.recovery && state.goals.bossContained;
}

function installed(state: GameState, itemId: ItemId, stationId: StationId): boolean {
  const descriptor = ITEMS[itemId];
  if (descriptor.destinationId !== stationId || state.heldItemId !== itemId || state.items[itemId].status !== 'held') return false;
  if (itemId === 'filter_cartridge' && state.items.filter_frame.status !== 'installed') return false;
  state.heldItemId = null;
  state.items[itemId].status = stationId === 'sorter_chute' ? 'delivered' : 'installed';
  state.items[itemId].position = null;
  if (itemId === 'battery') {
    state.grid.capacityKwh += 8;
    state.grid.batteryKwh += 6;
    state.grid.maxDischargeKw += 4;
    state.grid.importedKwh += 6;
    refreshPower(state.grid);
  }
  event(state, 'success', `${descriptor.label} ${stationId === 'sorter_chute' ? 'delivered' : 'installed'}.`);
  return true;
}

function interact(state: GameState, id: StationId): void {
  const goals = state.goals;
  const grid = state.grid;
  switch (id) {
    case 'grid_socket':
      if (state.heldItemId === 'battery') installed(state, 'battery', id);
      else if (state.items.battery.status === 'installed' && grid.batteryKwh < 0.5) {
        const added = Math.min(1, grid.capacityKwh - grid.batteryKwh);
        grid.batteryKwh += added;
        grid.importedKwh += added;
        refreshPower(grid);
        event(state, 'success', `${added.toFixed(2)} kWh imported from an emergency battery pack.`);
      } else blocked(state, state.items.battery.status === 'installed' ? 'Emergency packs are available below 0.5 kWh.' : 'Bring the Reusable Battery here.');
      break;
    case 'sorter_jam':
      if (state.items.battery.status !== 'installed') blocked(state, 'Install the Reusable Battery first.');
      else if (goals.sorterJamCleared) blocked(state, 'The recovery line is already clear.');
      else { goals.sorterJamCleared = true; event(state, 'success', 'Recovery line blockage cleared.'); }
      break;
    case 'sorter_chute':
      if (!goals.sorterJamCleared) blocked(state, 'Clear the recovery line first.');
      else if (state.heldItemId === 'waste_a' || state.heldItemId === 'waste_b') installed(state, state.heldItemId, id);
      else blocked(state, 'Bring a Mixed Waste Bundle here.');
      break;
    case 'sorter_switch':
      if (!goals.sorterJamCleared || deliveredCount(state) < 2) blocked(state, 'Clear the jam and deliver both waste bundles first.');
      else {
        goals.sorterStarted = true; grid.loads.Recovery.enabled = true; grid.loads.Recovery.faulted = false;
        refreshPower(grid); event(state, 'success', 'Material recovery line started.');
      }
      break;
    case 'comms_switch':
      grid.loads.Comms.enabled = true; grid.loads.Comms.faulted = false; refreshPower(grid);
      event(state, 'success', 'Island communications connected.');
      break;
    case 'intake_a':
    case 'intake_b':
      if (state.phase < 2) blocked(state, 'Water treatment is the next assignment.');
      else if (id === 'intake_a' ? goals.intakeACleared : goals.intakeBCleared) blocked(state, 'This intake is already clear.');
      else {
        if (id === 'intake_a') goals.intakeACleared = true; else goals.intakeBCleared = true;
        event(state, 'success', `${LOCATIONS[id]} cleared.`);
      }
      break;
    case 'filter_socket':
      if (state.phase < 2) blocked(state, 'Water treatment is the next assignment.');
      else if (state.heldItemId === 'filter_frame') installed(state, 'filter_frame', id);
      else if (state.heldItemId === 'filter_cartridge') {
        if (!installed(state, 'filter_cartridge', id)) blocked(state, 'Install the reusable filter frame first.');
      } else blocked(state, state.items.filter_frame.status === 'installed' ? 'Bring the Fresh Filter Cartridge here.' : 'Bring the Reusable Filter Frame here.');
      break;
    case 'water_switch':
      if (!goals.intakeACleared || !goals.intakeBCleared || state.items.filter_frame.status !== 'installed' || state.items.filter_cartridge.status !== 'installed') {
        blocked(state, 'Clear both intakes and fit the frame and cartridge first.');
      } else {
        goals.waterStarted = true; grid.loads.Water.enabled = true; grid.loads.Water.faulted = false;
        refreshPower(grid); event(state, 'success', 'Water treatment equipment running.');
      }
      break;
    case 'wind_socket':
      if (state.phase < 3) blocked(state, 'Wind control is the final assignment.');
      else if (state.heldItemId === 'wind_converter') installed(state, 'wind_converter', id);
      else blocked(state, 'Bring the Wind Control Module here.');
      break;
    case 'wind_switch':
      if (state.items.wind_converter.status !== 'installed') blocked(state, 'Install the Wind Control Module first.');
      else if (windSpeedMps(state) >= 25) blocked(state, 'Turbine protective shutdown: wait for wind below 25 m/s.');
      else {
        goals.windStarted = true; grid.generationKw = 18; refreshPower(grid);
        event(state, 'success', 'Wind generation online.');
      }
      break;
    case 'capture_switch':
      if (!goals.bossLeftDisabled || !goals.bossRightDisabled) blocked(state, 'Disable both exposed nodes first.');
      else if (!serviceStatus(state).wind || !serviceStatus(state).recovery) blocked(state, 'Wind generation and the recovery line must be online.');
      else if (goals.bossContained) blocked(state, 'Waste machine already contained.');
      else { goals.bossContained = true; event(state, 'success', 'Runaway waste machine contained.'); }
      break;
    case 'extraction':
      extract(state);
      break;
    case 'boss_node_left':
    case 'boss_node_right':
      blocked(state, 'Hit the exposed node with a seed pod.');
      break;
  }
}

function extract(state: GameState): void {
  if (state.phase !== 3 || state.status !== 'readyToExtract' || !phaseRequirementsMet(state)) {
    blocked(state, 'Restore all required services and keep them stable before extraction.');
    return;
  }
  state.status = 'complete';
  event(state, 'complete', 'Island recovery complete. Extraction successful.');
}

/** Apply one gameplay action; invalid actions leave progression unchanged and emit a blocked event. */
export function applyCommand(current: GameState, command: GameCommand): GameState {
  const state = clone(current);
  if (state.status === 'complete' || state.status === 'failed') return state;
  switch (command.type) {
    case 'pickup': {
      const item = state.items[command.itemId];
      if (!item || ITEMS[command.itemId].unlockPhase > state.phase) blocked(state, 'This item is not available yet.');
      else if (state.heldItemId) blocked(state, 'Put down the item you are carrying first.');
      else if (item.status !== 'world') blocked(state, 'This item cannot be picked up.');
      else {
        item.status = 'held'; state.heldItemId = command.itemId;
        event(state, 'success', `${ITEMS[command.itemId].label} picked up.`);
      }
      break;
    }
    case 'drop': {
      if (!state.heldItemId) { blocked(state, 'Nothing to put down.'); break; }
      const id = state.heldItemId;
      const item = state.items[id];
      if (command.position && !validVector(command.position)) { blocked(state, 'Invalid drop position.'); break; }
      item.status = 'world'; item.wasDropped = true;
      item.position = command.position ? [...command.position] as Vector3 : item.position;
      state.heldItemId = null;
      event(state, 'success', `${ITEMS[id].label} put down.`);
      break;
    }
    case 'setItemPosition':
      if (!validVector(command.position)) blocked(state, 'Invalid item position.');
      else if (state.items[command.itemId]?.status === 'world') state.items[command.itemId].position = [...command.position] as Vector3;
      break;
    case 'recoverItem':
      if (state.items[command.itemId]?.status !== 'world') blocked(state, 'Only loose cargo can be recovered.');
      else {
        state.items[command.itemId].position = null;
        state.items[command.itemId].wasDropped = false;
        event(state, 'success', `${ITEMS[command.itemId].label} returned to its safe pickup point.`);
      }
      break;
    case 'install':
      if (state.heldItemId !== command.itemId || ITEMS[command.itemId]?.destinationId !== command.stationId) blocked(state, 'Carry the matching item to its destination.');
      else interact(state, command.stationId);
      break;
    case 'interact':
      interact(state, command.stationId);
      break;
    case 'hitBossNode':
      if (state.phase !== 3 || state.items.wind_converter.status !== 'installed') blocked(state, 'Repair the wind controls before confronting the waste machine.');
      else if (command.nodeId === 'boss_node_left' && !state.goals.bossLeftDisabled) {
        state.goals.bossLeftDisabled = true; event(state, 'success', 'Left exposed node disabled.');
      } else if (command.nodeId === 'boss_node_right' && !state.goals.bossRightDisabled) {
        state.goals.bossRightDisabled = true; event(state, 'success', 'Right exposed node disabled.');
      }
      break;
    case 'setLoadEnabled': {
      const load = state.grid.loads[command.loadId];
      if (!load) { blocked(state, 'Unknown electrical circuit.'); break; }
      if (command.enabled && command.loadId === 'Recovery' && !state.goals.sorterStarted) blocked(state, 'Start the recovery line first.');
      else if (command.enabled && command.loadId === 'Water' && !state.goals.waterStarted) blocked(state, 'Start water treatment first.');
      else { load.enabled = command.enabled; refreshPower(state.grid); event(state, 'success', `${command.loadId} circuit ${command.enabled ? 'connected' : 'isolated'}.`); }
      break;
    }
    case 'setLoadFault': {
      const load = state.grid.loads[command.loadId];
      if (!load) { blocked(state, 'Unknown electrical circuit.'); break; }
      load.faulted = command.faulted; refreshPower(state.grid);
      event(state, command.faulted ? 'interrupted' : 'success', `${command.loadId} circuit ${command.faulted ? 'faulted' : 'repaired'}.`);
      break;
    }
    case 'damage':
      if (!Number.isFinite(command.amount) || command.amount < 0) { blocked(state, 'Invalid injury amount.'); break; }
      state.playerHealth = Math.max(0, state.playerHealth - command.amount);
      if (state.playerHealth === 0) {
        state.status = 'failed';
        event(state, 'failed', 'Field engineer down. Restore the last objective checkpoint.');
      } else if (command.amount > 0) event(state, 'interrupted', 'Field engineer injured.');
      break;
    case 'heal':
      if (!Number.isFinite(command.amount) || command.amount < 0) { blocked(state, 'Invalid recovery amount.'); break; }
      state.playerHealth = Math.min(100, state.playerHealth + command.amount);
      if (command.amount > 0) event(state, 'success', 'Field engineer recovered.');
      break;
    case 'extract':
      extract(state);
      break;
  }
  return state;
}

/** Advance only while the game is actively playing. Uses fixed one-second grid ticks. */
export function tickGame(current: GameState, seconds: number): GameState {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Tick duration must be finite and nonnegative.');
  if (seconds === 0 || current.status === 'complete' || current.status === 'failed') return current;
  const state = clone(current);
  state.tickRemainderSeconds += seconds;
  while (state.tickRemainderSeconds >= 1) {
    state.tickRemainderSeconds -= 1;
    state.elapsedSeconds++;
    state.phaseElapsedSeconds++;
    if (state.phase === 3 && state.goals.windStarted) {
      state.grid.generationKw = windSpeedMps(state) < 25 ? 18 : 0;
      refreshPower(state.grid);
    }
    stepGrid(state.grid);
    if (serviceStatus(state).recovery) {
      const next = ITEM_IDS.find(id => (id === 'waste_a' || id === 'waste_b') && state.items[id].status === 'delivered');
      if (next) {
        state.goals.processingSeconds++;
        if (state.goals.processingSeconds >= 3) {
          state.goals.processingSeconds = 0;
          state.items[next].status = 'processed';
          event(state, 'success', `${ITEMS[next].label} sorted into recovery streams.`);
        }
      }
    }
    if (serviceStatus(state).water) state.goals.waterPoweredSeconds++;
    if (phaseRequirementsMet(state)) {
      state.goals.stableSeconds++;
      const duration = state.phase === 1 ? 20 : 25;
      if (state.goals.stableSeconds >= duration) {
        if (state.phase < 3) {
          state.phase = (state.phase + 1) as Phase;
          state.phaseElapsedSeconds = 0;
          state.goals.stableSeconds = 0;
          event(state, 'phase', `${PHASE_TITLES[state.phase]} unlocked.`);
        } else if (state.status !== 'readyToExtract') {
          state.status = 'readyToExtract';
          event(state, 'phase', 'All critical services stable. Extraction authorized.');
        }
      }
    } else if (state.goals.stableSeconds > 0 || state.status === 'readyToExtract') {
      state.goals.stableSeconds = 0;
      if (state.status === 'readyToExtract') state.status = 'playing';
      event(state, 'interrupted', 'Critical service interrupted. Restore power and restart the stability hold.');
    }
  }
  return state;
}

function validVector(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v));
}

function guide(state: GameState, goalId: string, action: Guidance['action'], title: string, detail: string, targetId: Guidance['targetId'], extra: Partial<Guidance> = {}): Guidance {
  return { phase: state.phase, phaseTitle: PHASE_TITLES[state.phase], goalId, action, title, detail, targetId,
    targetLabel: targetId in LOCATIONS ? LOCATIONS[targetId as StationId] : ITEMS[targetId as ItemId].label, ...extra };
}

function itemGuidance(state: GameState, itemId: ItemId, goalId: string): Guidance {
  const item = ITEMS[itemId];
  const destinationLabel = LOCATIONS[item.destinationId];
  if (state.heldItemId && state.heldItemId !== itemId) {
    return guide(state, goalId, 'drop', `Put down ${ITEMS[state.heldItemId].label}`, `Then find ${item.label} and bring it to ${destinationLabel}.`, itemId,
      { itemLabel: item.label, sourceLabel: state.items[itemId].wasDropped ? 'Where you left it' : item.sourceLabel, destinationLabel });
  }
  if (state.heldItemId === itemId) {
    return guide(state, goalId, 'deliver', `Bring ${item.label} to ${destinationLabel}`, `Carry the item to ${destinationLabel} and press E.`, item.destinationId,
      { itemLabel: item.label, sourceLabel: item.sourceLabel, destinationLabel });
  }
  return guide(state, goalId, 'pickup', `Pick up ${item.label}`, `Find it at ${state.items[itemId].wasDropped ? 'the place you left it' : item.sourceLabel}, then take it to ${destinationLabel}.`, itemId,
    { itemLabel: item.label, sourceLabel: state.items[itemId].wasDropped ? 'Where you left it' : item.sourceLabel, destinationLabel });
}

function powerRecoveryGuidance(state: GameState): Guidance | null {
  const powerMissing = !isPowered(state, 'Comms') ||
    ((state.phase === 1 || state.phase === 3) && !serviceStatus(state).recovery) ||
    (state.phase >= 2 && !serviceStatus(state).water);
  if (powerMissing && state.grid.batteryKwh < 0.5 && state.grid.generationKw === 0 && state.items.battery.status === 'installed') {
    return guide(state, 'emergency_energy', 'interact', 'Import an emergency battery pack', 'The grid is low. Press E at Dock Grid Slot for a tracked 1 kWh pack.', 'grid_socket');
  }
  if (!isPowered(state, 'Comms')) return guide(state, 'restore_comms', 'interact', 'Restore communications power', 'Use the Communications Switch to reconnect the island.', 'comms_switch');
  if ((state.phase === 1 || state.phase === 3) && !serviceStatus(state).recovery) {
    return guide(state, 'restore_recovery', 'interact', 'Restart the recovery line', 'Use the Recovery Line Switch.', 'sorter_switch');
  }
  if (state.phase >= 2 && !serviceStatus(state).water) return guide(state, 'restore_water', 'interact', 'Restart water treatment', 'Use the Water Treatment Switch.', 'water_switch');
  return null;
}

/** One ordered step for the permanent upper-left HUD, with a dynamic world target. */
export function deriveGuidance(state: GameState): Guidance {
  const goals = state.goals;
  if (state.status === 'complete') return guide(state, 'complete', 'wait', 'Island recovery complete', 'The island is operating again.', 'extraction');
  if (state.status === 'failed') return guide(state, 'failed', 'wait', 'Field engineer down', 'Resume from the last objective checkpoint.', 'extraction');
  if (state.phase === 1) {
    if (state.items.battery.status !== 'installed') return itemGuidance(state, 'battery', 'install_battery');
    if (!goals.sorterJamCleared) return guide(state, 'clear_sorter', 'interact', 'Clear the recovery line blockage', 'Find the jammed line and press E to remove debris.', 'sorter_jam');
    if (state.items.waste_a.status === 'world' || state.items.waste_a.status === 'held') return itemGuidance(state, 'waste_a', 'deliver_waste_a');
    if (state.items.waste_b.status === 'world' || state.items.waste_b.status === 'held') return itemGuidance(state, 'waste_b', 'deliver_waste_b');
    if (!goals.sorterStarted) return guide(state, 'start_sorter', 'interact', 'Start the recovery line', 'Use the Recovery Line Switch so the delivered waste can be sorted.', 'sorter_switch');
    if (!isPowered(state, 'Recovery')) return powerRecoveryGuidance(state) ?? guide(state, 'restore_recovery', 'interact', 'Restart the recovery line', 'Use the Recovery Line Switch.', 'sorter_switch');
    if (!isPowered(state, 'Comms')) return powerRecoveryGuidance(state) ?? guide(state, 'start_comms', 'interact', 'Connect island communications', 'Use the Communications Switch.', 'comms_switch');
    if (processedCount(state) < 2) return guide(state, 'sort_waste', 'wait', `Sorting waste · ${processedCount(state)}/2`, 'Keep the recovery line powered while it sorts both bundles.', 'sorter_chute', { progress: { current: processedCount(state), total: 2 } });
  } else if (state.phase === 2) {
    if (!goals.intakeACleared) return guide(state, 'clear_intake_a', 'interact', 'Clear the west water intake', 'Follow the marker and press E to remove the debris.', 'intake_a', { progress: { current: 0, total: 2 } });
    if (!goals.intakeBCleared) return guide(state, 'clear_intake_b', 'interact', 'Clear the east water intake', 'Follow the marker and press E to remove the debris.', 'intake_b', { progress: { current: 1, total: 2 } });
    if (state.items.filter_frame.status !== 'installed') return itemGuidance(state, 'filter_frame', 'install_filter_frame');
    if (state.items.filter_cartridge.status !== 'installed') return itemGuidance(state, 'filter_cartridge', 'install_filter_cartridge');
    if (!goals.waterStarted) return guide(state, 'start_water', 'interact', 'Start water treatment', 'Use the Water Treatment Switch.', 'water_switch');
    if (!isPowered(state, 'Water')) return powerRecoveryGuidance(state) ?? guide(state, 'restore_water', 'interact', 'Restart water treatment', 'Use the Water Treatment Switch.', 'water_switch');
  } else {
    if (state.items.wind_converter.status !== 'installed') return itemGuidance(state, 'wind_converter', 'install_wind_module');
    if (!goals.bossLeftDisabled) return guide(state, 'boss_left', 'shoot', 'Disable the left exposed node', 'Aim at the marked node and fire a seed pod.', 'boss_node_left', { progress: { current: 0, total: 2 } });
    if (!goals.bossRightDisabled) return guide(state, 'boss_right', 'shoot', 'Disable the right exposed node', 'Aim at the marked node and fire a seed pod.', 'boss_node_right', { progress: { current: 1, total: 2 } });
    if (!serviceStatus(state).wind) {
      const speed = windSpeedMps(state);
      return guide(state, 'restart_wind', speed < 25 ? 'interact' : 'wait', speed < 25 ? 'Start wind generation' : 'Wait for the safe wind window',
        speed < 25 ? 'Press E at the Wind Restart Console.' : `Protective shutdown · ${speed.toFixed(1)} m/s. Restart below 25 m/s.`, 'wind_switch');
    }
    if (!goals.bossContained) {
      const recovery = serviceStatus(state).recovery;
      if (!recovery) return powerRecoveryGuidance(state) ?? guide(state, 'restore_recovery', 'interact', 'Power the recovery line', 'The capture console needs the recovery line online.', 'sorter_switch');
      return guide(state, 'capture_machine', 'interact', 'Contain the waste machine', 'Use the wind-powered Recovery Capture Console.', 'capture_switch');
    }
  }
  const power = powerRecoveryGuidance(state);
  if (power) return power;
  if (state.phase === 3 && state.status === 'readyToExtract') return guide(state, 'extract', 'extract', 'Return to the extraction boat', 'All critical services are stable. Press E at the boat to leave.', 'extraction');
  const needed = state.phase === 1 ? 20 : 25;
  return guide(state, 'stability', 'wait', 'Keep essential services online', `Hold for ${Math.max(0, needed - goals.stableSeconds)} more seconds.`, state.phase === 1 ? 'sorter_switch' : state.phase === 2 ? 'water_switch' : 'wind_switch',
    { remainingSeconds: Math.max(0, needed - goals.stableSeconds) });
}

export function energyBalanceErrorKwh(grid: EnergyGridState): number {
  return grid.initialBatteryKwh + grid.importedKwh + grid.generatedKwh - grid.batteryKwh - grid.consumedKwh - grid.spilledKwh;
}

export function deriveResult(state: GameState): GameResult {
  return {
    complete: state.status === 'complete', elapsedSeconds: state.elapsedSeconds,
    wasteBundlesProcessed: processedCount(state),
    reusedComponents: (state.items.battery.status === 'installed' ? 1 : 0) +
      (state.items.filter_frame.status === 'installed' ? 1 : 0) +
      (state.items.wind_converter.status === 'installed' ? 1 : 0),
    waterPoweredSeconds: state.goals.waterPoweredSeconds,
    windGeneratedKwh: state.grid.generatedKwh,
    importedBatteryKwh: state.grid.importedKwh,
    unservedDemandKwh: state.grid.unservedKwh,
    energyBalanceErrorKwh: energyBalanceErrorKwh(state.grid),
    disclosure: 'Educational game simulation',
  };
}

/** Check the version and key invariants before accepting an IndexedDB snapshot. */
export function restoreGameState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') throw new Error('Missing game save.');
  const state = raw as GameState;
  if (state.version !== 1 || ![1, 2, 3].includes(state.phase) || !['playing', 'readyToExtract', 'failed', 'complete'].includes(state.status)) throw new Error('Unsupported game save.');
  if (!Number.isFinite(state.playerHealth) || state.playerHealth < 0 || state.playerHealth > 100) throw new Error('Invalid saved health.');
  if (!state.items || !state.goals || !state.grid || !state.grid.loads) throw new Error('Incomplete game save.');
  const held = ITEM_IDS.filter(id => state.items[id]?.status === 'held');
  if (held.length > 1 || (state.heldItemId === null ? held.length !== 0 : held.length !== 1 || held[0] !== state.heldItemId)) throw new Error('Invalid carried item.');
  for (const id of ITEM_IDS) {
    const item = state.items[id];
    if (!item || !['world', 'held', 'installed', 'delivered', 'processed'].includes(item.status) ||
      (item.position !== null && !validVector(item.position))) throw new Error(`Invalid saved item: ${id}.`);
  }
  for (const key of ['elapsedSeconds', 'phaseElapsedSeconds', 'tickRemainderSeconds', 'eventSerial'] as const) {
    if (!Number.isFinite(state[key]) || state[key] < 0) throw new Error(`Invalid saved ${key}.`);
  }
  for (const key of ['batteryKwh', 'capacityKwh', 'maxDischargeKw', 'generationKw', 'initialBatteryKwh',
    'importedKwh', 'generatedKwh', 'consumedKwh', 'spilledKwh', 'unservedKwh', 'elapsedSeconds'] as const) {
    if (!Number.isFinite(state.grid[key]) || state.grid[key] < 0) throw new Error(`Invalid saved energy field: ${key}.`);
  }
  if (state.grid.batteryKwh > state.grid.capacityKwh + EPSILON || Math.abs(energyBalanceErrorKwh(state.grid)) > 1e-6) throw new Error('Saved energy accounting does not balance.');
  if (state.items.battery.status === 'installed' && (state.grid.capacityKwh < 8.5 || state.grid.importedKwh < 6)) throw new Error('Saved battery installation is inconsistent.');
  if (!Number.isFinite(state.goals.stableSeconds) || state.goals.stableSeconds < 0 || !Number.isFinite(state.goals.waterPoweredSeconds) || state.goals.waterPoweredSeconds < 0) throw new Error('Invalid saved goal timer.');
  for (const id of LOAD_ORDER) {
    const load = state.grid.loads[id];
    if (!load || !Number.isFinite(load.demandKw) || load.demandKw < 0 ||
      (load.powered && (!load.enabled || load.faulted))) throw new Error(`Invalid saved load: ${id}.`);
  }
  return clone(state);
}
