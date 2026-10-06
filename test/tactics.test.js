import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyInstructions, advance, snapshot, player } from '../backend/engine.js';
import { tacticalTargets, localPoint, worldPoint, chooseAction, roleOf, phaseFor } from '../backend/tactics.js';

const plan = g => ({ players: g.players.map(p => ({ id: p.id, x: p.x, y: p.y, move: 'press', action: 'dribble', target: null, shootRange: p.keeper ? 0 : 30, tackle: 'normal' })) });
function ready() { const g = createMatch(() => .5); applyInstructions(g, plan(g)); g.touch = g.protection = 0; return g; }

test('both teams recover towards their own goal immediately after a turnover', () => {
  for (const team of [0, 1]) {
    const g = ready(), back = player(g, 2 + team * 11), rival = player(g, 10 + (1 - team) * 11);
    Object.assign(back, worldPoint(76, 10, team));
    Object.assign(rival, worldPoint(60, 34, team));
    g.owner = rival.id; g.ball = { x: rival.x, y: rival.y }; g.controlTeam = team;
    advance(g, .5);
    assert.equal(phaseFor(g, team), 'recover'); assert.equal(phaseFor(g, 1 - team), 'counter');
    assert.ok(localPoint(back, team).u < 74); assert.equal(back.duty, 'recover');
    assert.ok(tacticalTargets(g).get(back.id).speed > 6);
  }
});

test('left backs cannot be directed onto the opposite wing; weak-side fullback covers', () => {
  for (const team of [0, 1]) {
    const g = ready(), left = player(g, 2 + team * 11), right = player(g, 5 + team * 11);
    g.owner = 9 + team * 11; Object.assign(player(g, g.owner), worldPoint(75, 10, team));
    g.ball = worldPoint(75, 10, team); Object.assign(left.intent, worldPoint(100, 66, team));
    const targets = tacticalTargets(g), l = localPoint(targets.get(left.id), team), r = localPoint(targets.get(right.id), team);
    assert.ok(l.v <= 25); assert.ok(l.u > r.u + 10);
    advance(g, 3); assert.ok(localPoint(left, team).v <= 26);
  }
});

test('pressing is limited so the entire defence does not chase the ball', () => {
  const g = ready(); g.ball = { x: 70, y: 34 }; Object.assign(player(g, 10), g.ball);
  for (const p of g.players.filter(p => p.team === 1)) Object.assign(p, { x: 73, y: 34 + (p.number - 6) * .5 });
  let press = [...tacticalTargets(g).values()].filter(p => p.duty === 'press'); assert.ok(press.length > 0 && press.length <= 2);
  g.turnovers = 1; g.possessionSince = 0;
  press = [...tacticalTargets(g).values()].filter(p => p.duty === 'press'); assert.ok(press.length <= 1);
});

test('a defender leaves the static line to get goal-side of a dangerous forward', () => {
  for (const team of [0, 1]) {
    const g = ready(), rivalTeam = 1 - team, threat = player(g, 10 + rivalTeam * 11), owner = player(g, 7 + rivalTeam * 11);
    g.owner = owner.id; g.possessionSince = -10; g.turnovers = 0;
    Object.assign(threat, worldPoint(20, 34, team)); Object.assign(owner, worldPoint(65, 58, team)); g.ball = { x: owner.x, y: owner.y };
    for (const defender of g.players.filter(p => p.team === team && ['centreBack', 'fullBack'].includes(roleOf(p).type))) Object.assign(defender, worldPoint(31, roleOf(defender).v, team));
    const targets = tacticalTargets(g), cover = [...targets.values()].find(target => target.movementTrace?.cover?.threat === threat.id);
    assert.ok(cover, `team ${team} should assign a goal-side defender`); assert.equal(cover.duty, 'coverRunner');
    assert.ok(localPoint(cover, team).u <= 17.5 + .001); assert.ok(Math.abs(localPoint(cover, team).v - 34) < .001); assert.equal(cover.speed, 7.1);
  }
});

test('counter runners use normal off-ball speed and live settings drive all four speed groups', () => {
  const g = ready(), runner = player(g, 6), owner = player(g, 11), keeper = player(g, 1);
  g.owner = owner.id; g.ball = { x: owner.x, y: owner.y }; g.turnovers = 1; g.possessionSince = g.elapsed;
  let targets = tacticalTargets(g); assert.equal(phaseFor(g, 0), 'counter'); assert.equal(targets.get(runner.id).speed, 5.7);
  g.turnovers = 0; targets = tacticalTargets(g); assert.equal(phaseFor(g, 0), 'attack'); assert.equal(targets.get(runner.id).speed, 5.7);
  g.speedSettings = { onBall: 5.1, offBall: 6.2, sprint: 7.8, keeper: 4.4 }; targets = tacticalTargets(g);
  assert.equal(targets.get(owner.id).speed, 5.1); assert.equal(targets.get(runner.id).speed, 6.2); assert.equal(targets.get(keeper.id).speed, 4.4);
  const rival = player(g, 21); g.owner = rival.id; Object.assign(rival, worldPoint(20, 34, 0)); g.ball = { x: rival.x, y: rival.y };
  const sprint = [...tacticalTargets(g).values()].find(target => target.duty === 'coverRunner'); assert.ok(sprint); assert.equal(sprint.speed, 7.8);
});

test('an open long shot is taken from a standing local pass policy in either direction', () => {
  for (const team of [0, 1]) {
    const g = ready(), p = player(g, 7 + team * 11);
    for (const q of g.players) if (q.team !== team) { q.y = 3; q.intent = null; }
    Object.assign(p, worldPoint(77, 34, team)); p.intent.action = 'pass'; p.intent.target = 8 + team * 11;
    g.owner = p.id; g.ball = { x: p.x, y: p.y };
    assert.equal(chooseAction(g, p), 'shoot'); advance(g, .025);
    assert.equal(g.shots[team], 1); assert.equal(g.longShots[team], 1); assert.equal(g.flight.kind, 'shot');
  }
});

test('shot permission respects distance, angle and blocked lanes', () => {
  const g = ready(), p = player(g, 7); g.owner = p.id; Object.assign(p, { x: 76, y: 34 });
  p.intent.action = 'dribble'; p.intent.shootRange = 24; assert.equal(chooseAction(g, p), 'dribble');
  p.intent.shootRange = 34;
  for (const [index, y] of [32.8, 34, 35.2].entries()) Object.assign(player(g, 14 + index), { x: 90, y });
  assert.equal(chooseAction(g, p), 'dribble');
  Object.assign(p, { x: 100, y: 5 }); assert.equal(chooseAction(g, p), 'dribble');
});

function contact(x = 55, team = 0) {
  const g = ready(), victim = player(g, 10 + team * 11), defender = player(g, 6 + (1 - team) * 11);
  for (const p of g.players) if (![victim, defender].includes(p)) { p.x = p.team ? 99 : 5; p.y = 3 + p.number; p.intent = null; }
  Object.assign(victim, worldPoint(x, 34, team)); Object.assign(defender, worldPoint(x + 1.15, 34, team));
  defender.intent.tackle = 'hard'; g.owner = victim.id; g.ball = { x: victim.x, y: victim.y }; g.random = () => .58;
  return { g, victim, defender };
}

test('reckless contact awards a free kick and yellow; no contact produces no foul', () => {
  const { g, victim, defender } = contact(); advance(g, .025);
  assert.equal(g.fouls[defender.team], 1); assert.equal(defender.yellows, 1);
  assert.equal(defender.card, 'yellow'); assert.ok(defender.cardUntil > g.elapsed);
  assert.equal(g.setPiece.kind, 'freeKick'); assert.equal(g.owner, victim.id); assert.ok(g.restart > 0);
  advance(g, 2); assert.equal(g.setPiece, null); assert.ok(g.flight || g.events.some(e => e.type === 'pass'));
  const apart = contact(); apart.defender.x += 20; advance(apart.g, .025); assert.deepEqual(apart.g.fouls, [0, 0]);
});

test('fouls inside either defending penalty area produce a penalty and a shot', () => {
  for (const team of [0, 1]) {
    const { g, victim } = contact(94, team); advance(g, .025);
    assert.equal(g.setPiece.kind, 'penalty'); assert.equal(g.owner, victim.id);
    assert.ok(Math.abs(localPoint(g.ball, team).u - 94) < .01);
    advance(g, 1.6); assert.equal(g.shots[team], 1); assert.equal(g.setPiece, null);
  }
});

test('second yellow removes a player from movement and participation', () => {
  const { g, defender } = contact(); defender.yellows = 1; advance(g, .025);
  assert.equal(defender.active, false); assert.equal(g.redCards[defender.team], 1);
  assert.equal(defender.card, 'red'); assert.ok(defender.cardUntil > g.elapsed);
  assert.equal(tacticalTargets(g).has(defender.id), false);
  const point = [defender.x, defender.y]; advance(g, 2); assert.deepEqual([defender.x, defender.y], point);
  assert.equal(snapshot(g, 'local').players[defender.id - 1].active, false);
});

test('five-minute seeded match keeps finite positions, active owners and valid snapshots', () => {
  let seed = 17; const g = createMatch(() => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296));
  for (let t = 0; t < 300; t++) {
    if (!g.hasPlan || t % 5 === 0) applyInstructions(g, { players: g.players.map(p => ({ id: p.id, ...worldPoint(Math.min(localPoint(p, p.team).u, roleOf(p).maxU), roleOf(p).v, p.team), move: 'press', action: p.keeper ? 'pass' : 'dribble', target: p.keeper ? p.id + 1 : null, shootRange: p.keeper ? 0 : 30, tackle: 'normal' })) });
    advance(g, 1); assert.ok(g.players.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 1 && p.x <= 104 && p.y >= 1 && p.y <= 67));
    if (g.owner) assert.ok(player(g, g.owner).active);
  }
  assert.equal(g.ended, true); assert.ok(g.shots[0] + g.shots[1] > 0);
});
