import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, frameOf } from '../backend/simulation.js';
import { Playback } from '../public/playback.js';

test('debug captures every actual pass before launch with the exact scored options and does not change the match', () => {
  const normal = new Simulation(17), debug = new Simulation(17, undefined, 'debug');
  let count = 0, lastTime = 0; const checkpoints = [];
  const capture = debug.game.onBeforePass;
  debug.game.onBeforePass = trace => { count++; capture(trace); };
  while (!normal.game.ended) {
    normal.next(); const chunk = debug.next();
    assert.deepEqual(frameOf(normal.game), frameOf(debug.game));
    for (const f of chunk.frames) {
      assert.ok(f.elapsed > lastTime); lastTime = f.elapsed;
      if (!f.debugPass) continue;
      const d = f.debugPass; checkpoints.push(f);
      assert.equal(d.id, checkpoints.length); assert.equal(f.owner, d.from); assert.equal(f.flight, null);
      assert.ok(d.evaluatedAt <= d.at); assert.equal(d.candidates.length, 10);
      const selected = d.candidates.find(c => c.id === d.to); assert.ok(selected);
      for (const c of d.candidates) assert.ok(Math.abs(c.value - Object.values(c.terms).reduce((a, b) => a + b)) < 1e-9);
      if (d.reason === 'better-chance') assert.equal(selected.chanceValue, Math.max(...d.candidates.filter(c => !c.chanceExclusions.length).map(c => c.chanceValue)));
      if (d.reason === 'planned-pass') assert.equal(selected.value, Math.max(...d.candidates.filter(c => !c.exclusions.length).map(c => c.value)));
    }
  }
  assert.ok(count > 20); assert.equal(count, checkpoints.length);
});

test('playback cannot skip a pass checkpoint even with a large time step; release advances exactly once', () => {
  const simulation = new Simulation(7, undefined, 'debug'), p = new Playback(); p.reset(frameOf(simulation.game));
  const expected = [];
  while (expected.length < 3) { const chunk = simulation.next(); expected.push(...chunk.frames.filter(f => f.debugPass)); p.append(chunk); }
  for (const frame of expected) {
    assert.equal(p.advance(1000).debugPass.id, frame.debugPass.id);
    assert.equal(p.time, frame.elapsed); assert.equal(p.advance(1000).elapsed, frame.elapsed);
    p.releaseDebug();
  }
  assert.equal(p.debugPause, null);
  p.reset(frameOf(new Simulation(7).game)); assert.equal(p.released, 0); assert.equal(p.debugPause, null);
});
