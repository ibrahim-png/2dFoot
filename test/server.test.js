import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { Playback, readMatch } from '../public/playback.js';

async function fixture(t) {
  const server = createApp(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, post: (route, body, signal, headers = {}) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body), signal }) };
}
test('local mode exposes 4-4-2 and serves only display assets; GPT/key routes are gone', async t => {
  const { origin, post } = await fixture(t);
  const config = await (await fetch(origin + '/api/config')).json(); assert.equal(config.engine, 'local'); assert.deepEqual(config.defaultFormations, ['4-4-2', '4-4-2']); assert.ok(config.formations.includes('3-5-2'));
  assert.deepEqual(config.defaultSpeeds, { onBall: 4.9, offBall: 5.7, sprint: 7.1, keeper: 4.8 }); assert.deepEqual(config.speedLimits, { min: 3, max: 9 });
  assert.equal((await post('/api/decision', {})).status, 404); assert.equal((await post('/api/key', {})).status, 404);
  for (const route of ['/.env', '/server.js', '/backend/engine.js', '/engine.js', '/tactics.js']) assert.equal((await fetch(origin + route)).status, 404);
  for (const route of ['/', '/app.js', '/playback.js', '/pitch.js', '/style.css', '/audio/stadium-ambience.mp3', '/audio/goal-cheer.mp3', '/audio/danger-attack.mp3', '/audio/shot-roar.mp3', '/audio/ball-kick.mp3']) {
    const response = await fetch(origin + route); assert.equal(response.status, 200);
    if (route.endsWith('.mp3')) { assert.equal(response.headers.get('content-type'), 'audio/mpeg'); assert.ok((await response.arrayBuffer()).byteLength > 40_000); }
  }
});
test('one request streams independent decisions and the entire five-minute match', async t => {
  const { post } = await fixture(t); let ready, chunks = 0, last = 0, decisions = 0, omittedReports = 0, finalScore = [0, 0];
  const playback = new Playback();
  const response = await post('/api/match', { seed: 17 }); assert.equal(response.status, 200);
  await readMatch(response, message => {
    if (message.type === 'ready') { ready = message; playback.reset(message.frame); assert.deepEqual(message.formations, ['4-4-2', '4-4-2']); return; }
    omittedReports += message.frames.flatMap(f => f.players).filter(p => p.decision && !Object.hasOwn(p.decision, 'report')).length;
    playback.append(message);
    chunks++; assert.equal(message.sequence, chunks - 1);
    for (const frame of message.frames) { assert.ok(frame.elapsed > last); last = frame.elapsed; decisions = frame.decisionCount; finalScore = frame.score; assert.equal(frame.players.length, 22); assert.ok(frame.players.every(p => p.decision.report.at <= frame.elapsed + .001)); }
    playback.advance(1000);
  });
  assert.equal(ready.seed, 17); assert.equal(last, 300); assert.ok(chunks > 1); assert.ok(decisions > 22000);
  assert.ok(omittedReports > 0); assert.ok(finalScore[0] + finalScore[1] > 0, 'worker must keep streaming after at least one goal');
});
test('malformed seeds, state injection and cross-origin starts are rejected before worker creation', async t => {
  const { post, server } = await fixture(t);
  for (const body of [{ seed: -1 }, { seed: 2.5 }, { seed: 'x' }, { players: [] }, { mode: 'bad' }, { mode: true }, { controlled: 'yes' },
    { freePlayers: { home: 4, away: 3 } }, { mode: 'free', freePlayers: { home: 0, away: 3 } }, { mode: 'free', freePlayers: { home: 4, away: 12 } },
    { speeds: { onBall: 4.9, offBall: 5.7, sprint: 99, keeper: 4.8 } }, { speeds: { onBall: 4.9 } }, null]) assert.equal((await post('/api/match', body)).status, 400);
  assert.equal((await post('/api/match/control', { matchId: 'missing', action: 'next' })).status, 404);
  assert.equal((await post('/api/match', {}, undefined, { Origin: 'https://example.com' })).status, 403);
  assert.equal(server.activeSimulations, 0);
});

test('Free mode reaches the worker with selected player counts and accepts manual attack controls', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 16, mode: 'free', freePlayers: { home: 4, away: 3 }, controlled: true }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const nextMessage = async () => {
    while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
    const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return message;
  };
  const ready = await nextMessage(), owner = ready.frame.manualControl.owner, p = ready.frame.players[owner - 1];
  assert.deepEqual(ready.freePlayers, { home: 4, away: 3 }); assert.equal(ready.frame.manualControl.kind, 'free');
  assert.equal(ready.frame.players.filter(player => player.active && player.team === 0).length, 4);
  assert.equal(ready.frame.players.filter(player => player.active && player.team === 1).length, 3);
  const plan = { owner, action: 'dribble', passTo: null, aim: { x: p.x + 10, y: p.y }, power: 1, curve: 0, runs: [] };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualPlan', plan })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualDrive', direction: { x: 1, y: 0 } })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'next' })).status, 200);
  const chunk = await nextMessage(); assert.ok(chunk.frames.some(frame => frame.players[owner - 1].decision?.reason === 'manual-dribble'));
  controller.abort(); await reader.cancel().catch(() => {});
});

test('controlled match applies live speeds before calculating the next short chunk', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 9, controlled: true, speeds: { onBall: 4.9, offBall: 5.7, sprint: 7.1, keeper: 4.8 } }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const nextMessage = async () => {
    while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
    const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return message;
  };
  const ready = await nextMessage(); assert.equal(ready.type, 'ready'); assert.equal(ready.frame.elapsed, 0); assert.ok(ready.matchId);
  const speeds = { onBall: 5.1, offBall: 6.2, sprint: 7.8, keeper: 4.4 };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'speeds', speeds })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'next' })).status, 200);
  const chunk = await nextMessage(); assert.equal(chunk.type, 'frames'); assert.ok(chunk.frames.at(-1).elapsed <= .5 + .001);
  assert.deepEqual(chunk.frames.at(-1).speedSettings, speeds);
  controller.abort(); await reader.cancel().catch(() => {});
});

test('manual mode accepts a drawn Lime plan and keeps calculating only after approval', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 5, mode: 'manual', controlled: true }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const nextMessage = async () => {
    while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
    const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return message;
  };
  const ready = await nextMessage(), owner = ready.frame.manualControl.owner, passTo = owner === 2 ? 3 : 2, runId = owner === 4 ? 5 : 4;
  assert.equal(ready.frame.owner, owner); assert.equal(ready.frame.players[owner - 1].team, 0);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualPlan', plan: { owner, action: 'pass', passTo: runId, aim: { x: 999, y: 12 }, power: 1, curve: 0, runs: [] } })).status, 400);
  const plan = { owner, action: 'pass', passTo, aim: { x: 70, y: 12 }, power: .8, curve: .3, runs: [{ id: runId, x: 70, y: 12 }, { id: owner, x: 60, y: 34 }] };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualPlan', plan })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'next' })).status, 200);
  const chunk = await nextMessage(), planned = chunk.frames.find(frame => frame.players[owner - 1].decision?.reason === 'manual-pass');
  assert.ok(planned); assert.equal(planned.players[owner - 1].decision.target, passTo); assert.equal(planned.players[runId - 1].decision.action, 'manualRun');
  controller.abort(); await reader.cancel().catch(() => {});
});
test('online room code connects two clients to one authoritative manual match', async t => {
  const { post } = await fixture(t), hostAbort = new AbortController(), guestAbort = new AbortController();
  const createdResponse = await post('/api/online/rooms', { formations: ['4-4-2', '4-4-2'] });
  assert.equal(createdResponse.status, 201); const host = await createdResponse.json(); assert.match(host.roomCode, /^\d{6}$/); assert.equal(host.team, 0);
  const lineReader = response => {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    return { reader, async next() { while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
      const end = buffer.indexOf('\n'), value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return value; } };
  };
  const hostStream = await post('/api/online/stream', { roomCode: host.roomCode, playerToken: host.playerToken }, hostAbort.signal), hostLines = lineReader(hostStream);
  let hostReady, hostWaiting;
  for (let i = 0; i < 3 && (!hostReady || !hostWaiting); i++) { const message = await hostLines.next(); if (message.type === 'ready') hostReady = message; if (message.type === 'room') hostWaiting = message; }
  assert.equal(hostReady.frame.manualControl.team, 0); assert.equal(hostWaiting.status, 'waiting');
  const joinedResponse = await post('/api/online/join', { roomCode: host.roomCode }); assert.equal(joinedResponse.status, 200);
  const guest = await joinedResponse.json(); assert.equal(guest.team, 1); assert.equal(guest.matchId, host.matchId);
  const guestStream = await post('/api/online/stream', { roomCode: guest.roomCode, playerToken: guest.playerToken }, guestAbort.signal), guestLines = lineReader(guestStream);
  let guestReady, guestRoom;
  for (let i = 0; i < 3 && (!guestReady || !guestRoom); i++) { const message = await guestLines.next(); if (message.type === 'ready') guestReady = message; if (message.type === 'room') guestRoom = message; }
  assert.equal(guestReady.onlineTeam, 1); assert.equal(guestRoom.status, 'ready');
  const owner = hostReady.frame.manualControl.owner, p = hostReady.frame.players[owner - 1], recipient = hostReady.frame.players.find(player => player.team === 0 && player.id !== owner);
  const plan = { owner, action: 'pass', passTo: recipient.id, aim: { x: p.x + 8, y: p.y }, power: .7, curve: 0, runs: [] };
  assert.equal((await post('/api/match/control', { matchId: host.matchId, playerToken: guest.playerToken, action: 'manualPlan', plan })).status, 400);
  assert.equal((await post('/api/match/control', { matchId: host.matchId, playerToken: host.playerToken, action: 'manualPlan', plan })).status, 200);
  let hostResume; while (hostResume?.status !== 'resume') hostResume = await hostLines.next();
  let guestResume; while (guestResume?.status !== 'resume') guestResume = await guestLines.next();
  assert.equal((await post('/api/match/control', { matchId: host.matchId, playerToken: host.playerToken, action: 'next' })).status, 200);
  const hostChunk = await hostLines.next(), guestChunk = await guestLines.next(); assert.equal(hostChunk.type, 'frames'); assert.deepEqual(guestChunk, hostChunk);
  hostAbort.abort(); guestAbort.abort(); await hostLines.reader.cancel().catch(() => {}); await guestLines.reader.cancel().catch(() => {});
});

test('Space control interrupts a manual dribble inside the worker', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 15, mode: 'manual', controlled: true }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const nextMessage = async () => {
    while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
    const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return message;
  };
  const ready = await nextMessage(), owner = ready.frame.manualControl.owner, p = ready.frame.players[owner - 1];
  const plan = { owner, action: 'dribble', passTo: null, aim: { x: p.x + 12, y: p.y + 4 }, power: 1, curve: 0, runs: [] };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualPlan', plan })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualDrive', direction: { x: 2, y: 0 } })).status, 400);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualDrive', direction: { x: 1, y: 0 } })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'next' })).status, 200);
  const moving = await nextMessage(); assert.ok(moving.frames.some(frame => frame.players[owner - 1].decision?.reason === 'manual-dribble'));
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'manualPause' })).status, 200);
  const stopped = await nextMessage(); assert.equal(stopped.manualRequested, true); assert.equal(stopped.frames[0].manualControl.owner, owner);
  controller.abort(); await reader.cancel().catch(() => {});
});

test('free kick setup reaches the worker with ball position, wall size and player skills', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 23, mode: 'freeKick', controlled: true }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const nextMessage = async () => {
    while (!buffer.includes('\n')) { const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true }); }
    const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return message;
  };
  const ready = await nextMessage(), owner = ready.frame.manualControl.owner;
  assert.equal(ready.frame.manualControl.kind, 'freeKick');
  const invalid = { owner, ball: { x: 75, y: 30 }, wallCount: 9, aim: { x: 107, y: 34 }, power: .8, curve: .2, shotPower: 36, curvePower: 80 };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'freeKickPlan', plan: invalid })).status, 400);
  const plan = { ...invalid, wallCount: 4 };
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'freeKickPlan', plan })).status, 200);
  assert.equal((await post('/api/match/control', { matchId: ready.matchId, action: 'next' })).status, 200);
  const chunk = await nextMessage(), shot = chunk.frames.find(frame => frame.flight?.kind === 'shot');
  assert.ok(shot); assert.equal(shot.flight.power, .8); assert.ok(Math.abs(shot.flight.curve - .16) < 1e-9); assert.equal(shot.flight.curvePower, 80);
  assert.equal(shot.players.filter(player => player.active).length, 6);
  controller.abort(); await reader.cancel().catch(() => {});
});

test('debug request reaches the worker and sends a pre-pass checkpoint over HTTP', async t => {
  const { post } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 7, mode: 'debug' }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', checkpoint;
  while (!checkpoint) {
    const part = await reader.read(); assert.equal(part.done, false); buffer += decoder.decode(part.value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      checkpoint ??= message.frames?.find(f => f.debugPass);
    }
  }
  assert.equal(checkpoint.owner, checkpoint.debugPass.from); assert.equal(checkpoint.debugPass.candidates.length, 10);
  assert.ok(Number.isFinite(checkpoint.offsideLine.x));
  controller.abort(); await reader.cancel().catch(() => {});
});
test('disconnect cancels the worker, including while the stream is backed up', async t => {
  const { post, server } = await fixture(t), controller = new AbortController();
  const response = await post('/api/match', { seed: 2 }, controller.signal);
  const reader = response.body.getReader(); await reader.read(); assert.equal(server.activeSimulations, 1);
  controller.abort(); await reader.cancel().catch(() => {});
  for (let n = 0; n < 100 && server.activeSimulations; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(server.activeSimulations, 0);
});

test('independent formations survive HTTP validation and worker startup', async t => {
  const { post, server } = await fixture(t);
  for (const formations of [null, '4-4-2', [], ['4-4-2'], ['4-4-2', 'bad'], ['__proto__', '4-4-2']]) assert.equal((await post('/api/match', { formations })).status, 400);
  assert.equal(server.activeSimulations, 0);
  const controller = new AbortController(), response = await post('/api/match', { seed: 2, formations: ['4-2-3-1', '3-5-2'] }, controller.signal);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '';
  while (!text.includes('\n')) text += decoder.decode((await reader.read()).value, { stream: true });
  const ready = JSON.parse(text.split('\n')[0]); assert.deepEqual(ready.formations, ['4-2-3-1', '3-5-2']);
  assert.equal(ready.frame.players[8].role, 'AM'); assert.equal(ready.frame.players[12].role, 'LCB');
  controller.abort(); await reader.cancel().catch(() => {});
});
