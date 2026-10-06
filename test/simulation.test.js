import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, frameOf } from '../backend/simulation.js';
import { ROLES, localPoint } from '../backend/tactics.js';
import { think } from '../backend/players.js';

test('both teams start with four defenders, four midfielders and two forwards', () => {
  const s = new Simulation(1), g = s.game;
  assert.deepEqual(ROLES.map(r => r.code), ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LST', 'RST']);
  for (const team of [0, 1]) {
    const ps = g.players.filter(p => p.team === team);
    assert.equal(ps.filter(p => ['LM', 'LCM', 'RCM', 'RM'].includes(ROLES[p.number - 1].code)).length, 4);
    assert.equal(new Set(ps.slice(5, 9).map(p => localPoint(p, team).u)).size, 1);
  }
});
test('all 22 players have their own decisions, targets, traits and decision histories', () => {
  const s = new Simulation(1); s.next(); const ps = s.game.players;
  assert.equal(new Set(ps.map(p => p.decision)).size, 22);
  assert.ok(ps.every(p => p.thoughts >= 10 && p.decision && Number.isFinite(p.decision.x)));
  assert.ok(new Set(ps.map(p => p.decision.action)).size >= 3);
  assert.ok(new Set(ps.map(p => p.traits.vision)).size > 1);
  assert.equal(ps.reduce((n, p) => n + p.thoughts, 0), s.game.decisionCount);
});
test('sent-off players stop deciding; possession turnover immediately changes both teams', () => {
  const s = new Simulation(3), g = s.game, expelled = g.players[1];
  expelled.active = false; const count = expelled.thoughts;
  g.owner = 21; g.controlTeam = 1; g.turnovers++; g.possessionSince = g.elapsed; think(g);
  assert.equal(expelled.thoughts, count); assert.equal(g.players[20].decision.action === 'press', false);
  assert.ok(g.players.some(p => p.team === 0 && p.decision.action === 'recover'));
});
test('same seed and commands reproduce exactly the same backend frames', () => {
  const a = new Simulation(51), b = new Simulation(51);
  for (let n = 0; n < 5; n++) assert.deepEqual(a.next(), b.next());
});
test('a ball-out ends the current batch at the event and the backend continues without a client decision', () => {
  const s = new Simulation(1), g = s.game;
  g.owner = null; g.ball = { x: 104.9, y: 3 }; g.lastTouchTeam = 0;
  g.flight = { kind: 'shot', from: 10, team: 0, vx: 29, vy: 0, remaining: 10, age: 1, start: { x: 95, y: 3 }, aim: { x: 110, y: 3 } };
  const first = s.next(); assert.equal(first.boundary, true); assert.equal(first.frames.length, 1);
  assert.equal(first.frames[0].events.at(-1).type, 'goalKick');
  const second = s.next(); assert.ok(second.frames.at(-1).elapsed > first.frames[0].elapsed); assert.ok(g.hasPlan);
});
test('wire snapshots cannot mutate the authoritative match', () => {
  const s = new Simulation(8), frame = frameOf(s.game); frame.players[0].x = 999; frame.score[0] = 99;
  assert.notEqual(s.game.players[0].x, 999); assert.equal(s.game.score[0], 0);
});
