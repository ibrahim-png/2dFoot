import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyInstructions, advance, snapshot, player } from '../backend/engine.js';

function quiet() {
  const g = createMatch(() => .5);
  // Isolate the ball fixtures from all other players.
  for (const p of g.players) { p.x = p.team ? 90 : 10; p.y = 3 + p.number * 2; }
  applyInstructions(g, { players: g.players.map(p => ({ id: p.id, x: p.x, y: p.y, move: 'hold', action: 'dribble', target: null })) });
  g.touch = 0; g.protection = 0; g.restart = 0;
  return g;
}
function own(g, id, x, y, action, target = null) {
  const p = player(g, id); Object.assign(p, { x, y, vx: 0, vy: 0 });
  p.intent = { id, x, y, move: 'hold', action, target }; g.owner = id; g.ball = { x, y }; return p;
}
test('22 players, opposing directions, unique IDs and valid kickoff state', () => {
  const g = createMatch(); assert.equal(g.players.length, 22);
  assert.equal(g.players.filter(p => p.team === 0).length, 11);
  assert.equal(g.players.filter(p => p.keeper).length, 2);
  assert.equal(new Set(g.players.map(p => p.id)).size, 22);
  assert.ok(g.players.every(p => p.x >= 1 && p.x <= 104 && p.y >= 1 && p.y <= 67));
});
test('home teammate receives an actual travelling pass', () => {
  const g = quiet(); own(g, 6, 45, 40, 'pass', 8);
  const receiver = own(g, 8, 60, 40, 'dribble'); g.owner = 6; g.ball = { x: 45, y: 40 };
  advance(g, .025); assert.equal(g.owner, null); assert.equal(g.flight.kind, 'pass');
  assert.equal(g.events.at(-1).type, 'kick'); assert.equal(g.events.at(-1).action, 'pass');
  advance(g, .7); assert.equal(g.owner, receiver.id); assert.equal(g.passes[0], 1);
});
test('opponent intercepts the physical passing lane and takes possession', () => {
  const g = quiet(); own(g, 6, 40, 40, 'pass', 7);
  own(g, 7, 65, 40, 'pass', 8); const rival = own(g, 17, 50, 40, 'pass', 18); rival.intent = null;
  g.owner = null; g.ball = { x: 40, y: 40 }; g.flight = { kind: 'pass', from: 6, to: 7, team: 0, vx: 22, vy: 0, remaining: 25, age: 0, start: { x: 40, y: 40 }, aim: { x: 65, y: 40 } };
  advance(g, .5);
  assert.equal(g.owner, 17); assert.equal(g.tackles[1], 1); assert.equal(g.passes[0], 0);
});
test('an untouched pass keeps rolling and loses speed gradually after its target point', () => {
  const g = quiet(); g.owner = null; g.ball = { x: 50, y: 34 };
  g.flight = { kind: 'pass', from: 6, to: 7, team: 0, vx: 10, vy: 0, remaining: .1, age: 1,
    start: { x: 40, y: 34 }, aim: { x: 50.1, y: 34 }, throughBall: false };
  advance(g, .025); assert.equal(g.flight, null); assert.equal(g.loose, true); assert.ok(g.looseVelocity.vx > 5);
  const atTarget = g.ball.x; advance(g, .25); const first = g.ball.x - atTarget;
  const afterFirst = g.ball.x; advance(g, .25); const second = g.ball.x - afterFirst;
  assert.ok(first > 1); assert.ok(second > 0 && second < first);
  advance(g, 2); assert.equal(g.looseVelocity, null); assert.ok(g.ball.x > atTarget + 3);
});
test('a high loose ball bounces repeatedly with diminishing height and horizontal speed', () => {
  const g = quiet(); g.owner = null; g.ball = { x: 50, y: 34, z: .04 };
  g.flight = { kind: 'shot', from: 10, team: 0, vx: 10, vy: 0, remaining: .1, age: 1,
    start: { x: 40, y: 34 }, aim: { x: 50.1, y: 34 }, arcHeight: 6, arcLength: 10, arcTravel: 9.9 };
  advance(g, .025); assert.equal(g.flight, null); assert.ok(g.looseVelocity.vz < 0);
  const initialHorizontal = Math.hypot(g.looseVelocity.vx, g.looseVelocity.vy), peaks = []; let peak = 0, rising = false, bounceCount = 0;
  for (let i = 0; i < 160 && g.looseVelocity; i++) {
    advance(g, .025); const z = g.ball.z ?? 0;
    if (g.looseVelocity) {
      bounceCount = Math.max(bounceCount, g.looseVelocity.bounces ?? 0);
      if (g.looseVelocity.vz > 0) { rising = true; peak = Math.max(peak, z); }
      else if (rising) { peaks.push(peak); peak = 0; rising = false; }
    }
  }
  assert.ok(bounceCount >= 2); assert.ok(peaks.length >= 2); assert.ok(peaks[0] > peaks[1] * 2);
  assert.ok(initialHorizontal > 9); assert.equal(g.ball.z, 0); assert.equal(g.looseVelocity, null);
});
test('falso continuously bends a travelling ball without changing its speed', () => {
  for (const curve of [-1, 1]) {
    const g = quiet(), start = { x: 40, y: 34 }, aim = { x: 65, y: 34 }, control = { x: 52.5, y: 34 + curve * 5.5 };
    for (const p of g.players) { p.x = 2; p.y = 2; }
    let curveLength = 0, previous = start;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20, u = 1 - t, point = { x: u * u * start.x + 2 * u * t * control.x + t * t * aim.x, y: u * u * start.y + 2 * u * t * control.y + t * t * aim.y };
      curveLength += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point;
    }
    g.owner = null; g.ball = { ...start };
    g.flight = { kind: 'pass', from: 10, to: 9, team: 0, vx: 24, vy: 0, remaining: curveLength, age: 0, curve, power: .7,
      start, aim, curveControl: control, curveLength, curveProgress: 0 };
    advance(g, .5);
    assert.equal(Math.sign(g.ball.y - 34), Math.sign(curve));
    assert.ok(Math.abs(Math.hypot(g.flight.vx, g.flight.vy) - 24) < .00001);
    for (let i = 0; i < 60 && g.flight; i++) advance(g, .025);
    assert.ok(Math.abs(g.ball.x - aim.x) < .01 && Math.abs(g.ball.y - aim.y) < .01, `curve ${curve} ended at ${g.ball.x},${g.ball.y}`);
  }
});
test('pressing defender can tackle without needing a new decision refresh', () => {
  const g = quiet(); g.random = () => 0;
  own(g, 6, 50, 40, 'dribble'); const rival = own(g, 17, 51.1, 40, 'pass', 18); rival.intent.move = 'press';
  g.owner = 6; g.ball = { x: 50, y: 40 };
  advance(g, .025); assert.equal(g.owner, 17); assert.equal(g.tackles[1], 1);
});
test('the same two opponents cannot trap the ball in an immediate tackle loop', () => {
  const g = quiet(); g.random = () => 0;
  const first = own(g, 6, 50, 40, 'dribble'), second = own(g, 17, 51.1, 40, 'dribble'); second.intent.move = 'press';
  g.owner = first.id; g.ball = { x: first.x, y: first.y };
  advance(g, .025); assert.equal(g.owner, second.id);
  first.intent.move = 'press'; advance(g, 3);
  assert.equal(g.owner, second.id); assert.equal(g.events.filter(event => event.type === 'tackle').length, 1);
});
test('shots can score in both goals and the conceding team restarts', () => {
  for (const team of [0, 1]) {
    const g = quiet(), id = team ? 21 : 10, keeper = player(g, team ? 1 : 12);
    keeper.x = team ? 4 : 101; keeper.y = 50; keeper.intent = null;
    own(g, id, team ? 18 : 87, 34, 'shoot');
    advance(g, .9);
    assert.equal(g.shots[team], 1); assert.equal(g.score[team], 1);
    assert.equal(player(g, g.owner).team, 1 - team); assert.ok(g.restart > 0);
    assert.equal(g.hasPlan, false); const goal = g.events.find(e => e.type === 'goal'); assert.ok(goal);
    assert.ok(goal.crossY >= 30.34 && goal.crossY <= 37.66); assert.ok(goal.crossZ >= 0 && goal.crossZ <= 2.44); assert.ok(goal.shotDistance > 0);
  }
});
test('shot power is a real travel range rather than only a speed label', () => {
  const g = quiet(), shooter = own(g, 10, 45, 34, 'shoot'); g.random = () => .5;
  shooter.traits.shotPower = 20; shooter.traits.shotAccuracy = 1;
  g.setPiece = { kind: 'penalty', taker: shooter.id }; g.touch = 0; g.restart = 0;
  advance(g, .025); assert.equal(g.flight.kind, 'shot'); assert.equal(g.flight.maxRange, 20); assert.ok(g.flight.remaining <= 20);
  while (g.flight) advance(g, .025);
  assert.ok(g.ball.x <= 65.6, `20 m shot from x=45 landed at x=${g.ball.x}`); assert.deepEqual(g.score, [0, 0]);
});
test('a goalkeeper uses the reaction time of a long shot to cover the goal mouth', () => {
  const g = quiet(), keeper = player(g, 12); Object.assign(keeper, { x: 103, y: 34 }); g.random = () => .2;
  g.owner = null; g.ball = { x: 60, y: 37.5, z: 0 }; g.lastTouchTeam = 0; g.lastTouchId = 10;
  g.flight = { kind: 'shot', from: 10, team: 0, reason: 'manual-shot', vx: 30, vy: 0, remaining: 60, age: 0,
    start: { x: 60, y: 37.5 }, aim: { x: 108, y: 37.5 }, arcHeight: 0, arcLength: 60, arcTravel: 0 };
  advance(g, 2);
  assert.equal(g.owner, keeper.id); assert.deepEqual(g.score, [0, 0]); assert.equal(g.saves[1], 1);
});
test('goalkeeper catches an on-target shot without awarding a goal', () => {
  const g = quiet(); g.random = () => 0;
  const keeper = player(g, 12); keeper.x = 101; keeper.y = 34; keeper.intent = null;
  g.owner = null; g.ball = { x: 98, y: 34 };
  g.flight = { kind: 'shot', from: 10, team: 0, to: null, vx: 29, vy: 0, remaining: 10, age: 0, start: { x: 85, y: 34 }, aim: { x: 105, y: 34 } };
  advance(g, .1); assert.equal(g.owner, 12); assert.equal(g.saves[1], 1); assert.deepEqual(g.score, [0, 0]);
});

test('goalkeeper can parry an on-target shot out for a corner', () => {
  const g = quiet(); g.random = () => .7;
  const keeper = player(g, 12); keeper.x = 101; keeper.y = 34; keeper.intent = null;
  g.owner = null; g.ball = { x: 98, y: 34 };
  g.flight = { kind: 'shot', from: 10, team: 0, to: null, vx: 29, vy: 0, remaining: 10, age: 0, start: { x: 85, y: 34 }, aim: { x: 105, y: 34 } };
  advance(g, .8);
  assert.equal(g.saves[1], 1); assert.ok(g.events.some(event => event.type === 'save' && event.parried));
  assert.ok(g.events.some(event => event.type === 'corner')); assert.equal(player(g, g.owner).team, 0);
});

test('a failed challenge can deflect the ball over the touchline', () => {
  const g = quiet(), victim = own(g, 6, 50, 5, 'dribble'), defender = own(g, 17, 51.1, 5, 'dribble');
  for (const p of g.players) p.active = p === victim || p === defender;
  defender.intent.tackle = 'hard'; g.owner = victim.id; g.ball = { x: victim.x, y: victim.y }; g.random = () => .65;
  advance(g, .8);
  assert.ok(g.events.some(event => event.type === 'deflection'));
  assert.ok(g.events.some(event => event.type === 'throwIn')); assert.equal(player(g, g.owner).team, victim.team);
});

test('a missed goalkeeper save is not rerolled in overlapping physics frames', () => {
  const g = quiet(); let rolls = 0; g.random = () => { rolls++; return .99; };
  const keeper = player(g, 12); keeper.x = 101; keeper.y = 34; keeper.intent = null;
  g.owner = null; g.ball = { x: 98, y: 34 };
  g.flight = { kind: 'shot', from: 10, team: 0, to: null, vx: 29, vy: 0, remaining: 10, age: 0, start: { x: 85, y: 34 }, aim: { x: 105, y: 34 } };
  advance(g, .3); assert.equal(rolls, 1); assert.equal(g.score[0], 1); assert.equal(g.saves[1], 0);
});
test('touchline exit awards opponent a throw-in; wide shot awards a goal kick', () => {
  for (const type of ['throwIn', 'goalKick']) {
    const g = quiet(); g.owner = null; g.ball = type === 'throwIn' ? { x: 60, y: .1 } : { x: 104.9, y: 20 };
    g.lastTouchTeam = 0;
    g.flight = { kind: 'shot', from: 10, team: 0, vx: type === 'throwIn' ? 0 : 29, vy: type === 'throwIn' ? -29 : 0, remaining: 20, age: 1, start: { ...g.ball }, aim: { x: 110, y: 20 } };
    advance(g, .025); assert.equal(player(g, g.owner).team, 1); assert.equal(g.events.at(-1).type, type);
    if (type === 'goalKick') { assert.equal(g.events.at(-1).exitX, 105); assert.ok(Math.abs(g.events.at(-1).exitY - 20) < .1); assert.ok(Number.isFinite(g.events.at(-1).exitZ)); }
    assert.ok(g.ball.x >= 0 && g.ball.x <= 105 && g.ball.y >= 0 && g.ball.y <= 68);
  }
});
test('defender last touch over their own goal line awards a corner', () => {
  const g = quiet(); g.owner = null; g.lastTouchTeam = 1; g.ball = { x: 104.9, y: 20 };
  g.flight = { kind: 'pass', from: 17, team: 1, vx: 22, vy: 0, remaining: 10, age: 1, start: { x: 99, y: 20 }, aim: { x: 108, y: 20 } };
  advance(g, .025); assert.equal(g.events.at(-1).type, 'corner'); assert.equal(player(g, g.owner).team, 0);
  assert.equal(g.events.at(-1).exitX, 105); assert.ok(Math.abs(g.events.at(-1).exitY - 20) < .1); assert.ok(Number.isFinite(g.events.at(-1).exitZ));
});
test('a corner reorganizes both teams into attacking and defensive set-piece positions', () => {
  for (const attackingTeam of [0, 1]) {
    const g = quiet(), edge = attackingTeam ? .1 : 104.9, direction = attackingTeam ? -1 : 1;
    g.owner = null; g.lastTouchTeam = 1 - attackingTeam; g.ball = { x: edge, y: 20 };
    g.flight = { kind: 'pass', from: attackingTeam ? 6 : 17, team: 1 - attackingTeam, vx: direction * 22, vy: 0, remaining: 10, age: 1, start: { ...g.ball }, aim: { x: edge + direction * 5, y: 20 } };
    advance(g, .025); assert.equal(g.events.at(-1).type, 'corner');
    const taker = player(g, g.owner), attackers = g.players.filter(p => p.active && p.team === attackingTeam && p !== taker), defenders = g.players.filter(p => p.active && p.team !== attackingTeam);
    const attackingDepth = p => attackingTeam ? 105 - p.x : p.x;
    assert.ok(attackers.filter(p => attackingDepth(p) > 75).length >= 8); assert.ok(defenders.every(p => attackingDepth(p) > 80));
    assert.ok(Math.abs(attackingDepth(attackers.find(p => p.keeper)) - 6) < .01);
    assert.ok(Math.abs(attackingDepth(defenders.find(p => p.keeper)) - 103.2) < .01); assert.ok(taker.y === 1 || taker.y === 67);
  }
});
test('a corner sent into the penalty area travels as an aerial cross', () => {
  const g = quiet(), taker = own(g, 11, 104, 67, 'pass', 10), target = own(g, 10, 96, 34, 'dribble');
  g.owner = taker.id; g.ball = { x: taker.x, y: taker.y }; g.setPiece = { kind: 'corner', taker: taker.id }; g.restart = 0;
  advance(g, .025);
  assert.equal(g.owner, null); assert.equal(g.flight.kind, 'pass'); assert.equal(g.flight.to, target.id);
  assert.ok(g.flight.arcHeight >= 2.4); assert.ok(g.flight.lift > 0); assert.equal(g.flight.start.y, 67);
});
test('physics keeps moving on existing policies while no new response arrives', () => {
  const g = quiet(); own(g, 6, 40, 34, 'dribble');
  const before = player(g, 6).x; advance(g, 1);
  assert.ok(player(g, 6).x > before + 3); assert.equal(g.hasPlan, true);
});
test('full time freezes simulation and emits the final event once', () => {
  const g = quiet(); g.elapsed = 299.95; advance(g, .5);
  assert.equal(g.elapsed, 300); assert.equal(g.ended, true);
  const after = JSON.stringify(snapshot(g, 'local')); advance(g, 10);
  assert.equal(JSON.stringify(snapshot(g, 'local')), after);
  assert.equal(g.events.filter(e => e.type === 'fullTime').length, 1);
});
