import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, advance, player } from '../backend/engine.js';
import { offsideLine, inOffsidePosition, captureOffside } from '../backend/offside.js';
import { worldPoint, passOption } from '../backend/tactics.js';

function fixture(team = 0, targetU = 85, kind = 'indirectFreeKick') {
  const g = createMatch(() => .5);
  for (const p of g.players) { p.active = false; p.intent = null; }
  const kicker = player(g, 10 + team * 11), target = player(g, 8 + team * 11);
  const defender = player(g, 3 + (1 - team) * 11), keeper = player(g, 1 + (1 - team) * 11);
  for (const [p, u, v] of [[kicker, 65, 34], [target, targetU, 34], [defender, 80, 5], [keeper, 100, 60]]) {
    p.active = true; Object.assign(p, worldPoint(u, v, team));
  }
  kicker.intent = { action: 'pass', target: target.id, shootRange: 0, x: kicker.x, y: kicker.y };
  g.owner = kicker.id; g.ball = { x: kicker.x, y: kicker.y }; g.controlTeam = team;
  g.touch = g.protection = g.restart = 0; g.hasPlan = true; g.setPiece = { kind, taker: kicker.id };
  return { g, kicker, target, defender, keeper, team };
}

test('offside uses ball, halfway and second-last active opponent in both directions; level is legal', () => {
  for (const team of [0, 1]) {
    const { g, target, keeper, defender } = fixture(team);
    assert.equal(offsideLine(g, team).u, 80); assert.equal(inOffsidePosition(g, target), true);
    Object.assign(target, worldPoint(80, 34, team)); assert.equal(inOffsidePosition(g, target), false);
    Object.assign(g.ball, worldPoint(90, 34, team)); Object.assign(target, worldPoint(89, 34, team));
    assert.equal(inOffsidePosition(g, target), false);
    Object.assign(g.ball, worldPoint(40, 34, team)); Object.assign(keeper, worldPoint(45, 60, team)); Object.assign(defender, worldPoint(30, 5, team));
    Object.assign(target, worldPoint(52.5, 34, team)); assert.equal(inOffsidePosition(g, target), false);
    Object.assign(target, worldPoint(53, 34, team)); assert.equal(inOffsidePosition(g, target), true);
    defender.active = false; assert.equal(offsideLine(g, team).u, 52.5);
  }
});

test('a flagged player is penalized only on involvement; returning onside after the kick does not erase the offense', () => {
  for (const team of [0, 1]) {
    const { g, target } = fixture(team); advance(g, .025);
    assert.ok(g.offsidePhase.candidates.includes(target.id)); assert.deepEqual(g.offsides, [0, 0]);
    Object.assign(target, worldPoint(75, 34, team)); advance(g, .5);
    assert.equal(g.offsides[team], 1); assert.equal(g.passes[team], 0);
    assert.equal(g.setPiece.kind, 'indirectFreeKick'); assert.equal(player(g, g.owner).team, 1 - team);
    assert.ok(g.events.some(e => e.type === 'offside' && e.to === target.id));
  }
});

test('onside at the kick stays legal when defenders step up before reception', () => {
  for (const team of [0, 1]) {
    const { g, target, defender } = fixture(team, 75); advance(g, .025);
    Object.assign(defender, worldPoint(70, 5, team)); advance(g, .5);
    assert.equal(g.owner, target.id); assert.equal(g.passes[team], 1); assert.equal(g.offsides[team], 0);
  }
});

test('direct throw-ins, goal kicks and corners are exempt; a subsequent teammate kick is not', () => {
  for (const kind of ['throwIn', 'goalKick', 'corner']) {
    const { g, kicker, target } = fixture(0, 85, kind);
    assert.equal(passOption(g, kicker, target).offside, false);
    advance(g, .025); assert.equal(g.offsidePhase.exempt, true); assert.deepEqual(g.offsidePhase.candidates, []);
    advance(g, 1); assert.equal(g.owner, target.id); assert.equal(g.offsides[0], 0);
    Object.assign(kicker, worldPoint(95, 40, 0));
    assert.ok(captureOffside(g, target).candidates.includes(kicker.id));
  }
});

test('an uninvolved offside teammate does not stop a legal pass and controlled interception resets the phase', () => {
  const { g, target, defender, kicker } = fixture(0, 75);
  const other = player(g, 11); other.active = true; Object.assign(other, worldPoint(90, 55, 0));
  advance(g, .025); assert.ok(g.offsidePhase.candidates.includes(other.id));
  advance(g, .5); assert.equal(g.owner, target.id); assert.equal(g.offsides[0], 0); assert.equal(g.offsidePhase, null);
  const s = fixture(); advance(s.g, .025); Object.assign(s.defender, worldPoint(70, 34, 0));
  advance(s.g, .25); assert.equal(s.g.owner, s.defender.id); assert.equal(s.g.offsidePhase, null); assert.equal(s.g.offsides[0], 0);
});

test('offside persists through a loose ball and applies to shot touches and challenges', () => {
  for (const kind of ['loose', 'shot', 'challenge']) {
    const { g, kicker, target, defender } = fixture();
    g.offsidePhase = captureOffside(g, kicker); g.owner = null; g.setPiece = null;
    g.ball = worldPoint(84, 34, 0);
    if (kind === 'loose') g.loose = true;
    else g.flight = { kind: kind === 'shot' ? 'shot' : 'pass', from: kicker.id, team: 0, vx: 22, vy: 0, remaining: 20, age: 1, start: worldPoint(65, 34, 0), aim: worldPoint(105, 34, 0) };
    if (kind === 'challenge') Object.assign(defender, worldPoint(84, 34, 0));
    advance(g, .025); assert.equal(g.offsides[0], 1, kind);
  }
});

test('an indirect free kick cannot score without another player touching it', () => {
  const { g, kicker, target } = fixture(); target.active = false; g.setPiece = null; g.owner = null;
  g.indirectKick = true; g.ball = { x: 104.8, y: 34 };
  g.flight = { kind: 'pass', from: kicker.id, team: 0, vx: 22, vy: 0, remaining: 5, age: 1, start: { x: 90, y: 34 }, aim: { x: 106, y: 34 } };
  advance(g, .025); assert.deepEqual(g.score, [0, 0]); assert.equal(g.setPiece.kind, 'goalKick');
});
