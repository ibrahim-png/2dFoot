import { roleOf, localPoint, worldPoint, tacticalTargets, chooseAction, chooseDecision, shootingWindow, phaseFor, activePlayers, ballSecurity } from './tactics.js';
import { think } from './players.js';
import { FORMATIONS, formationPair } from './formations.js';
import { captureOffside, offsideParticipant } from './offside.js';
import { speedSettings } from './speeds.js';
import { playerTraits } from './traits.js';
export { phaseFor, roleOf } from './tactics.js';
export const DURATION = 300;
export const LOW_ENERGY_THRESHOLD = .60;
export const INJURY_EXPOSURE_SECONDS = 12;
export const TEAM_NAMES = ['Lime FC', 'Coral United'];
const BALL_GRAVITY = 9.81, BALL_RESTITUTION = .48;
export const teamOf = id => id <= 11 ? 0 : 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function createMatch(random = Math.random, { autonomous = false, formations, debug = false, speeds } = {}) {
  const selected = formationPair(formations);
  const players = [0, 1].flatMap(team => FORMATIONS[selected[team]].map((roleProfile, i) => ({
    id: i + 1 + team * 11, number: i + 1, team, keeper: i === 0,
    ...worldPoint(roleProfile.startU, roleProfile.v, team), roleProfile,
    vx: 0, vy: 0, tackleCooldown: 0, intent: null, active: true, injured: false, yellows: 0, card: null, cardUntil: 0, duty: 'hold', thoughts: 0, decision: null,
    energy: 1, lowEnergyTime: 0, traits: playerTraits(i, team),
  })));
  const game = { players, owner: 10, ball: { x: 50.5, y: 34 }, flight: null, loose: false, looseVelocity: null, looseProtection: 0, looseExcluded: [], score: [0, 0], elapsed: 0,
    passes: [0, 0], shots: [0, 0], saves: [0, 0], tackles: [0, 0], possession: [0, 0], events: [], trails: [],
    touch: .35, protection: .7, restart: 0, revision: 0, planAt: -Infinity, hasPlan: false, ended: false, random,
    lastTouchTeam: 0, lastTouchId: 10, planBall: { x: 50.5, y: 34 }, eventSerial: 0, restartVersion: 0,
    controlTeam: 0, possessionSince: 0, turnovers: 0, setPiece: null, ballAction: 'wait',
    fouls: [0, 0], yellowCards: [0, 0], redCards: [0, 0], injuries: [0, 0], longShots: [0, 0],
    autonomous, debug, formations: selected, nextThink: 0, decisionCount: 0, deadBallVersion: 0,
    offsides: [0, 0], offsidePhase: null, indirectKick: false, contestLock: null, speedSettings: speedSettings(speeds),
  };
  kickoff(game, 0, false); if (autonomous) think(game); return game;
}
export const player = (game, id) => game.players[id - 1];
const forwardFor = (game, team) => activePlayers(game).filter(p => p.team === team && !p.keeper).sort((a, b) => Number(roleOf(b).type === 'striker') - Number(roleOf(a).type === 'striker') || Math.abs(a.number - 10) - Math.abs(b.number - 10))[0];
function event(game, type, team, extra = {}) {
  game.events.push({ serial: ++game.eventSerial, type, team, time: game.elapsed, ...extra });
  if (game.events.length > 80) game.events.shift();
}
export function applyInstructions(game, plan) {
  for (const instruction of plan.players) {
    const p = player(game, instruction.id);
    p.intent = { shootRange: p.traits.shotPower, tackle: 'normal', ...instruction };
  }
  game.planAt = game.elapsed; game.planBall = { ...game.ball }; game.hasPlan = true;
}
export function snapshot(game) {
  return { ballOwner: game.owner, ball: { x: clamp(game.ball.x, 0, 105), y: clamp(game.ball.y, 0, 68) }, elapsed: game.elapsed, score: [...game.score], phases: [phaseFor(game, 0), phaseFor(game, 1)],
    players: game.players.map(p => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, active: p.active, role: roleOf(p).code, yellows: p.yellows })) };
}
export function kickoff(game, team, announce = true) {
  for (const p of game.players) {
    if (!p.active) continue;
    const { startU: x, v: y } = roleOf(p);
    p.x = p.team ? 105 - x : x; p.y = p.team ? 68 - y : y; p.vx = p.vy = 0;
    if (p.team !== team && distance(p, { x: 52.5, y: 34 }) < 9.5) p.x = p.team ? 63 : 42;
  }
  // Training modes may intentionally have no outfield player, or no active
  // player at all, on the conceding team. A goal must still end cleanly so
  // the mode can restore its saved setup on the next simulation boundary.
  const taker = forwardFor(game, team) ?? activePlayers(game).find(p => p.team === team) ?? null;
  if (taker) { taker.x = team ? 53 : 52; taker.y = 34; }
  game.owner = taker?.id ?? null; game.ball = { x: taker?.x ?? 52.5, y: 34 }; game.flight = null; game.loose = false; game.looseVelocity = null;
  game.touch = .3; game.protection = .8; game.restart = announce ? 1.4 : 0;
  game.lastTouchTeam = team; game.lastTouchId = taker?.id ?? null; game.revision++; game.restartVersion++;
  game.controlTeam = team; game.possessionSince = game.elapsed; game.setPiece = null; game.looseFrom = null;
  game.offsidePhase = null; game.indirectKick = false; game.contestLock = null;
  game.deadBallVersion++; game.nextThink = 0;
  // Restart plans were generated for a different layout and must not be reused.
  game.hasPlan = false; for (const p of game.players) p.intent = null;
  if (announce) event(game, 'kickoff', team, { to: taker?.id ?? null });
}
function receive(game, receiver, type, from, extra = {}) {
  game.offsidePhase = null; game.indirectKick = false;
  const loser = from ? player(game, from) : null;
  const closeTurnover = (type === 'tackle' || type === 'intercept') && loser?.active && loser.team !== receiver.team && distance(loser, receiver) < 2.5;
  game.contestLock = closeTurnover ? { winner: receiver.id, loser: loser.id, until: game.elapsed + 1.1, spot: { x: receiver.x, y: receiver.y } } : null;
  if (closeTurnover) loser.tackleCooldown = Math.max(loser.tackleCooldown, 1.1);
  if (receiver.team !== game.controlTeam) { game.controlTeam = receiver.team; game.possessionSince = game.elapsed; game.turnovers++; }
  game.owner = receiver.id; game.ball = { x: receiver.x, y: receiver.y }; game.flight = null; game.loose = false; game.looseVelocity = null; game.looseFrom = null; game.looseProtection = 0; game.looseExcluded = [];
  game.touch = receiver.keeper ? .4 : .2; game.protection = closeTurnover ? .4 : .1;
  game.lastTouchTeam = receiver.team; game.lastTouchId = receiver.id;
  if (type === 'pass') game.passes[receiver.team]++;
  if (type === 'intercept' || type === 'tackle') { game.tackles[receiver.team]++; game.revision++; }
  if (type === 'save') { game.saves[receiver.team]++; game.revision++; }
  if (type) event(game, type, receiver.team, { from, to: receiver.id, ...extra });
}
function restartAt(game, type, team, x, y, keeper = false, eventExtra = {}) {
  const local = localPoint({ x, y }, team);
  const options = activePlayers(game).filter(p => p.team === team && (keeper ? p.keeper : !p.keeper && local.v >= roleOf(p).lane[0] && local.v <= roleOf(p).lane[1]));
  if (!options.length) options.push(...activePlayers(game).filter(p => p.team === team));
  const taker = options.sort((a, b) => distance(a, { x, y }) - distance(b, { x, y }))[0];
  taker.x = clamp(x, 1, 104); taker.y = clamp(y, 1, 67);
  receive(game, taker);
  if (type === 'corner') arrangeCorner(game, team, taker);
  game.restart = .8; game.touch = .25; game.revision++;
  game.deadBallVersion++; game.nextThink = 0;
  game.setPiece = { kind: type, taker: taker.id };
  event(game, type, team, { to: taker.id, ...eventExtra });
}
function arrangeCorner(game, attackingTeam, taker) {
  const attackers = activePlayers(game).filter(p => p.team === attackingTeam && p !== taker && !p.keeper);
  const attackingKeeper = activePlayers(game).find(p => p.team === attackingTeam && p.keeper);
  const defenders = activePlayers(game).filter(p => p.team !== attackingTeam && !p.keeper);
  const keeper = activePlayers(game).find(p => p.team !== attackingTeam && p.keeper);
  const attackSlots = [[99, 29], [100, 34], [98, 39], [95, 31.5], [94, 37], [90, 34], [87, 25], [86, 43], [80, 34], [76, 50]];
  const defendSlots = [[98, 30], [98.5, 34], [98, 38], [95, 32], [95, 36.5], [91, 29], [91, 39], [87, 34], [83, 25], [82, 45]];
  attackers.forEach((p, index) => { const slot = attackSlots[index] ?? [78 - index, 34]; Object.assign(p, worldPoint(slot[0], slot[1], attackingTeam)); p.vx = p.vy = 0; });
  defenders.forEach((p, index) => { const slot = defendSlots[index] ?? [80 - index, 34]; Object.assign(p, worldPoint(slot[0], slot[1], attackingTeam)); p.vx = p.vy = 0; });
  if (attackingKeeper) { Object.assign(attackingKeeper, worldPoint(6, 34, attackingTeam)); attackingKeeper.vx = attackingKeeper.vy = 0; }
  if (keeper) { Object.assign(keeper, worldPoint(103.2, 34, attackingTeam)); keeper.vx = keeper.vy = 0; }
  taker.vx = taker.vy = 0;
}
function penalizeOffside(game, p) {
  const phase = game.offsidePhase;
  game.offsides[p.team]++;
  event(game, 'offside', p.team, { from: phase.from, to: p.id, kickTime: phase.at, lineX: phase.x });
  restartAt(game, 'indirectFreeKick', 1 - p.team, p.x, p.y);
  // Keep opponents away from the restart, just as for a normal free kick.
  const taker = player(game, game.owner);
  for (const q of activePlayers(game).filter(q => q.team === p.team && distance(q, taker) < 9.15)) {
    const dx = q.x - taker.x || (p.team ? -1 : 1), dy = q.y - taker.y, d = Math.hypot(dx, dy);
    q.x = clamp(taker.x + dx / d * 9.3, 1, 104); q.y = clamp(taker.y + dy / d * 9.3, 1, 67);
    q.vx = q.vy = 0;
  }
}
function boundary(game, oldBall) {
  const b = game.ball;
  if (b.x < 0 || b.x > 105) {
    const edge = b.x < 0 ? 0 : 105;
    const alpha = (edge - oldBall.x) / (b.x - oldBall.x);
    const crossY = oldBall.y + (b.y - oldBall.y) * clamp(alpha, 0, 1);
    const crossZ = (oldBall.z ?? 0) + ((b.z ?? 0) - (oldBall.z ?? 0)) * clamp(alpha, 0, 1);
    const defendingTeam = edge === 0 ? 0 : 1;
    if (crossY >= 30.34 && crossY <= 37.66 && crossZ <= 2.44 && !game.indirectKick) {
      const shot = game.flight, keeper = activePlayers(game).find(p => p.team === defendingTeam && p.keeper);
      if (keeper && shot?.kind === 'shot' && !shot.missedKeepers?.includes(keeper.id)) {
        const reactionTime = Math.max(0, shot.age - .12), diveReach = Math.min(4.6, 1.35 + reactionTime * 3.8 * (keeper.traits?.pace ?? 1));
        const lateral = Math.abs(keeper.y - crossY), reachable = lateral <= diveReach && crossZ <= 2.6;
        if (reachable) {
          const speed = Math.hypot(shot.vx, shot.vy), difficulty = lateral / Math.max(.1, diveReach);
          const shotDistance = Math.abs(edge - (shot.start?.x ?? edge)), longBonus = clamp((shotDistance - 20) / 35, 0, .16);
          const saveChance = clamp(.84 + longBonus - difficulty * .2 - Math.max(0, speed - 25) * .009 - crossZ * .04, .2, .94), roll = game.random();
          if (roll < saveChance) {
            if (roll < saveChance * .55) receive(game, keeper, 'save', shot.from, { diving: true });
            else parryShot(game, keeper, shot);
            return true;
          }
          (shot.missedKeepers ??= []).push(keeper.id);
        }
      }
      const scoring = 1 - defendingTeam;
      const origin = shot?.start;
      game.score[scoring]++; event(game, 'goal', scoring, { from: game.lastTouchId,
        crossY: Math.round(crossY * 100) / 100, crossZ: Math.round(crossZ * 100) / 100,
        shotDistance: origin ? Math.round(Math.hypot(edge - origin.x, crossY - origin.y) * 10) / 10 : null });
      kickoff(game, defendingTeam); return true;
    }
    const exit = { exitX: edge, exitY: Math.round(crossY * 100) / 100, exitZ: Math.round(crossZ * 100) / 100 };
    if (game.lastTouchTeam === defendingTeam) restartAt(game, 'corner', 1 - defendingTeam, edge === 0 ? 1 : 104, crossY < 34 ? 1 : 67, false, exit);
    else restartAt(game, 'goalKick', defendingTeam, edge === 0 ? 6 : 99, 34, true, exit);
    return true;
  }
  if (b.y < 0 || b.y > 68) { restartAt(game, 'throwIn', 1 - game.lastTouchTeam, b.x, b.y < 0 ? 1 : 67); return true; }
  return false;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { distance: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}
function curveGeometry(start, aim, curve) {
  const dx = aim.x - start.x, dy = aim.y - start.y, chord = Math.hypot(dx, dy) || 1;
  const bow = curve * Math.min(9, chord * .22);
  const control = { x: (start.x + aim.x) / 2 - dy / chord * bow, y: (start.y + aim.y) / 2 + dx / chord * bow };
  let length = 0, previous = start;
  for (let i = 1; i <= 20; i++) {
    const t = i / 20, u = 1 - t;
    const point = { x: u * u * start.x + 2 * u * t * control.x + t * t * aim.x, y: u * u * start.y + 2 * u * t * control.y + t * t * aim.y };
    length += distance(previous, point); previous = point;
  }
  return { curveControl: control, curveLength: length, curveProgress: 0 };
}
function launch(game, p) {
  const intent = p.intent, decision = game.autonomous ? p.decision : chooseDecision(game, p), action = decision?.action; if (!intent || !action || action === 'dribble' || action === 'wait') return;
  const shot = action === 'shoot', setPieceKind = game.setPiece?.kind;
  let recipient = shot ? null : player(game, decision.target);
  const freePass = !shot && decision.reason === 'manual-pass' && decision.aim && !decision.target;
  if (!shot && !freePass && game.setPiece && (!recipient?.active || recipient.team !== p.team || recipient === p)) recipient = activePlayers(game).filter(q => q.team === p.team && q !== p).sort((a, b) => distance(a, p) - distance(b, p))[0];
  if (!shot && !freePass && (!recipient || !recipient.active || recipient.team !== p.team || recipient.id === p.id)) return;
  let aim, calculatedLift = 0, calculatedArcHeight = 0, maxShotRange = Infinity;
  if (shot) {
    const goalX = p.team === 0 ? 105 : 0, keeper = player(game, p.team === 0 ? 12 : 1), shotDistance = distance(p, { x: goalX, y: 34 });
    const pressure = shootingWindow(game, p).nearest < 2 ? 1.25 : 0;
    const accuracy = p.traits.shotAccuracy ?? .72;
    if (decision.reason === 'manual-shot' && decision.aim) {
      const planned = decision.aim, pdx = planned.x - p.x, pdy = planned.y - p.y, plannedLength = Math.hypot(pdx, pdy) || 1;
      const error = (1 - accuracy) * (2 + plannedLength * .08) + pressure * .4 + Math.max(0, plannedLength - p.traits.shotPower) * .75;
      const lateral = (game.random() - .5) * error * 2;
      aim = { x: planned.x - pdy / plannedLength * lateral, y: planned.y + pdx / plannedLength * lateral };
    } else {
      const error = (1 - accuracy) * (5 + shotDistance * .18) + pressure + Math.max(0, shotDistance - p.traits.shotPower) * .75;
      aim = { x: goalX, y: (keeper.active && keeper.y >= 34 ? 31.8 : 36.2) + (game.random() - .5) * error * 2 };
    }
    const selectedPower = clamp(decision.power ?? 1, .3, 1), traitPower = clamp((p.traits.shotPower - 20) / 20, 0, 1);
    maxShotRange = p.traits.shotPower * (.35 + .65 * selectedPower);
    const shotTravel = distance(p, aim), distanceFactor = clamp(shotTravel / 35, .35, 1);
    if (decision.lift !== undefined) {
      calculatedLift = clamp(decision.lift, .04, 1); calculatedArcHeight = .6 + calculatedLift * 3;
    } else {
      calculatedArcHeight = .8 + Math.pow(selectedPower, 1.6) * 7.2 * (.75 + traitPower * .25) * distanceFactor;
      calculatedLift = clamp((calculatedArcHeight - .8) / 7.2, .04, 1);
    }
    const isLong = shotDistance > 23;
    game.shots[p.team]++; if (isLong) game.longShots[p.team]++;
    event(game, 'shot', p.team, { from: p.id, long: isLong, distance: Math.round(shotDistance),
      power: p.traits.shotPower, selectedPower: Math.round((decision.power ?? 1) * 100), curve: Math.round((decision.curve ?? 0) * 100),
      lift: Math.round(calculatedLift * 100), accuracy: Math.round(accuracy * 100), maxRange: Math.round(maxShotRange * 10) / 10 });
  } else {
    const planned = decision.aim ?? { x: recipient.x, y: recipient.y };
    const pdx = planned.x - p.x, pdy = planned.y - p.y, plannedLength = Math.hypot(pdx, pdy) || 1;
    const ux = pdx / plannedLength, uy = pdy / plannedLength, accuracy = p.traits.passAccuracy ?? .82;
    const pressure = shootingWindow(game, p).nearest < 3 ? .55 : 0;
    const spread = (1 - accuracy) * (1.2 + plannedLength * .12) + pressure;
    const along = (game.random() - .5) * spread * .7, lateral = (game.random() - .5) * spread * 2;
    aim = { x: planned.x + ux * along - uy * lateral, y: planned.y + uy * along + ux * lateral };
  }
  const dx = aim.x - p.x, dy = aim.y - p.y, length = Math.hypot(dx, dy);
  if (length < .3) return;
  const cornerCross = !shot && setPieceKind === 'corner' && length > 6;
  const speed = shot ? (26 + (p.traits.shotPower - 20) * .25) * (.45 + .55 * (decision.power ?? 1)) : 22;
  const offside = captureOffside(game, p);
  if (!shot && game.onBeforePass) game.onBeforePass({ from: p.id, to: recipient?.id ?? null, team: p.team, reason: decision.reason,
    aim: { ...aim }, at: game.elapsed, offside, fallback: !!recipient && recipient.id !== decision.target, ...decision.trace });
  game.offsidePhase = offside;
  game.indirectKick = game.setPiece?.kind === 'indirectFreeKick';
  const selectedCurve = decision.curve ?? 0;
  const effectiveCurve = shot ? selectedCurve * clamp(decision.curveSkill ?? 1, .2, 1) : selectedCurve;
  const lift = shot ? calculatedLift : cornerCross ? clamp(.28 + length * .008, .32, .58) : 0;
  const arcHeight = shot ? calculatedArcHeight : cornerCross ? clamp(1.8 + length * .075, 2.4, 4.6) : 0;
  const flightDistance = shot ? Math.min(length + 3, maxShotRange) : length;
  game.flight = { kind: shot ? 'shot' : 'pass', from: p.id, to: recipient?.id ?? null, team: p.team, reason: decision.reason,
    throughBall: !!decision.throughBall, leadDistance: decision.leadDistance ?? 0,
    curve: effectiveCurve, selectedCurve, curvePower: p.traits.curvePower ?? 100, power: decision.power ?? 1, maxRange: maxShotRange,
    lift, arcHeight, arcLength: flightDistance, arcTravel: 0,
    vx: dx / length * speed, vy: dy / length * speed, remaining: flightDistance, age: 0, start: { x: p.x, y: p.y }, aim };
  if (game.flight.curve) {
    const geometry = curveGeometry(game.flight.start, aim, game.flight.curve);
    Object.assign(game.flight, geometry);
    const curvedFlightDistance = shot ? Math.min(geometry.curveLength + 3, maxShotRange) : geometry.curveLength;
    game.flight.arcLength = curvedFlightDistance; game.flight.remaining = curvedFlightDistance;
  }
  event(game, 'kick', p.team, { from: p.id, to: recipient?.id ?? null, action: shot ? 'shot' : 'pass', power: decision.power ?? 1 });
  game.owner = null; game.loose = false; game.looseVelocity = null; game.lastTouchTeam = p.team; game.lastTouchId = p.id;
  game.setPiece = null;
}
function injure(game, p) {
  if (!p.active || p.injured) return;
  p.injured = true; p.active = false; p.vx = p.vy = 0; game.injuries[p.team]++;
  event(game, 'injury', p.team, { from: p.id, energy: Math.round(p.energy * 100) });
  if (game.owner === p.id) {
    game.owner = null; game.ball = { x: p.x, y: p.y }; game.flight = null;
    game.loose = true; game.looseVelocity = null; game.looseFrom = null;
  }
  game.revision++; game.nextThink = 0; game.hasPlan = false;
}
function movePlayers(game, dt) {
  if (game.freeKickFreezePlayers) { for (const p of activePlayers(game)) p.vx = p.vy = 0; return; }
  const targets = game.autonomous ? new Map(activePlayers(game).map(p => [p.id, p.decision])) : tacticalTargets(game);
  for (const p of activePlayers(game)) {
    p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
    const target = targets.get(p.id); p.duty = target.duty;
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
    const fatigue = .82 + .18 * (p.energy ?? 1), availableSpeed = target.speed * p.traits.pace * fatigue;
    const speed = Math.min(availableSpeed, d / Math.max(dt, .001));
    const tx = d > .12 ? dx / d * speed : 0, ty = d > .12 ? dy / d * speed : 0;
    const blend = Math.min(1, dt * 9);
    p.vx += (tx - p.vx) * blend; p.vy += (ty - p.vy) * blend;
    p.x = clamp(p.x + p.vx * dt, 1, 104); p.y = clamp(p.y + p.vy * dt, 1, 67);
    const effort = clamp(Math.hypot(p.vx, p.vy) / Math.max(.1, target.speed * p.traits.pace), 0, 1);
    const recovery = effort < .2 ? .0007 * dt : 0;
    p.energy = clamp((p.energy ?? 1) - .0014 * Math.pow(effort, 1.35) * (90 / p.traits.stamina) * dt + recovery, .3, 1);
    if (p.energy <= LOW_ENERGY_THRESHOLD && effort >= .55) p.lowEnergyTime = (p.lowEnergyTime ?? 0) + dt * effort;
    else p.lowEnergyTime = Math.max(0, (p.lowEnergyTime ?? 0) - dt * 2);
    if (p.lowEnergyTime >= INJURY_EXPOSURE_SECONDS) injure(game, p);
  }
  const active = activePlayers(game);
  for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
    const p = active[a], q = active[b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1.1) {
      const ux = d > .001 ? dx / d : 1, uy = d > .001 ? dy / d : 0, push = (1.1 - d) * .35;
      p.x = clamp(p.x - ux * push, 1, 104); p.y = clamp(p.y - uy * push, 1, 67);
      q.x = clamp(q.x + ux * push, 1, 104); q.y = clamp(q.y + uy * push, 1, 67);
    }
  }
}
function flightStep(game, dt) {
  const f = game.flight, previous = { ...game.ball }; f.age += dt;
  if (f.curve && f.curveProgress < 1) {
    const speed = Math.hypot(f.vx, f.vy), t = Math.min(1, f.curveProgress + speed * dt / f.curveLength), u = 1 - t;
    game.ball.x = u * u * f.start.x + 2 * u * t * f.curveControl.x + t * t * f.aim.x;
    game.ball.y = u * u * f.start.y + 2 * u * t * f.curveControl.y + t * t * f.aim.y;
    const tx = 2 * u * (f.curveControl.x - f.start.x) + 2 * t * (f.aim.x - f.curveControl.x);
    const ty = 2 * u * (f.curveControl.y - f.start.y) + 2 * t * (f.aim.y - f.curveControl.y), tangent = Math.hypot(tx, ty) || 1;
    f.vx = tx / tangent * speed; f.vy = ty / tangent * speed; f.curveProgress = t;
  } else { game.ball.x += f.vx * dt; game.ball.y += f.vy * dt; }
  const stepDistance = Math.hypot(game.ball.x - previous.x, game.ball.y - previous.y);
  if (f.arcHeight > 0) {
    f.arcTravel = Math.min(f.arcLength, f.arcTravel + stepDistance);
    const progress = clamp(f.arcTravel / Math.max(.01, f.arcLength), 0, 1);
    game.ball.z = 4 * f.arcHeight * progress * (1 - progress);
  }
  const collisions = activePlayers(game).filter(p => !(p.id === f.from && f.age < .22) && !(f.kind === 'shot' && p.team === f.team && !offsideParticipant(game, p)))
    .map(p => { const hit = segmentDistance(p, previous, game.ball); return { p, ...hit,
      height: (previous.z ?? 0) + ((game.ball.z ?? 0) - (previous.z ?? 0)) * hit.t }; })
    .filter(hit => hit.height <= (hit.p.keeper ? 2.6 : 1.9)
      && hit.distance < (hit.p.keeper && (hit.p.team ? hit.p.x > 88.5 : hit.p.x < 16.5) ? 1.55 : f.kind === 'pass' && hit.p.id === f.to ? 1.25 : .9))
    .sort((a, b) => a.t - b.t);
  for (const hit of collisions) {
    if (offsideParticipant(game, hit.p)) { penalizeOffside(game, hit.p); return; }
    if (f.kind === 'shot' && hit.p.keeper) {
      // One save attempt per keeper per shot, not a fresh chance on every
      // physics frame while the ball overlaps the keeper's catch radius.
      if (f.missedKeepers?.includes(hit.p.id)) continue;
      const saveRoll = game.random(), defendedGoalX = hit.p.team ? 105 : 0;
      const shotDistance = Math.abs(defendedGoalX - (f.start?.x ?? defendedGoalX));
      const missThreshold = clamp(.82 + Math.max(0, shotDistance - 20) * .004, .82, .94);
      if (saveRoll > missThreshold) { (f.missedKeepers ??= []).push(hit.p.id); continue; }
      if (saveRoll > .45) { parryShot(game, hit.p, f); return; }
    }
    game.trails.push({ from: f.start, to: { x: hit.p.x, y: hit.p.y }, team: f.team, shot: f.kind === 'shot' });
    if (game.trails.length > 6) game.trails.shift();
    receive(game, hit.p, hit.p.team === f.team ? 'pass' : f.kind === 'shot' && hit.p.keeper ? 'save' : 'intercept', f.from,
      hit.p.team === f.team && f.kind === 'pass' ? { throughBall: !!f.throughBall } : {}); return;
  }
  if (boundary(game, previous)) return;
  f.remaining -= stepDistance;
  if (f.remaining <= 0) {
    const speed = Math.hypot(f.vx, f.vy), rollSpeed = f.kind === 'shot' ? 10 : f.throughBall ? 7 : 5.5;
    const landingVz = f.arcHeight > .15 ? -Math.sqrt(2 * BALL_GRAVITY * f.arcHeight) : 0;
    game.looseFrom = f; game.looseVelocity = speed || landingVz ? {
      vx: speed ? f.vx / speed * rollSpeed : 0, vy: speed ? f.vy / speed * rollSpeed : 0, vz: landingVz, bounces: 0,
    } : null;
    game.ball.z = 0; game.flight = null; game.loose = true; game.revision++;
  }
}
function collectLooseBall(game, receiver) {
  if (offsideParticipant(game, receiver)) { penalizeOffside(game, receiver); return; }
  const sameTeam = receiver.team === game.lastTouchTeam, source = game.looseFrom;
  receive(game, receiver, !sameTeam ? 'intercept' : source?.kind === 'pass' ? 'pass' : 'recovery', game.lastTouchId,
    sameTeam && source?.kind === 'pass' ? { throughBall: !!source.throughBall } : {});
}
function parryShot(game, keeper, shot) {
  const aim = { x: keeper.team ? 107 : -2, y: keeper.y < 34 ? 22 : 46 };
  const dx = aim.x - keeper.x, dy = aim.y - keeper.y, length = Math.hypot(dx, dy) || 1, speed = 17;
  game.saves[keeper.team]++; event(game, 'save', keeper.team, { from: shot.from, to: keeper.id, parried: true });
  game.trails.push({ from: shot.start, to: { x: keeper.x, y: keeper.y }, team: shot.team, shot: true });
  if (game.trails.length > 6) game.trails.shift();
  game.ball = { x: keeper.x, y: keeper.y }; game.owner = null; game.flight = null; game.loose = true;
  game.looseVelocity = { vx: dx / length * speed, vy: dy / length * speed };
  game.looseFrom = { kind: 'parry', from: shot.from }; game.looseProtection = .2; game.looseExcluded = [keeper.id];
  game.lastTouchTeam = keeper.team; game.lastTouchId = keeper.id;
  game.offsidePhase = null; game.indirectKick = false; game.revision++;
}
function challengeDeflection(game, defender, victim) {
  const towardTop = victim.y < 34, defenderPoint = localPoint(defender, defender.team);
  const target = defenderPoint.u < 35
    ? worldPoint(-3, towardTop ? 22 : 46, defender.team)
    : { x: clamp(victim.x + (victim.team ? -7 : 7), 1, 104), y: towardTop ? -3 : 71 };
  const dx = target.x - victim.x, dy = target.y - victim.y, length = Math.hypot(dx, dy) || 1, speed = 18;
  game.owner = null; game.ball = { x: victim.x, y: victim.y }; game.flight = null; game.loose = true;
  game.looseVelocity = { vx: dx / length * speed, vy: dy / length * speed };
  game.looseFrom = { kind: 'deflection', from: defender.id }; game.looseProtection = .2; game.looseExcluded = [defender.id, victim.id];
  game.lastTouchTeam = defender.team; game.lastTouchId = defender.id;
  game.offsidePhase = null; game.indirectKick = false; game.revision++;
  event(game, 'deflection', defender.team, { from: defender.id, to: victim.id });
}
function looseBallStep(game, dt) {
  const velocity = game.looseVelocity, previous = { ...game.ball };
  game.looseProtection = Math.max(0, (game.looseProtection ?? 0) - dt);
  if (!game.looseProtection) game.looseExcluded = [];
  if (velocity) {
    game.ball.x += velocity.vx * dt; game.ball.y += velocity.vy * dt;
    velocity.vz ??= 0; velocity.vz -= BALL_GRAVITY * dt; game.ball.z = (game.ball.z ?? 0) + velocity.vz * dt;
    if (game.ball.z <= 0) {
      game.ball.z = 0;
      if (velocity.vz < -1.15) {
        velocity.vz = -velocity.vz * BALL_RESTITUTION; velocity.vx *= .86; velocity.vy *= .86; velocity.bounces = (velocity.bounces ?? 0) + 1;
      } else velocity.vz = 0;
    }
    const hit = activePlayers(game).filter(p => !(game.looseProtection && game.looseExcluded?.includes(p.id))).map(p => {
      const contact = segmentDistance(p, previous, game.ball);
      return { p, ...contact, height: (previous.z ?? 0) + ((game.ball.z ?? 0) - (previous.z ?? 0)) * contact.t };
    }).filter(item => item.height <= (item.p.keeper ? 2.6 : 1.9) && item.distance < (item.p.keeper ? 1.35 : .9)).sort((a, b) => a.t - b.t)[0];
    if (hit) { collectLooseBall(game, hit.p); return; }
    if (boundary(game, previous)) return;
    const speed = Math.hypot(velocity.vx, velocity.vy), next = Math.max(0, speed - 3.2 * dt);
    if (next < .12) velocity.vx = velocity.vy = 0;
    else if (speed) { velocity.vx *= next / speed; velocity.vy *= next / speed; }
    if (!velocity.vx && !velocity.vy && !velocity.vz && game.ball.z === 0) game.looseVelocity = null;
  }
  const nearest = activePlayers(game).filter(p => !(game.looseProtection && game.looseExcluded?.includes(p.id))).sort((a, b) => distance(a, game.ball) - distance(b, game.ball))[0];
  if (nearest && (game.ball.z ?? 0) <= (nearest.keeper ? 2.6 : 1.9) && distance(nearest, game.ball) < 1.3) collectLooseBall(game, nearest);
}
function foul(game, defender, victim, closing, behind, style) {
  game.fouls[defender.team]++;
  event(game, 'foul', defender.team, { from: defender.id, to: victim.id });
  const severe = style === 'hard' && behind && closing > 8.5;
  const reckless = style === 'hard' || closing > 7.5 || (behind && closing > 5);
  if (reckless && !severe) {
    defender.yellows++; game.yellowCards[defender.team]++;
    defender.card = 'yellow'; defender.cardUntil = game.elapsed + 4;
    event(game, 'yellow', defender.team, { from: defender.id });
  }
  if (severe || defender.yellows >= 2) {
    defender.active = false; defender.injured = false; defender.vx = defender.vy = 0; game.redCards[defender.team]++;
    defender.card = 'red'; defender.cardUntil = game.elapsed + 4;
    event(game, 'red', defender.team, { from: defender.id });
  }
  const local = localPoint(victim, defender.team);
  const penalty = local.u <= 16.5 && local.v >= 13.84 && local.v <= 54.16;
  const spot = penalty ? worldPoint(94, 34, victim.team) : { x: victim.x, y: victim.y };
  const taker = penalty ? forwardFor(game, victim.team) : victim;
  for (const p of activePlayers(game)) {
    p.vx = p.vy = 0;
    if (p === taker) continue;
    if (penalty) {
      if (p.keeper && p.team !== victim.team) Object.assign(p, worldPoint(104, 34, victim.team));
      else { const point = localPoint(p, victim.team); Object.assign(p, worldPoint(Math.min(point.u, 83), point.v, victim.team)); }
    } else if (p.team !== victim.team && distance(p, spot) < 9.15) {
      const dx = p.x - spot.x || (p.team ? 1 : -1), dy = p.y - spot.y, d = Math.hypot(dx, dy);
      p.x = clamp(spot.x + dx / d * 9.3, 1, 104); p.y = clamp(spot.y + dy / d * 9.3, 1, 67);
    }
  }
  Object.assign(taker, spot); receive(game, taker);
  game.setPiece = { kind: penalty ? 'penalty' : 'freeKick', taker: taker.id };
  game.restart = 1.5; game.protection = 1; game.touch = 0; game.revision++;
  game.deadBallVersion++; game.nextThink = 0;
  event(game, game.setPiece.kind, victim.team, { to: taker.id });
}
function tick(game, dt) {
  game.elapsed = Math.min(DURATION, game.elapsed + dt);
  if (game.elapsed >= DURATION) { game.ended = true; event(game, 'fullTime', null); return; }
  game.touch = Math.max(0, game.touch - dt); game.protection = Math.max(0, game.protection - dt);
  if (game.restart > 0) { game.restart = Math.max(0, game.restart - dt); return; }
  const team = game.owner ? player(game, game.owner).team : game.flight?.team;
  if (team !== undefined && team !== game.controlTeam) { game.controlTeam = team; game.possessionSince = game.elapsed; game.turnovers++; }
  if (game.autonomous && (game.elapsed >= game.nextThink || game.thoughtOwner !== game.owner || game.thoughtRevision !== game.revision)) think(game);
  game.ballAction = game.owner ? game.autonomous ? player(game, game.owner).decision.action : chooseAction(game, player(game, game.owner)) : 'wait';
  if (game.setPiece && game.owner === game.setPiece.taker) { launch(game, player(game, game.owner)); return; }
  movePlayers(game, dt);
  // In this point-player model a close challenge for the ball is interference.
  if (!game.owner && game.offsidePhase) {
    const challenger = activePlayers(game).find(p => offsideParticipant(game, p) && distance(p, game.ball) < 1.8 &&
      activePlayers(game).some(q => q.team !== p.team && distance(q, game.ball) < 1.8 && distance(q, p) < 1.5));
    if (challenger) { penalizeOffside(game, challenger); return; }
  }
  if (game.owner) {
    const p = player(game, game.owner); game.ball.x = p.x; game.ball.y = p.y; game.possession[p.team] += dt;
    const lock = game.contestLock, lockActive = lock?.winner === p.id && (game.elapsed < lock.until || distance(p, lock.spot) < 1.8);
    if (lock && !lockActive) game.contestLock = null;
    const rival = activePlayers(game).filter(q => q.team !== p.team && q.intent && q.tackleCooldown <= 0 && (!lockActive || q.id !== lock.loser) && distance(q, p) < 2.1).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (rival && game.protection <= 0) {
      rival.tackleCooldown = 1.2;
      const closing = Math.hypot(rival.vx - p.vx, rival.vy - p.vy);
      const behind = (rival.x - p.x) * (p.team ? -1 : 1) < -.45;
      const style = rival.intent.tackle || 'normal', roll = game.random();
      let clean = style === 'cautious' ? .5 : style === 'hard' ? .56 : .54;
      const carryMode = p.decision?.carryMode;
      if (carryMode === 'diagonal' || carryMode === 'shield') {
        const protection = 1.15 - ballSecurity(p) * .45 - (carryMode === 'shield' ? .08 : 0);
        clean *= clamp(protection, .62, 1.08);
      }
      const foulChance = (style === 'cautious' ? .015 : style === 'hard' ? .04 : .03) + (behind ? .025 : 0) + (closing > 7 ? .015 : 0);
      if (roll < clean) { receive(game, rival, 'tackle', p.id); return; }
      if (roll < clean + foulChance) { foul(game, rival, p, closing, behind, style); return; }
      if (roll < clean + foulChance + .1) { challengeDeflection(game, rival, p); return; }
    }
    if (game.touch <= 0 && game.hasPlan) launch(game, p);
  } else if (game.flight) flightStep(game, dt);
  else if (game.loose) looseBallStep(game, dt);
}
export function advance(game, seconds) {
  if (game.ended || seconds <= 0) return;
  let remaining = Math.min(seconds, DURATION - game.elapsed);
  while (remaining > .000001 && !game.ended) { const dt = Math.min(.025, remaining); tick(game, dt); remaining -= dt; }
  if (!game.ended && game.elapsed >= DURATION - .000001) { game.elapsed = DURATION; game.ended = true; event(game, 'fullTime', null); }
}
