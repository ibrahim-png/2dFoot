import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, frameOf } from '../backend/simulation.js';
import { advance } from '../backend/engine.js';
import { worldPoint } from '../backend/tactics.js';

test('all active players expose their actual movement targets and only the owner exposes ball choices', () => {
  const simulation = new Simulation(7);
  for (const frame of simulation.next().frames) for (const p of frame.players) {
    if (!p.active) continue;
    const report = p.decision.report, movement = report.movement;
    assert.ok(report.at <= frame.elapsed + .001);
    const expected = worldPoint(movement.final.u, movement.final.v, p.team);
    assert.ok(Math.abs(expected.x - p.decision.x) < .001);
    assert.ok(Math.abs(expected.y - p.decision.y) < .001);
    assert.ok(movement.final.v >= movement.lane[0] && movement.final.v <= movement.lane[1]);
    if (report.hadBall) {
      const selected = report.choices.filter(c => c.selected);
      assert.equal(selected.length, 1); assert.equal(selected[0].reason, p.decision.reason); assert.equal(selected[0].ok, true);
      const index = report.choices.indexOf(selected[0]);
      assert.ok(report.choices.slice(0, index).every(c => !c.ok && !c.skipped));
      assert.ok(report.choices.slice(index + 1).every(c => c.skipped));
    } else assert.deepEqual(report.choices, []);
  }
});

test('analysis cadence, early possession refresh and restart suspension are reported accurately', () => {
  const { game: g } = new Simulation(7); g.touch = 100;
  assert.equal(g.players[0].decision.report.trigger, 'initial');
  advance(g, .175); assert.equal(g.players[0].thoughts, 1);
  advance(g, .075); assert.equal(g.players[0].thoughts, 2);
  const periodic = g.players[0].decision.report;
  assert.equal(periodic.trigger, 'interval'); assert.ok(periodic.at >= .2 - 1e-7 && periodic.at <= .225 + 1e-7);
  g.owner = 21; g.ball = { x: g.players[20].x, y: g.players[20].y }; g.nextThink = 100;
  advance(g, .025); assert.equal(g.players[20].decision.report.trigger, 'possession'); assert.equal(g.players[20].decision.report.hadBall, true);
  const count = g.decisionCount; g.restart = .4; advance(g, .2); assert.equal(g.decisionCount, count);
  assert.ok(frameOf(g).timing.restart > 0);
});

test('every analysis reaches the stream, including decisions between regular display samples', () => {
  const simulation = new Simulation(4); let previous = simulation.game.players[0].thoughts;
  for (let batch = 0; batch < 3; batch++) for (const frame of simulation.next().frames) {
    const p = frame.players[0]; assert.ok(p.thoughts - previous <= 1); previous = p.thoughts;
  }
  assert.ok(previous > 20);
  const frame = frameOf(simulation.game); frame.players[0].decision.report.movement.final.u = -100;
  assert.notEqual(simulation.game.players[0].decision.report.movement.final.u, -100);
});
