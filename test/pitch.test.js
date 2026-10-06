import test from 'node:test';
import assert from 'node:assert/strict';
import { pitchCamera } from '../public/pitch.js';

test('mobile half-pitch camera enlarges the field and puts the attacking goal above midfield', () => {
  const half = pitchCamera(380, 300, true);
  assert.equal(half.scale, 5);
  assert.ok(half.scale > pitchCamera(380, 300).scale * 1.5);
  assert.deepEqual(half.toField(190, 27.5), { x: 105, y: 34 });
  assert.deepEqual(half.toField(190, 10), { x: 108.5, y: 34 }); // Room behind the net for aiming.
  assert.deepEqual(half.toField(20, 290), { x: 52.5, y: 0 });
  assert.deepEqual(half.toField(360, 290), { x: 52.5, y: 68 });
  const wide = pitchCamera(600, 240, true);
  assert.deepEqual(wide.toField(300, 22), { x: 105, y: 34 });
  assert.ok(wide.scale > pitchCamera(600, 240).scale);
});

test('desktop camera keeps both goals and the original touch coordinates', () => {
  const camera = pitchCamera(1170, 800);
  assert.equal(camera.rotation, 0);
  assert.deepEqual(camera.toField(60, 400), { x: 0, y: 34 });
  assert.deepEqual(camera.toField(1110, 400), { x: 105, y: 34 });
});
