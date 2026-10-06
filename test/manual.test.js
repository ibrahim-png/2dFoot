import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, freeKickLayout, automaticFreeKickLift, FREE_KICK_WALL_DISTANCE } from '../backend/simulation.js';

test('manual mode stops at each new Lime owner and applies the drawn pass and runs', () => {
  const simulation = new Simulation(5, undefined, 'manual'), ready = simulation.readyFrame();
  assert.equal(ready.manualControl.owner, ready.owner); assert.equal(ready.players[ready.owner - 1].team, 0);
  const owner = ready.owner, teammates = simulation.game.players.filter(p => p.active && p.team === 0 && p.id !== owner && !p.keeper), recipient = teammates[0].id, runner = teammates[1].id;
  simulation.applyManualPlan({ owner, action: 'pass', passTo: recipient, aim: { x: 70, y: 8 }, power: 1, curve: .25,
    runs: [{ id: runner, x: 70, y: 8 }, { id: owner, x: 63, y: 34 }] });
  const first = simulation.next(.1);
  assert.ok(first.frames.length); assert.equal(simulation.game.players[owner - 1].decision.reason, 'manual-pass');
  assert.equal(simulation.game.players[owner - 1].decision.target, recipient);
  assert.deepEqual(simulation.game.players[owner - 1].decision.aim, { x: 70, y: 8 });
  assert.equal(simulation.game.players[runner - 1].decision.action, 'manualRun');
  assert.deepEqual([simulation.game.players[runner - 1].decision.x, simulation.game.players[runner - 1].decision.y], [70, 8]);
  const afterKick = simulation.next(.35);
  assert.ok(afterKick.frames.some(frame => frame.flight?.kind === 'pass' && frame.players[recipient - 1].decision?.action === 'receive'));
  assert.ok(afterKick.frames.some(frame => frame.flight?.kind === 'pass' && frame.players[owner - 1].decision?.action === 'manualRun'));

  for (let n = 0; n < 40 && !simulation.awaitingManual; n++) simulation.next(.5);
  assert.ok(simulation.awaitingManual); assert.equal(simulation.game.players[simulation.awaitingManual - 1].team, 0);
  const elapsed = simulation.game.elapsed, waiting = simulation.next(.5);
  assert.equal(waiting.manualBoundary, true); assert.equal(waiting.frames.length, 0); assert.equal(simulation.game.elapsed, elapsed);
});
test('online mode creates manual checkpoints and accepts plans for either team', () => {
  const simulation = new Simulation(41, undefined, 'online');
  const home = simulation.readyFrame(); assert.equal(home.manualControl.team, 0); assert.equal(home.manualControl.kind, 'online');
  const awayOwner = simulation.game.players[11]; simulation.game.owner = awayOwner.id; simulation.game.controlTeam = 1; simulation.game.ball = { x: awayOwner.x, y: awayOwner.y };
  simulation.awaitingManual = awayOwner.id;
  const away = simulation.readyFrame(); assert.equal(away.manualControl.team, 1); assert.equal(away.manualControl.owner, awayOwner.id);
  simulation.applyManualPlan({ owner: awayOwner.id, action: 'pass', passTo: 13, aim: { x: 60, y: 30 }, power: .7, curve: .2, runs: [{ id: 14, x: 55, y: 40 }] });
  assert.equal(simulation.game.manualPlan.owner, awayOwner.id); assert.equal(simulation.game.manualPlan.passTo, 13); assert.equal(simulation.game.manualPlan.runs[0].id, 14);
});

test('manual plans reject the wrong owner or malformed free target', () => {
  const simulation = new Simulation(3, undefined, 'manual'), owner = simulation.awaitingManual;
  assert.throws(() => simulation.applyManualPlan({ owner: owner + 1, action: 'pass', passTo: 2, aim: { x: 70, y: 20 }, power: 1, curve: 0, runs: [] }), /geçersiz/);
  assert.throws(() => simulation.applyManualPlan({ owner, action: 'pass', passTo: owner, aim: { x: NaN, y: 20 }, power: 1, curve: 0, runs: [] }), /geçersiz/);
});

test('manual pass can target empty space without selecting a receiver', () => {
  const simulation = new Simulation(4, undefined, 'manual'), owner = simulation.awaitingManual;
  simulation.game.random = () => .5;
  simulation.applyManualPlan({ owner, action: 'pass', passTo: null, aim: { x: 76, y: 18 }, power: 1, curve: 0, runs: [] });
  const result = simulation.next(.4), planned = result.frames.find(frame => frame.players[owner - 1].decision?.reason === 'manual-pass');
  assert.equal(simulation.game.flight?.kind, 'pass'); assert.equal(simulation.game.flight?.to, null);
  assert.ok(planned); assert.equal(planned.players[owner - 1].decision.target, null);
});

test('selected receiver keeps pursuing a manual pass after it slows into a loose ball', () => {
  const simulation = new Simulation(6, undefined, 'manual'), owner = simulation.awaitingManual;
  const recipient = simulation.game.players.find(p => p.active && p.team === 0 && p.id !== owner && !p.keeper).id;
  simulation.applyManualPlan({ owner, action: 'pass', passTo: recipient, aim: { x: 82, y: 20 }, power: 1, curve: 0,
    runs: [{ id: recipient, x: 55, y: 55 }] });
  simulation.next(.4); const flight = simulation.game.flight; assert.ok(flight);
  simulation.game.flight = null; simulation.game.loose = true; simulation.game.looseFrom = flight; simulation.game.looseVelocity = { vx: 2, vy: 0 };
  simulation.game.ball = { x: 72, y: 20 }; simulation.game.revision++; simulation.game.nextThink = 0;
  simulation.next(.025);
  assert.equal(simulation.game.players[recipient - 1].decision.action, 'receive');
  assert.ok(!simulation.game.manualPlan.runs.some(run => run.id === recipient));
});

test('manual shot uses the drawn target, selected power and curve', () => {
  const simulation = new Simulation(9, undefined, 'manual'), owner = simulation.awaitingManual;
  simulation.game.random = () => .5;
  simulation.applyManualPlan({ owner, action: 'shoot', passTo: null, aim: { x: 107, y: 33 }, power: .62, curve: -.7, runs: [] });
  const result = simulation.next(.4), planned = result.frames.find(frame => frame.players[owner - 1].decision?.reason === 'manual-shot');
  assert.ok(planned);
  assert.equal(simulation.game.shots[0], 1); assert.ok(simulation.game.flight || simulation.game.events.some(event => event.type === 'goal'));
  if (simulation.game.flight) { assert.equal(simulation.game.flight.power, .62); assert.equal(simulation.game.flight.curve, -.7); assert.ok(simulation.game.flight.arcHeight > 0); }
});

test('manual shot power increases its automatically selected height', () => {
  const height = power => {
    const simulation = new Simulation(10, undefined, 'manual'), owner = simulation.awaitingManual;
    simulation.game.players[owner - 1].traits.shotAccuracy = 1; simulation.game.random = () => .5;
    simulation.applyManualPlan({ owner, action: 'shoot', passTo: null, aim: { x: 107, y: 34 }, power, curve: 0, runs: [] });
    simulation.next(.4); return simulation.game.flight?.arcHeight;
  };
  const low = height(.3), high = height(1);
  assert.ok(low > 1 && low < 2.5); assert.ok(high >= 6 && high > low + 4, `${low} -> ${high}`);
});

test('manual dribble keeps possession until Space creates a new decision checkpoint', () => {
  const simulation = new Simulation(12, undefined, 'manual'), owner = simulation.awaitingManual;
  const start = { x: simulation.game.players[owner - 1].x, y: simulation.game.players[owner - 1].y };
  simulation.applyManualPlan({ owner, action: 'dribble', passTo: null, aim: { x: start.x + 14, y: start.y + 6 }, power: 1, curve: 0, runs: [] });
  simulation.next(.6);
  const p = simulation.game.players[owner - 1]; assert.equal(simulation.game.owner, owner); assert.equal(p.decision.reason, 'manual-dribble');
  assert.ok(p.x > start.x); assert.equal(simulation.game.flight, null);
  const checkpoint = simulation.pauseManual(); assert.equal(checkpoint.manualRequested, true); assert.equal(checkpoint.frames[0].manualControl.owner, owner);
  const at = simulation.game.elapsed; assert.equal(simulation.next(.5).frames.length, 0); assert.equal(simulation.game.elapsed, at);
});

test('manual dribble direction can be changed live', () => {
  const simulation = new Simulation(13, undefined, 'manual'), owner = simulation.awaitingManual, p = simulation.game.players[owner - 1];
  simulation.applyManualPlan({ owner, action: 'dribble', passTo: null, aim: { x: p.x, y: p.y - 20 }, power: 1, curve: 0, runs: [] });
  simulation.next(.1); const before = { x: p.x, y: p.y };
  assert.equal(simulation.steerManual({ x: 1, y: 0 }), true); simulation.next(.2);
  assert.equal(p.decision.reason, 'manual-dribble'); assert.ok(p.x > before.x); assert.ok(Math.abs(p.y - before.y) < 1);
  assert.equal(simulation.steerManual({ x: 0, y: 0 }), true);
  assert.ok(Math.abs(simulation.game.manualPlan.aim.x - p.x) < .001); assert.ok(Math.abs(simulation.game.manualPlan.aim.y - p.y) < .001);
});

test('Free mode uses selected player counts and resets the same attack after loss or ball-out', () => {
  const simulation = new Simulation(14, undefined, 'free', undefined, { home: 4, away: 3 }), ready = simulation.readyFrame(), owner = ready.owner;
  assert.equal(ready.manualControl.kind, 'free'); assert.equal(ready.players.filter(player => player.active && player.team === 0).length, 4);
  assert.equal(ready.players.filter(player => player.active && player.team === 1).length, 3);
  const initial = ready.players.filter(player => player.active).map(player => [player.id, player.x, player.y]);
  simulation.applyManualPlan({ owner, action: 'dribble', passTo: null, aim: { x: 70, y: 34 }, power: 1, curve: 0, runs: [] });
  const opponent = simulation.game.players.find(player => player.active && player.team === 1); simulation.game.owner = opponent.id; simulation.game.ball = { x: opponent.x, y: opponent.y };
  let result = simulation.next(.025); assert.equal(result.manualBoundary, true); assert.equal(simulation.game.owner, owner); assert.equal(result.frames.at(-1).manualControl.repeat, true);
  assert.deepEqual(result.frames.at(-1).players.filter(player => player.active).map(player => [player.id, player.x, player.y]), initial);
  simulation.applyManualPlan({ owner, action: 'dribble', passTo: null, aim: { x: 70, y: 34 }, power: 1, curve: 0, runs: [] });
  simulation.game.owner = null; simulation.game.ball = { x: 60, y: .1 }; simulation.game.lastTouchTeam = 0;
  simulation.game.flight = { kind: 'pass', from: owner, to: null, team: 0, vx: 0, vy: -20, remaining: 5, age: 1, start: { x: 60, y: .1 }, aim: { x: 60, y: -3 } };
  result = simulation.next(.025); assert.equal(result.manualBoundary, true); assert.equal(simulation.game.owner, owner);
  assert.deepEqual(result.frames.at(-1).players.filter(player => player.active).map(player => [player.id, player.x, player.y]), initial);
});

test('Free mode survives a goal when the opponent has no outfield player', () => {
  for (const away of [0, 1]) {
    const simulation = new Simulation(31 + away, undefined, 'free', undefined, { home: 6, away });
    const owner = simulation.awaitingManual; simulation.awaitingManual = null;
    simulation.game.owner = null; simulation.game.ball = { x: 104.8, y: 34, z: 0 };
    simulation.game.lastTouchTeam = 0; simulation.game.lastTouchId = owner;
    simulation.game.flight = { kind: 'shot', from: owner, team: 0, vx: 20, vy: 0, remaining: 4, age: .5,
      start: { x: 103, y: 34 }, aim: { x: 108, y: 34 }, arcHeight: 0, arcLength: 5, arcTravel: 1.8,
      missedKeepers: away ? [12] : [] };
    const result = simulation.next(.025);
    assert.deepEqual(simulation.game.score, [1, 0]); assert.equal(result.manualBoundary, true);
    assert.equal(simulation.game.owner, owner); assert.equal(result.frames.at(-1).manualControl.repeat, true);
  }
});

test('free kick mode places the ball and automatic wall before launching the configured shot', () => {
  const simulation = new Simulation(21, undefined, 'freeKick'), ready = simulation.readyFrame(), owner = ready.manualControl.owner;
  assert.equal(ready.manualControl.kind, 'freeKick');
  simulation.game.random = () => .5;
  simulation.applyFreeKickPlan({ owner, ball: { x: 78, y: 27 }, wallCount: 5,
    aim: { x: 107, y: 34 }, power: .68, curve: .4, shotPower: 38, curvePower: 80 });
  assert.deepEqual(simulation.game.ball, { x: 78, y: 27 }); assert.equal(simulation.game.setPiece.kind, 'freeKick');
  const layout = freeKickLayout({ x: 78, y: 27 }, 5), active = simulation.game.players.filter(p => p.active), wall = active.filter(p => p.team === 1 && !p.keeper);
  assert.equal(active.length, 7); assert.equal(active.filter(p => p.team === 0).length, 1); assert.equal(wall.length, 5);
  assert.ok(Math.abs(Math.hypot(layout.wall.x - 78, layout.wall.y - 27) - FREE_KICK_WALL_DISTANCE) < .0001);
  assert.ok(wall.every((p, index) => Math.hypot(p.x - layout.positions[index].x, p.y - layout.positions[index].y) < .001));
  const keeper = active.find(p => p.keeper); assert.deepEqual([keeper.x, keeper.y], [layout.keeper.x, layout.keeper.y]);
  assert.equal(simulation.game.players[owner - 1].traits.shotPower, 38); assert.equal(simulation.game.players[owner - 1].traits.curvePower, 80);
  simulation.next(.05); assert.equal(simulation.game.shots[0], 1); assert.equal(simulation.game.flight.kind, 'shot');
  assert.equal(simulation.game.flight.power, .68); assert.ok(Math.abs(simulation.game.flight.curve - .32) < 1e-9);
});

test('free kick wall width moves the keeper while its automatic centre and distance stay fixed', () => {
  const ball = { x: 76, y: 25 }, one = freeKickLayout(ball, 1), six = freeKickLayout(ball, 6);
  assert.deepEqual(one.wall, six.wall); assert.ok(Math.abs(Math.hypot(one.wall.x - ball.x, one.wall.y - ball.y) - 9.15) < .0001);
  assert.notEqual(one.keeper.y, six.keeper.y); assert.ok(six.keeper.y > one.keeper.y);
});

test('free kick practice resets at the same point before the opponent can counterattack', () => {
  const simulation = new Simulation(22, undefined, 'freeKick'), owner = simulation.readyFrame().manualControl.owner, ball = { x: 79, y: 28 };
  simulation.game.random = () => .5;
  simulation.applyFreeKickPlan({ owner, ball, wallCount: 4, aim: { x: 107, y: 34 }, power: .8, curve: 0, shotPower: 34, curvePower: 75 });
  let result;
  for (let index = 0; index < 80 && !simulation.awaitingManual; index++) result = simulation.next(.1);
  assert.equal(simulation.awaitingManual, owner); assert.deepEqual(simulation.game.ball, ball); assert.equal(simulation.game.owner, owner);
  assert.equal(simulation.game.setPiece.kind, 'freeKick'); assert.equal(result.manualBoundary, true);
  assert.equal(result.frames.at(-1).manualControl.kind, 'freeKick'); assert.equal(result.frames.at(-1).manualControl.repeat, true);
  assert.deepEqual(result.frames.at(-1).manualControl.setup.ball, ball);
});

test('free kick height is selected automatically to clear a wall in the shot lane', () => {
  const simulation = new Simulation(31, undefined, 'freeKick'), owner = simulation.readyFrame().manualControl.owner, ball = { x: 78, y: 27 };
  const layout = freeKickLayout(ball, 5), aim = { x: 105, y: 30.34 }, lift = automaticFreeKickLift(ball, aim, 5); simulation.game.random = () => .5;
  simulation.applyFreeKickPlan({ owner, ball, wallCount: 5, aim, power: 1, curve: 0, shotPower: 40, curvePower: 100 });
  let crossed = false, heightAtWall = 0;
  for (let index = 0; index < 80 && !simulation.awaitingManual; index++) {
    simulation.next(.025);
    if (simulation.game.flight && simulation.game.ball.x >= layout.wall.x) { crossed = true; heightAtWall = simulation.game.ball.z ?? 0; break; }
  }
  assert.ok(lift > 0 && lift < 1); assert.equal(crossed, true); assert.ok(heightAtWall > 1.9);
});

test('a keeper save remains visible before free kick practice resets', () => {
  const simulation = new Simulation(32, undefined, 'freeKick'), owner = simulation.readyFrame().manualControl.owner, ball = { x: 79, y: 28 };
  const keeper = freeKickLayout(ball, 4).keeper; simulation.game.players[owner - 1].traits.shotAccuracy = 1; simulation.game.random = () => .3;
  simulation.applyFreeKickPlan({ owner, ball, wallCount: 4, aim: keeper, power: 1, curve: 0, shotPower: 40, curvePower: 100 });
  for (let index = 0; index < 100 && simulation.freeKickResetAt === null; index++) simulation.next(.05);
  assert.ok(simulation.game.events.some(event => event.type === 'save')); assert.ok(simulation.freeKickResetAt > simulation.game.elapsed + 1.4);
  const held = simulation.next(1); assert.equal(held.manualBoundary, false); assert.equal(simulation.awaitingManual, null);
  const reset = simulation.next(.6); assert.equal(reset.manualBoundary, true); assert.equal(simulation.awaitingManual, owner);
});

test('free kick keeper can dive across goal but a difficult shot can still beat him', () => {
  const shoot = roll => {
    const simulation = new Simulation(33, undefined, 'freeKick'), owner = simulation.readyFrame().manualControl.owner;
    simulation.game.players[owner - 1].traits.shotAccuracy = 1; simulation.game.random = () => roll;
    simulation.applyFreeKickPlan({ owner, ball: { x: 78, y: 27 }, wallCount: 4,
      aim: { x: 107, y: 31 }, power: .9, curve: 0, shotPower: 38, curvePower: 80 });
    for (let index = 0; index < 120 && !simulation.awaitingManual; index++) simulation.next(.05);
    return simulation;
  };
  const saved = shoot(.2); assert.equal(saved.game.score[0], 0); assert.ok(saved.game.events.some(event => event.type === 'save'));
  const scored = shoot(.99); assert.equal(scored.game.score[0], 1); assert.ok(scored.game.events.some(event => event.type === 'goal'));
});
