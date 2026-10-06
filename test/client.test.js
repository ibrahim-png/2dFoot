import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Playback, readMatch } from '../public/playback.js';
import { Simulation } from '../backend/simulation.js';
import { speedSettings } from '../backend/speeds.js';
const settle = () => new Promise(resolve => setImmediate(resolve));

async function client(t, { audio = false, audioThrows = false, webAudio = false } = {}) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])), nodes = new Map(), sources = [], documentListeners = {};
  function node(id) {
    if (id && !ids.has(id)) throw Error(`Missing element ${id}`); if (nodes.has(id)) return nodes.get(id);
    const n = { value: '', textContent: '', checked: true, disabled: false, hidden: false, children: [], listeners: {}, style: {},
      classList: { toggle() {} }, addEventListener(name, fn) { this.listeners[name] = fn; },
      replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); }, prepend(child) { this.children.unshift(child); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1170, height: 800 }; }, setPointerCapture() {},
      get lastElementChild() { const self = this; return { remove() { self.children.pop(); } }; },
    }; if (id) nodes.set(id, n); return n;
  }
  let now = 0; const audioInstances = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.currentTime = 0; this.readyState = 4; this.volume = 1; this.loop = false; this.paused = true; this.playCount = 0; audioInstances.push(this); }
    play() { this.paused = false; this.playCount++; if (audioThrows) throw new Error('media unavailable'); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const whistleStarts = [];
  class FakeAudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start(at) { whistleStarts.push(at); }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    close() { return Promise.resolve(); }
  }
  const context = { Playback, readMatch, AbortController, createPitch: () => () => {}, performance: { now: () => now }, requestAnimationFrame() {},
    Audio: audio ? FakeAudio : undefined,
    AudioContext: webAudio ? FakeAudioContext : undefined, setTimeout(fn) { fn(); return 0; },
    document: { body: { classList: { remove() {} } }, getElementById: node, createElement: () => node(), createTextNode: text => ({ textContent: text }), addEventListener(name, fn) { documentListeners[name] = fn; } },
    fetch: async (url, options) => {
      assert.equal(options.method, 'POST'); const request = JSON.parse(options.body);
      if (url === '/api/match/control') {
        const source = sources.find(item => item.matchId === request.matchId); assert.ok(source);
        source.controls.push(request);
        if (request.action === 'speeds') source.simulation.game.speedSettings = speedSettings(request.speeds);
        else if (request.action === 'manualPlan') source.simulation.applyManualPlan(request.plan);
        else if (request.action === 'manualDrive') source.simulation.steerManual(request.direction);
        else if (request.action === 'freeKickPlan') source.simulation.applyFreeKickPlan(request.plan);
        else if (request.action === 'manualPause') source.emit(source.simulation.pauseManual());
        else if (!source.blockNext) source.emit(source.simulation.next(.5));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(url, '/api/match');
      const simulation = new Simulation(7, request.formations, request.mode, request.speeds, request.freePlayers), encoder = new TextEncoder(); let streamController;
      const body = new ReadableStream({ start(c) { streamController = c; } });
      const matchId = `match-${sources.length + 1}`;
      const source = { simulation, request, matchId, controls: [], blockNext: false, emit: message => streamController.enqueue(encoder.encode(JSON.stringify(message) + '\n')), end: () => streamController.close() };
      options.signal.addEventListener('abort', () => { try { streamController.error(new Error('aborted')); } catch {} }, { once: true });
      sources.push(source); source.emit({ type: 'ready', frame: simulation.readyFrame(), seed: 7, matchId, formations: simulation.game.formations, speeds: simulation.game.speedSettings });
      return new Response(body);
    },
  };
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const api = await vm.runInNewContext(`(async () => { ${source}\nreturn { state: () => ({ game, running, failed, playback }), frame, showEvents: () => logEvents(), dispose: () => controller?.abort() }; })()`, context);
  t.after(() => api.dispose()); await settle();
  return { api, node, sources, audioInstances, whistleStarts, tick(dt = .05) { now += dt * 1000; api.frame(now); }, key(name, event) { documentListeners[name]?.(event); } };
}
test('UI starts without credentials; a single stream supplies all player decisions', async t => {
  const c = await client(t); assert.equal(c.node('start').disabled, false); assert.equal(c.api.state().game.players.length, 22);
  assert.equal(c.sources[0].request.controlled, true); assert.deepEqual(c.sources[0].request.speeds, { onBall: 4.9, offBall: 5.7, sprint: 7.1, keeper: 4.8 });
  assert.equal(c.node('selected-player').children.length, 23); assert.equal(c.node('selected-player').value, 'auto');
  assert.match(c.node('decision-summary').textContent, /#10/); assert.match(c.node('trait-shot-power').textContent, /m/);
  assert.match(c.node('trait-shot-accuracy').textContent, /%/); assert.match(c.node('trait-pass-accuracy').textContent, /%/);
  assert.equal(c.node('player-roster').children.length, 22);
  assert.match(c.node('player-roster').children[0].children.at(-1).style.color, /^hsl\(120 /);
  c.node('start').listeners.click(); c.tick(); assert.ok(c.api.state().playback.time > 0); assert.equal(c.sources.length, 1);
  assert.ok(c.node('player-action').textContent.length > 0);
});
test('restarts show their notice while goal kicks and corners also map the ball exit point', async t => {
  const c = await client(t), state = c.api.state(); let serial = 0;
  for (const fixture of [
    { type: 'throwIn', title: 'TAÇ', team: 0, to: 6, detail: /Lime FC kullanacak/ },
    { type: 'goalKick', title: 'AUT', team: 1, to: 12, exitX: 105, exitY: 20, exitZ: .4, detail: /Coral United kullanacak/ },
    { type: 'offside', title: 'OFSAYT', team: 0, to: 10, detail: /Lime FC #10 ofsaytta · Coral United kullanacak/ },
    { type: 'corner', title: 'KORNER', team: 1, to: 18, exitX: 0, exitY: 44, exitZ: 1.2, detail: /Coral United kullanacak/ },
  ]) {
    state.game.events.push({ serial: ++serial, time: state.game.elapsed, ...fixture }); c.api.showEvents();
    if (fixture.type === 'goalKick' || fixture.type === 'corner') {
      assert.equal(c.node('exit-overlay').hidden, false); assert.equal(c.node('exit-title').textContent, fixture.title);
      assert.match(c.node('exit-team').textContent, fixture.detail); assert.match(c.node('exit-ball-marker').style.left, /%$/);
      assert.ok(c.node('exit-location').textContent.length > 0);
    } else {
      assert.equal(c.node('event-overlay').hidden, false); assert.equal(c.node('event-title').textContent, fixture.title); assert.match(c.node('event-detail').textContent, fixture.detail);
    }
  }
  c.tick(4.3); assert.equal(c.node('event-overlay').hidden, true); assert.equal(c.node('exit-overlay').hidden, true);
});
test('stadium atmosphere can be switched off and on even when Web Audio is unavailable', async t => {
  const c = await client(t); assert.match(c.node('stadium-sound').textContent, /Stadyum sesi/);
  c.node('stadium-sound').listeners.click(); assert.match(c.node('stadium-sound').textContent, /Ses kapalı/);
  c.node('stadium-sound').listeners.click(); assert.match(c.node('stadium-sound').textContent, /Stadyum sesi/);
});
test('kickoff and full time play one-start and three-blast whistle patterns', async t => {
  const c = await client(t, { webAudio: true }); c.node('start').listeners.click(); assert.equal(c.whistleStarts.length, 1);
  const state = c.api.state(); state.game.events.push({ serial: 1, type: 'fullTime', team: null, time: 300 }); c.api.showEvents();
  assert.equal(c.whistleStarts.length, 4); assert.equal(c.node('final-overlay').hidden, false);
  assert.equal(c.node('final-score').textContent, `${state.game.score[0]} – ${state.game.score[1]}`); assert.ok(c.node('final-result').textContent.length > 0);
  c.node('final-close').listeners.click(); assert.equal(c.node('final-overlay').hidden, true);
});
test('licensed stadium ambience and match reactions follow shots, danger and goals', async t => {
  const c = await client(t, { audio: true }); c.node('start').listeners.click(); await settle();
  assert.deepEqual(c.audioInstances.map(audio => audio.src), ['/audio/stadium-ambience.mp3', '/audio/goal-cheer.mp3', '/audio/danger-attack.mp3', '/audio/shot-roar.mp3', '/audio/ball-kick.mp3']);
  c.node('start').listeners.click();
  const [ambient, goal, danger, shot, kick] = c.audioInstances, state = c.api.state(); assert.equal(ambient.loop, true); assert.ok(ambient.playCount > 0);
  state.game.events.push({ serial: 1, type: 'shot', team: 0, from: 10, distance: 18, time: 1 });
  state.game.flight = { kind: 'shot', team: 0, vx: 25, vy: 0 }; c.api.showEvents(); c.tick();
  assert.equal(danger.playCount, 1); assert.equal(shot.playCount, 1); assert.equal(shot.paused, false);
  state.game.events.push({ serial: 2, type: 'kick', team: 0, from: 10, action: 'shot', time: 1 }); c.api.showEvents(); assert.equal(kick.playCount, 1);
  state.game.flight = null; c.tick(); assert.equal(shot.paused, true);
  state.game.events.push({ serial: 3, type: 'goal', team: 0, from: 10, time: 2, crossY: 31, crossZ: 2, shotDistance: 18.4 }); c.api.showEvents();
  assert.equal(goal.playCount, 1); assert.match(c.node('goal-ball-marker').style.left, /%$/); assert.match(c.node('goal-ball-marker').style.top, /%$/);
  assert.match(c.node('goal-location').textContent, /sol yüksek/); assert.match(c.node('goal-location').textContent, /18,4 m şut/);
  c.node('goal-close').listeners.click(); assert.equal(c.node('goal-overlay').hidden, true);
});
test('a browser media failure during a goal never stops the match UI', async t => {
  const c = await client(t, { audio: true, audioThrows: true }); c.node('start').listeners.click(); await settle(); c.node('start').listeners.click();
  const state = c.api.state(); state.game.events.push({ serial: 1, type: 'goal', team: 0, from: 10, time: 1 });
  assert.doesNotThrow(() => c.api.showEvents()); assert.equal(c.node('goal-overlay').hidden, false); assert.match(c.node('goal-location').textContent, /Lime FC/);
  assert.doesNotThrow(() => c.tick());
});
test('match speed controls update the running backend without creating a new match', async t => {
  const c = await client(t), source = c.sources[0];
  c.node('speed-off-ball').value = '6.2'; c.node('speed-off-ball').listeners.input(); c.node('speed-off-ball').listeners.change(); await settle();
  assert.match(c.node('speed-off-ball-value').textContent, /6,2 m\/sn/);
  assert.equal(source.simulation.game.speedSettings.offBall, 6.2); assert.equal(c.sources.length, 1);
  assert.deepEqual(source.controls.find(control => control.action === 'speeds').speeds, { onBall: 4.9, offBall: 6.2, sprint: 7.1, keeper: 4.8 });
  c.node('speed-reset').listeners.click(); await settle(); assert.equal(source.simulation.game.speedSettings.offBall, 5.7);
});
test('pause freezes display, resume consumes streamed frames, starvation never simulates locally', async t => {
  const c = await client(t); c.sources[0].blockNext = true; c.node('start').listeners.click(); c.tick();
  c.node('start').listeners.click(); const before = c.api.state().playback.time; c.tick(); assert.equal(c.api.state().playback.time, before);
  c.node('start').listeners.click(); for (let n = 0; n < 60; n++) c.tick();
  const starvedAt = c.api.state().playback.time; assert.ok(starvedAt > 0 && starvedAt <= 1); c.tick(); assert.equal(c.api.state().playback.time, starvedAt);
  assert.equal(c.sources.length, 1);
  c.sources[0].emit(c.sources[0].simulation.next()); await settle(); c.tick(); assert.ok(c.api.state().playback.time > starvedAt);
});
test('reset cancels the old stream and starts a fresh 4-4-2 match', async t => {
  const c = await client(t); c.node('start').listeners.click(); c.tick(); c.node('reset').listeners.click(); await settle();
  assert.equal(c.sources.length, 2); assert.equal(c.api.state().playback.time, 0); assert.equal(c.api.state().running, false); assert.equal(c.api.state().failed, false);
});
test('10-second playback stops exactly; premature stream closure shows an error', async t => {
  const c = await client(t); c.node('step').listeners.click();
  for (let n = 0; n < 250 && c.api.state().running; n++) { c.tick(); await settle(); }
  assert.ok(Math.abs(c.api.state().playback.time - 10) < .00001, `stopped at ${c.api.state().playback.time}`); assert.equal(c.api.state().running, false);
  c.sources[0].end(); c.node('start').listeners.click();
  for (let n = 0; n < 50 && !c.api.state().failed; n++) { c.tick(); await settle(); }
  assert.equal(c.api.state().failed, true); assert.ok(c.node('notice').textContent.length > 0);
});

test('both pre-match selections reach the backend and update player roles independently', async t => {
  const c = await client(t);
  c.node('home-formation').value = '4-3-3'; c.node('home-formation').listeners.change();
  c.node('away-formation').value = '3-5-2'; c.node('away-formation').listeners.change(); await settle();
  assert.deepEqual(c.sources.at(-1).request.formations, ['4-3-3', '3-5-2']);
  assert.deepEqual([...c.api.state().game.formations], ['4-3-3', '3-5-2']);
  assert.match(c.node('home-formation-label').textContent, /4-3-3/); assert.match(c.node('away-formation-label').textContent, /3-5-2/);
  assert.equal(c.api.state().game.players[5].role, 'DM'); assert.equal(c.api.state().game.players[12].role, 'LCB');
  assert.equal(c.api.state().failed, false); assert.equal(c.api.state().playback.time, 0);
});

test('formation selection locks from kickoff including while paused; new match unlocks and preserves choices', async t => {
  const c = await client(t); c.node('home-formation').value = '4-2-3-1'; c.node('home-formation').listeners.change(); await settle();
  c.node('start').listeners.click(); assert.equal(c.node('home-formation').disabled, true); assert.equal(c.node('away-formation').disabled, true);
  c.node('start').listeners.click(); assert.equal(c.node('home-formation').disabled, true);
  const calls = c.sources.length; c.node('home-formation').listeners.change(); assert.equal(c.sources.length, calls);
  c.node('reset').listeners.click(); await settle(); assert.equal(c.node('home-formation').disabled, false);
  assert.equal(c.sources.at(-1).request.formations[0], '4-2-3-1'); assert.equal(c.api.state().game.owner, 11);
});

test('debug mode pauses before each pass, shows ten calculations and resumes through the dedicated button', async t => {
  const c = await client(t); c.node('match-mode').value = 'debug'; c.node('match-mode').listeners.change(); await settle();
  assert.equal(c.sources.at(-1).request.mode, 'debug'); assert.equal(c.node('debug-panel').hidden, false);
  c.node('start').listeners.click();
  for (let n = 0; n < 100 && !c.api.state().playback.debugPause; n++) { c.tick(.2); await settle(); }
  const first = c.api.state().playback.debugPause; assert.ok(first);
  assert.equal(c.api.state().running, false); assert.equal(c.api.state().game.owner, first.debugPass.from);
  assert.equal(c.node('debug-options').children.length, 10); assert.equal(c.node('debug-next').disabled, false);
  assert.ok(!c.node('debug-summary').textContent.includes('NaN')); assert.equal(c.node('match-mode').disabled, true);
  c.tick(1); assert.equal(c.api.state().playback.time, first.elapsed);
  c.node('debug-next').listeners.click();
  for (let n = 0; n < 100 && !c.api.state().playback.debugPause; n++) { c.tick(.2); await settle(); }
  assert.equal(c.api.state().playback.debugPause.debugPass.id, first.debugPass.id + 1);
  c.node('reset').listeners.click(); await settle(); assert.equal(c.node('match-mode').disabled, false);
  assert.equal(c.api.state().playback.debugPause, null); assert.equal(c.node('debug-options').children.length, 0);
});

test('decision screen follows either player selector and next decision stops exactly once', async t => {
  const c = await client(t);
  assert.equal(c.node('decision-player').children.length, 23); assert.equal(c.node('decision-player').value, 'auto');
  assert.ok(c.node('decision-actions').children.length >= 5); assert.equal(c.node('decision-movement').children.length, 8);
  c.node('decision-player').value = '2'; c.node('decision-player').listeners.change();
  assert.equal(c.node('selected-player').value, '2'); assert.equal(c.node('decision-actions').children.length, 1);
  assert.ok(c.node('decision-summary').textContent.includes('#2'));
  const before = c.api.state().game.players[1].thoughts;
  c.node('decision-next').listeners.click(); assert.equal(c.api.state().running, true);
  for (let n = 0; n < 10 && c.api.state().running; n++) c.tick(.2);
  assert.equal(c.api.state().running, false); assert.equal(c.api.state().game.players[1].thoughts, before + 1);
  const at = c.api.state().playback.time; c.tick(); assert.equal(c.api.state().playback.time, at);
  c.node('selected-player').value = '21'; c.node('selected-player').listeners.change();
  assert.equal(c.node('decision-player').value, '21'); assert.ok(c.node('decision-summary').textContent.includes('Coral'));
  c.node('start').listeners.click(); c.node('decision-pause').listeners.click(); assert.equal(c.api.state().running, false);
  c.node('reset').listeners.click(); await settle(); assert.equal(c.api.state().playback.time, 0); assert.equal(c.node('decision-player').value, 'auto');
});

test('Sen oyna mode selects the receiver and draws both a free pass and the passer run', async t => {
  const c = await client(t); c.node('match-mode').value = 'manual'; c.node('match-mode').listeners.change(); await settle();
  const source = c.sources.at(-1), state = c.api.state(), owner = state.game.players[state.game.owner - 1];
  assert.equal(source.request.mode, 'manual'); assert.equal(c.node('manual-panel').hidden, false); assert.equal(c.node('start').disabled, true);
  const teammates = state.game.players.filter(p => p.active && p.team === 0 && p.id !== owner.id), runner = teammates[1];
  const eventAt = p => ({ clientX: 60 + p.x * 10, clientY: 60 + p.y * 10, pointerId: 1, preventDefault() {} });
  const recipient = teammates[0];
  const powerPoint = { x: owner.x > 99 ? owner.x - 4.1 : owner.x + 4.1, y: Math.max(1, Math.min(57, owner.y - 5)) + 5 };
  assert.equal(c.node('manual-action-label').textContent, 'Şut');
  assert.equal(c.node('manual-timing-control').hidden, true);
  const aim = { x: 76, y: 22 };
  c.node('pitch').listeners.pointerdown(eventAt(owner)); c.node('pitch').listeners.pointerup(eventAt(aim));
  assert.equal(c.node('manual-apply').disabled, true);
  const dx = aim.x - owner.x, dy = aim.y - owner.y, length = Math.hypot(dx, dy), bow = Math.min(9, length * .22) * -.45;
  const curveHandle = { x: (owner.x + aim.x) / 2 - dy / length * bow, y: (owner.y + aim.y) / 2 + dx / length * bow };
  c.node('pitch').listeners.pointerdown(eventAt(aim)); c.node('pitch').listeners.pointermove(eventAt(curveHandle)); c.node('pitch').listeners.pointerup(eventAt(curveHandle));
  c.tick(.45); c.node('pitch').listeners.pointerdown(eventAt(powerPoint));
  assert.equal(c.node('manual-apply').disabled, false); c.node('pitch').listeners.dblclick(eventAt(recipient));
  assert.equal(c.node('manual-action-label').textContent, 'Pas');
  c.node('pitch').listeners.pointerdown(eventAt(owner)); c.node('pitch').listeners.pointerup(eventAt({ x: owner.x + 7, y: owner.y + 3 }));
  c.node('pitch').listeners.pointerdown(eventAt(recipient)); c.node('pitch').listeners.pointerup(eventAt({ x: recipient.x + 5, y: recipient.y + 2 }));
  c.node('pitch').listeners.pointerdown(eventAt(runner)); c.node('pitch').listeners.pointerup({ clientX: 60 + (runner.x + 8) * 10, clientY: 60 + (runner.y + 4) * 10, pointerId: 1, preventDefault() {} });
  assert.equal(c.node('manual-apply').disabled, false); c.node('manual-apply').listeners.click(); await settle(); await settle();
  const control = source.controls.find(item => item.action === 'manualPlan'); assert.ok(control);
  assert.equal(control.plan.owner, owner.id); assert.equal(control.plan.action, 'pass'); assert.equal(control.plan.passTo, recipient.id); assert.deepEqual(control.plan.aim, { x: 76, y: 22 });
  assert.ok(Math.abs(control.plan.curve - -.45) < .0001); assert.ok(control.plan.power > .3 && control.plan.power < 1);
  assert.ok(control.plan.runs.some(run => run.id === owner.id)); assert.ok(control.plan.runs.some(run => run.id === runner.id));
  assert.ok(!control.plan.runs.some(run => run.id === recipient.id));
  assert.equal(c.node('manual-panel').hidden, true); assert.equal(c.api.state().running, true);
});
test('double-clicking the kick arrow cancels either a shot or a pass', async t => {
  const c = await client(t); c.node('match-mode').value = 'manual'; c.node('match-mode').listeners.change(); await settle();
  const state = c.api.state(), owner = state.game.players[state.game.owner - 1], receiver = state.game.players.find(player => player.active && player.team === 0 && player.id !== owner.id);
  const eventAt = p => ({ clientX: 60 + p.x * 10, clientY: 60 + p.y * 10, pointerId: 1, preventDefault() {} });
  const target = { x: owner.x + 20, y: owner.y + 4 }, middle = { x: (owner.x + target.x) / 2, y: (owner.y + target.y) / 2 };
  const powerPoint = { x: owner.x > 99 ? owner.x - 4.1 : owner.x + 4.1, y: Math.max(1, Math.min(57, owner.y - 5)) + 5 };
  c.node('pitch').listeners.pointerdown(eventAt(owner)); c.node('pitch').listeners.pointerup(eventAt(target)); assert.equal(c.node('manual-apply').disabled, true);
  c.tick(.4); c.node('pitch').listeners.pointerdown(eventAt(powerPoint)); assert.equal(c.node('manual-apply').disabled, false);
  c.node('pitch').listeners.dblclick(eventAt(middle)); assert.equal(c.node('manual-apply').disabled, true); assert.match(c.node('manual-status').textContent, /Şut oku iptal edildi/);
  c.node('pitch').listeners.dblclick(eventAt(receiver));
  c.node('pitch').listeners.pointerdown(eventAt(owner)); c.node('pitch').listeners.pointerup(eventAt(target)); assert.equal(c.node('manual-action-label').textContent, 'Pas');
  c.tick(.4); c.node('pitch').listeners.pointerdown(eventAt(powerPoint)); assert.equal(c.node('manual-apply').disabled, false);
  c.node('pitch').listeners.dblclick(eventAt(middle)); assert.equal(c.node('manual-apply').disabled, true); assert.match(c.node('manual-status').textContent, /Pas oku iptal edildi/);
});

test('Free mode sends selected player counts and starts with only those players', async t => {
  const c = await client(t); c.node('free-home-count').value = '4'; c.node('free-away-count').value = '3';
  c.node('free-home-count').listeners.input(); c.node('free-away-count').listeners.input(); c.node('match-mode').value = 'free'; c.node('match-mode').listeners.change(); await settle();
  const source = c.sources.at(-1), players = c.api.state().game.players;
  assert.deepEqual(source.request.freePlayers, { home: 4, away: 3 }); assert.equal(c.node('free-mode-setup').hidden, false);
  assert.equal(players.filter(player => player.active && player.team === 0).length, 4); assert.equal(players.filter(player => player.active && player.team === 1).length, 3);
  assert.equal(c.node('manual-panel').hidden, false); assert.match(c.node('manual-title').textContent, /Free mod/);
});
test('online mode opens the room-code lobby without starting a separate local match', async t => {
  const c = await client(t), before = c.sources.length;
  c.node('match-mode').value = 'online'; c.node('match-mode').listeners.change(); await settle();
  assert.equal(c.node('online-room-setup').hidden, false); assert.equal(c.node('online-room-result').hidden, true);
  assert.equal(c.sources.length, before); assert.match(c.node('online-room-status').textContent, /6 haneli oda numarası/);
  assert.equal(c.node('start').disabled, true);
  for (const id of ['decision-stat', 'segment-stat', 'speed-panel', 'decision-panel', 'log-panel', 'local-engine-panel']) assert.equal(c.node(id).hidden, true);
  for (const id of ['player-roster', 'home-formation', 'match-statistics-panel', 'pitch']) assert.equal(c.node(id).hidden, false);
});
test('every opening-screen choice loads its mode or the online lobby', async t => {
  for (const [id, mode] of [['normal', 'normal'], ['manual', 'manual'], ['online', 'online'], ['debug', 'debug'], ['free', 'free'], ['free-kick', 'freeKick']]) {
    await t.test(mode, async t => {
      const c = await client(t); assert.equal(c.node('mode-gate').hidden, false);
      const before = c.sources.length;
      c.node(`choose-${id}`).listeners.click(); await settle();
      assert.equal(c.node('mode-gate').hidden, true); assert.equal(c.node('match-mode').value, mode);
      assert.equal(c.api.state().failed, false);
      if (mode === 'online') {
        assert.equal(c.node('online-room-setup').hidden, false); assert.equal(c.sources.length, before);
      } else {
        assert.equal(c.sources.length, before + 1); assert.equal(c.sources.at(-1).request.mode, mode);
        assert.equal(c.node('online-room-setup').hidden, true);
        assert.equal(c.node('manual-panel').hidden, !['manual', 'free', 'freeKick'].includes(mode));
      }
    });
  }
});

test('Sen oyna top sürme continues until Space requests a new backend decision point', async t => {
  const c = await client(t); c.node('match-mode').value = 'manual'; c.node('match-mode').listeners.change(); await settle();
  const source = c.sources.at(-1), owner = c.api.state().game.players[c.api.state().game.owner - 1];
  let drivePrevented = false;
  c.key('keydown', { code: 'KeyW', target: { tagName: 'BODY' }, preventDefault() { drivePrevented = true; } }); await settle(); await settle();
  const plan = source.controls.find(item => item.action === 'manualPlan')?.plan;
  assert.equal(drivePrevented, true); assert.equal(plan.action, 'dribble'); assert.equal(plan.passTo, null); assert.ok(plan.aim.y < owner.y);
  c.key('keydown', { code: 'KeyD', target: { tagName: 'BODY' }, preventDefault() {} }); await settle();
  const diagonal = source.controls.filter(item => item.action === 'manualDrive').at(-1); assert.ok(diagonal.direction.x > 0); assert.ok(diagonal.direction.y < 0);
  c.key('keyup', { code: 'KeyW', target: { tagName: 'BODY' }, preventDefault() {} }); await settle();
  const right = source.controls.filter(item => item.action === 'manualDrive').at(-1); assert.equal(right.direction.x, 1); assert.equal(right.direction.y, 0);
  for (let i = 0; i < 5; i++) c.tick(.1);
  let prevented = false; c.key('keydown', { code: 'Space', target: { tagName: 'BODY' }, preventDefault() { prevented = true; } }); await settle();
  for (let i = 0; i < 20 && !c.api.state().playback.manualPause; i++) c.tick(.1);
  assert.equal(prevented, true);
  assert.ok(source.controls.some(item => item.action === 'manualPause')); assert.ok(c.api.state().playback.manualPause);
  assert.equal(c.api.state().playback.manualPause.manualControl.owner, owner.id); assert.equal(c.node('manual-panel').hidden, false); assert.equal(c.node('manual-action-label').textContent, 'Şut');
});

test('Free kick uses the drawn curve and timed power meter before sending the shot', async t => {
  const c = await client(t); c.node('match-mode').value = 'freeKick'; c.node('match-mode').listeners.change(); await settle();
  const source = c.sources.at(-1), eventAt = p => ({ clientX: 60 + p.x * 10, clientY: 60 + p.y * 10, pointerId: 1, preventDefault() {} });
  assert.equal(source.request.mode, 'freeKick'); assert.equal(c.node('free-kick-controls').hidden, false); assert.equal(c.node('manual-action-label').textContent, 'Şut');
  assert.equal(c.node('manual-apply').hidden, false);
  c.node('pitch').listeners.pointerdown(eventAt({ x: 76, y: 28 }));
  c.node('free-kick-wall-count').value = '5'; c.node('free-kick-wall-count').listeners.input();
  const owner = c.api.state().game.players[c.api.state().game.owner - 1];
  c.node('pitch').listeners.pointerdown(eventAt({ x: 76, y: 28 })); c.node('pitch').listeners.pointerup(eventAt({ x: 107, y: 34 }));
  assert.equal(c.node('manual-apply').disabled, true);
  c.node('manual-apply').listeners.click(); await settle();
  assert.equal(source.controls.some(item => item.action === 'freeKickPlan'), false);
  const length = Math.hypot(31, 6), bow = Math.min(9, length * .22) * .35;
  const handle = { x: 91.5 - 6 / length * bow, y: 31 + 31 / length * bow };
  c.node('pitch').listeners.pointerdown(eventAt({ x: 107, y: 34 }));
  c.node('pitch').listeners.pointermove(eventAt(handle)); c.node('pitch').listeners.pointerup(eventAt(handle));
  c.tick(.45); c.node('pitch').listeners.pointerdown(eventAt({ x: 80.1, y: 28 }));
  assert.equal(c.node('manual-apply').disabled, false);
  c.tick(.2); assert.equal(c.node('manual-timed-power-value').textContent, '%65');
  assert.equal(c.node('manual-apply').disabled, false); c.node('manual-apply').listeners.click(); await settle(); await settle();
  const control = source.controls.find(item => item.action === 'freeKickPlan'); assert.ok(control);
  assert.deepEqual(control.plan.ball, { x: 76, y: 28 }); assert.equal('wall' in control.plan, false); assert.equal(control.plan.wallCount, 5);
  assert.equal(control.plan.shotPower, owner.traits.shotPower); assert.equal(control.plan.curvePower, owner.traits.curvePower ?? 70); assert.equal('lift' in control.plan, false);
  assert.deepEqual(control.plan.aim, { x: 107, y: 34 }); assert.ok(Math.abs(control.plan.power - .65) < 1e-9); assert.ok(Math.abs(control.plan.curve - .35) < 1e-9);
  assert.equal(c.node('manual-apply').hidden, true);
});

test('Free kick power can be reselected and moving the ball requires a new aim and power', async t => {
  const c = await client(t); c.node('choose-free-kick').listeners.click(); await settle();
  const eventAt = p => ({ clientX: 60 + p.x * 10, clientY: 60 + p.y * 10, pointerId: 1, preventDefault() {} });
  const down = point => c.node('pitch').listeners.pointerdown(eventAt(point));
  down({ x: 76, y: 28 }); down({ x: 76, y: 28 }); c.node('pitch').listeners.pointerup(eventAt({ x: 107, y: 34 }));
  c.tick(.45); down({ x: 80.1, y: 28 }); assert.equal(c.node('manual-apply').disabled, false);
  down({ x: 80.1, y: 28 }); assert.equal(c.node('manual-apply').disabled, true);
  c.tick(.18); down({ x: 80.1, y: 28 }); assert.equal(c.node('manual-timed-power-value').textContent, '%44');
  assert.equal(c.node('manual-apply').disabled, false);
  c.node('free-kick-ball').listeners.click(); down({ x: 82, y: 40 }); assert.equal(c.node('manual-apply').disabled, true);
  down({ x: 82, y: 40 }); c.node('pitch').listeners.pointerup(eventAt({ x: 107, y: 34 }));
  assert.equal(c.node('manual-apply').disabled, true);
  c.tick(.45); down({ x: 86.1, y: 40 }); assert.equal(c.node('manual-apply').disabled, false);
  c.node('manual-clear').listeners.click(); assert.equal(c.node('manual-apply').disabled, true);
});
