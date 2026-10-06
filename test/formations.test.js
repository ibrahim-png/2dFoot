import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATIONS, FORMATION_IDS, formationPair } from '../backend/formations.js';
import { createMatch, kickoff, advance } from '../backend/engine.js';
import { roleOf, localPoint, worldPoint, tacticalTargets } from '../backend/tactics.js';
import { think } from '../backend/players.js';
import { Simulation, frameOf } from '../backend/simulation.js';

test('every combination assigns separate valid roles, corridors and mirrored starting positions', () => {
  for (const home of FORMATION_IDS) for (const away of FORMATION_IDS) {
    const g = createMatch(() => .5, { formations: [home, away], autonomous: true });
    assert.deepEqual(g.formations, [home, away]); assert.equal(g.players.length, 22);
    for (const p of g.players) {
      const role = roleOf(p), intended = FORMATIONS[g.formations[p.team]][p.number - 1];
      assert.equal(role.code, intended.code);
      if (p.id !== g.owner) assert.equal(localPoint(p, p.team).v, role.v);
      assert.ok(role.lane[0] <= role.v && role.v <= role.lane[1]);
    }
    advance(g, 2);
    assert.ok(g.players.every(p => Number.isFinite(p.x) && p.x >= 1 && p.x <= 104 && p.y >= 1 && p.y <= 67));
  }
});

test('3-5-2 uses three centre backs and wing backs rather than number-based 4-4-2 duties', () => {
  const g = createMatch(() => .5, { formations: ['3-5-2', '4-3-3'], autonomous: true });
  assert.equal(g.players.filter(p => p.team === 0 && roleOf(p).type === 'centreBack').length, 3);
  assert.equal(g.players.filter(p => p.team === 0 && roleOf(p).type === 'wingBack').length, 2);
  g.owner = 10; g.ball = { x: 75, y: 10 }; Object.assign(g.players[9], g.ball); think(g);
  const targets = tacticalTargets(g);
  assert.ok(targets.get(2).x < 60, 'shirt 2 must cover as a centre back');
  assert.ok(targets.get(5).x > targets.get(2).x + 10, 'left wing back must support the attack');
  assert.ok(targets.get(7).x < targets.get(8).x, 'holding midfielder must cover behind central midfielder');
});

test('4-2-3-1 has two holding midfielders, a number ten and one striker; restarts preserve both formations', () => {
  const g = createMatch(() => .5, { formations: ['4-2-3-1', '3-5-2'], autonomous: true });
  assert.equal(g.players.filter(p => p.team === 0 && roleOf(p).type === 'holding').length, 2);
  assert.equal(roleOf(g.players[8]).type, 'attackingMid');
  assert.equal(g.owner, 11, 'centre forward takes kickoff, not shirt 10 playing on the wing');
  advance(g, 5);
  for (const team of [0, 1]) {
    kickoff(g, team); think(g);
    assert.equal(roleOf(g.players[g.owner - 1]).type, 'striker');
    for (const p of g.players) if (p.id !== g.owner) assert.equal(localPoint(p, p.team).v, roleOf(p).v);
    assert.deepEqual(frameOf(g).formations, ['4-2-3-1', '3-5-2']);
  }
});

test('roles and directions mirror for either team with the same formation', () => {
  for (const id of FORMATION_IDS) {
    const g = createMatch(() => .5, { formations: [id, id] });
    for (let n = 0; n < 11; n++) {
      const a = g.players[n], b = g.players[n + 11]; assert.equal(roleOf(a).code, roleOf(b).code);
      if (a.id !== g.owner) { const mirrored = worldPoint(roleOf(a).startU, roleOf(a).v, 1); assert.equal(b.y, mirrored.y); }
    }
  }
});

test('formation inputs are validated and copied; mixed formations remain deterministic', () => {
  for (const bad of [null, '4-3-3', [], ['4-4-2'], ['4-4-2', 'bad'], ['__proto__', '4-4-2']]) assert.throws(() => formationPair(bad));
  const pair = ['4-3-3', '3-5-2'], a = new Simulation(4, pair), b = new Simulation(4, pair); pair[0] = '4-4-2';
  assert.deepEqual(a.game.formations, ['4-3-3', '3-5-2']); assert.deepEqual(a.next(), b.next());
});
