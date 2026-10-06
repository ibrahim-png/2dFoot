import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyInstructions, advance, player, LOW_ENERGY_THRESHOLD, INJURY_EXPOSURE_SECONDS } from '../backend/engine.js';
import { Simulation, frameOf } from '../backend/simulation.js';
import { playerTraits } from '../backend/traits.js';

test('the five player attributes cover the requested ranges', () => {
  const traits = [0, 1].flatMap(team => Array.from({ length: 11 }, (_, index) => playerTraits(index, team)));
  const range = key => [Math.min(...traits.map(item => item[key])), Math.max(...traits.map(item => item[key]))];
  assert.deepEqual(range('shotPower'), [20, 40]);
  assert.deepEqual(range('shotAccuracy'), [.55, .9]);
  assert.deepEqual(range('passAccuracy'), [.7, .96]);
  const [slowest, fastest] = range('pace'); assert.ok(Math.abs(fastest / slowest - 1.3) < .0001);
  const [lowestStamina, highestStamina] = range('stamina'); assert.equal(highestStamina / lowestStamina, 1.5);
});

test('traits and current energy are included in every backend frame', () => {
  const simulation = new Simulation(4), frame = frameOf(simulation.game);
  assert.ok(frame.players.every(item => item.traits.shotPower >= 20 && item.traits.shotPower <= 40));
  assert.ok(frame.players.every(item => Number.isFinite(item.traits.shotAccuracy) && Number.isFinite(item.traits.passAccuracy)));
  assert.ok(frame.players.every(item => item.energy === 1));
  assert.ok(simulation.game.players.filter(item => !item.keeper).every(item => item.intent.shootRange === item.traits.shotPower));
});

function energyAfterRun(stamina) {
  const game = createMatch(() => .5), runner = player(game, 6);
  for (const item of game.players) item.active = item === runner;
  Object.assign(runner, { x: 10, y: 10, energy: 1 }); runner.traits.stamina = stamina; game.owner = runner.id; game.ball = { x: runner.x, y: runner.y };
  applyInstructions(game, { players: [{ id: runner.id, x: 100, y: 10, move: 'support', action: 'dribble', target: null }] });
  advance(game, 10); return runner.energy;
}

test('higher stamina loses less energy during the same sustained run', () => {
  assert.ok(energyAfterRun(90) > energyAfterRun(60));
});

test('a player is injured after sustained high effort with low energy', () => {
  const game = createMatch(() => .5), runner = player(game, 6);
  for (const item of game.players) item.active = item === runner;
  Object.assign(runner, { x: 10, y: 10, vx: 5, energy: LOW_ENERGY_THRESHOLD - .01, lowEnergyTime: INJURY_EXPOSURE_SECONDS - .01 });
  game.owner = runner.id; game.ball = { x: runner.x, y: runner.y };
  applyInstructions(game, { players: [{ id: runner.id, x: 100, y: 10, move: 'support', action: 'dribble', target: null }] });
  advance(game, .25);
  assert.equal(runner.injured, true); assert.equal(runner.active, false);
  assert.deepEqual(game.injuries, [1, 0]); assert.equal(game.owner, null);
  assert.equal(game.events.at(-1).type, 'injury');
});
