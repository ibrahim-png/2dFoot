import { createMatch, advance } from './engine.js';
import { roleOf, phaseFor } from './tactics.js';
import { offsideLine } from './offside.js';

export const PHYSICS_STEP = .025, FRAME_STEP = .05, CHUNK_SECONDS = 2;
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
}
const round = n => Math.round(n * 1000) / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const FREE_KICK_WALL_DISTANCE = 9.15;
export function freeKickLayout(ball, wallCount) {
  const count = clamp(Math.round(wallCount), 1, 6), goalY = ball.y < 34 ? 30.34 : 37.66;
  const dx = 105 - ball.x, dy = goalY - ball.y, length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length, distance = Math.min(FREE_KICK_WALL_DISTANCE, Math.max(.75, length - .8));
  const wall = { x: ball.x + ux * distance, y: ball.y + uy * distance }, px = -uy, py = ux;
  const positions = Array.from({ length: count }, (_, index) => {
    const offset = (index - (count - 1) / 2) * 1.15;
    return { x: clamp(wall.x + px * offset, 1, 104), y: clamp(wall.y + py * offset, 1, 67) };
  });
  const halfSpan = (count - 1) * 1.15 / 2 + .52;
  const projectToGoal = point => Math.abs(point.x - ball.x) < .01 ? point.y
    : ball.y + (point.y - ball.y) * (105 - ball.x) / (point.x - ball.x);
  const projections = [
    projectToGoal({ x: wall.x + px * halfSpan, y: wall.y + py * halfSpan }),
    projectToGoal({ x: wall.x - px * halfSpan, y: wall.y - py * halfSpan }),
  ];
  const covered = { min: Math.min(...projections), max: Math.max(...projections) };
  const keeperY = ball.y < 34
    ? (clamp(covered.max, 30.34, 37.66) + 37.66) / 2
    : (30.34 + clamp(covered.min, 30.34, 37.66)) / 2;
  return { wall, positions, covered, keeper: { x: 103.2, y: clamp(keeperY, 30.8, 37.2) }, distance };
}
export function automaticFreeKickLift(ball, aim, wallCount) {
  const layout = freeKickLayout(ball, wallCount), dx = aim.x - ball.x, dy = aim.y - ball.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1) return .35;
  const length = Math.sqrt(lengthSquared);
  const blockers = layout.positions.map(position => {
    const t = clamp(((position.x - ball.x) * dx + (position.y - ball.y) * dy) / lengthSquared, 0, 1);
    const nearest = { x: ball.x + dx * t, y: ball.y + dy * t };
    return { t, distance: Math.hypot(position.x - nearest.x, position.y - nearest.y) };
  }).filter(hit => hit.t > .05 && hit.t < .8 && hit.distance < 1.55).sort((a, b) => a.t - b.t);
  let apex = blockers.length ? 2.12 / Math.max(.08, 4 * blockers[0].t * (1 - blockers[0].t)) : clamp(length * .055, 1.15, 2.1);
  if (aim.x > 105 && ball.x < 105) {
    const goalProgress = clamp((105 - ball.x) / (aim.x - ball.x), 0, 1), factor = 4 * goalProgress * (1 - goalProgress);
    if (factor > .02) apex = Math.min(apex, 2.3 / factor);
  }
  apex = clamp(apex, .75, 3.55);
  return clamp((apex - .6) / 3, .05, .983);
}
export function frameOf(game) {
  return {
    elapsed: round(game.elapsed), formations: [...game.formations], speedSettings: { ...game.speedSettings }, score: [...game.score], owner: game.owner, ended: game.ended,
    timing: { thinkInterval: .2, physicsStep: PHYSICS_STEP, frameStep: FRAME_STEP, touch: round(game.touch), restart: round(game.restart), setPiece: game.setPiece?.kind ?? null, hasPlan: game.hasPlan },
    offsides: [...game.offsides], offsideLine: structuredClone(game.offsidePhase ?? offsideLine(game, game.controlTeam)),
    ball: { x: round(game.ball.x), y: round(game.ball.y), z: round(game.ball.z ?? 0) }, flight: game.flight ? structuredClone(game.flight) : null,
    players: game.players.map(p => ({ id: p.id, number: p.number, team: p.team, keeper: p.keeper, active: p.active, injured: !!p.injured, yellows: p.yellows,
      card: p.card, cardUntil: round(p.cardUntil ?? 0),
      traits: { ...p.traits }, energy: round(p.energy ?? 1), lowEnergyTime: round(p.lowEnergyTime ?? 0),
      x: round(p.x), y: round(p.y), role: roleOf(p).code, roleName: roleOf(p).name,
      decision: p.decision ? { action: p.decision.action, reason: p.decision.reason, target: p.decision.target, carryMode: p.decision.carryMode ?? null,
        throughBall: !!p.decision.throughBall, leadDistance: round(p.decision.leadDistance || 0),
        x: round(p.decision.x), y: round(p.decision.y), report: structuredClone(p.decision.report) } : null,
      thoughts: p.thoughts })),
    passes: [...game.passes], shots: [...game.shots], longShots: [...game.longShots], saves: [...game.saves], tackles: [...game.tackles],
    possession: [...game.possession], fouls: [...game.fouls], yellowCards: [...game.yellowCards], redCards: [...game.redCards], injuries: [...game.injuries],
    phases: [phaseFor(game, 0), phaseFor(game, 1)], events: structuredClone(game.events), trails: structuredClone(game.trails),
    deadBallVersion: game.deadBallVersion, decisionCount: game.decisionCount,
  };
}
export class Simulation {
  constructor(seed, formations, mode = 'normal', speeds, freePlayers) {
    this.game = createMatch(seededRandom(seed), { autonomous: true, formations, debug: mode === 'debug', speeds });
    this.mode = mode; this.freeKick = mode === 'freeKick'; this.freeMode = mode === 'free'; this.online = mode === 'online'; this.manual = mode === 'manual' || this.online || this.freeMode || this.freeKick; this.sequence = 0; this.ticks = 0; this.checkpointId = 0; this.manualCheckpointId = 0; this.pending = [];
    this.freeKickTraining = null; this.freeKickShotActive = false; this.freeKickResetAt = null;
    this.freeTraining = null; this.freePlayers = null;
    if (this.freeMode) this.configureFreeTraining(freePlayers);
    this.awaitingManual = this.manual && this.game.owner && (this.online || this.game.players[this.game.owner - 1].team === 0) ? this.game.owner : null;
    if (this.game.debug) this.game.onBeforePass = trace => {
      const frame = frameOf(this.game);
      frame.debugPass = { id: ++this.checkpointId, ...structuredClone(trace) };
      this.pending.push(frame);
    };
  }
  readyFrame() {
    const frame = frameOf(this.game);
    if (this.awaitingManual) frame.manualControl = { id: ++this.manualCheckpointId, owner: this.awaitingManual, team: this.game.players[this.awaitingManual - 1].team, kind: this.freeKick ? 'freeKick' : this.freeMode ? 'free' : this.online ? 'online' : 'manual',
      setup: this.freeKickTraining ? structuredClone(this.freeKickTraining) : undefined };
    return frame;
  }
  configureFreeTraining(value = { home: 6, away: 6 }) {
    const homeCount = clamp(Math.round(value?.home ?? 6), 1, 11), awayCount = clamp(Math.round(value?.away ?? 6), 0, 11);
    const originalOwner = this.game.players[this.game.owner - 1];
    const home = this.game.players.filter(player => player.team === 0);
    const homeOrder = [originalOwner, ...home.filter(player => player !== originalOwner).sort((a, b) => Number(a.keeper) - Number(b.keeper) || b.x - a.x)];
    const awayOrder = this.game.players.filter(player => player.team === 1).sort((a, b) => Number(b.keeper) - Number(a.keeper) || b.x - a.x);
    const active = new Set([...homeOrder.slice(0, homeCount), ...awayOrder.slice(0, awayCount)].map(player => player.id));
    this.freePlayers = { home: homeCount, away: awayCount };
    this.freeTraining = { owner: originalOwner.id, players: this.game.players.map(player => ({ id: player.id, active: active.has(player.id), x: player.x, y: player.y,
      energy: player.energy, yellows: player.yellows })) };
    this.placeFreeTraining();
  }
  placeFreeTraining() {
    const setup = this.freeTraining; if (!setup) return;
    for (const state of setup.players) {
      const player = this.game.players[state.id - 1]; Object.assign(player, { active: state.active, injured: false, x: state.x, y: state.y, vx: 0, vy: 0,
        energy: state.energy, lowEnergyTime: 0, yellows: state.yellows, card: null, cardUntil: 0 });
    }
    const owner = this.game.players[setup.owner - 1]; this.game.owner = owner.id; this.game.ball = { x: owner.x, y: owner.y }; this.game.controlTeam = 0;
    this.game.flight = null; this.game.loose = false; this.game.looseVelocity = null; this.game.looseFrom = null; this.game.looseProtection = 0; this.game.looseExcluded = [];
    this.game.touch = .3; this.game.protection = .7; this.game.restart = 0; this.game.setPiece = null; this.game.contestLock = null;
    this.game.lastTouchTeam = 0; this.game.lastTouchId = owner.id; this.game.possessionSince = this.game.elapsed; this.game.offsidePhase = null; this.game.indirectKick = false;
    this.game.freeKickSetup = null; this.game.freeKickWallIds = []; this.game.freeKickFreezePlayers = false; this.game.manualPlan = null; this.game.hasPlan = false;
    this.game.trails = []; this.game.revision++; this.game.nextThink = 0;
  }
  repeatFreeAttack() {
    this.placeFreeTraining(); this.game.deadBallVersion++; this.awaitingManual = this.freeTraining.owner;
    const frame = frameOf(this.game); frame.manualControl = { id: ++this.manualCheckpointId, owner: this.awaitingManual, team: 0, kind: 'free', repeat: true };
    return frame;
  }
  applyManualPlan(plan) {
    if (!this.manual || !this.awaitingManual || plan?.owner !== this.awaitingManual) throw new Error('Manuel plan geçersiz.');
    const owner = this.game.players[plan.owner - 1];
    if (!owner?.active || !this.online && owner.team !== 0 || !['pass', 'shoot', 'dribble'].includes(plan.action) || !Number.isFinite(plan.aim?.x) || !Number.isFinite(plan.aim?.y)
      || !Number.isFinite(plan.power) || plan.power < .3 || plan.power > 1 || !Number.isFinite(plan.curve) || plan.curve < -1 || plan.curve > 1) throw new Error('Manuel vuruş geçersiz.');
    const seen = new Set(), runs = [];
    for (const run of plan.runs ?? []) {
      const p = this.game.players[run.id - 1];
      if (!p?.active || p.team !== owner.team || plan.action === 'pass' && plan.passTo !== null && p.id === plan.passTo || seen.has(p.id) || !Number.isFinite(run.x) || !Number.isFinite(run.y)) continue;
      seen.add(p.id); runs.push({ id: p.id, x: Math.max(1, Math.min(104, run.x)), y: Math.max(1, Math.min(67, run.y)) });
    }
    const aim = { x: Math.max(-3, Math.min(108, plan.aim.x)), y: Math.max(-3, Math.min(71, plan.aim.y)) };
    let passTo = null;
    if (plan.action === 'pass' && plan.passTo !== null) {
      const recipient = this.game.players[plan.passTo - 1];
      if (!recipient?.active || recipient.team !== owner.team || recipient.id === owner.id) throw new Error('Manuel pas alıcısı geçersiz.');
      passTo = recipient.id;
    }
    this.game.manualPlan = { owner: owner.id, action: plan.action, aim, passTo, power: Math.max(.3, Math.min(1, plan.power)), curve: Math.max(-1, Math.min(1, plan.curve)), runs };
    this.game.revision++; this.game.nextThink = 0; this.game.hasPlan = false; this.awaitingManual = null;
  }
  steerManual(direction) {
    const owner = this.game.owner && this.game.players[this.game.owner - 1], plan = this.game.manualPlan;
    if (!['manual', 'free', 'online'].includes(this.mode) || this.awaitingManual || !owner?.active || !this.online && owner.team !== 0 || plan?.owner !== owner.id || plan.action !== 'dribble') return false;
    const magnitude = Math.hypot(direction.x, direction.y), dx = magnitude ? direction.x / magnitude : 0, dy = magnitude ? direction.y / magnitude : 0;
    plan.aim = { x: clamp(owner.x + dx * 28, 1, 104), y: clamp(owner.y + dy * 28, 1, 67) };
    this.game.revision++; this.game.nextThink = 0; this.game.hasPlan = false; return true;
  }
  applyFreeKickPlan(plan) {
    if (!this.freeKick || !this.awaitingManual || plan?.owner !== this.awaitingManual) throw new Error('Serbest vuruş planı geçersiz.');
    const taker = this.game.players[plan.owner - 1];
    if (!taker?.active || taker.team !== 0 || !Number.isFinite(plan.ball?.x) || !Number.isFinite(plan.ball?.y)
      || !Number.isInteger(plan.wallCount) || plan.wallCount < 1 || plan.wallCount > 6
      || !Number.isFinite(plan.aim?.x) || !Number.isFinite(plan.aim?.y) || !Number.isFinite(plan.power) || plan.power < .3 || plan.power > 1
      || !Number.isFinite(plan.curve) || plan.curve < -1 || plan.curve > 1
      || !Number.isFinite(plan.shotPower) || plan.shotPower < 20 || plan.shotPower > 40
      || !Number.isFinite(plan.curvePower) || plan.curvePower < 20 || plan.curvePower > 100) throw new Error('Serbest vuruş planı geçersiz.');
    const ball = { x: clamp(plan.ball.x, 1, 104), y: clamp(plan.ball.y, 1, 67) };
    this.freeKickTraining = { owner: taker.id, ball, wallCount: plan.wallCount, shotPower: plan.shotPower, curvePower: plan.curvePower };
    this.placeFreeKickTraining();
    const aim = { x: clamp(plan.aim.x, -3, 108), y: clamp(plan.aim.y, -3, 71) };
    this.game.manualPlan = { owner: taker.id, action: 'shoot', aim, passTo: null,
      power: clamp(plan.power, .3, 1), curve: clamp(plan.curve, -1, 1), curveSkill: clamp(plan.curvePower / 100, .2, 1),
      lift: automaticFreeKickLift(ball, aim, plan.wallCount), runs: [] };
    this.game.revision++; this.game.nextThink = 0; this.game.hasPlan = false; this.awaitingManual = null; this.freeKickShotActive = false; this.freeKickResetAt = null;
  }
  placeFreeKickTraining() {
    const setup = this.freeKickTraining; if (!setup) return;
    const taker = this.game.players[setup.owner - 1], keeper = this.game.players.find(p => p.team === 1 && p.keeper);
    const defenders = this.game.players.filter(p => p.team === 1 && !p.keeper).slice(0, setup.wallCount), layout = freeKickLayout(setup.ball, setup.wallCount);
    defenders.forEach((p, index) => { Object.assign(p, layout.positions[index]); p.vx = p.vy = 0; });
    if (keeper) { Object.assign(keeper, layout.keeper); keeper.vx = keeper.vy = 0; }
    const participants = new Set([taker.id, keeper?.id, ...defenders.map(p => p.id)]);
    for (const p of this.game.players) { p.active = participants.has(p.id); p.injured = false; p.vx = p.vy = 0; }
    taker.traits.shotPower = setup.shotPower; taker.traits.curvePower = setup.curvePower;
    Object.assign(taker, setup.ball); this.game.owner = taker.id; this.game.ball = { ...setup.ball }; this.game.controlTeam = 0;
    this.game.flight = null; this.game.loose = false; this.game.looseVelocity = null; this.game.looseFrom = null; this.game.looseProtection = 0; this.game.looseExcluded = [];
    this.game.freeKickFreezePlayers = false;
    this.game.setPiece = { kind: 'freeKick', taker: taker.id }; this.game.restart = 0; this.game.touch = 0; this.game.protection = .5;
    this.game.offsidePhase = null; this.game.indirectKick = false; this.game.freeKickWallIds = defenders.map(p => p.id);
    this.game.freeKickSetup = { ball: { ...setup.ball }, wall: { ...layout.wall }, wallCount: setup.wallCount, keeper: { ...layout.keeper } };
    this.game.manualPlan = null; this.game.hasPlan = false; this.game.nextThink = 0;
  }
  repeatFreeKick() {
    this.placeFreeKickTraining(); this.game.deadBallVersion++; this.game.revision++; this.awaitingManual = this.freeKickTraining.owner; this.freeKickShotActive = false; this.freeKickResetAt = null;
    const frame = frameOf(this.game);
    frame.manualControl = { id: ++this.manualCheckpointId, owner: this.awaitingManual, team: 0, kind: 'freeKick', repeat: true, setup: structuredClone(this.freeKickTraining) };
    return frame;
  }
  pauseManual() {
    const owner = this.game.owner && this.game.players[this.game.owner - 1];
    if (!this.manual || this.awaitingManual || !owner?.active || !this.online && owner.team !== 0) {
      return { type: 'frames', sequence: this.sequence++, segment: this.game.deadBallVersion, boundary: false, manualBoundary: !!this.awaitingManual, manualRequested: false, frames: [], ended: this.game.ended };
    }
    this.awaitingManual = owner.id; this.game.manualPlan = null; this.game.hasPlan = false; this.game.nextThink = 0;
    const frame = frameOf(this.game); frame.manualControl = { id: ++this.manualCheckpointId, owner: owner.id, team: owner.team, kind: this.freeMode ? 'free' : this.online ? 'online' : 'manual', requested: true };
    return { type: 'frames', sequence: this.sequence++, segment: this.game.deadBallVersion, boundary: false, manualBoundary: true, manualRequested: true, frames: [frame], ended: this.game.ended };
  }
  next(seconds = CHUNK_SECONDS) {
    const frames = [], start = this.game.elapsed, segment = this.game.deadBallVersion;
    if (this.awaitingManual) return { type: 'frames', sequence: this.sequence++, segment, boundary: false, manualBoundary: true, frames, ended: false };
    while (!this.game.ended && this.game.elapsed - start < seconds - .000001) {
      const previousDecisions = this.game.decisionCount, previousOwner = this.game.owner, previousEventSerial = this.game.eventSerial;
      advance(this.game, PHYSICS_STEP); this.ticks++;
      frames.push(...this.pending.splice(0));
      if (this.freeKick && this.freeKickResetAt !== null) {
        if (this.game.elapsed + .000001 >= this.freeKickResetAt) {
          const frame = this.repeatFreeKick();
          if (frames.at(-1)?.elapsed === frame.elapsed) frames[frames.length - 1] = frame; else frames.push(frame);
          break;
        }
        if (this.ticks % 2 === 0 && frames.at(-1)?.elapsed !== round(this.game.elapsed)) frames.push(frameOf(this.game));
        continue;
      }
      if (this.freeKick && this.game.flight?.kind === 'shot' && this.game.flight.reason === 'manual-shot') this.freeKickShotActive = true;
      // Landing or a parry transfers the shot to loose-ball physics. The
      // attempt is still live until possession, a boundary, or a full stop.
      const movingLooseBall = this.game.loose && this.game.looseVelocity && !this.game.owner;
      if (this.freeKick && this.freeKickShotActive && !this.game.ended && !this.game.flight && !movingLooseBall) {
        const save = this.game.events.find(event => event.serial > previousEventSerial && event.type === 'save');
        if (save) {
          this.freeKickShotActive = false; this.freeKickResetAt = this.game.elapsed + 1.5; this.game.restart = Math.max(this.game.restart, 1.5);
          this.game.flight = null; this.game.freeKickFreezePlayers = true;
          this.game.loose = false; this.game.looseVelocity = null;
        } else {
          const frame = this.repeatFreeKick();
          if (frames.at(-1)?.elapsed === frame.elapsed) frames[frames.length - 1] = frame; else frames.push(frame);
          break;
        }
      }
      const boundary = this.game.deadBallVersion !== segment;
      if (this.freeMode && (boundary || this.game.owner && this.game.players[this.game.owner - 1].team === 1)) {
        const frame = this.repeatFreeAttack();
        if (frames.at(-1)?.elapsed === frame.elapsed) frames[frames.length - 1] = frame; else frames.push(frame);
        break;
      }
      const manualOwner = this.manual && this.game.owner !== previousOwner && this.game.owner && (this.online || this.game.players[this.game.owner - 1].team === 0) ? this.game.owner : null;
      if (manualOwner) {
        this.awaitingManual = manualOwner; const frame = frameOf(this.game), team = this.game.players[manualOwner - 1].team;
        frame.manualControl = { id: ++this.manualCheckpointId, owner: manualOwner, team, kind: this.freeMode ? 'free' : this.online ? 'online' : 'manual' };
        if (frames.at(-1)?.elapsed === frame.elapsed) frames[frames.length - 1] = frame; else frames.push(frame);
        break;
      }
      if ((this.ticks % 2 === 0 || boundary || this.game.ended || previousDecisions !== this.game.decisionCount) && frames.at(-1)?.elapsed !== round(this.game.elapsed)) frames.push(frameOf(this.game));
      if (boundary) break;
    }
    return { type: 'frames', sequence: this.sequence++, segment, boundary: this.game.deadBallVersion !== segment, manualBoundary: !!this.awaitingManual, frames, ended: this.game.ended };
  }
}
