const freeKickLayout = (ball, wallCount) => {
  if (!ball) return { wall: null, positions: [], keeper: { x: 103.2, y: 34 } };
  const count = Math.max(1, Math.min(6, Math.round(wallCount))), goalY = ball.y < 34 ? 30.34 : 37.66;
  const dx = 105 - ball.x, dy = goalY - ball.y, length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
  const distance = Math.min(9.15, Math.max(.75, length - .8)), wall = { x: ball.x + ux * distance, y: ball.y + uy * distance }, px = -uy, py = ux;
  const positions = Array.from({ length: count }, (_, index) => {
    const offset = (index - (count - 1) / 2) * 1.15;
    return { x: Math.max(1, Math.min(104, wall.x + px * offset)), y: Math.max(1, Math.min(67, wall.y + py * offset)) };
  });
  const halfSpan = (count - 1) * 1.15 / 2 + .52;
  const project = point => Math.abs(point.x - ball.x) < .01 ? point.y : ball.y + (point.y - ball.y) * (105 - ball.x) / (point.x - ball.x);
  const projections = [project({ x: wall.x + px * halfSpan, y: wall.y + py * halfSpan }), project({ x: wall.x - px * halfSpan, y: wall.y - py * halfSpan })];
  const keeperY = ball.y < 34 ? (Math.max(30.34, Math.min(37.66, Math.max(...projections))) + 37.66) / 2
    : (30.34 + Math.max(30.34, Math.min(37.66, Math.min(...projections)))) / 2;
  return { wall, positions, keeper: { x: 103.2, y: Math.max(30.8, Math.min(37.2, keeperY)) } };
};

// Shared by drawing and pointer input so zooming never shifts a shot's target.
export function pitchCamera(width, height, halfPitch = false) {
  const scale = halfPitch ? Math.min(width / 76, height / 60) : Math.min(width / 117, height / 80);
  const centerX = halfPitch ? 80.5 : 52.5;
  return {
    scale, centerX, rotation: halfPitch ? -Math.PI / 2 : 0,
    toField(x, y) {
      const dx = (x - width / 2) / scale, dy = (y - height / 2) / scale;
      return halfPitch ? { x: centerX - dy, y: 34 + dx } : { x: centerX + dx, y: 34 + dy };
    },
  };
}

export function createPitch(canvas) {
  const ctx = canvas.getContext('2d'); let width = 1, height = 1;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // CSS rotation changes the screen bounds, not the canvas drawing axes.
    width = canvas.clientWidth; height = canvas.clientHeight; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  new ResizeObserver(resize).observe(canvas); resize();
  return (game, showPaths = true, manualDraft = null, halfPitch = false) => {
    const camera = pitchCamera(width, height, halfPitch), s = camera.scale;
    ctx.clearRect(0, 0, width, height); ctx.save();
    ctx.translate(width / 2, height / 2); ctx.rotate(camera.rotation); ctx.scale(s, s); ctx.translate(-camera.centerX, -34);
    if (halfPitch) { ctx.beginPath(); ctx.rect(52.5, -4, 58, 76); ctx.clip(); }
    const label = (text, x, y) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(-camera.rotation); ctx.fillText(text, 0, 0); ctx.restore();
    };
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const circle = (x, y, r, fill = false) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke(); };
    const arrow = (from, to, color, dashed = false) => {
      const angle = Math.atan2(to.y - from.y, to.x - from.x), head = 1.7;
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = .5; ctx.setLineDash(dashed ? [1.2, .75] : []);
      line(from.x, from.y, to.x, to.y); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - Math.cos(angle - .48) * head, to.y - Math.sin(angle - .48) * head);
      ctx.lineTo(to.x - Math.cos(angle + .48) * head, to.y - Math.sin(angle + .48) * head); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    const curvedArrow = (from, to, color, curve = 0) => {
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
      const bow = curve * Math.min(9, length * .22), cx = (from.x + to.x) / 2 - dy / length * bow, cy = (from.y + to.y) / 2 + dx / length * bow;
      const angle = Math.atan2(to.y - cy, to.x - cx), head = 1.8;
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = .58;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo(cx, cy, to.x, to.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - Math.cos(angle - .48) * head, to.y - Math.sin(angle - .48) * head);
      ctx.lineTo(to.x - Math.cos(angle + .48) * head, to.y - Math.sin(angle + .48) * head); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#224432' : '#203f2f'; ctx.fillRect(i * 10.5, 0, 10.5, 68); }
    ctx.strokeStyle = '#b3c8b866'; ctx.lineWidth = .19;
    ctx.strokeRect(0, 0, 105, 68); line(52.5, 0, 52.5, 68); circle(52.5, 34, 9.15);
    ctx.fillStyle = '#b9c9b980'; circle(52.5, 34, .32, true);
    ctx.strokeRect(0, 13.84, 16.5, 40.32); ctx.strokeRect(88.5, 13.84, 16.5, 40.32);
    ctx.strokeRect(0, 24.84, 5.5, 18.32); ctx.strokeRect(99.5, 24.84, 5.5, 18.32);
    circle(11, 34, .27, true); circle(94, 34, .27, true);
    ctx.beginPath(); ctx.arc(11, 34, 9.15, -.927, .927); ctx.stroke();
    ctx.beginPath(); ctx.arc(94, 34, 9.15, Math.PI - .927, Math.PI + .927); ctx.stroke();
    ctx.strokeStyle = '#aec8b28c'; ctx.strokeRect(-2.4, 30.34, 2.4, 7.32); ctx.strokeRect(105, 30.34, 2.4, 7.32);
    ctx.strokeStyle = '#a9c2ab25'; ctx.lineWidth = .12;
    for (let y = 30.8; y < 37.7; y += .7) { line(-2.4, y, 0, y); line(105, y, 107.4, y); }
    for (let x = .5; x < 2.4; x += .6) { line(-x, 30.34, -x, 37.66); line(105 + x, 30.34, 105 + x, 37.66); }
    if (game.offsideLine) {
      ctx.save(); ctx.strokeStyle = game.offsideLine.team ? '#fb987e66' : '#d0eb9966'; ctx.lineWidth = .24;
      ctx.setLineDash([1.1, .85]); line(game.offsideLine.x, 0, game.offsideLine.x, 68); ctx.restore();
    }
    if (game.debugPass && game.owner === game.debugPass.from) {
      ctx.save(); ctx.strokeStyle = '#e9edb980'; ctx.lineWidth = .3; ctx.setLineDash([.5, .8]);
      line(game.ball.x, game.ball.y, game.debugPass.aim.x, game.debugPass.aim.y); ctx.restore();
    }
    if (showPaths) {
      game.trails.forEach((trail, i) => { ctx.globalAlpha = .1 + i * .075; ctx.strokeStyle = trail.team ? '#fb987e' : '#c5f36b'; ctx.lineWidth = .25; ctx.setLineDash([.8, 1]); line(trail.from.x, trail.from.y, trail.to.x, trail.to.y); });
      ctx.globalAlpha = .6;
      if (game.flight) { ctx.strokeStyle = game.flight.kind === 'shot' ? '#fff4b7' : '#e2ebd2'; ctx.setLineDash([.8, 1]); line(game.flight.start.x, game.flight.start.y, game.flight.aim.x, game.flight.aim.y); }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    const planningFreeKick = manualDraft?.kind === 'freeKick', freeKick = planningFreeKick ? freeKickLayout(manualDraft.ball, manualDraft.wallCount) : null;
    if (manualDraft) {
      if (manualDraft.kind === 'freeKick' && manualDraft.ball) {
        ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = .28; circle(manualDraft.ball.x, manualDraft.ball.y, .82, true); circle(manualDraft.ball.x, manualDraft.ball.y, 1.25); ctx.restore();
        const dx = 105 - manualDraft.ball.x, dy = 34 - manualDraft.ball.y, length = Math.hypot(dx, dy) || 1;
        const kicker = { x: manualDraft.ball.x - dx / length * 2.45, y: manualDraft.ball.y - dy / length * 2.45 };
        const owner = game.players.find(p => p.id === manualDraft.owner);
        ctx.save(); ctx.fillStyle = '#c5f36b'; ctx.strokeStyle = '#e7ffad'; ctx.lineWidth = .18; circle(kicker.x, kicker.y, 1.45, true); circle(kicker.x, kicker.y, 1.45);
        ctx.fillStyle = '#193020'; ctx.font = 'bold 1.4px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; label(owner?.number ?? '', kicker.x, kicker.y + .04); ctx.restore();
      }
      if (manualDraft.kind === 'freeKick' && manualDraft.ball) {
        ctx.save(); ctx.strokeStyle = '#ffe28a70'; ctx.lineWidth = .18; ctx.setLineDash([.5, .45]); line(manualDraft.ball.x, manualDraft.ball.y, freeKick.wall.x, freeKick.wall.y); ctx.restore();
        for (const position of freeKick.positions) {
          ctx.save(); ctx.fillStyle = '#fb987e'; ctx.strokeStyle = '#ffe0d1'; ctx.lineWidth = .18; circle(position.x, position.y, 1.45, true); circle(position.x, position.y, 1.45); ctx.restore();
        }
      }
      if (manualDraft.kind === 'freeKick') {
        const keeper = freeKick.keeper, keeperPlayer = game.players.find(p => p.team === 1 && p.keeper);
        ctx.save(); ctx.fillStyle = '#bbabfa'; ctx.strokeStyle = '#ffd3bd'; ctx.lineWidth = .18; circle(keeper.x, keeper.y, 1.45, true); circle(keeper.x, keeper.y, 1.45);
        ctx.fillStyle = '#193020'; ctx.font = 'bold 1.4px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; label(keeperPlayer?.number ?? '1', keeper.x, keeper.y + .04); ctx.restore();
      }
      for (const run of manualDraft.runs ?? []) {
        const source = game.players.find(p => p.id === run.id); if (source) arrow(source, run, '#79cff2', true);
      }
      const owner = game.players.find(p => p.id === manualDraft.owner);
      const kickSource = manualDraft.kind === 'freeKick' ? manualDraft.ball : owner;
      if (kickSource && manualDraft.aim) {
        if (manualDraft.action === 'dribble') arrow(kickSource, manualDraft.aim, '#79cff2', true);
        else curvedArrow(kickSource, manualDraft.aim, manualDraft.action === 'shoot' ? '#ff9d77' : '#fff0a8', manualDraft.curve);
        if (manualDraft.kind === 'freeKick') {
          ctx.save(); ctx.fillStyle = '#fff4b7'; ctx.font = 'bold 1.15px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
          label('yükseklik otomatik', (kickSource.x + manualDraft.aim.x) / 2, (kickSource.y + manualDraft.aim.y) / 2 - 1.2); ctx.restore();
        }
      }
      if (manualDraft.powerMeter) {
        const meter = manualDraft.powerMeter, value = Math.max(.3, Math.min(1, manualDraft.power ?? .3));
        const fillHeight = meter.height * value, percent = Math.round(value * 100);
        ctx.save();
        ctx.fillStyle = '#08110fee'; ctx.strokeStyle = manualDraft.powerLocked ? '#c5f36b' : '#dbe8df'; ctx.lineWidth = .22;
        ctx.beginPath(); ctx.roundRect?.(meter.x, meter.y, meter.width, meter.height, .35); ctx.fill(); ctx.stroke();
        if (!ctx.roundRect) { ctx.fillRect(meter.x, meter.y, meter.width, meter.height); ctx.strokeRect(meter.x, meter.y, meter.width, meter.height); }
        const gradient = ctx.createLinearGradient(0, meter.y + meter.height, 0, meter.y);
        gradient.addColorStop(0, '#b64b45'); gradient.addColorStop(.52, '#ddb94c'); gradient.addColorStop(1, '#80c95e');
        ctx.fillStyle = gradient; ctx.fillRect(meter.x + .22, meter.y + meter.height - fillHeight + .18, meter.width - .44, Math.max(0, fillHeight - .36));
        ctx.fillStyle = '#fff'; ctx.fillRect(meter.x - .18, meter.y + meter.height - fillHeight - .12, meter.width + .36, .24);
        ctx.font = 'bold 1.05px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`%${percent}`, meter.x + meter.width / 2, meter.y - .38);
        if (manualDraft.powerLocked) { ctx.fillStyle = '#c5f36b'; ctx.textBaseline = 'top'; ctx.fillText('✓', meter.x + meter.width / 2, meter.y + meter.height + .35); }
        ctx.restore();
      }
      const receiver = game.players.find(p => p.id === manualDraft.passTo);
      if (receiver) { ctx.save(); ctx.strokeStyle = '#fff0a8'; ctx.lineWidth = .35; ctx.setLineDash([.6, .45]); circle(receiver.x, receiver.y, 2.25); ctx.restore(); }
      if (manualDraft.preview) {
        const source = manualDraft.kind === 'freeKick' ? manualDraft.ball : game.players.find(p => p.id === manualDraft.preview.id);
        if (source && manualDraft.preview.kind === 'kick') curvedArrow(source, manualDraft.preview, manualDraft.action === 'shoot' ? '#ff9d7799' : '#fff0a899', manualDraft.curve);
        else if (manualDraft.preview.kind === 'curve') {
          ctx.save(); ctx.strokeStyle = '#fff0a899'; ctx.fillStyle = '#fff0a8'; ctx.lineWidth = .18; ctx.setLineDash([.4, .35]);
          circle(manualDraft.preview.x, manualDraft.preview.y, .72); circle(manualDraft.preview.x, manualDraft.preview.y, .23, true); ctx.restore();
        }
        else if (source) arrow(source, manualDraft.preview, '#79cff299', true);
      }
    }
    for (const p of game.players) {
      if (planningFreeKick) continue;
      const showingRed = p.card === 'red' && game.elapsed <= p.cardUntil;
      if (!p.active && !p.injured && !showingRed) continue;
      const color = p.team ? '#fb987e' : '#c5f36b';
      if (!p.active) ctx.globalAlpha = .48;
      if (p.id === game.owner) { ctx.fillStyle = p.team ? '#fb987e22' : '#c5f36b22'; circle(p.x, p.y, 3.2, true); ctx.strokeStyle = color; ctx.lineWidth = .17; circle(p.x, p.y, 2.6); }
      ctx.fillStyle = '#081a1880'; circle(p.x + .18, p.y + .4, 1.5, true);
      ctx.fillStyle = p.keeper ? p.team ? '#bbabfa' : '#79cff2' : color; circle(p.x, p.y, 1.45, true);
      ctx.strokeStyle = p.team ? '#ffd3bd' : '#e7ffad'; ctx.lineWidth = .15; circle(p.x, p.y, 1.45);
      ctx.fillStyle = '#193020'; ctx.font = 'bold 1.4px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; label(p.number, p.x, p.y + .04);
      ctx.globalAlpha = 1;
      if (p.card === 'yellow' || showingRed) {
        ctx.save(); ctx.translate(p.x, p.y - 3.25); ctx.rotate(-.1);
        ctx.fillStyle = p.card === 'red' ? '#f04646' : '#ffdf55'; ctx.fillRect(-.55, -.8, 1.1, 1.6);
        ctx.strokeStyle = '#18201d'; ctx.lineWidth = .13; ctx.strokeRect(-.55, -.8, 1.1, 1.6); ctx.restore();
      }
      if (p.injured) {
        ctx.save(); ctx.strokeStyle = '#ff4d55'; ctx.lineWidth = .55;
        line(p.x - 1, p.y - 3.1, p.x + 1, p.y - 3.1); line(p.x, p.y - 4.1, p.x, p.y - 2.1); ctx.restore();
      }
    }
    if (!planningFreeKick) {
      const holder = game.owner ? game.players[game.owner - 1] : null;
      const bx = game.ball.x + (holder ? holder.team ? -1.65 : 1.65 : 0), groundY = game.ball.y + (holder ? .7 : 0), z = game.ball.z ?? 0;
      const by = groundY - Math.min(5.6, z * .7), radius = .64 + Math.min(1.05, z * .18);
      ctx.fillStyle = '#081a1880'; circle(bx + .15, groundY + .25, .69, true);
      ctx.fillStyle = '#fff'; circle(bx, by, radius, true); ctx.fillStyle = '#45504b'; circle(bx, by, .22, true);
      if (z > .15) { ctx.fillStyle = '#fff4b7'; ctx.font = 'bold 1.05px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; label(`${z.toFixed(1)} m`, bx, by - 1.25); }
    }
    ctx.restore();
  };
}
