import test from 'node:test';
import assert from 'node:assert/strict';
import { Playback, readMatch } from '../public/playback.js';
const frame = (elapsed, x, version = 1) => ({ elapsed, deadBallVersion: version, owner: 1, ball: { x, y: 34 }, players: [{ id: 1, active: true, x, y: 34 }], score: [0, 0] });

test('interpolation smooths positions without revealing future score or running physics', () => {
  const p = new Playback(); p.reset(frame(0, 10)); const next = frame(1, 20); next.score = [1, 0];
  p.append({ sequence: 0, frames: [next], ended: false });
  const middle = p.advance(.5); assert.equal(middle.players[0].x, 15); assert.deepEqual(middle.score, [0, 0]);
  assert.deepEqual(p.advance(10).score, [1, 0]); assert.equal(p.time, 1);
});
test('goal/restart discontinuities never interpolate players across the pitch', () => {
  const p = new Playback(); p.reset(frame(0, 100)); p.append({ sequence: 0, frames: [frame(1, 52, 2)], ended: false });
  assert.equal(p.advance(.5).players[0].x, 100); assert.equal(p.advance(.5).players[0].x, 52);
});
test('out-of-order chunks and duplicate frame times are rejected', () => {
  const p = new Playback(); p.reset(frame(0, 1)); assert.throws(() => p.append({ sequence: 3, frames: [] }));
  assert.throws(() => p.append({ sequence: 0, frames: [frame(0, 2)] }));
});
test('NDJSON handles split UTF-8 characters and detects interrupted streams', async () => {
  const data = new TextEncoder().encode(JSON.stringify({ type: 'ready', text: 'Şut, geri koşu' }) + '\n' + JSON.stringify({ type: 'frames', ended: true }) + '\n');
  const messages = [];
  await readMatch(new Response(new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } })), m => messages.push(m));
  assert.equal(messages[0].text, 'Şut, geri koşu');
  await assert.rejects(readMatch(new Response('{"type":"ready"}\n'), () => {}), /tamamlanmadan/);
});

test('compressed reports hydrate per player without leaking a future decision into an earlier frame', () => {
  const p = new Playback(), a = frame(0, 1), b = frame(.05, 2), c = frame(.2, 3);
  a.players[0].decision = { report: { at: 0, choices: ['first'] } }; a.players[0].thoughts = 1;
  b.players[0].decision = {}; b.players[0].thoughts = 1;
  c.players[0].decision = { report: { at: .2, choices: ['second'] } }; c.players[0].thoughts = 2;
  p.reset(a); p.append({ sequence: 0, frames: [b, c], ended: false });
  assert.deepEqual(p.advance(.1).players[0].decision.report.choices, ['first']);
  const result = p.advance(1, Infinity, { id: 1, thoughts: 1 });
  assert.equal(p.time, .2); assert.deepEqual(result.players[0].decision.report.choices, ['second']);
  assert.deepEqual(a.players[0].decision.report.choices, ['first']);
});

test('manual checkpoints stop playback until the drawn plan is released', () => {
  const p = new Playback(), a = frame(0, 1), checkpoint = frame(.4, 5), after = frame(.8, 9);
  checkpoint.manualControl = { id: 1, owner: 1, team: 0 };
  p.reset(a); p.append({ sequence: 0, frames: [checkpoint, after], ended: false });
  const stopped = p.advance(1); assert.equal(p.time, .4); assert.equal(stopped.manualControl.id, 1); assert.equal(p.manualPause, checkpoint);
  p.releaseManual(); assert.equal(p.manualPause, null); assert.equal(p.advance(1).elapsed, .8);
});
