import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, createGameState, deriveGuidance, deriveResult,
  energyBalanceErrorKwh, restoreGameState, tickGame, windSpeedMps,
} from '../src/game/state.ts';

const act = (state, command) => applyCommand(state, command);
const carry = (state, itemId, stationId) => act(act(state, { type: 'pickup', itemId }), { type: 'interact', stationId });

function finishFirstPhase() {
  let state = createGameState();
  state = carry(state, 'battery', 'grid_socket');
  state = act(state, { type: 'interact', stationId: 'sorter_jam' });
  state = carry(state, 'waste_a', 'sorter_chute');
  state = carry(state, 'waste_b', 'sorter_chute');
  state = act(state, { type: 'interact', stationId: 'sorter_switch' });
  state = act(state, { type: 'interact', stationId: 'comms_switch' });
  return tickGame(state, 25);
}

function finishSecondPhase(state) {
  state = act(state, { type: 'interact', stationId: 'intake_a' });
  state = act(state, { type: 'interact', stationId: 'intake_b' });
  state = carry(state, 'filter_frame', 'filter_socket');
  state = carry(state, 'filter_cartridge', 'filter_socket');
  state = act(state, { type: 'interact', stationId: 'water_switch' });
  return tickGame(state, 25);
}

test('guidance tracks the actual cargo after pickup and a physical drop', () => {
  let state = createGameState();
  assert.equal(deriveGuidance(state).targetId, 'battery');
  assert.equal(deriveGuidance(state).sourceLabel, 'North Storage Bay');
  assert.equal(deriveGuidance(state).destinationLabel, 'Dock Grid Slot');
  state = act(state, { type: 'pickup', itemId: 'battery' });
  assert.equal(deriveGuidance(state).targetId, 'grid_socket');
  state = act(state, { type: 'drop', position: [4, 2, 9] });
  assert.equal(deriveGuidance(state).targetId, 'battery');
  assert.equal(deriveGuidance(state).sourceLabel, 'Where you left it');
  assert.deepEqual(state.items.battery.position, [4, 2, 9]);
  state = act(state, { type: 'recoverItem', itemId: 'battery' });
  assert.equal(deriveGuidance(state).sourceLabel, 'North Storage Bay');
});

test('all three green-tech phases are gated by actual services and final extraction', () => {
  let state = finishFirstPhase();
  assert.equal(state.phase, 2);
  assert.equal(state.items.waste_a.status, 'processed');
  assert.equal(state.items.waste_b.status, 'processed');
  assert.equal(state.grid.importedKwh, 6);
  assert.equal(state.grid.generatedKwh, 0);
  assert.equal(deriveGuidance(state).targetId, 'intake_a');

  state = finishSecondPhase(state);
  assert.equal(state.phase, 3);
  assert.equal(deriveGuidance(state).targetId, 'wind_converter');
  state = carry(state, 'wind_converter', 'wind_socket');
  state = act(state, { type: 'hitBossNode', nodeId: 'boss_node_left' });
  state = act(state, { type: 'hitBossNode', nodeId: 'boss_node_right' });
  state = act(state, { type: 'interact', stationId: 'wind_switch' });
  assert.equal(state.goals.windStarted, false);
  assert.equal(deriveGuidance(state).goalId, 'restart_wind');
  state = tickGame(state, 91);
  assert.ok(windSpeedMps(state) < 25);
  state = act(state, { type: 'interact', stationId: 'wind_switch' });
  state = act(state, { type: 'interact', stationId: 'capture_switch' });
  state = tickGame(state, 25);
  assert.equal(state.status, 'readyToExtract');
  assert.equal(deriveGuidance(state).targetId, 'extraction');
  state = act(state, { type: 'extract' });
  assert.equal(state.status, 'complete');
  const result = deriveResult(state);
  assert.equal(result.wasteBundlesProcessed, 2);
  assert.equal(result.reusedComponents, 3);
  assert.ok(result.windGeneratedKwh > 0);
  assert.equal(result.importedBatteryKwh, 6);
  assert.ok(Math.abs(energyBalanceErrorKwh(state.grid)) < 1e-8);
});

test('outage resets the stability hold and save restore cannot duplicate battery import', () => {
  let state = createGameState();
  state = carry(state, 'battery', 'grid_socket');
  state = act(state, { type: 'interact', stationId: 'grid_socket' });
  assert.equal(state.grid.importedKwh, 6);
  state = restoreGameState(JSON.parse(JSON.stringify(state)));
  state = act(state, { type: 'install', itemId: 'battery', stationId: 'grid_socket' });
  assert.equal(state.grid.importedKwh, 6);

  state = act(state, { type: 'interact', stationId: 'sorter_jam' });
  state = carry(state, 'waste_a', 'sorter_chute');
  state = carry(state, 'waste_b', 'sorter_chute');
  state = act(state, { type: 'interact', stationId: 'sorter_switch' });
  state = act(state, { type: 'interact', stationId: 'comms_switch' });
  state = tickGame(state, 15);
  assert.ok(state.goals.stableSeconds > 0);
  state = act(state, { type: 'setLoadFault', loadId: 'Comms', faulted: true });
  state = tickGame(state, 1);
  assert.equal(state.goals.stableSeconds, 0);
  assert.equal(deriveGuidance(state).targetId, 'comms_switch');
  state = act(state, { type: 'interact', stationId: 'comms_switch' });
  state = tickGame(state, 20);
  assert.equal(state.phase, 2);
  assert.ok(Math.abs(energyBalanceErrorKwh(state.grid)) < 1e-8);
});

test('injury stops the simulation until a checkpoint restores a healthy state', () => {
  const checkpoint = createGameState();
  const failed = act(checkpoint, { type: 'damage', amount: 150 });
  assert.equal(failed.playerHealth, 0);
  assert.equal(failed.status, 'failed');
  assert.equal(tickGame(failed, 20).elapsedSeconds, 0);
  const restored = restoreGameState(JSON.parse(JSON.stringify(checkpoint)));
  assert.equal(restored.playerHealth, 100);
  assert.equal(restored.status, 'playing');
});
