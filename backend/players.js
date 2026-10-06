import { activePlayers, roleOf, localPoint, worldPoint, phaseFor, evaluatePasses, shootingWindow, chooseDecision, tacticalTargets } from './tactics.js';

export const THINK_INTERVAL = .2;

// All players read the same world state, then their own intents are committed
// together. No player gets an advantage from being earlier in the roster.
function intentFor(game, p) {
  const role = roleOf(p), at = localPoint(p, p.team), phase = phaseFor(game, p.team);
  const candidates = evaluatePasses(game, p);
  const best = candidates.filter(c => !c.exclusions.length).sort((a, b) => b.value - a.value)[0];
  const pressure = shootingWindow(game, p).nearest;
  const pass = best && (p.keeper || best.value > .55 && best.progress > 3 || pressure < 4 || game.setPiece?.taker === p.id);
  const passPolicy = { triggered: !!pass, best: best?.id ?? null, value: best?.value ?? null, progress: best?.progress ?? null, pressure,
    detail: best ? `En iyi normal pas #${best.number}: puan ${best.value.toFixed(3)}, pas ilerlemesi ${best.progress.toFixed(2)} m, oyuncunun pas isabeti %${Math.round(p.traits.passAccuracy * 100)}, beklenen sapma ${best.option.errorRadius.toFixed(2)} m${best.option?.throughBall ? `, koşu yoluna ${best.option.leadDistance.toFixed(2)} m öne` : ''}. Tetik: kaleci ${p.keeper ? 'evet' : 'hayır'}; (puan > 0,55 ve ilerleme > 3 m) ${best.value > .55 && best.progress > 3 ? 'evet' : 'hayır'}; rakip ${pressure.toFixed(2)} m < 4 ${pressure < 4 ? 'evet' : 'hayır'}; duran top ${game.setPiece?.taker === p.id ? 'evet' : 'hayır'}` : '42 m içinde güvenli, ofsaytsız ve en az 3 m uzakta uygun normal pas adayı yok' };
  return {
    id: p.id, ...worldPoint(Math.min(at.u, role.maxU), role.v, p.team),
    move: p.keeper ? 'hold' : phase === 'defend' || phase === 'recover' ? 'press' : 'support',
    action: pass ? 'pass' : 'dribble', target: pass ? best.id : null,
    candidates, evaluatedAt: game.elapsed, passPolicy,
    shootRange: p.keeper ? 0 : p.traits.shotPower, tackle: p.yellows || p.keeper ? 'cautious' : p.traits.aggression > .6 && pressure < 4 ? 'hard' : 'normal',
  };
}

export function think(game) {
  const trigger = game.thoughtOwner === undefined ? 'initial' : game.thoughtOwner !== game.owner ? 'possession' : game.thoughtRevision !== game.revision ? 'event' : 'interval';
  const players = activePlayers(game), intents = players.map(p => intentFor(game, p));
  for (let i = 0; i < players.length; i++) players[i].intent = intents[i];
  const owner = players.find(p => p.id === game.owner);
  let possession = owner ? chooseDecision(game, owner) : null;
  const manualOwner = game.manualPlan ? game.players[game.manualPlan.owner - 1] : null;
  const manual = game.manualPlan && manualOwner && game.controlTeam === manualOwner.team ? game.manualPlan : null;
  if (manual && owner?.id === manual.owner) {
    const recipient = manual.passTo ? game.players[manual.passTo - 1] : null;
    if (manual.action === 'shoot') possession = { action: 'shoot', target: null, aim: { ...manual.aim }, reason: 'manual-shot', power: manual.power, curve: manual.curve, curveSkill: manual.curveSkill, lift: manual.lift,
      throughBall: false, leadDistance: 0, carryMode: null, choices: [{ reason: 'manual-shot', ok: true, selected: true,
        detail: `Sen oyna planı: #${owner.number} çizilen noktaya %${Math.round(manual.power * 100)} güç ve %${Math.round(manual.curve * 100)} falsoyla şut çeker.` }] };
    else if (manual.action === 'dribble') possession = { action: 'dribble', target: null, aim: { ...manual.aim }, reason: 'manual-dribble', carryMode: 'manual',
      throughBall: false, leadDistance: 0, choices: [{ reason: 'manual-dribble', ok: true, selected: true,
        detail: `Sen oyna planı: #${owner.number} çizilen yol boyunca top sürer; Space ile yeniden pas veya şut kararı istenir.` }] };
    else if (manual.action === 'pass' && (!recipient || recipient.active && recipient.team === owner.team)) {
      const leadDistance = recipient ? Math.hypot(manual.aim.x - recipient.x, manual.aim.y - recipient.y) : 0;
      possession = { action: 'pass', target: recipient?.id ?? null, aim: { ...manual.aim }, reason: 'manual-pass', power: manual.power, curve: manual.curve,
        throughBall: leadDistance > 2.5, leadDistance, carryMode: null, choices: [{ reason: 'manual-pass', ok: true, selected: true,
          detail: recipient ? `Sen oyna planı: #${owner.number} topu boş alandaki çizilen noktaya gönderir; seçilen alıcı #${recipient.number}.` :
            `Sen oyna planı: #${owner.number} topu belirli bir alıcı olmadan çizilen boş alana gönderir.` }] };
    }
  }
  if (game.debug && possession) possession.trace = { evaluatedAt: game.elapsed, candidates: owner.intent.candidates,
    ownQuality: shootingWindow(game, owner).quality, pressure: shootingWindow(game, owner).nearest, vision: owner.traits.vision };
  game.ballAction = possession?.action ?? 'wait';
  const targets = tacticalTargets(game), manualRuns = new Map((manual?.runs ?? []).map(run => [run.id, run]));
  for (const p of players) {
    let movement = targets.get(p.id); const run = manualRuns.get(p.id);
    const manualPass = game.flight?.kind === 'pass' ? game.flight : game.loose && game.looseFrom?.kind === 'pass' ? game.looseFrom : null;
    const receivingManualPass = manualPass?.to === p.id && manualPass.reason === 'manual-pass';
    if (run && p.team === manualOwner?.team && p !== owner && !receivingManualPass) {
      const local = localPoint(run, p.team), speed = game.speedSettings.offBall;
      movement = { ...movement, x: run.x, y: run.y, duty: 'manualRun', speed,
        movementTrace: { ...movement.movementTrace, override: 'manualRun', beforeLimit: local, final: local, speed, speedMode: 'offBall' } };
    }
    p.decision = { ...movement, action: movement.duty, target: null, reason: movement.duty, ...(p === owner ? possession : {}) };
    p.decision.report = { at: game.elapsed, trigger, hadBall: p === owner, policy: p === owner ? p.intent.passPolicy : null,
      choices: p === owner ? possession.choices : [], movement: movement.movementTrace, tackle: p.intent.tackle };
    p.duty = movement.duty; p.thoughts++; game.decisionCount++;
  }
  game.hasPlan = true; game.nextThink = game.elapsed + THINK_INTERVAL;
  game.thoughtOwner = game.owner; game.thoughtRevision = game.revision;
}
