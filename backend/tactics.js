import { FORMATIONS } from './formations.js';
import { inOffsidePosition, offsideLine } from './offside.js';
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Coordinates are relative to each team's own goal: u = forward, v = left to right.
export const ROLES = FORMATIONS['4-4-2'];
export const roleOf = p => p.roleProfile ?? ROLES[(p.number ?? (p.id - 1) % 11 + 1) - 1];
export const localPoint = (p, team) => ({ u: team ? 105 - p.x : p.x, v: team ? 68 - p.y : p.y });
export const worldPoint = (u, v, team) => ({ x: team ? 105 - u : u, y: team ? 68 - v : v });
export const activePlayers = game => game.players.filter(p => p.active !== false);
export function controlTeam(game) { return game.owner ? game.players[game.owner - 1].team : game.flight?.team ?? game.controlTeam ?? game.lastTouchTeam; }
export function phaseFor(game, team) {
  const attacking = controlTeam(game) === team;
  const transition = game.elapsed - game.possessionSince < 5 && game.turnovers > 0;
  return attacking ? transition ? 'counter' : 'attack' : transition ? 'recover' : 'defend';
}
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { distance: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}
function receivePoint(game, p) {
  const f = game.flight, speed = Math.hypot(f.vx, f.vy) || 1, seconds = Math.max(.05, f.remaining / speed);
  const runnerSpeed = (game.speedSettings?.sprint ?? 7.1) * (p.traits?.pace ?? 1) * (.82 + .18 * (p.energy ?? 1));
  let fallback = f.aim;
  for (let i = 1; i <= 16; i++) {
    const time = seconds * i / 16; let point;
    if (f.curve && f.curveControl && f.curveProgress < 1) {
      const t = Math.min(1, f.curveProgress + speed * time / f.curveLength), u = 1 - t;
      point = { x: u * u * f.start.x + 2 * u * t * f.curveControl.x + t * t * f.aim.x,
        y: u * u * f.start.y + 2 * u * t * f.curveControl.y + t * t * f.aim.y };
    } else {
      const travel = Math.min(f.remaining, speed * time);
      point = { x: game.ball.x + f.vx / speed * travel, y: game.ball.y + f.vy / speed * travel };
    }
    fallback = point;
    if (distance(p, point) <= runnerSpeed * time + 1.15) return point;
  }
  return fallback;
}
export function shootingWindow(game, p) {
  const point = localPoint(p, p.team), goal = worldPoint(105, 34, p.team);
  const range = distance(p, goal), angle = Math.atan2(Math.abs(point.v - 34), Math.max(1, 105 - point.u));
  const opponents = activePlayers(game).filter(q => q.team !== p.team && !q.keeper);
  const lanes = [31.5, 34, 36.5].filter(y => {
    const aim = worldPoint(105, y, p.team);
    return !opponents.some(q => { const hit = segmentDistance(q, p, aim); return hit.t > .06 && hit.t < .94 && hit.distance < 1.05; });
  });
  const nearest = Math.min(99, ...opponents.map(q => distance(q, p)));
  const keeper = activePlayers(game).find(q => q.team !== p.team && q.keeper);
  const keeperDistance = keeper ? distance(keeper, p) : 99;
  const emptyGoal = !keeper || segmentDistance(keeper, p, goal).distance > 7;
  // Relative chance quality, not a calibrated xG probability.
  const accuracy = p.traits?.shotAccuracy ?? .72;
  const quality = clamp((40 - range) / 36, 0, 1) * Math.pow(Math.max(0, Math.cos(angle)), 1.5)
    * (lanes.length ? 1 : .25) * clamp(nearest / 4, .3, 1) * clamp(keeperDistance / 4, .35, 1)
    * (.7 + accuracy * .4) + (emptyGoal && lanes.length ? .2 : 0);
  return { range, clear: lanes.length > 0, angle, nearest, keeperDistance, emptyGoal, quality, accuracy, long: range > 23, aimV: lanes[0] ?? 34 };
}
function throughBallSpace(game, p, target, receiverDistance) {
  const role = roleOf(target), from = localPoint(p, p.team), at = localPoint(target, p.team);
  if (target.keeper || !['striker', 'winger', 'attackingMid'].includes(role.type) || at.u < 55 || at.u <= from.u + 3) return null;
  const keeper = activePlayers(game).find(q => q.team !== p.team && q.keeper);
  const keeperU = keeper ? localPoint(keeper, p.team).u : 105;
  const runLimit = Math.min(99, keeperU - 4.5);
  const pace = target.traits?.pace ?? 1;
  // The receiver attacks a meeting point instead of waiting at their current
  // position. A longer pass can therefore release a longer run behind the line.
  const desiredLead = clamp((receiverDistance / 22 + .75) * 7.1 * pace, 5, 14);
  const leadDistance = Math.min(desiredLead, runLimit - at.u);
  if (leadDistance < 3.5) return { aim: null, leadDistance: 0, blockers: [], reason: 'keeper-space' };
  const movement = target.decision ? localPoint(target.decision, p.team) : null;
  const forwardRun = movement && movement.u > at.u + .8 ? { u: movement.u - at.u, v: movement.v - at.v } : null;
  const runLength = forwardRun ? Math.hypot(forwardRun.u, forwardRun.v) : 0;
  const lateralRun = forwardRun ? forwardRun.v / runLength * Math.min(7, leadDistance * .6) :
    clamp((target.team ? -target.vy : target.vy) * (receiverDistance / 22 + .5), -5, 5);
  const aimLocal = { u: at.u + leadDistance, v: clamp(at.v + lateralRun + clamp((34 - at.v) * .12, -1.2, 1.2), ...role.lane) };
  const aim = worldPoint(aimLocal.u, aimLocal.v, p.team);
  const blockers = activePlayers(game).filter(q => {
    if (q.team === p.team || q.keeper) return false;
    const opponent = localPoint(q, p.team);
    // A defender chasing from behind is precisely when a pass into space is
    // useful. Only opponents beside or ahead of the receiver close the runway.
    if (opponent.u <= at.u + .25 || opponent.u > aimLocal.u + 3) return false;
    const current = segmentDistance(q, target, aim);
    const arrival = receiverDistance / 22 + leadDistance / (5.7 * pace);
    const future = { x: q.x + (q.vx || 0) * arrival, y: q.y + (q.vy || 0) * arrival };
    return Math.min(current.distance, segmentDistance(future, target, aim).distance) < 4.2;
  });
  return { aim: blockers.length ? null : aim, leadDistance: blockers.length ? 0 : leadDistance,
    blockers: blockers.map(q => q.id), reason: blockers.length ? 'defender' : 'open-runway' };
}
export function passOption(game, p, target) {
  if (!target || target.active === false || target.team !== p.team || target.id === p.id) return null;
  const receiverDistance = distance(p, target); if (receiverDistance < 3) return null;
  const lead = clamp(receiverDistance / 22, 0, 1), role = roleOf(target);
  const predicted = localPoint({ x: target.x + (target.vx || 0) * lead, y: target.y + (target.vy || 0) * lead }, p.team);
  const normalAim = worldPoint(clamp(predicted.u, 1, target.keeper ? role.maxU : 103), clamp(predicted.v, ...role.lane), p.team);
  const space = throughBallSpace(game, p, target, receiverDistance);
  const aim = space?.aim ?? normalAim, length = distance(p, aim), travel = length / 22;
  const blockers = activePlayers(game).filter(q => {
    if (q.team === p.team) return false;
    const hit = segmentDistance(q, p, aim);
    if (hit.t <= .06 || hit.t >= .98) return false;
    const arrival = travel * hit.t;
    const future = { x: q.x + (q.vx || 0) * arrival, y: q.y + (q.vy || 0) * arrival };
    return Math.min(hit.distance, segmentDistance(future, p, aim).distance) < 1.05 + Math.min(2, arrival * 2.5);
  });
  const offside = inOffsidePosition(game, target);
  const accuracy = p.traits?.passAccuracy ?? .82, errorRadius = (1 - accuracy) * (1.2 + length * .12);
  return { target: target.id, aim, safe: !blockers.length && !offside, length, receiverDistance, offside, accuracy, errorRadius,
    blockers: blockers.map(q => q.id), throughBall: !!space?.aim, leadDistance: space?.leadDistance ?? 0,
    runwayBlockers: space?.blockers ?? [], runwayReason: space?.reason ?? 'not-attacking-run' };
}
// These values drive the decision itself and are also sent to the debugger.
export function evaluatePasses(game, p) {
  const own = shootingWindow(game, p), at = localPoint(p, p.team);
  return game.players.filter(q => q.team === p.team && q.id !== p.id).map(q => {
    const option = passOption(game, p, q), chance = shootingWindow(game, q);
    const length = option?.length ?? distance(p, q);
    const progress = localPoint(option?.aim ?? q, p.team).u - at.u;
    const terms = { progress: progress * .055 * (p.traits?.vision ?? 1), space: Math.min(chance.nearest, 8) * .1,
      accuracy: ((p.traits?.passAccuracy ?? .82) - .7) * .9, distance: -length * .017, keeper: q.keeper ? -.5 : 0 };
    const value = Object.values(terms).reduce((a, b) => a + b, 0);
    const arrival = option ? shootingWindow(game, { ...q, ...option.aim }) : chance;
    const scoringChance = option?.throughBall ? arrival : chance;
    const chanceValue = (option?.throughBall ? arrival.quality * .84 : Math.min(chance.quality, arrival.quality)) - length * .0015 - (option?.errorRadius ?? 0) * .02;
    const keyPassValue = progress * .045 + Math.min(arrival.nearest, 8) * .06 + arrival.quality * .35
      + ((p.traits?.passAccuracy ?? .82) - .7) * .6 - length * .008;
    const exclusions = [];
    if (q.active === false) exclusions.push('Oyuncu sahada değil');
    if (length < 3) exclusions.push('3 m altı: fazla yakın');
    if (option?.offside) exclusions.push('Ofsayt konumunda');
    if (option?.blockers.length) exclusions.push(`Pas koridorunda rakip: ${option.blockers.map(id => '#' + ((id - 1) % 11 + 1)).join(', ')}`);
    const chanceExclusions = [...exclusions];
    if (length > 42) exclusions.push('42 m normal pas sınırının dışında');
    if (q.keeper) chanceExclusions.push('Kaleci gol fırsatı adayı değil');
    if (length > 38) chanceExclusions.push('38 m fırsat pası sınırının dışında');
    if (!scoringChance.clear) chanceExclusions.push('Şut koridoru kapalı');
    if (scoringChance.range > 24) chanceExclusions.push('Pas hedefinde kaleye 24 m üzerinde');
    if (scoringChance.angle > .85) chanceExclusions.push('Pas hedefindeki şut açısı 0,85 radyan üzerinde');
    if (scoringChance.nearest < 3) chanceExclusions.push('Pas hedefinde rakip 3 m içinde');
    if (scoringChance.keeperDistance < 2.5) chanceExclusions.push('Pas hedefinde kaleci 2,5 m içinde');
    if (chanceValue <= Math.max(.3, own.quality + .12)) chanceExclusions.push('Fırsat puanı gerekli eşiği aşmıyor');
    const keyPassExclusions = [...exclusions];
    if (!option?.throughBall) keyPassExclusions.push('Savunma arkası koşu yolu yok');
    if (length > 42) keyPassExclusions.push('42 m kilit pas sınırının dışında');
    if (progress < 8) keyPassExclusions.push('Koşu yolunda en az 8 m ilerleme yok');
    if (localPoint(option?.aim ?? q, p.team).u < 68) keyPassExclusions.push('Buluşma noktası son bölgeye yeterince yakın değil');
    if (arrival.nearest < 2.5) keyPassExclusions.push('Buluşma noktasında rakip 2,5 m içinde');
    if (arrival.keeperDistance < 4) keyPassExclusions.push('Kaleci buluşma noktasına 4 m içinde');
    return { id: q.id, number: q.number, role: roleOf(q).code, option, length, progress, space: chance.nearest,
      terms, value, chanceValue, keyPassValue, chanceQuality: chance.quality, arrivalQuality: arrival.quality,
      chanceThreshold: Math.max(.3, own.quality + .12), exclusions, chanceExclusions, keyPassExclusions };
  });
}
export function ballSecurity(p) {
  const pass = clamp(((p.traits?.passAccuracy ?? .7) - .7) / .26, 0, 1);
  const pace = clamp(((p.traits?.pace ?? .87) - .87) / (.87 * .3), 0, 1);
  const stamina = clamp(((p.traits?.stamina ?? 60) - 60) / 30, 0, 1);
  return clamp(pass * .38 + pace * .27 + (p.energy ?? 1) * .2 + stamina * .15, 0, 1);
}
function carryPlan(game, p) {
  const at = localPoint(p, p.team), role = roleOf(p), goal = worldPoint(105, 34, p.team), security = ballSecurity(p);
  const opponents = activePlayers(game).filter(q => q.team !== p.team && !q.keeper);
  const ahead = opponents.filter(q => localPoint(q, p.team).u > at.u - .5 && segmentDistance(q, p, goal).distance < 5.5);
  const chaser = opponents.filter(q => localPoint(q, p.team).u <= at.u + .5 && distance(q, p) < 7).sort((a, b) => distance(a, p) - distance(b, p))[0];
  const clearBreakaway = at.u >= 55 && ahead.length === 0;
  let mode = 'forward', u = Math.min(p.keeper ? role.maxU : 103, at.u + 7);
  let v = clamp(at.v + clamp((34 - at.v) * .3, -3, 3), ...role.lane);
  if (clearBreakaway && chaser) {
    const chaserAt = localPoint(chaser, p.team), side = chaserAt.v <= at.v ? 1 : -1;
    mode = security >= .58 ? 'diagonal' : 'shield';
    u = Math.min(103, at.u + (mode === 'diagonal' ? 7 : 1.2));
    v = clamp(at.v + side * (mode === 'diagonal' ? 4.5 : 1.4), 3, 65);
  }
  return { aim: worldPoint(u, v, p.team), mode, security, clearBreakaway, chaser: chaser?.id ?? null, ahead: ahead.map(q => q.id) };
}
const decimal = n => Number(n).toFixed(2);
function carryingAssessment(game, p, shot) {
  const plan = carryPlan(game, p), next = plan.aim;
  const gain = shot.range - distance(next, worldPoint(105, 34, p.team));
  const blocked = activePlayers(game).some(q => {
    if (q.team === p.team || q.keeper) return false;
    const hit = segmentDistance(q, p, next);
    return hit.t > .05 && hit.distance < 3.3;
  });
  const checks = [
    [!p.keeper, 'Saha oyuncusu olmalı'], [shot.range < 45 && shot.range > 14, `Kaleye mesafe ${decimal(shot.range)} m; 14 < mesafe < 45`],
    [shot.nearest > 3.2 || plan.clearBreakaway && plan.chaser, plan.clearBreakaway && plan.chaser ? `Öndeki kale koridoru açık; arkadaki ${(plan.chaser - 1) % 11 + 1} numaralı rakibe karşı ${plan.mode === 'diagonal' ? 'çapraz sürüş' : 'top saklama'} seçildi` : `En yakın saha rakibi ${decimal(shot.nearest)} m > 3,2`],
    [shot.keeperDistance > 7, `Kaleci ${decimal(shot.keeperDistance)} m > 7`], [!shot.emptyGoal, 'Kale boş görünmüyor'],
    [distance(p, next) >= (plan.mode === 'shield' ? .5 : 2.5) && gain > (plan.mode === 'shield' ? .3 : 1.5), plan.mode === 'shield' ? `Top saklama hedefi ${decimal(distance(p, next))} m; geri gitmeden kaleye ${decimal(gain)} m yaklaşır` : `Koşu ${decimal(distance(p, next))} m ≥ 2,5; kaleye yaklaşma ${decimal(gain)} m > 1,5`],
    [!blocked, 'Koşu koridorunun 3,3 m yakınında engel yok'],
  ];
  return { ok: checks.every(([ok]) => ok), detail: `${checks.map(([ok, text]) => `${ok ? '✓' : '✕'} ${text}`).join(' · ')} · Top koruma yeteneği %${Math.round(plan.security * 100)}`,
    aim: plan.aim, carryMode: plan.mode, security: plan.security, clearBreakaway: plan.clearBreakaway, chaser: plan.chaser };
}
// Return action AND recipient together; execution must not reuse a stale local
// target after the current pitch has revealed a better scoring opportunity.
export function chooseDecision(game, p) {
  const i = p.intent, choices = [];
  const order = ['better-chance', 'key-pass', 'approach-goal', 'finish', 'planned-pass', 'keep-ball'];
  const decision = (action, reason, option = null) => ({ action, target: option?.target ?? null, aim: option?.aim ?? null, reason, carryMode: option?.carryMode ?? null,
    throughBall: !!option?.throughBall, leadDistance: option?.leadDistance ?? 0,
    choices: [...choices.map(c => ({ ...c, selected: c.reason === reason })), ...order.filter(key => !choices.some(c => c.reason === key)).map(key => ({ reason: key, skipped: true }))] });
  if (!i || p.active === false) return decision('wait', 'no-plan');
  if (game.setPiece?.taker === p.id) {
    choices.push({ reason: game.setPiece.kind === 'penalty' ? 'penalty' : game.setPiece.kind === 'freeKick' && shootingWindow(game, p).range <= (i.shootRange || 28) + 2 ? 'free-kick' : 'restart', ok: true,
      detail: `Duran top: ${game.setPiece.kind}. Penaltıda şut; direkt serbest vuruşta mesafe ≤ ${decimal((i.shootRange || 28) + 2)} m ise şut; diğer durumda pas.` });
    if (game.setPiece.kind === 'penalty') return decision('shoot', 'penalty');
    if (game.setPiece.kind === 'freeKick' && shootingWindow(game, p).range <= (i.shootRange || 28) + 2) return decision('shoot', 'free-kick');
    return decision('pass', 'restart', passOption(game, p, game.players[i.target - 1]));
  }
  const shot = shootingWindow(game, p), allowed = i.shootRange ?? roleOf(p).range;
  const candidates = i.evaluatedAt === game.elapsed ? i.candidates : evaluatePasses(game, p);
  const best = candidates.filter(c => !c.chanceExclusions.length).sort((a, b) => b.chanceValue - a.chanceValue)[0];
  choices.push({ reason: 'better-chance', ok: !!best, detail: best ? `#${best.number}: fırsat ${decimal(best.chanceValue)} > eşik ${decimal(best.chanceThreshold)}; pas isabeti %${Math.round(best.option.accuracy * 100)}, beklenen sapma ${decimal(best.option.errorRadius)} m; uygun adaylar arasında en yüksek.${best.option.throughBall ? ` Top ayağına değil, kaleye gidiş yoluna ${decimal(best.option.leadDistance)} m öne bırakılır.` : ''}` : `Uygun aday yok. Güvenli koridor, ofsaytsız konum, mesafe ≤ 38 m, pas hedefinde kaleye mesafe ≤ 24 m ve fırsat puanı > ${decimal(Math.max(.3, shot.quality + .12))} gerekli.` });
  if (best) return decision('pass', 'better-chance', best.option);
  const keyPass = candidates.filter(c => !c.keyPassExclusions.length).sort((a, b) => b.keyPassValue - a.keyPassValue)[0];
  choices.push({ reason: 'key-pass', ok: !!keyPass, detail: keyPass ? `#${keyPass.number}: savunma arkasındaki buluşma noktasına ${decimal(keyPass.option.leadDistance)} m koşu payı; pas isabeti %${Math.round(keyPass.option.accuracy * 100)}, beklenen sapma ${decimal(keyPass.option.errorRadius)} m; kilit pas puanı ${decimal(keyPass.keyPassValue)}.` : 'Güvenli, ofsaytsız, en az 8 m ilerleyen ve son bölgede boş buluşma noktası oluşturan koşu yok.' });
  if (keyPass) return decision('pass', 'key-pass', keyPass.option);
  const carry = carryingAssessment(game, p, shot); choices.push({ reason: 'approach-goal', ...carry });
  if (carry.ok) return decision('dribble', 'approach-goal', carry);
  const shotChecks = [[!p.keeper, 'Saha oyuncusu'], [shot.range <= allowed, `Mesafe ${decimal(shot.range)} ≤ oyuncunun şut gücü menzili ${allowed} m`],
    [shot.angle < .9, `Açı ${decimal(shot.angle)} < 0,9 radyan`], [shot.clear, 'Şut koridoru açık'],
    [shot.range < 20 || shot.nearest > 1.6, `Mesafe < 20 m veya en yakın rakip ${decimal(shot.nearest)} > 1,6 m`],
    [true, `Oyuncunun şut isabeti %${Math.round((p.traits?.shotAccuracy ?? .72) * 100)}; vuruş sapması fizik anında hesaplanır`]];
  const canShoot = shotChecks.every(([ok]) => ok);
  choices.push({ reason: 'finish', ok: canShoot, detail: shotChecks.map(([ok, text]) => `${ok ? '✓' : '✕'} ${text}`).join(' · ') });
  if (canShoot) return decision('shoot', 'finish');
  const option = i.action === 'pass' ? passOption(game, p, game.players[i.target - 1]) : null;
  choices.push({ reason: 'planned-pass', ok: !!option?.safe, detail: `${i.passPolicy?.detail ?? 'Önceden belirlenmiş pas niyeti'}. ${i.action === 'pass' ? `#${(i.target - 1) % 11 + 1} için koridor/ofsayt kontrolü: ${option?.safe ? 'uygun' : 'uygun değil'}` : 'Pas tetiklenmedi'}.` });
  if (i.action === 'pass') {
    if (option?.safe) return decision('pass', 'planned-pass', option);
  }
  const fallbackCarry = carryPlan(game, p);
  choices.push({ reason: 'keep-ball', ok: true, detail: `Üst öncelikte uygulanabilir pas, yaklaşma veya şut seçilmedi; ${fallbackCarry.mode === 'diagonal' ? 'arkadaki baskıdan çapraz sürüşle kaç' : fallbackCarry.mode === 'shield' ? 'geri dönmeden vücudunu araya koyup topu sakla' : 'topu ileri sürerek koru'}. Top koruma yeteneği %${Math.round(fallbackCarry.security * 100)}.` });
  return decision('dribble', 'keep-ball', { aim: fallbackCarry.aim, carryMode: fallbackCarry.mode });
}
export const chooseAction = (game, p) => chooseDecision(game, p).action;
function anchor(game, p) {
  const role = roleOf(p), b = localPoint(game.ball, p.team), phase = phaseFor(game, p.team);
  const attacking = phase === 'attack' || phase === 'counter', type = role.type;
  let u, v = role.v + clamp((b.v - 34) * .13, -4, 4);
  if (attacking) {
    const back = clamp(b.u - 25, 20, 52);
    if (type === 'keeper') u = 6;
    else if (type === 'centreBack') u = back;
    else if (type === 'fullBack' || type === 'wingBack') {
      const sameSide = role.v < 34 ? b.v < 34 : b.v >= 34;
      u = type === 'wingBack' ? sameSide ? clamp(b.u + 2, 33, 90) : back + 14 : sameSide ? clamp(b.u - 4, 28, 82) : back + 6;
    } else if (type === 'holding') u = clamp(b.u - 14, 27, 68);
    else if (type === 'central') u = clamp(b.u + role.offset, 32, 78);
    else if (type === 'wideMid') u = clamp(b.u + 3, 37, 90);
    else if (type === 'attackingMid') u = clamp(b.u + 5, 43, 91);
    else u = clamp(b.u + (phase === 'counter' ? 18 : 10), 53, 97);
  } else {
    const deepestThreat = Math.min(99, ...activePlayers(game).filter(q => q.team !== p.team && !q.keeper
      && ['striker', 'winger', 'attackingMid'].includes(roleOf(q).type) && localPoint(q, p.team).u < 55)
      .map(q => localPoint(q, p.team).u));
    // The line drops goal-side of the deepest attacker. Individual defenders
    // are assigned below; the rest of the unit keeps a compact covering line.
    const back = clamp(Math.min(b.u - 12, deepestThreat - 2.5), 4, 48);
    if (type === 'keeper') u = 4;
    else if (['centreBack', 'fullBack', 'wingBack'].includes(type)) u = back;
    else if (type === 'holding') u = back + 8;
    else if (['central', 'wideMid'].includes(type)) u = back + 12;
    else if (type === 'attackingMid') u = back + 20;
    else if (type === 'winger') u = back + 23;
    else u = Math.min(70, back + 28);
  }
  const attackRules = {
    keeper: '6', centreBack: 'kısıtla(top.u − 25, 20, 52)',
    holding: 'kısıtla(top.u − 14, 27, 68)', central: `kısıtla(top.u + ${role.offset}, 32, 78)`,
    wideMid: 'kısıtla(top.u + 3, 37, 90)', attackingMid: 'kısıtla(top.u + 5, 43, 91)',
  };
  const sameSide = role.v < 34 ? b.v < 34 : b.v >= 34;
  attackRules.fullBack = sameSide ? 'kısıtla(top.u − 4, 28, 82)' : 'savunma hattı + 6';
  attackRules.wingBack = sameSide ? 'kısıtla(top.u + 2, 33, 90)' : 'savunma hattı + 14';
  const defendOffset = ['holding'].includes(type) ? 8 : ['central', 'wideMid'].includes(type) ? 12 : type === 'attackingMid' ? 20 : type === 'winger' ? 23 : 0;
  const formula = attacking ? attackRules[type] ?? `kısıtla(top.u + ${phase === 'counter' ? 18 : 10}, 53, 97)` :
    type === 'keeper' ? '4' : type === 'striker' ? 'min(70, savunma hattı + 28)' : `savunma hattı + ${defendOffset}`;
  const defensiveThreat = attacking ? 99 : Math.min(99, ...activePlayers(game).filter(q => q.team !== p.team && !q.keeper
    && ['striker', 'winger', 'attackingMid'].includes(roleOf(q).type) && localPoint(q, p.team).u < 55)
    .map(q => localPoint(q, p.team).u));
  return { u, v, phase, formula, back: attacking ? clamp(b.u - 25, 20, 52) : clamp(Math.min(b.u - 12, defensiveThreat - 2.5), 4, 48) };
}
export function tacticalTargets(game) {
  const all = activePlayers(game), possession = controlTeam(game), targets = new Map();
  const passSource = game.flight?.kind === 'pass' ? game.flight : game.loose && game.looseFrom?.kind === 'pass' ? game.looseFrom : null;
  const pressing = new Set(), chasing = new Set(), covering = new Map();
  for (const team of [0, 1]) {
    const b = localPoint(game.ball, team), phase = phaseFor(game, team);
    const suitable = all.filter(p => p.team === team && !p.keeper && b.v >= roleOf(p).lane[0] - 2 && b.v <= roleOf(p).lane[1] + 2);
    if (game.loose) {
      const nearest = suitable.sort((a, b) => distance(a, game.ball) - distance(b, game.ball))[0]; if (nearest) chasing.add(nearest.id);
    } else if (team !== possession) {
      const candidates = suitable.filter(p => p.intent?.move === 'press' && distance(p, game.ball) < (phase === 'recover' ? 9 : 15));
      candidates.sort((a, b) => distance(a, game.ball) - distance(b, game.ball));
      for (const p of candidates.slice(0, phase === 'recover' ? 1 : 2)) pressing.add(p.id);
    }
  }
  for (const team of [0, 1]) {
    if (team === possession) continue;
    const available = all.filter(p => p.team === team && ['centreBack', 'fullBack', 'wingBack'].includes(roleOf(p).type)
      && !pressing.has(p.id) && !chasing.has(p.id));
    const threats = all.filter(p => p.team !== team && !p.keeper && ['striker', 'winger', 'attackingMid'].includes(roleOf(p).type)
      && localPoint(p, team).u < 55).sort((a, b) => localPoint(a, team).u - localPoint(b, team).u);
    for (const threat of threats) {
      const t = localPoint(threat, team);
      available.sort((a, b) => {
        const aa = localPoint(a, team), bb = localPoint(b, team);
        return Math.abs(aa.v - t.v) * .75 + Math.abs(aa.u - t.u) * .25 - (Math.abs(bb.v - t.v) * .75 + Math.abs(bb.u - t.u) * .25);
      });
      const defender = available.shift(); if (!defender) break;
      covering.set(defender.id, { threat: threat.id, u: Math.max(4, t.u - 2.5), v: t.v });
    }
  }
  for (const p of all) {
    const i = p.intent, role = roleOf(p), current = localPoint(p, p.team), a = anchor(game, p);
    let u = a.u, v = a.v, duty = a.phase;
    if (!i) { targets.set(p.id, { x: p.x, y: p.y, duty: 'hold', speed: 0 }); continue; }
    const requested = localPoint(i, p.team);
    // local adjusts the role anchor; it cannot swap a left back onto the right wing.
    u += clamp(requested.u - u, -7, 7) * .35; v += clamp(requested.v - v, -5, 5) * .35;
    const adjusted = { u, v }; let override = 'shape', manualCarry = false;
    if (game.freeKickWallIds?.includes(p.id) && (game.setPiece?.kind === 'freeKick' || game.flight?.reason === 'manual-shot')) {
      override = 'freeKickWall'; u = current.u; v = current.v; duty = 'hold';
    } else if (p.keeper) {
      override = 'keeper';
      u = clamp(3.5 + localPoint(game.ball, p.team).u * .035, 3.5, 7);
      v = clamp(34 + (localPoint(game.ball, p.team).v - 34) * .25, 29, 39);
      if (game.flight?.kind === 'shot' && game.flight.team !== p.team) v = clamp(localPoint(game.flight.aim, p.team).v, 29, 39);
    } else if (p.id === game.owner) {
      override = game.ballAction === 'dribble' ? 'carry' : 'onBallHold';
      duty = game.ballAction || chooseAction(game, p);
      if (duty === 'dribble') {
        const carry = p.decision?.action === 'dribble' && p.decision.aim ? { aim: p.decision.aim, mode: p.decision.carryMode } : carryPlan(game, p);
        const next = localPoint(carry.aim, p.team); manualCarry = carry.mode === 'manual'; u = manualCarry ? next.u : Math.max(current.u, next.u); v = next.v; override = `carry-${carry.mode || 'forward'}`;
      }
      else { u = current.u; v = current.v; }
    } else if (passSource?.to === p.id) {
      override = 'receive';
      const target = game.flight?.kind === 'pass' ? game.flight.reason === 'manual-pass' ? receivePoint(game, p) : game.flight.aim : game.ball;
      const b = localPoint(target, p.team); u = b.u; v = b.v; duty = 'receive';
    } else if (pressing.has(p.id) || chasing.has(p.id)) {
      override = chasing.has(p.id) ? 'chase' : 'press';
      const b = localPoint(game.ball, p.team); u = b.u; v = b.v; duty = chasing.has(p.id) ? 'recoverBall' : 'press';
    } else if (covering.has(p.id)) {
      const cover = covering.get(p.id); override = 'coverRunner';
      u = Math.min(u, cover.u); v = cover.v; duty = 'coverRunner';
    }
    const receiving = passSource?.to === p.id;
    const wallDuty = override === 'freeKickWall';
    const beforeLimit = { u, v }, offsideLimit = p.team === possession && game.owner && p.id !== game.owner && !p.keeper ? offsideLine(game, p.team).u - .6 : null;
    if (offsideLimit !== null) u = Math.min(u, offsideLimit);
    const movementLane = manualCarry || receiving || wallDuty ? [1, 67] : covering.has(p.id) ? [Math.max(2, role.lane[0] - 8), Math.min(66, role.lane[1] + 8)] : role.lane;
    const maxU = manualCarry || receiving || wallDuty ? 104 : p.id === game.owner && !p.keeper ? 103 : role.maxU;
    u = clamp(u, 1, maxU); v = clamp(v, ...movementLane);
    const recovering = a.phase === 'recover' || (a.phase === 'defend' && current.u > a.u + 6);
    const sprinting = receiving || recovering || pressing.has(p.id) || chasing.has(p.id) || covering.has(p.id);
    const speedMode = p.keeper ? 'keeper' : p.id === game.owner ? 'onBall' : sprinting ? 'sprint' : 'offBall';
    let speed = game.speedSettings?.[speedMode] ?? { keeper: 4.8, onBall: 4.9, sprint: 7.1, offBall: 5.7 }[speedMode];
    if (wallDuty) speed = 0;
    if (p.id === game.owner && p.decision?.carryMode === 'shield') speed *= .42;
    targets.set(p.id, { ...worldPoint(u, v, p.team), duty: recovering && !pressing.has(p.id) && !covering.has(p.id) && p.id !== game.owner ? 'recover' : duty, speed,
      movementTrace: { phase: a.phase, current, ball: localPoint(game.ball, p.team), anchor: a, adjusted, override, beforeLimit, offsideLimit,
        lane: [...movementLane], maxU, final: { u, v },
        ballDistance: distance(p, game.ball), inBallLane: localPoint(game.ball, p.team).v >= role.lane[0] - 2 && localPoint(game.ball, p.team).v <= role.lane[1] + 2,
        pressers: [...pressing].filter(id => game.players[id - 1].team === p.team), chasers: [...chasing].filter(id => game.players[id - 1].team === p.team),
        speed, speedMode, pace: p.traits.pace, stamina: p.traits.stamina, energy: p.energy ?? 1,
        fatigue: .82 + .18 * (p.energy ?? 1), recovering,
        cover: covering.has(p.id) ? { ...covering.get(p.id) } : null } });
  }
  return targets;
}
