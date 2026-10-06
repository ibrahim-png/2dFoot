import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { FORMATION_IDS, DEFAULT_FORMATIONS, validFormations } from './backend/formations.js';
import { DEFAULT_SPEEDS, SPEED_LIMITS, validSpeeds } from './backend/speeds.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES = {
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/playback.js': ['playback.js', 'text/javascript'],
  '/pitch.js': ['pitch.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
  '/audio/stadium-ambience.mp3': ['audio/stadium-ambience.mp3', 'audio/mpeg'],
  '/audio/goal-cheer.mp3': ['audio/goal-cheer.mp3', 'audio/mpeg'],
  '/audio/danger-attack.mp3': ['audio/danger-attack.mp3', 'audio/mpeg'],
  '/audio/shot-roar.mp3': ['audio/shot-roar.mp3', 'audio/mpeg'],
  '/audio/ball-kick.mp3': ['audio/ball-kick.mp3', 'audio/mpeg'],
};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON gerekli.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024) throw new HttpError(413, 'İstek çok büyük.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON okunamadı.'); }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function validManualPlan(plan, team = 0) {
  const firstId = team * 11 + 1, lastId = firstId + 10;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some(key => !['owner', 'action', 'passTo', 'aim', 'power', 'curve', 'runs'].includes(key))
    || !Number.isInteger(plan.owner) || plan.owner < firstId || plan.owner > lastId || !['pass', 'shoot', 'dribble'].includes(plan.action)
    || plan.action === 'pass' && plan.passTo !== null && (!Number.isInteger(plan.passTo) || plan.passTo < firstId || plan.passTo > lastId || plan.passTo === plan.owner)
    || plan.action !== 'pass' && plan.passTo !== null
    || !plan.aim || typeof plan.aim !== 'object' || Array.isArray(plan.aim) || Object.keys(plan.aim).some(key => !['x', 'y'].includes(key))
    || !Number.isFinite(plan.aim.x) || plan.aim.x < -3 || plan.aim.x > 108 || !Number.isFinite(plan.aim.y) || plan.aim.y < -3 || plan.aim.y > 71
    || !Number.isFinite(plan.power) || plan.power < .3 || plan.power > 1
    || !Number.isFinite(plan.curve) || plan.curve < -1 || plan.curve > 1
    || !Array.isArray(plan.runs) || plan.runs.length > 11) return false;
  const ids = new Set();
  return plan.runs.every(run => run && typeof run === 'object' && !Array.isArray(run) && !Object.keys(run).some(key => !['id', 'x', 'y'].includes(key))
    && Number.isInteger(run.id) && run.id >= firstId && run.id <= lastId && !(plan.action === 'pass' && plan.passTo !== null && run.id === plan.passTo) && !ids.has(run.id) && ids.add(run.id)
    && Number.isFinite(run.x) && run.x >= 1 && run.x <= 104 && Number.isFinite(run.y) && run.y >= 1 && run.y <= 67);
}
function validFreeKickPlan(plan) {
  const point = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['x', 'y'].includes(key))
    && Number.isFinite(value.x) && value.x >= 1 && value.x <= 104 && Number.isFinite(value.y) && value.y >= 1 && value.y <= 67;
  const aim = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['x', 'y'].includes(key))
    && Number.isFinite(value.x) && value.x >= -3 && value.x <= 108 && Number.isFinite(value.y) && value.y >= -3 && value.y <= 71;
  return !!plan && typeof plan === 'object' && !Array.isArray(plan)
    && Object.keys(plan).every(key => ['owner', 'ball', 'wallCount', 'aim', 'power', 'curve', 'shotPower', 'curvePower'].includes(key))
    && Number.isInteger(plan.owner) && plan.owner >= 1 && plan.owner <= 11 && point(plan.ball)
    && Number.isInteger(plan.wallCount) && plan.wallCount >= 1 && plan.wallCount <= 6
    && aim(plan.aim) && Number.isFinite(plan.power) && plan.power >= .3 && plan.power <= 1
    && Number.isFinite(plan.curve) && plan.curve >= -1 && plan.curve <= 1
    && Number.isFinite(plan.shotPower) && plan.shotPower >= 20 && plan.shotPower <= 40
    && Number.isFinite(plan.curvePower) && plan.curvePower >= 20 && plan.curvePower <= 100;
}
const validDirection = direction => direction && typeof direction === 'object' && !Array.isArray(direction)
  && Object.keys(direction).every(key => ['x', 'y'].includes(key)) && Number.isFinite(direction.x) && Math.abs(direction.x) <= 1
  && Number.isFinite(direction.y) && Math.abs(direction.y) <= 1;
const validFreePlayers = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 2 && Object.keys(value).every(key => ['home', 'away'].includes(key))
  && Number.isInteger(value.home) && value.home >= 1 && value.home <= 11
  && Number.isInteger(value.away) && value.away >= 0 && value.away <= 11;

export function createApp() {
  const workers = new Set(), sessions = new Map(), rooms = new Map();
  const roomCode = () => {
    let code; do code = String(randomBytes(4).readUInt32LE() % 1000000).padStart(6, '0'); while (rooms.has(code)); return code;
  };
  const roomToken = () => randomBytes(18).toString('base64url');
  const sendRoom = (room, message) => {
    const line = JSON.stringify(message) + '\n';
    for (const client of [...room.clients]) if (!client.destroyed) client.write(line); else room.clients.delete(client);
  };
  const destroyRoom = room => {
    if (!room || room.destroyed) return; room.destroyed = true;
    rooms.delete(room.code); sessions.delete(room.matchId); workers.delete(room.worker);
    for (const client of room.clients) if (!client.destroyed) client.end();
    room.clients.clear(); void room.worker.terminate();
  };
  const createRoom = body => {
    const code = roomCode(), matchId = `online-${code}`, hostToken = roomToken(), seed = randomBytes(4).readUInt32LE();
    const worker = new Worker(new URL('./backend/worker.js', import.meta.url), { workerData: { seed, formations: body.formations ?? DEFAULT_FORMATIONS,
      mode: 'online', speeds: body.speeds ?? DEFAULT_SPEEDS, freePlayers: { home: 11, away: 11 } }, execArgv: [] });
    const room = { code, matchId, worker, mode: 'online', online: true, controlled: true, pending: false, ended: false, started: false,
      tokens: new Map([[hostToken, 0]]), clients: new Set(), ready: null, ownerTeam: 0, manualTeam: 0, destroyed: false };
    rooms.set(code, room); sessions.set(matchId, room); workers.add(worker);
    worker.on('message', message => {
      if (room.destroyed) return;
      if (message.type === 'ready') room.ready = { ...message, matchId, roomCode: code };
      if (message.type === 'frames') {
        room.pending = false;
        const last = message.frames?.at(-1); if (last?.owner) room.ownerTeam = last.owner <= 11 ? 0 : 1;
        const manual = [...(message.frames ?? [])].reverse().find(frame => frame.manualControl)?.manualControl;
        room.manualTeam = manual ? manual.team : null;
      }
      sendRoom(room, message.type === 'ready' ? room.ready : message);
      if (message.ended) { room.ended = true; for (const client of room.clients) if (!client.destroyed) client.end(); }
    });
    worker.once('error', () => { sendRoom(room, { type: 'error', error: 'Online maç hesaplanamadı.' }); destroyRoom(room); });
    return { room, hostToken };
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!req.headers.host || /[\r\n]/.test(req.headers.host)) throw new HttpError(403, 'Geçersiz sunucu adresi.');
      const sameOrigins = [`http://${req.headers.host}`, `https://${req.headers.host}`];
      if (req.method === 'POST' && !sameOrigins.includes(req.headers.origin)) throw new HttpError(403, 'Yalnızca uygulamanın kendi sayfasından istek gönderilebilir.');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { engine: 'local', formations: FORMATION_IDS, defaultFormations: DEFAULT_FORMATIONS,
        defaultSpeeds: DEFAULT_SPEEDS, speedLimits: SPEED_LIMITS, duration: 300, physicsHz: 40, decisionHz: 5, frameHz: 20 });
      if (req.method === 'POST' && url.pathname === '/api/online/rooms') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['formations', 'speeds'].includes(key))
          || body.formations !== undefined && !validFormations(body.formations) || body.speeds !== undefined && !validSpeeds(body.speeds)) throw new HttpError(400, 'Oda ayarları geçersiz.');
        if (workers.size >= 4) throw new HttpError(429, 'Açık maç sayısı sınırına ulaşıldı.');
        const { room, hostToken } = createRoom(body);
        return json(res, 201, { roomCode: room.code, playerToken: hostToken, team: 0, matchId: room.matchId });
      }
      if (req.method === 'POST' && url.pathname === '/api/online/join') {
        const body = await readJson(req), code = String(body?.roomCode ?? '').trim(), room = rooms.get(code);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'roomCode') || !/^\d{6}$/.test(code) || !room) throw new HttpError(404, 'Oda bulunamadı.');
        if ([...room.tokens.values()].includes(1)) throw new HttpError(409, 'Bu oda dolu.');
        const playerToken = roomToken(); room.tokens.set(playerToken, 1); room.joined = true;
        return json(res, 200, { roomCode: room.code, playerToken, team: 1, matchId: room.matchId });
      }
      if (req.method === 'POST' && url.pathname === '/api/online/stream') {
        const body = await readJson(req), code = String(body?.roomCode ?? '').trim(), room = rooms.get(code), team = room?.tokens.get(body?.playerToken);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['roomCode', 'playerToken'].includes(key)) || team === undefined) throw new HttpError(403, 'Oda bağlantısı geçersiz.');
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
        room.clients.add(res); res.once('close', () => room.clients.delete(res));
        if (room.ready) res.write(JSON.stringify({ ...room.ready, onlineTeam: team }) + '\n');
        if (team === 1 && room.joined && !room.started) { room.started = true; sendRoom(room, { type: 'room', status: 'ready', roomCode: room.code, teams: 2 }); }
        else res.write(JSON.stringify({ type: 'room', status: room.started ? 'ready' : 'waiting', roomCode: room.code, team }) + '\n');
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/match/control') {
        const body = await readJson(req), session = body && sessions.get(body.matchId);
        if (!body || typeof body !== 'object' || Array.isArray(body) || !['next', 'speeds', 'manualPlan', 'manualDrive', 'manualPause', 'freeKickPlan'].includes(body.action)
          || typeof body.matchId !== 'string' || !session) throw new HttpError(404, 'Kontrol edilecek maç bulunamadı.');
        const onlineTeam = session.online ? session.tokens.get(body.playerToken) : null;
        if (session.online && (onlineTeam === undefined || !session.started)) throw new HttpError(403, session.started ? 'Oda yetkisi geçersiz.' : 'Rakip henüz odaya katılmadı.');
        const tokenKey = session.online ? ['playerToken'] : [];
        const allowed = body.action === 'next' || body.action === 'manualPause' ? ['matchId', 'action', ...tokenKey] : body.action === 'speeds' ? ['matchId', 'action', 'speeds', ...tokenKey]
          : body.action === 'manualDrive' ? ['matchId', 'action', 'direction', ...tokenKey] : ['matchId', 'action', 'plan', ...tokenKey];
        if (Object.keys(body).some(key => !allowed.includes(key)) || body.action === 'speeds' && !validSpeeds(body.speeds)
          || body.action === 'manualPlan' && (!['manual', 'free', 'online'].includes(session.mode) || !validManualPlan(body.plan, session.online ? onlineTeam : 0))
          || body.action === 'manualDrive' && (!['manual', 'free', 'online'].includes(session.mode) || !validDirection(body.direction))
          || body.action === 'freeKickPlan' && (session.mode !== 'freeKick' || !validFreeKickPlan(body.plan))) throw new HttpError(400, 'Maç kontrolü geçersiz.');
        if (session.online && body.action === 'speeds' && onlineTeam !== 0) throw new HttpError(403, 'Hızları yalnızca oda sahibi değiştirebilir.');
        if (session.online && ['manualPlan', 'manualDrive'].includes(body.action) && onlineTeam !== (body.action === 'manualPlan' ? session.manualTeam : session.ownerTeam)) throw new HttpError(403, 'Sıra rakip takımda.');
        if (body.action === 'speeds') { session.worker.postMessage({ type: 'speeds', speeds: body.speeds }); return json(res, 200, { updated: true }); }
        if (body.action === 'manualPlan') {
          session.manualTeam = null; session.worker.postMessage({ type: 'manualPlan', plan: body.plan });
          if (session.online) sendRoom(session, { type: 'room', status: 'resume', roomCode: session.code, team: onlineTeam });
          return json(res, 200, { applied: true });
        }
        if (body.action === 'manualDrive') { session.worker.postMessage({ type: 'manualDrive', direction: body.direction }); return json(res, 200, { applied: true }); }
        if (body.action === 'freeKickPlan') { session.worker.postMessage({ type: 'freeKickPlan', plan: body.plan }); return json(res, 200, { applied: true }); }
        if (body.action === 'manualPause') {
          if (!['manual', 'free', 'online'].includes(session.mode)) throw new HttpError(400, 'Bu kontrol yalnızca manuel hücum modlarında kullanılabilir.');
          if (session.online && onlineTeam !== session.ownerTeam) throw new HttpError(403, 'Sıra rakip takımda.');
          session.worker.postMessage({ type: 'manualPause' }); return json(res, 200, { requested: true });
        }
        if (!session.pending && !session.ended) {
          session.pending = true; session.worker.postMessage({ type: 'next', seconds: ['manual', 'free', 'online'].includes(session.mode) ? .1 : .5 });
        }
        return json(res, 200, { requested: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/match') {
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['seed', 'formations', 'mode', 'speeds', 'controlled', 'freePlayers'].includes(k))) throw new HttpError(400, 'Maç isteği geçersiz.');
        if (body.mode !== undefined && !['normal', 'debug', 'manual', 'free', 'freeKick'].includes(body.mode)) throw new HttpError(400, 'Geçerli bir maç modu seçin.');
        if (body.freePlayers !== undefined && (body.mode !== 'free' || !validFreePlayers(body.freePlayers))) throw new HttpError(400, 'Free mod oyuncu sayıları geçersiz.');
        if (body.controlled !== undefined && typeof body.controlled !== 'boolean') throw new HttpError(400, 'Maç akış türü geçersiz.');
        if (body.speeds !== undefined && !validSpeeds(body.speeds)) throw new HttpError(400, 'Oyuncu hızları 3–9 m/sn arasında olmalı.');
        if (body.formations !== undefined && !validFormations(body.formations)) throw new HttpError(400, 'Her takım için geçerli bir diziliş seçin.');
        if (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff)) throw new HttpError(400, 'Tohum 0–4294967295 arasında bir tamsayı olmalı.');
        if (workers.size >= 4) throw new HttpError(429, 'Açık maç sayısı sınırına ulaşıldı. Diğer maç sekmelerini kapatın.');
        const seed = body.seed ?? randomBytes(4).readUInt32LE();
        const matchId = randomBytes(12).toString('hex'), controlled = body.controlled === true;
        const worker = new Worker(new URL('./backend/worker.js', import.meta.url), { workerData: { seed, formations: body.formations ?? DEFAULT_FORMATIONS,
          mode: body.mode ?? 'normal', speeds: body.speeds ?? DEFAULT_SPEEDS, freePlayers: body.freePlayers ?? { home: 6, away: 6 } }, execArgv: [] });
        workers.add(worker);
        const session = { worker, pending: false, ended: false, controlled, mode: body.mode ?? 'normal' }; sessions.set(matchId, session);
        const cleanup = () => { workers.delete(worker); sessions.delete(matchId); void worker.terminate(); };
        res.once('close', cleanup);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        // One worker batch in flight at a time. A slow viewer applies socket
        // backpressure, so we never build an unbounded full-match frame queue.
        worker.on('message', async message => {
          if (res.destroyed) return;
          if (message.type === 'frames') session.pending = false;
          const output = message.type === 'ready' ? { ...message, matchId } : message;
          try {
            if (!res.write(JSON.stringify(output) + '\n')) await new Promise(resolve => {
              const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
              res.once('drain', done); res.once('close', done);
            });
            if (message.ended) { session.ended = true; res.end(); cleanup(); }
            else if (!res.destroyed && !controlled) worker.postMessage('next');
          } catch { cleanup(); if (!res.destroyed) res.destroy(); }
        });
        worker.once('error', error => {
          console.error(`Maç worker hatası (${matchId}):`, error);
          if (!res.destroyed) res.end(JSON.stringify({ type: 'error', error: 'Maç hesaplanamadı. Yeni maç başlatın.' }) + '\n'); cleanup();
        });
        return;
      }
      if (req.method === 'GET' && Object.hasOwn(FILES, url.pathname)) {
        const [file, type] = FILES[url.pathname], content = await readFile(path.join(ROOT, 'public', file));
        res.writeHead(200, { 'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type }); return res.end(content);
      }
      json(res, 404, { error: 'Bulunamadı.' });
    } catch (error) { if (!res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'Sunucu hatası.' }); }
  });
  Object.defineProperty(server, 'activeSimulations', { get: () => workers.size });
  server.on('close', () => { for (const room of [...rooms.values()]) destroyRoom(room); for (const worker of workers) void worker.terminate(); workers.clear(); sessions.clear(); rooms.clear(); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), server = createApp();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} kullanımda.` : 'Sunucu başlatılamadı.'); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => console.log(`2D Football → http://localhost:${port}\nYerel/online maç motoru · Oda koduyla iki oyuncu · API anahtarı gerekmez`));
}
