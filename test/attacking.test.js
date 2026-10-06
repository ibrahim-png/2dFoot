import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyInstructions, advance, player } from '../backend/engine.js';
import { chooseDecision, worldPoint, localPoint, passOption } from '../backend/tactics.js';

function situation(team = 0, u = 77, v = 34) {
  const g = createMatch(() => .5);
  applyInstructions(g, { players: g.players.map(p => ({ id: p.id, x: p.x, y: p.y, move: 'hold', action: 'shoot', target: null, shootRange: p.keeper ? 0 : 30, tackle: 'normal' })) });
  // Isolate the decision, retaining the keeper in a normal goal-side position.
  for (const p of g.players) p.active = false;
  const owner = player(g, 10 + 11 * team), keeper = player(g, 1 + 11 * (1 - team));
  owner.active = keeper.active = true; keeper.intent = null;
  Object.assign(owner, worldPoint(u, v, team)); Object.assign(keeper, worldPoint(101, 34, team));
  // Keep forward receivers onside; this defender is well away from the attack.
  const farDefender = player(g, 2 + 11 * (1 - team));
  farDefender.active = true; farDefender.intent = null; Object.assign(farDefender, worldPoint(101, 2, team));
  g.owner = owner.id; g.ball = { x: owner.x, y: owner.y }; g.touch = g.protection = 0;
  return { g, owner, keeper, team };
}
function add(s, number, u, v, opponent = false) {
  const p = player(s.g, number + 11 * (opponent ? 1 - s.team : s.team));
  p.active = true; Object.assign(p, worldPoint(u, v, s.team)); return p;
}

test('one-on-one from 28m carries closer before shooting, mirrored for both teams', () => {
  for (const team of [0, 1]) {
    const s = situation(team), { g, owner } = s;
    assert.equal(chooseDecision(g, owner).reason, 'approach-goal');
    advance(g, 1); assert.equal(g.shots[team], 0); assert.ok(localPoint(owner, team).u > 80);
    for (let n = 0; n < 200 && !g.shots[team]; n++) advance(g, .025);
    assert.equal(g.shots[team], 1);
    const shot = g.events.find(e => e.type === 'shot'); assert.ok(shot.distance >= 10 && shot.distance <= 14);
  }
});

test('a stale pass policy does not waste an unpressured one-on-one on a backward pass', () => {
  const s = situation(), back = add(s, 8, 60, 45);
  s.owner.intent.action = 'pass'; s.owner.intent.target = back.id;
  assert.equal(chooseDecision(s.g, s.owner).reason, 'approach-goal');
});

test('midfielder with the ball can finish a breakaway beyond their off-ball role depth', () => {
  for (const team of [0, 1]) {
    const s = situation(team); s.owner.active = false;
    const midfielder = add(s, 6, 77, 34); s.g.owner = midfielder.id;
    assert.equal(chooseDecision(s.g, midfielder).reason, 'approach-goal');
    advance(s.g, 1); assert.ok(localPoint(midfielder, team).u > 80); assert.equal(s.g.shots[team], 0);
  }
});

test('open teammate near goal receives the actual pass instead of an early shot', () => {
  for (const team of [0, 1]) {
    const s = situation(team, 78, 26), target = add(s, 8, 92, 35);
    const decision = chooseDecision(s.g, s.owner);
    assert.equal(decision.action, 'pass'); assert.equal(decision.target, target.id); assert.equal(decision.reason, 'better-chance');
    advance(s.g, .025);
    assert.equal(s.g.flight.kind, 'pass'); assert.equal(s.g.flight.to, target.id); assert.equal(s.g.shots[team], 0);
    for (let n = 0; n < 100 && !s.g.events.some(e => e.type === 'pass'); n++) advance(s.g, .025);
    assert.ok(s.g.events.some(e => e.type === 'pass' && e.to === target.id));
  }
});

test('better scoring option replaces the stale local recipient, including a square pass', () => {
  const s = situation(0, 91, 20), old = add(s, 7, 65, 20), target = add(s, 8, 92, 35);
  s.owner.intent.action = 'pass'; s.owner.intent.target = old.id;
  assert.equal(chooseDecision(s.g, s.owner).target, target.id);
  advance(s.g, .025); assert.equal(s.g.flight.to, target.id);
});

test('a cutback to a better central angle can beat a closer but narrow-angle shot', () => {
  const s = situation(0, 98, 23), target = add(s, 8, 91, 35);
  assert.equal(chooseDecision(s.g, s.owner).target, target.id);
});

test('marked, intercepted, inactive and opponent options cannot trigger a scoring pass', () => {
  for (const issue of ['marked', 'blocked', 'inactive', 'opponent']) {
    const s = situation(0, 78, 26), target = add(s, 8, 92, 35);
    if (issue === 'marked') add(s, 6, 93, 36, true);
    if (issue === 'blocked') add(s, 6, 85, 30.5, true);
    if (issue === 'inactive') target.active = false;
    if (issue === 'opponent') target.team = 1;
    assert.notEqual(chooseDecision(s.g, s.owner).target, target.id, issue);
  }
});

test('passing corridor uses defender motion and the same receiver lead as execution', () => {
  const s = situation(0, 78, 26), target = add(s, 8, 92, 35), defender = add(s, 6, 85, 34.5, true);
  defender.vy = -8;
  assert.equal(passOption(s.g, s.owner, target).safe, false);
  defender.active = false; target.vx = 2;
  const option = passOption(s.g, s.owner, target); assert.ok(option.aim.x > target.x);
  advance(s.g, .025); assert.equal(s.g.flight.to, target.id); assert.ok(s.g.flight.aim.x > target.x);
});

test('an open striker receives a through ball into the route to goal, mirrored for both teams', () => {
  for (const team of [0, 1]) {
    const s = situation(team, 65, 30), striker = add(s, 11, 78, 34);
    const option = passOption(s.g, s.owner, striker), aim = localPoint(option.aim, team);
    assert.equal(option.throughBall, true); assert.equal(option.safe, true);
    assert.ok(option.leadDistance >= 5 && option.leadDistance <= 14);
    assert.ok(aim.u > localPoint(striker, team).u + 4);
    const decision = chooseDecision(s.g, s.owner);
    assert.equal(decision.action, 'pass'); assert.equal(decision.target, striker.id); assert.equal(decision.throughBall, true);
    const start = localPoint(striker, team).u; advance(s.g, .025);
    assert.equal(s.g.flight.throughBall, true); assert.ok(localPoint(s.g.flight.aim, team).u > start + 4);
    advance(s.g, .45); assert.ok(localPoint(striker, team).u > start + 1);
    for (let n = 0; n < 80 && !s.g.events.some(e => e.type === 'pass'); n++) advance(s.g, .025);
    assert.ok(s.g.events.some(e => e.type === 'pass' && e.to === striker.id && e.throughBall));
  }
});

test('fullback-to-forward and forward-to-forward runs create a key pass into the meeting point', () => {
  for (const setup of [
    { passer: 5, receiver: 10, from: [50, 14], at: [62, 24], run: [84, 34] },
    { passer: 10, receiver: 11, from: [56, 42], at: [65, 48], run: [86, 34] },
  ]) {
    const s = situation(0), passer = add(s, setup.passer, ...setup.from), receiver = add(s, setup.receiver, ...setup.at);
    const coveringDefender = player(s.g, 13); Object.assign(coveringDefender, worldPoint(70, 5, 0));
    receiver.decision = { ...worldPoint(...setup.run, 0), action: 'support' };
    s.g.owner = passer.id; s.g.ball = { x: passer.x, y: passer.y };
    const option = passOption(s.g, passer, receiver), aim = localPoint(option.aim, 0), start = localPoint(receiver, 0);
    assert.equal(option.safe, true); assert.equal(option.throughBall, true); assert.ok(aim.u > start.u + 7);
    assert.ok(Math.abs(aim.v - start.v) > 1, 'the pass should lead the diagonal run as well as the forward run');
    const decision = chooseDecision(s.g, passer);
    assert.equal(decision.reason, 'key-pass'); assert.equal(decision.target, receiver.id);
    advance(s.g, .025); assert.equal(s.g.flight.to, receiver.id); assert.equal(s.g.flight.throughBall, true);
    advance(s.g, .5); assert.ok(localPoint(receiver, 0).u > start.u + 1);
  }
});

test('a goal-side defender closes the through-ball runway, while a chasing defender does not', () => {
  const blocked = situation(0, 65, 30), target = add(blocked, 11, 78, 34), defender = add(blocked, 6, 84, 34, true);
  let option = passOption(blocked.g, blocked.owner, target);
  assert.equal(option.throughBall, false); assert.ok(option.runwayBlockers.includes(defender.id));
  assert.ok(Math.abs(localPoint(option.aim, 0).u - 78) < .01);

  const chased = situation(0, 65, 30), runner = add(chased, 11, 78, 34);
  add(chased, 6, 75, 42, true);
  option = passOption(chased.g, chased.owner, runner);
  assert.equal(option.throughBall, true); assert.equal(option.runwayBlockers.length, 0);
});

test('a striker is not led into a goalkeeper who has already closed the space', () => {
  const s = situation(0, 65, 30), striker = add(s, 11, 78, 34);
  Object.assign(s.keeper, worldPoint(84, 34, 0));
  const option = passOption(s.g, s.owner, striker);
  assert.equal(option.throughBall, false); assert.equal(option.runwayReason, 'keeper-space');
});

test('a good close finish is taken instead of passing endlessly between equal chances', () => {
  const s = situation(0, 93, 34); add(s, 8, 92, 36);
  assert.equal(chooseDecision(s.g, s.owner).action, 'shoot');
  advance(s.g, .025); assert.equal(s.g.shots[0], 1);
});

test('keeper closing down ends the carry, but a rear chaser triggers a forward diagonal or shield', () => {
  const s = situation(0, 84, 34); Object.assign(s.keeper, worldPoint(90, 34, 0));
  assert.equal(chooseDecision(s.g, s.owner).action, 'shoot');
  const pressed = situation(0, 84, 34); add(pressed, 6, 81.5, 34, true);
  const decision = chooseDecision(pressed.g, pressed.owner), target = localPoint(decision.aim, 0);
  assert.equal(decision.action, 'dribble'); assert.ok(['diagonal', 'shield'].includes(decision.carryMode));
  assert.ok(target.u >= 84); assert.notEqual(target.v, 34);
  pressed.owner.traits.passAccuracy = .7; pressed.owner.traits.pace = .87; pressed.owner.traits.stamina = 60; pressed.owner.energy = .55;
  const cautious = chooseDecision(pressed.g, pressed.owner);
  assert.equal(cautious.carryMode, 'shield'); assert.ok(localPoint(cautious.aim, 0).u >= 84);
});

test('ball security attributes change whether a rear challenge wins the ball', () => {
  const run = skilled => {
    const s = situation(0, 84, 34), defender = add(s, 6, 82.4, 34, true);
    Object.assign(s.owner.traits, skilled
      ? { passAccuracy: .96, pace: .87 * 1.3, stamina: 90 }
      : { passAccuracy: .7, pace: .87, stamina: 60 });
    s.owner.energy = skilled ? 1 : .55; defender.intent.tackle = 'normal';
    s.owner.decision = chooseDecision(s.g, s.owner); s.g.random = () => .54;
    advance(s.g, .025); return { s, defender };
  };
  const low = run(false), high = run(true);
  assert.equal(low.s.g.owner, low.defender.id);
  assert.equal(high.s.g.owner, high.s.owner.id);
});

test('empty goals and blocked dribble corridors still allow appropriate long shots', () => {
  const open = situation(); open.keeper.y = 50;
  assert.equal(chooseDecision(open.g, open.owner).action, 'shoot');
  const blockedCarry = situation(); add(blockedCarry, 6, 82, 36.5, true);
  assert.equal(chooseDecision(blockedCarry.g, blockedCarry.owner).action, 'shoot');
});

test('explicit local shoot commands cannot bypass a blocked shooting lane', () => {
  const s = situation();
  for (const [number, y] of [[3, 32.8], [4, 34], [6, 35.2]]) add(s, number, 90, y, true);
  assert.notEqual(chooseDecision(s.g, s.owner).action, 'shoot');
});

test('shot power changes ball speed and shot accuracy changes physical dispersion', () => {
  const low = situation(0, 93, 34), high = situation(0, 93, 34);
  low.owner.traits.shotPower = 20; low.owner.traits.shotAccuracy = .55; low.g.random = () => 1;
  high.owner.traits.shotPower = 40; high.owner.traits.shotAccuracy = .9; high.g.random = () => 1;
  advance(low.g, .025); advance(high.g, .025);
  const lowSpeed = Math.hypot(low.g.flight.vx, low.g.flight.vy), highSpeed = Math.hypot(high.g.flight.vx, high.g.flight.vy);
  assert.ok(highSpeed > lowSpeed);
  assert.ok(Math.abs(low.g.flight.aim.y - 31.8) > Math.abs(high.g.flight.aim.y - 31.8));
});

test('pass accuracy changes execution error while preserving the planned recipient', () => {
  const low = situation(0, 65, 30), high = situation(0, 65, 30);
  const lowTarget = add(low, 11, 78, 34), highTarget = add(high, 11, 78, 34);
  low.owner.traits.passAccuracy = .7; low.g.random = () => 1;
  high.owner.traits.passAccuracy = .96; high.g.random = () => 1;
  const lowPlan = chooseDecision(low.g, low.owner), highPlan = chooseDecision(high.g, high.owner);
  advance(low.g, .025); advance(high.g, .025);
  assert.equal(low.g.flight.to, lowTarget.id); assert.equal(high.g.flight.to, highTarget.id);
  const error = (flight, plan) => Math.hypot(flight.aim.x - plan.aim.x, flight.aim.y - plan.aim.y);
  assert.ok(error(low.g.flight, lowPlan) > error(high.g.flight, highPlan));
});
