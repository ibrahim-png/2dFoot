// Display-only interpolation. No football rules, decisions or physics here.
export class Playback {
  constructor() { this.frames = []; this.time = 0; this.lastSequence = -1; this.complete = false; }
  reset(frame) { this.frames = [frame]; this.time = frame.elapsed; this.lastSequence = -1; this.complete = false; this.debugPause = null; this.released = 0;
    this.manualPause = frame.manualControl ? frame : null; this.releasedManual = 0; }
  releaseDebug() { if (this.debugPause) { this.released = this.debugPause.debugPass.id; this.debugPause = null; } }
  releaseManual() { if (this.manualPause) { this.releasedManual = this.manualPause.manualControl.id; this.manualPause = null; } }
  append(message) {
    if (message.sequence !== this.lastSequence + 1) throw new Error('Maç görüntüsü sırasında kopukluk oluştu. Yeni maç başlatın.');
    this.lastSequence = message.sequence;
    for (const frame of message.frames) {
      if (frame.elapsed < this.frames.at(-1).elapsed) throw new Error('Maç zaman sırası geçersiz.');
      if (frame.elapsed === this.frames.at(-1).elapsed && frame.manualControl) { this.frames[this.frames.length - 1] = frame; continue; }
      if (frame.elapsed === this.frames.at(-1).elapsed) throw new Error('Maç zaman sırası geçersiz.');
      for (const p of frame.players ?? []) if (p.decision && !Object.hasOwn(p.decision, 'report')) {
        const previous = this.frames.at(-1).players.find(q => q.id === p.id);
        p.decision = { ...p.decision, report: previous?.decision?.report };
      }
      this.frames.push(frame);
    }
    this.complete = message.ended;
  }
  get buffered() { return Math.max(0, (this.frames.at(-1)?.elapsed ?? 0) - this.time); }
  get hasManualCheckpoint() { return this.frames.some(frame => frame.manualControl?.id > (this.releasedManual ?? 0)); }
  advance(seconds, until = Infinity, decisionStop = null) {
    if (!this.frames.length) return null;
    if (this.debugPause) return this.debugPause; if (this.manualPause) return this.manualPause;
    let nextTime = Math.min(this.time + Math.max(0, seconds), this.frames.at(-1).elapsed, until);
    const decisionFrame = decisionStop && this.frames.find(f => f.elapsed <= nextTime + .000001 && f.players.some(p => p.id === decisionStop.id && p.thoughts > decisionStop.thoughts));
    if (decisionFrame) nextTime = decisionFrame.elapsed;
    const checkpoint = this.frames.find(f => f.elapsed <= nextTime + .000001 && f.debugPass?.id > (this.released ?? 0));
    const manual = this.frames.find(f => f.elapsed <= nextTime + .000001 && f.manualControl?.id > (this.releasedManual ?? 0));
    const stop = [checkpoint, manual].filter(Boolean).sort((a, b) => a.elapsed - b.elapsed)[0];
    this.time = stop ? stop.elapsed : nextTime;
    while (this.frames.length > 1 && this.frames[1].elapsed <= this.time + .000001) this.frames.shift();
    this.debugPause = stop?.debugPass ? stop : null; this.manualPause = stop?.manualControl ? stop : null;
    return this.view();
  }
  view() {
    if (this.debugPause) return this.debugPause; if (this.manualPause) return this.manualPause;
    const a = this.frames[0], b = this.frames[1]; if (!a || !b || a.deadBallVersion !== b.deadBallVersion) return a;
    const t = Math.max(0, Math.min(1, (this.time - a.elapsed) / (b.elapsed - a.elapsed)));
    const point = (p, q) => ({ ...p, x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t,
      ...(Number.isFinite(p.z) && Number.isFinite(q.z) ? { z: p.z + (q.z - p.z) * t } : {}) });
    return { ...a, elapsed: this.time, players: a.players.map((p, i) => p.active === b.players[i].active ? point(p, b.players[i]) : p),
      ball: a.owner === b.owner ? point(a.ball, b.ball) : a.ball };
  }
}

export async function readMatch(response, onMessage, waitForRoom = async () => {}) {
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Yerel sunucuya ulaşılamadı.'); }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', ended = false;
  try {
    while (true) {
      await waitForRoom();
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        await waitForRoom();
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
        const message = JSON.parse(line); if (message.type === 'error') throw new Error(message.error);
        onMessage(message); if (message.ended) ended = true;
      }
    }
    if (buffer.trim() || !ended) throw new Error('Maç akışı tamamlanmadan bağlantı kesildi. Yeni maç başlatın.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
