import { Playback, readMatch } from './playback.js';
import { createPitch } from './pitch.js';

const $ = id => document.getElementById(id), render = createPitch($('pitch'));
const TEAM_NAMES = ['Lime FC', 'Coral United'], DURATION = 300;
let playback = new Playback(), game = null, running = false, failed = false, stepUntil = null;
let controller = null, generation = 0, lastFrame = performance.now(), lastEvent = 0, seed = 0;
let goalUntil = 0, eventUntil = 0, exitUntil = 0;
let stadiumAudio = null, goalAudio = null, dangerAudio = null, shotAudio = null, kickAudio = null, stadiumEnabled = true, shotRoarActive = false;
let started = false;
let decisionUntil = null, decisionKey = '';
let matchId = null, chunkRequested = false, requestedSpeeds = null;
let lastAutoPlayerId = 10;
let matchMode = 'normal', manualDraft = null, manualDrag = null, applyingManual = false, manualStopRequested = false;
let manualMeterPower = .3;
let pitchExpanded = false, fullscreenPending = false;
let powerPointerHandled = false;
let onlineRoomCode = null, onlinePlayerToken = null, onlineTeam = null, onlineRoomReady = false;
const manualKeys = new Set(), DRIVE_KEYS = { KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0], KeyW: [0, -1] };
const rosterCells = new Map();
const formationInputs = ['home-formation', 'away-formation'];
const selectedFormations = () => formationInputs.map(id => $(id).value || '4-4-2');
const DEFAULT_SPEEDS = { onBall: 4.9, offBall: 5.7, sprint: 7.1, keeper: 4.8 };
const SPEED_INPUTS = { onBall: 'speed-on-ball', offBall: 'speed-off-ball', sprint: 'speed-sprint', keeper: 'speed-keeper' };
const selectedSpeeds = () => Object.fromEntries(Object.entries(SPEED_INPUTS).map(([key, id]) => [key, Number($(id).value) || DEFAULT_SPEEDS[key]]));
const selectedFreePlayers = () => ({ home: Number($('free-home-count').value), away: Number($('free-away-count').value) });
const roomWaiters = new Set(), number = n => n.toLocaleString('tr-TR');
const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
const shirt = id => id ? `#${(id - 1) % 11 + 1}` : '';
const phases = { attack: 'Hücum', counter: 'Kontra atak', defend: 'Savunma', recover: 'Geri koşu' };
const actions = { ...phases, pass: 'Pas', shoot: 'Şut', dribble: 'Top sürme', press: 'Pres', hold: 'Mevki koruma', support: 'Destek', receive: 'Pas karşılama', recoverBall: 'Topa koşu', coverRunner: 'Forvetin gol tarafını kapatma', manualRun: 'Senin çizdiğin koşu', wait: 'Bekleme' };
const decisionAction = p => p.decision?.carryMode === 'diagonal' ? 'Çapraza top sürme' : p.decision?.carryMode === 'shield' ? 'Topu saklama' : actions[p.decision?.action] || 'Bekleme';
const reasons = { ...actions, 'better-chance': 'Daha iyi gol pozisyonuna pas', 'key-pass': 'Savunma arkasına kilit pas', 'approach-goal': 'Boş alandan kaleye yaklaşma', finish: 'Uygun şut fırsatı', 'planned-pass': 'Güvenli pas seçeneği', 'keep-ball': 'Topu koruyarak ilerleme', 'manual-pass': 'Sen oyna · Çizilen pas', 'manual-shot': 'Sen oyna · Çizilen şut', 'manual-dribble': 'Sen oyna · Çizilen top sürme', penalty: 'Penaltı', 'free-kick': 'Serbest vuruş', restart: 'Duran top', 'no-plan': 'Oyun yeniden başlayacak' };
const eventNames = { foul: 'FAUL', freeKick: 'SERBEST VURUŞ', penalty: 'PENALTI', yellow: 'SARI KART', red: 'KIRMIZI KART', injury: 'SAKATLIK', deflection: 'SEKEN TOP', pass: 'PAS', shot: 'ŞUT', save: 'KURTARIŞ', intercept: 'ARAYA GİRME', tackle: 'TOP KAPMA', goal: 'GOL!', kickoff: 'SANTRA', corner: 'KORNER', throwIn: 'TAÇ', goalKick: 'AUT', recovery: 'TOP KONTROLÜ', fullTime: 'MAÇ SONU' };
const overlayEvents = { throwIn: 'TAÇ', goalKick: 'AUT', offside: 'OFSAYT', corner: 'KORNER' };
function showGoalMap(e) {
  const y = Math.max(30.34, Math.min(37.66, Number.isFinite(e.crossY) ? e.crossY : 34));
  const z = Math.max(0, Math.min(2.44, Number.isFinite(e.crossZ) ? e.crossZ : 0));
  const mouthPosition = (y - 30.34) / 7.32, scorerView = e.team === 1 ? 1 - mouthPosition : mouthPosition;
  $('goal-ball-marker').style.left = `${12 + scorerView * 76}%`;
  $('goal-ball-marker').style.top = `${78 - z / 2.44 * 62}%`;
  const side = scorerView < .34 ? 'sol' : scorerView > .66 ? 'sağ' : 'orta';
  const height = z < .55 ? 'alt' : z < 1.35 ? 'orta yükseklik' : z < 2.05 ? 'yüksek' : 'üst köşe';
  const distance = Number.isFinite(e.shotDistance) ? ` · ${e.shotDistance.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m şut` : '';
  $('goal-location').textContent = `${TEAM_NAMES[e.team]} · ${side} ${height} · ${z.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} m yükseklik${distance}`;
}
function showExitMap(e) {
  const y = Math.max(0, Math.min(68, Number.isFinite(e.exitY) ? e.exitY : 20));
  const x = Number.isFinite(e.exitX) ? e.exitX : 105, z = Math.max(0, Number.isFinite(e.exitZ) ? e.exitZ : 0);
  const end = x <= 52.5 ? 'sol' : 'sağ', wide = y < 30.34 ? 30.34 - y : y > 37.66 ? y - 37.66 : 0;
  $('exit-title').textContent = e.type === 'corner' ? 'KORNER' : 'AUT';
  $('exit-team').textContent = `${TEAM_NAMES[e.team]} kullanacak`;
  $('exit-ball-marker').style.left = `${3 + y / 68 * 94}%`;
  const position = wide > 0 ? `direğin ${wide.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m dışından` : z > 2.44 ? `üst direğin ${(z - 2.44).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m üzerinden` : 'kale çizgisinden';
  $('exit-location').textContent = `Top ${end} taraftaki ${position} çıktı · saha genişliği konumu ${y.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m`;
  $('exit-overlay').classList.toggle('corner-map', e.type === 'corner');
  $('exit-overlay').classList.toggle('left-end', x <= 52.5);
}
function updateStadiumButton() {
  $('stadium-sound').textContent = stadiumEnabled ? '🔊 Stadyum sesi' : '🔇 Ses kapalı';
  $('stadium-sound').setAttribute?.('aria-pressed', String(stadiumEnabled));
}
async function ensureStadiumSound() {
  if (!stadiumEnabled || !globalThis.Audio) return;
  if (!stadiumAudio) {
    stadiumAudio = new globalThis.Audio('/audio/stadium-ambience.mp3'); stadiumAudio.loop = true; stadiumAudio.preload = 'auto'; stadiumAudio.volume = .24;
    goalAudio = new globalThis.Audio('/audio/goal-cheer.mp3'); goalAudio.preload = 'auto'; goalAudio.volume = .82;
    dangerAudio = new globalThis.Audio('/audio/danger-attack.mp3'); dangerAudio.preload = 'auto'; dangerAudio.volume = .58;
    shotAudio = new globalThis.Audio('/audio/shot-roar.mp3'); shotAudio.loop = true; shotAudio.preload = 'auto'; shotAudio.volume = .38;
    kickAudio = new globalThis.Audio('/audio/ball-kick.mp3'); kickAudio.preload = 'auto'; kickAudio.volume = .72;
  }
  try { await stadiumAudio.play(); } catch { /* İlk kullanıcı etkileşimine kadar tarayıcı sesi engelleyebilir. */ }
}
function playMatchSound(audio) {
  if (!stadiumEnabled || !audio) return;
  try {
    if (audio.readyState > 0) audio.currentTime = 0;
    const started = audio.play?.(); started?.catch?.(() => {});
  } catch { /* Ses hatası maç ve görüntü akışını durdurmamalı. */ }
}
function playWhistle(kind = 'start') {
  if (!stadiumEnabled) return;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass(), blasts = kind === 'end' ? [0, .48, .96] : [0];
    for (const offset of blasts) {
      const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime + offset;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(kind === 'end' ? 2450 : 2700, at);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'end' ? 2850 : 3150, at + .2);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.2, at + .025); gain.gain.exponentialRampToValueAtTime(.0001, at + .32);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + .34);
    }
    setTimeout(() => { void context.close?.(); }, kind === 'end' ? 1600 : 500);
  } catch { /* Düdük desteği yoksa maç akışı devam eder. */ }
}
function stopMatchSound(audio, reset = true) {
  try { audio?.pause?.(); if (reset && audio?.readyState > 0) audio.currentTime = 0; } catch { /* Medya hazır değilse sessizce devam et. */ }
}
function updateMatchAudio() {
  const towardGoal = game?.flight?.kind === 'shot' && (game.flight.team === 0 ? game.flight.vx > 0 : game.flight.vx < 0);
  if (towardGoal && !shotRoarActive) { shotRoarActive = true; playMatchSound(shotAudio); }
  else if (!towardGoal && shotRoarActive) { shotRoarActive = false; stopMatchSound(shotAudio); }
}
function toggleStadiumSound() {
  stadiumEnabled = !stadiumEnabled; updateStadiumButton();
  if (stadiumEnabled) { void ensureStadiumSound(); updateMatchAudio(); }
  else {
    for (const audio of [stadiumAudio, goalAudio, dangerAudio, shotAudio, kickAudio]) stopMatchSound(audio, false);
    shotRoarActive = false;
  }
}
function setPitchExpanded(expanded) {
  pitchExpanded = expanded;
  $('pitch-view').classList.toggle('pitch-expanded', expanded);
  document.body.classList.toggle('pitch-is-expanded', expanded);
  $('pitch-fullscreen').textContent = expanded ? '⤡ Küçült' : '⤢ Tam ekran';
  $('pitch-fullscreen').setAttribute('aria-pressed', String(expanded));
}
async function togglePitchFullscreen() {
  if (fullscreenPending) return;
  fullscreenPending = true;
  const view = $('pitch-view');
  try {
    if (pitchExpanded) {
      if (document.fullscreenElement === view) await document.exitFullscreen();
      setPitchExpanded(false);
    } else {
      setPitchExpanded(true);
      // Keep the in-page expanded view on browsers without element fullscreen.
      if (view.requestFullscreen) await view.requestFullscreen();
    }
  } catch {
    if (document.fullscreenElement === view) setPitchExpanded(true);
  } finally { fullscreenPending = false; }
}
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
Object.assign(eventNames, { offside: 'OFSAYT', indirectFreeKick: 'ENDİREKT SERBEST VURUŞ' });
function status(text, active = false) { $('state-label').replaceChildren(document.createElement('i'), document.createTextNode(text)); $('state-label').classList.toggle('running', active); }
function controls() {
  $('start').disabled = !game || failed || game.ended || !!playback.manualPause;
  $('start').textContent = running ? 'Ⅱ Duraklat' : game?.elapsed ? '▶ Devam et' : '▶ Maçı başlat';
  $('step').disabled = !game || failed || running || game.ended || !!playback.manualPause;
  for (const id of formationInputs) $(id).disabled = started || !!onlinePlayerToken;
  $('match-mode').disabled = started || !!onlinePlayerToken;
  $('free-home-count').disabled = started; $('free-away-count').disabled = started;
  $('debug-next').disabled = !playback.debugPause || failed;
  $('decision-pause').disabled = !game || failed || !running;
  $('decision-next').disabled = !game || failed || running || game.ended || !selectedPlayer('decision-player')?.active;
  const manualReady = manualDraft?.kind === 'freeKick' ? manualDraft.ball && manualDraft.wall && manualDraft.aim && manualDraft.powerLocked :
    manualDraft?.aim && (manualDraft.action === 'dribble' || manualDraft.powerLocked);
  $('manual-apply').disabled = !manualReady || applyingManual;
  $('formation-hint').textContent = started ? 'Dizilişi değiştirmek için Yeni maç düğmesini kullan.' : 'İki takımın dizilişini ayrı seç. Yerleşim sahada güncellenir.';
}
const BUFFER_TARGET = 1, BUFFER_LOW = .35;
const bufferTarget = () => ['manual', 'free', 'online'].includes(matchMode) ? .05 : BUFFER_TARGET;
function updateFreeModeControls() {
  const free = ($('match-mode').value || 'normal') === 'free'; $('free-mode-setup').hidden = !free;
  $('online-room-setup').hidden = ($('match-mode').value || 'normal') !== 'online';
  $('free-home-count-value').textContent = $('free-home-count').value; $('free-away-count-value').textContent = $('free-away-count').value;
}
function updateModeLayout(mode = matchMode) {
  const online = mode === 'online';
  for (const id of ['decision-stat', 'segment-stat', 'speed-panel', 'decision-panel', 'log-panel', 'local-engine-panel']) $(id).hidden = online;
  $('top-stats').classList.toggle('online-summary', online);
}
function showFinalStats() {
  if (!game) return;
  const total = game.possession[0] + game.possession[1], homePossession = total ? Math.round(game.possession[0] / total * 100) : 50;
  $('final-score').textContent = `${game.score[0]} – ${game.score[1]}`;
  $('final-result').textContent = game.score[0] === game.score[1] ? 'Maç berabere tamamlandı' : `${TEAM_NAMES[game.score[0] > game.score[1] ? 0 : 1]} kazandı`;
  $('final-possession-home').textContent = `%${homePossession}`; $('final-possession-away').textContent = `%${100 - homePossession}`;
  for (const [name, values] of [['passes', game.passes], ['shots', game.shots], ['saves', game.saves], ['tackles', game.tackles], ['fouls', game.fouls]]) {
    $(`final-${name}-home`).textContent = String(values[0]); $(`final-${name}-away`).textContent = String(values[1]);
  }
  $('final-cards-home').textContent = `${game.yellowCards[0]}S · ${game.redCards[0]}K`;
  $('final-cards-away').textContent = `${game.yellowCards[1]}S · ${game.redCards[1]}K`;
  $('final-overlay').hidden = false;
}
function speedText(value) {
  const format = number => number.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${format(value)} m/sn · ${format(value * .87 * 3.6)}–${format(value * 1.131 * 3.6)} km/sa`;
}
function autoPlayerId() {
  const id = game?.owner ?? game?.flight?.from;
  if (id) lastAutoPlayerId = id;
  return lastAutoPlayerId;
}
function selectedPlayer(selectId) {
  if (!game) return null;
  const value = $(selectId).value;
  const id = value === 'auto' || !value ? autoPlayerId() : Number(value);
  return game.players.find(player => player.id === id) || game.players[9];
}
function playerOptions() {
  const automatic = Object.assign(document.createElement('option'), { value: 'auto', textContent: 'Otomatik · Top sahibi' });
  return [automatic, ...game.players.map(p => Object.assign(document.createElement('option'), { value: String(p.id), textContent: `${TEAM_NAMES[p.team]} #${p.number} · ${p.roleName}` }))];
}
function updateSpeedLabels() {
  for (const [key, id] of Object.entries(SPEED_INPUTS)) $(`${id}-value`).textContent = speedText(Number($(id).value) || DEFAULT_SPEEDS[key]);
}
const energyColor = energy => `hsl(${Math.round(Math.max(0, Math.min(1, energy)) * 120)} 78% 54%)`;
function buildRosterTable() {
  $('player-roster').replaceChildren(); rosterCells.clear();
  for (const p of game.players) {
    const row = document.createElement('tr');
    const values = [`${TEAM_NAMES[p.team]} #${p.number}`, p.roleName, `${p.traits.shotPower} m`, `%${Math.round(p.traits.shotAccuracy * 100)}`,
      `%${Math.round(p.traits.passAccuracy * 100)}`, `%${Math.round(p.traits.pace * 100)}`, `${p.traits.stamina} / 90`];
    values.forEach((value, index) => {
      const cell = document.createElement('td'); cell.textContent = value;
      if (index === 0) cell.className = `roster-player ${p.team ? 'away-player' : 'home-player'}`;
      row.append(cell);
    });
    const energy = document.createElement('td'); energy.className = 'energy-value'; row.append(energy);
    if (p.team === 1 && p.number === 1) row.className = 'team-separator';
    $('player-roster').append(row); rosterCells.set(p.id, { row, energy });
  }
}
function updateRosterTable() {
  if (rosterCells.size !== game.players.length) buildRosterTable();
  for (const p of game.players) {
    const cells = rosterCells.get(p.id), percent = Math.round(p.energy * 100);
    cells.energy.textContent = p.injured ? `%${percent} · SAKAT` : `%${percent}`;
    cells.energy.style.color = energyColor(p.energy);
    cells.row.className = `${p.team === 1 && p.number === 1 ? 'team-separator ' : ''}${p.injured ? 'injured-row' : ''}`.trim();
  }
}
async function controlMatch(action, extra = {}) {
  if (!matchId || !controller || controller.signal.aborted) return null;
  const response = await fetch('/api/match/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId, action, ...(onlinePlayerToken ? { playerToken: onlinePlayerToken } : {}), ...extra }), signal: controller.signal });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Maç kontrolü başarısız (${response.status})`); }
  return response;
}
function manualRenderDraft() {
  return manualDraft ? { kind: manualDraft.kind, owner: manualDraft.owner, passTo: manualDraft.action === 'pass' ? manualDraft.passTo : null, action: manualDraft.action,
    aim: manualDraft.aim, ball: manualDraft.ball, wall: manualDraft.wall, wallCount: manualDraft.wallCount,
    curve: manualDraft.action === 'dribble' ? 0 : manualDraft.curve, power: manualDraft.power, powerLocked: manualDraft.powerLocked,
    powerMeter: manualPowerMeterBox(), runs: [...manualDraft.runs.values()], preview: manualDraft.preview } : null;
}
function updateManualPanel(message = '') {
  const owner = game?.players.find(p => p.id === manualDraft?.owner), runCount = manualDraft?.runs.size ?? 0;
  $('manual-panel').hidden = !manualDraft; $('pitch-stage').classList.toggle('manual-drawing', !!manualDraft);
  $('manual-apply').hidden = !manualDraft;
  $('free-kick-controls').hidden = manualDraft?.kind !== 'freeKick';
  if (manualDraft?.kind === 'freeKick') {
    $('manual-title').textContent = 'Free kick · Lime FC';
    const powerState = manualDraft.powerLocked ? `güç %${Math.round(manualDraft.power * 100)}` : 'güç seçimi bekleniyor';
    $('manual-status').textContent = message || `${shirt(owner?.id)} kullanacak · ${manualDraft.ball ? 'top hazır' : 'top yeri bekleniyor'} · ${manualDraft.wallCount} kişilik otomatik baraj · yükseklik otomatik · ${manualDraft.aim ? `şut hedefi hazır · ${powerState}` : 'şut hedefi bekleniyor'}`;
    $('free-kick-ball').classList.toggle('active', manualDraft.setupTool === 'ball');
  } else if (manualDraft) {
    const teamName = TEAM_NAMES[manualDraft.team ?? 0];
    $('manual-title').textContent = matchMode === 'free' ? 'Free mod · Hücum çalışması' : matchMode === 'online' ? `Sen oyna online · ${teamName}` : 'Sen oyna · Lime FC';
    const powerState = manualDraft.action === 'dribble' ? '' : manualDraft.powerLocked ? ` · güç %${Math.round(manualDraft.power * 100)}` : manualDraft.aim ? ' · güç seçimi bekleniyor' : '';
    $('manual-status').textContent = message || `${teamName} ${shirt(owner?.id)} topun başında · ${runCount} koşu çizildi · ${manualDraft.aim ? `${manualDraft.action === 'shoot' ? 'şut' : manualDraft.action === 'dribble' ? 'top sürme' : 'pas'} hedefi hazır` : 'hedef bekleniyor'}${powerState}${manualDraft.action === 'pass' ? ` · ${manualDraft.passTo ? `${shirt(manualDraft.passTo)} alıcı` : 'alıcı seçimi isteğe bağlı'}` : ''}`;
  }
  updateManualPowerMeter(); controls();
}
function openManualControl(frame = playback.manualPause) {
  if (!frame?.manualControl) return;
  running = false; stepUntil = null; decisionUntil = null;
  if (matchMode === 'online' && frame.manualControl.team !== onlineTeam) {
    manualDraft = null; manualDrag = null; $('manual-panel').hidden = true; $('manual-apply').hidden = true;
    $('pitch-stage').classList.toggle('manual-drawing', false); status(`RAKİP PLANLIYOR · ${TEAM_NAMES[frame.manualControl.team]}`); controls(); return;
  }
  const freeKick = frame.manualControl.kind === 'freeKick';
  const setup = freeKick ? frame.manualControl.setup : null, owner = game?.players.find(p => p.id === frame.manualControl.owner);
  if (manualDraft?.checkpoint !== frame.manualControl.id) {
    manualKeys.clear();
    if (freeKick) {
      $('free-kick-wall-count').value = String(setup?.wallCount ?? Number($('free-kick-wall-count').value || 4));
    }
    const ball = setup?.ball ? { ...setup.ball } : null;
    manualDraft = { checkpoint: frame.manualControl.id, kind: freeKick ? 'freeKick' : 'manual', team: frame.manualControl.team ?? 0, owner: frame.manualControl.owner, passTo: null,
      action: 'shoot', aim: null, ball, wall: ball ? automaticFreeKickWall(ball) : null,
      wallCount: Number($('free-kick-wall-count').value || 4), setupTool: freeKick ? ball ? 'aim' : 'ball' : null,
      shotPower: setup?.shotPower ?? owner?.traits?.shotPower ?? 30, curvePower: setup?.curvePower ?? owner?.traits?.curvePower ?? 70,
      power: .3, curve: 0, powerLocked: false, meterStartedAt: performance.now(), runs: new Map(), preview: null };
  }
  manualStopRequested = false; status(matchMode === 'free' ? 'FREE MOD · HÜCUMU ÇİZ' : matchMode === 'online' ? `ONLINE · ${TEAM_NAMES[onlineTeam]} HÜCUMU ÇİZ` : 'SEN OYNA · HÜCUMU ÇİZ'); updateManualKickControls();
  if (matchMode === 'free' && frame.manualControl.repeat) updateManualPanel('Top kaybı veya oyun dışı sonrası başlangıç düzeni yeniden kuruldu. Yeni hücumu çiz.');
}
function clearManualDraft() {
  if (!manualDraft) return;
  manualDraft.aim = null; manualDraft.passTo = null; manualDraft.runs.clear(); manualDraft.preview = null; manualDrag = null;
  manualDraft.action = 'shoot'; manualDraft.curve = 0; manualDraft.power = .3; manualDraft.powerLocked = false; manualDraft.meterStartedAt = performance.now();
  if (manualDraft.kind === 'freeKick') {
    manualDraft.ball = null; manualDraft.wall = null; manualDraft.setupTool = 'ball';
    updateManualPanel('Serbest vuruş temizlendi. Topun yeni yerini sahaya tıkla.'); return;
  }
  updateManualPanel('Çizimler temizlendi. Pas için alıcıyı seçip topu göndereceğin noktayı çiz.');
}
function updateManualKickControls() {
  const action = manualDraft?.kind === 'freeKick' ? 'shoot' : manualDraft?.action === 'dribble' ? 'dribble' : manualDraft?.passTo ? 'pass' : 'shoot';
  $('manual-action-label').textContent = action === 'pass' ? 'Pas' : action === 'dribble' ? 'Top sürme · WASD' : 'Şut';
  if (manualDraft) {
    manualDraft.action = action;
    if (action === 'dribble') manualDraft.runs.delete(manualDraft.owner);
    updateManualPanel();
  }
}
const useLargePowerMeter = () => !!globalThis.matchMedia?.('(any-pointer: coarse)').matches || globalThis.innerWidth <= 780;
function updateManualPowerMeter(now = performance.now()) {
  $('manual-timing-control').hidden = !useLargePowerMeter() || !manualDraft?.aim || manualDraft.action === 'dribble';
  if (!manualDraft || manualDraft.action === 'dribble') return;
  if (!manualDraft.powerLocked) {
    const elapsed = Math.max(0, now - (manualDraft.meterStartedAt ?? now)), phase = elapsed % 1800 / 1800;
    const wave = phase < .5 ? phase * 2 : (1 - phase) * 2;
    manualMeterPower = .3 + wave * .7; manualDraft.power = manualMeterPower;
  } else manualMeterPower = manualDraft.power;
  const percent = Math.round(manualMeterPower * 100);
  $('manual-power-fill').style.height = `${percent}%`; $('manual-power-marker').style.bottom = `${percent}%`;
  $('manual-timed-power-value').textContent = `%${percent}`;
  $('manual-power-meter').classList.toggle('locked', !!manualDraft.powerLocked);
  $('manual-power-meter').setAttribute('aria-pressed', String(!!manualDraft.powerLocked));
  $('manual-power-meter').setAttribute('aria-label', `Vuruş gücü %${percent}. ${manualDraft.powerLocked ? 'Yeniden seçmek için dokun' : 'Bu seviyede durdurmak için dokun'}.`);
  $('manual-power-hint').textContent = manualDraft.powerLocked ? '✓ Seçildi' : 'Gücü seç';
  $('manual-timing-control').classList.toggle('power-on-right', (manualKickSource()?.x ?? 105) < 52.5);
}
function selectManualPower(event) {
  if (event?.button !== undefined && event.button !== 0 || !manualDraft || manualDraft.action === 'dribble') return;
  if (!manualDraft.aim) { updateManualPanel('Önce top sahibinden pas veya şut yönünü çiz.'); return; }
  if (manualDraft.powerLocked) {
    manualDraft.powerLocked = false; manualDraft.meterStartedAt = performance.now();
    updateManualPanel('Güç göstergesi yeniden hareket ediyor. İstediğin seviyede sol tıkla.');
  } else {
    updateManualPowerMeter();
    manualDraft.power = manualMeterPower; manualDraft.powerLocked = true;
    updateManualPanel(`Vuruş gücü %${Math.round(manualDraft.power * 100)} olarak seçildi. Planı uygulayabilir veya tekrar seçebilirsin.`);
  }
  updateManualPowerMeter(); event?.preventDefault?.();
}
function pitchPoint(event) {
  const rect = $('pitch').getBoundingClientRect(), scale = Math.min(rect.width / 117, rect.height / 80);
  const offsetX = (rect.width - 105 * scale) / 2, offsetY = (rect.height - 68 * scale) / 2;
  return { x: Math.max(-2.4, Math.min(107.4, (event.clientX - rect.left - offsetX) / scale)), y: Math.max(0, Math.min(68, (event.clientY - rect.top - offsetY) / scale)) };
}
function manualKickSource() {
  return manualDraft?.kind === 'freeKick' ? manualDraft.ball : game?.players.find(player => player.id === manualDraft?.owner);
}
function manualPowerMeterBox() {
  if (!manualDraft?.aim || manualDraft.action === 'dribble' || useLargePowerMeter()) return null;
  const owner = manualKickSource(); if (!owner) return null;
  return { x: owner.x > 99 ? owner.x - 5 : owner.x + 3.2, y: Math.max(1, Math.min(57, owner.y - 5)), width: 1.8, height: 10 };
}
const fieldPoint = point => ({
  x: Math.max(1, Math.min(104, Math.round(point.x * 10) / 10)),
  y: Math.max(1, Math.min(67, Math.round(point.y * 10) / 10)),
});
function automaticFreeKickWall(ball) {
  const goalY = ball.y < 34 ? 30.34 : 37.66, dx = 105 - ball.x, dy = goalY - ball.y, length = Math.hypot(dx, dy) || 1;
  const distance = Math.min(9.15, Math.max(.75, length - .8));
  return { x: ball.x + dx / length * distance, y: ball.y + dy / length * distance };
}
function closestControlledPlayer(point, exclude = null, radius = 3.4) {
  const team = manualDraft?.team ?? 0;
  return game?.players.filter(p => p.active && p.team === team && p.id !== exclude).map(p => ({ p, d: Math.hypot(p.x - point.x, p.y - point.y) }))
    .filter(item => item.d <= radius).sort((a, b) => a.d - b.d)[0]?.p ?? null;
}
function kickArrowDistance(point) {
  if (!manualDraft?.aim || manualDraft.action === 'dribble') return Infinity;
  const source = manualKickSource();
  if (!source) return Infinity;
  const dx = manualDraft.aim.x - source.x, dy = manualDraft.aim.y - source.y, length = Math.hypot(dx, dy) || 1;
  const bow = manualDraft.curve * Math.min(9, length * .22), control = { x: (source.x + manualDraft.aim.x) / 2 - dy / length * bow, y: (source.y + manualDraft.aim.y) / 2 + dx / length * bow };
  let nearest = Infinity;
  for (let index = 0; index <= 30; index++) {
    const t = index / 30, u = 1 - t;
    const x = u * u * source.x + 2 * u * t * control.x + t * t * manualDraft.aim.x;
    const y = u * u * source.y + 2 * u * t * control.y + t * t * manualDraft.aim.y;
    nearest = Math.min(nearest, Math.hypot(point.x - x, point.y - y));
  }
  return nearest;
}
function manualPointerDown(event) {
  if (!manualDraft || !playback.manualPause || event.button !== undefined && event.button !== 0) return;
  const point = pitchPoint(event);
  if (manualDraft.kind === 'freeKick' && manualDraft.setupTool === 'ball') {
    const placed = fieldPoint(point);
    manualDraft.ball = placed; manualDraft.wall = automaticFreeKickWall(placed); manualDraft.setupTool = 'aim';
    manualDraft.aim = null; manualDraft.curve = 0; manualDraft.power = .3; manualDraft.powerLocked = false; manualDraft.preview = null; manualDrag = null;
    updateManualPanel('Top yerleştirildi; baraj otomatik olarak 9,15 metreye kuruldu. Topun üzerinden şut yönünü çiz.');
    event.preventDefault?.(); return;
  }
  const powerMeter = manualPowerMeterBox();
  if (powerMeter && point.x >= powerMeter.x - .5 && point.x <= powerMeter.x + powerMeter.width + .5 && point.y >= powerMeter.y - .5 && point.y <= powerMeter.y + powerMeter.height + .5) {
    selectManualPower(event); return;
  }
  if (manualDraft.aim && manualDraft.action !== 'dribble' && Math.hypot(manualDraft.aim.x - point.x, manualDraft.aim.y - point.y) <= 4.5) {
    manualDrag = { id: manualDraft.owner, kind: 'curve', originalCurve: manualDraft.curve };
    manualDraft.preview = { id: manualDraft.owner, kind: 'curve', ...point };
    $('pitch').setPointerCapture?.(event.pointerId); event.preventDefault?.(); return;
  }
  if (manualDraft.kind === 'freeKick') {
    if (!manualDraft.ball || Math.hypot(manualDraft.ball.x - point.x, manualDraft.ball.y - point.y) > 4) { updateManualPanel('Şut çizgisini başlatmak için topun üzerine bas.'); return; }
    manualDrag = { id: manualDraft.owner, kind: 'kick' }; manualDraft.preview = { id: manualDraft.owner, kind: 'kick', ...point };
    $('pitch').setPointerCapture?.(event.pointerId); event.preventDefault?.(); return;
  }
  const source = closestControlledPlayer(point); if (!source) return;
  if (source.id === manualDraft.passTo) { updateManualPanel(`${shirt(source.id)} pas alıcısıdır; koşu yerine topu karşılama emrine uyacak.`); return; }
  const kind = source.id === manualDraft.owner && !manualDraft.aim ? 'kick' : 'run';
  manualDrag = { id: source.id, kind }; manualDraft.preview = { id: source.id, kind, ...pitchPoint(event) };
  $('pitch').setPointerCapture?.(event.pointerId); event.preventDefault?.();
}
function manualDoubleClick(event) {
  if (!manualDraft || !playback.manualPause) return;
  const point = pitchPoint(event);
  if (kickArrowDistance(point) <= 2.2) {
    const cancelled = manualDraft.action === 'pass' ? 'Pas' : 'Şut'; manualDraft.aim = null; manualDraft.curve = 0; manualDraft.power = .3; manualDraft.powerLocked = false; manualDraft.preview = null; manualDrag = null;
    updateManualKickControls(); updateManualPanel(`${cancelled} oku iptal edildi. Yeni bir hedef çizebilirsin.`); event.preventDefault?.(); return;
  }
  if (manualDraft.kind === 'freeKick') return;
  const receiver = closestControlledPlayer(point, manualDraft.owner, 3.8);
  if (!receiver) { updateManualPanel('Pas alıcısı isteğe bağlıdır. Seçmek için sarı oyuncunun üzerine çift tıkla.'); return; }
  let message;
  if (manualDraft.passTo === receiver.id) { manualDraft.passTo = null; manualDraft.action = 'shoot'; message = `${shirt(receiver.id)} pas alıcısı seçiminden çıkarıldı; çizilen vuruş artık şut olacak.`; }
  else { manualDraft.passTo = receiver.id; manualDraft.action = 'pass'; manualDraft.runs.delete(receiver.id); message = `${shirt(receiver.id)} pas alıcısı seçildi; çizilen vuruş pas olacak.`; }
  updateManualKickControls(); updateManualPanel(message);
  event.preventDefault?.();
}
function manualPointerMove(event) {
  if (!manualDraft || !manualDrag) return;
  const point = pitchPoint(event);
  if (manualDrag.kind === 'curve') manualDraft.curve = curveFromPoint(point);
  manualDraft.preview = { id: manualDrag.id, kind: manualDrag.kind, ...point }; event.preventDefault?.();
}
function curveFromPoint(point) {
  const source = manualKickSource(), aim = manualDraft?.aim;
  if (!source || !aim) return 0;
  const dx = aim.x - source.x, dy = aim.y - source.y, length = Math.hypot(dx, dy) || 1;
  const middle = { x: (source.x + aim.x) / 2, y: (source.y + aim.y) / 2 }, maxBow = Math.min(9, length * .22) || 1;
  const signedBow = (point.x - middle.x) * (-dy / length) + (point.y - middle.y) * (dx / length);
  return Math.max(-1, Math.min(1, signedBow / maxBow));
}
function manualPointerUp(event) {
  if (!manualDraft || !manualDrag) return;
  const point = pitchPoint(event), sourceId = manualDrag.id, kind = manualDrag.kind; manualDrag = null; manualDraft.preview = null;
  if (kind === 'kick') {
    manualDraft.aim = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
    if (manualDraft.action !== 'dribble') { manualDraft.curve = 0; manualDraft.power = .3; manualDraft.powerLocked = false; manualDraft.meterStartedAt = performance.now(); }
    updateManualPanel(manualDraft.action === 'dribble' ? `${shirt(sourceId)} için top sürme yolu çizildi. Oyun sırasında Space ile vuruş kararı ver.` :
      `${shirt(sourceId)} için ${manualDraft.action === 'shoot' ? 'şut' : 'serbest pas'} yönü çizildi. Okun ucundan yana sürükleyerek falso ver; sonra oyuncunun yanındaki hareketli güç göstergesine tıkla.`);
  } else if (kind === 'curve') {
    manualDraft.curve = curveFromPoint(point);
    const percent = Math.round(Math.abs(manualDraft.curve) * 100), direction = manualDraft.curve < 0 ? 'sol' : manualDraft.curve > 0 ? 'sağ' : 'düz';
    updateManualPanel(percent ? `Falso ${direction} %${percent} olarak çizildi. Şimdi oyuncunun yanındaki güç göstergesine istediğin seviyede tıkla.` : 'Falso kaldırıldı; vuruş düz gidecek. Şimdi oyuncunun yanındaki güç göstergesine tıkla.');
  } else {
    manualDraft.runs.set(sourceId, { id: sourceId, x: Math.max(1, Math.min(104, Math.round(point.x * 10) / 10)), y: Math.max(1, Math.min(67, Math.round(point.y * 10) / 10)) });
    updateManualPanel(`${shirt(sourceId)} için koşu hedefi çizildi.`);
  }
  event.preventDefault?.();
}
async function applyManualDraft() {
  const freeKickReady = manualDraft?.kind === 'freeKick' && manualDraft.ball && manualDraft.wall && manualDraft.aim && manualDraft.powerLocked;
  const manualReady = manualDraft?.kind === 'manual' && manualDraft.aim && (manualDraft.action === 'dribble' || manualDraft.powerLocked);
  if ((!freeKickReady && !manualReady) || applyingManual) return;
  applyingManual = true; updateManualPanel('Plan maç motoruna uygulanıyor…');
  try {
    if (manualDraft.kind === 'freeKick') await controlMatch('freeKickPlan', { plan: { owner: manualDraft.owner, ball: manualDraft.ball,
      wallCount: manualDraft.wallCount, aim: manualDraft.aim, power: manualDraft.power, curve: manualDraft.curve,
      shotPower: manualDraft.shotPower, curvePower: manualDraft.curvePower } });
    else await controlMatch('manualPlan', { plan: { owner: manualDraft.owner, action: manualDraft.action, passTo: manualDraft.action === 'pass' ? manualDraft.passTo : null,
      aim: manualDraft.aim, power: manualDraft.power, curve: manualDraft.curve, runs: [...manualDraft.runs.values()] } });
    playback.releaseManual(); manualDraft = null; manualDrag = null; applyingManual = false; updateManualPanel();
    const firstKickoff = !started; started = true; running = true; lastFrame = performance.now(); if (firstKickoff) playWhistle('start'); status('MAÇ CANLI', true); controls(); void requestChunk();
  } catch (error) { applyingManual = false; updateManualPanel('Plan uygulanamadı. Çizimleri kontrol edip tekrar dene.'); notice(error.message); }
}
function driveVector() {
  let x = 0, y = 0;
  for (const code of manualKeys) { const direction = DRIVE_KEYS[code]; if (direction) { x += direction[0]; y += direction[1]; } }
  const magnitude = Math.hypot(x, y); return magnitude ? { x: x / magnitude, y: y / magnitude } : { x: 0, y: 0 };
}
const driveAim = (owner, direction) => ({ x: Math.max(1, Math.min(104, owner.x + direction.x * 28)), y: Math.max(1, Math.min(67, owner.y + direction.y * 28)) });
async function startKeyboardDribble() {
  if (!manualDraft || manualDraft.kind !== 'manual' || manualDraft.passTo || manualDraft.aim || applyingManual) return;
  const owner = game?.players.find(player => player.id === manualDraft.owner), direction = driveVector();
  if (!owner || (!direction.x && !direction.y)) return;
  manualDraft.action = 'dribble'; manualDraft.aim = driveAim(owner, direction); updateManualKickControls();
  updateManualPanel('WASD ile top sürme başladı. Tuşları basılı tutarak yön ver; Space ile pas/şut kararına dön.');
  await applyManualDraft();
}
function sendManualDrive() {
  if (!['manual', 'free', 'online'].includes(matchMode) || !running || playback.manualPause) return;
  void controlMatch('manualDrive', { direction: driveVector() }).catch(error => notice(error.message));
}
async function requestChunk() {
  if (!matchId || chunkRequested || manualStopRequested || playback.complete || playback.manualPause || playback.hasManualCheckpoint || controller?.signal.aborted || playback.buffered >= bufferTarget()) return;
  const epoch = generation; chunkRequested = true;
  try { await controlMatch('next'); }
  catch (error) {
    chunkRequested = false;
    if (epoch === generation && !controller?.signal.aborted) { failed = true; pause('BAĞLANTI KESİLDİ'); notice(error.message); }
  }
}
async function sendSpeeds() {
  const speeds = selectedSpeeds(); requestedSpeeds = speeds; updateSpeedLabels();
  if (!matchId) { $('speed-status').textContent = 'Yeni maçta uygulanacak'; return; }
  $('speed-status').textContent = 'Motora gönderiliyor';
  try { await controlMatch('speeds', { speeds }); $('speed-status').textContent = 'Yeni hızlar hazırlanıyor'; }
  catch (error) { if (!controller?.signal.aborted) { $('speed-status').textContent = 'Uygulanamadı'; notice(error.message); } }
}
function wakeRoom() {
  if (playback.buffered < BUFFER_TARGET) for (const wake of [...roomWaiters]) wake();
  if (playback.buffered < (['manual', 'free', 'online'].includes(matchMode) ? .03 : BUFFER_LOW)) void requestChunk();
}
function waitForRoom(signal) {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('İptal edildi'), { name: 'AbortError' }));
  if (playback.buffered < BUFFER_TARGET) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { roomWaiters.delete(done); signal.removeEventListener('abort', done); signal.aborted ? reject(Object.assign(new Error('İptal edildi'), { name: 'AbortError' })) : resolve(); };
    roomWaiters.add(done); signal.addEventListener('abort', done, { once: true });
  });
}
function pause(label = 'DURAKLATILDI') { running = false; stepUntil = null; decisionUntil = null; status(label); controls(); }
function start(seconds = null) {
  if (!game || failed || game.ended || playback.manualPause) return;
  decisionUntil = null;
  playback.releaseDebug(); $('debug-next').disabled = true;
  const firstKickoff = !started; started = true; running = true; if (firstKickoff) playWhistle('start'); stepUntil = seconds ? Math.min(DURATION, playback.time + seconds) : null;
  lastFrame = performance.now(); status('MAÇ CANLI', true); controls();
}
$('start').addEventListener('click', () => { if (running) pause(); else { void ensureStadiumSound(); start(); } });
$('step').addEventListener('click', () => { void ensureStadiumSound(); start(10); });
$('debug-next').addEventListener('click', () => start());
$('manual-clear').addEventListener('click', clearManualDraft);
$('manual-apply').addEventListener('click', () => { void ensureStadiumSound(); void applyManualDraft(); });
$('stadium-sound').addEventListener('click', toggleStadiumSound);
$('pitch-fullscreen').addEventListener('click', () => { void togglePitchFullscreen(); });
document.addEventListener('fullscreenchange', () => { setPitchExpanded(document.fullscreenElement === $('pitch-view')); });
$('goal-close').addEventListener('click', () => { $('goal-overlay').hidden = true; goalUntil = 0; });
$('exit-close').addEventListener('click', () => { $('exit-overlay').hidden = true; exitUntil = 0; });
$('final-close').addEventListener('click', () => { $('final-overlay').hidden = true; });
$('manual-power-meter').addEventListener('pointerdown', event => {
  powerPointerHandled = event.pointerType === 'touch' || event.pointerType === 'pen';
  if (powerPointerHandled) selectManualPower(event);
});
$('manual-power-meter').addEventListener('click', event => {
  // A touch following a canvas drag may have no synthesized click. Select on
  // contact, and ignore its optional click so the power is not unlocked again.
  const handled = powerPointerHandled; powerPointerHandled = false;
  if (!handled || event?.detail === 0) selectManualPower(event);
});
$('free-kick-ball').addEventListener('click', () => { if (manualDraft?.kind === 'freeKick') { manualDraft.setupTool = 'ball'; updateManualPanel('Topu yerleştirmek istediğin noktaya tıkla.'); } });
$('free-kick-wall-count').addEventListener('input', () => {
  const count = Number($('free-kick-wall-count').value || 4); $('free-kick-wall-count-value').textContent = String(count);
  if (manualDraft?.kind === 'freeKick') { manualDraft.wallCount = count; updateManualPanel(); }
});
$('pitch').addEventListener('pointerdown', manualPointerDown); $('pitch').addEventListener('pointermove', manualPointerMove);
$('pitch').addEventListener('pointerup', manualPointerUp); $('pitch').addEventListener('pointercancel', () => {
  if (manualDrag?.kind === 'curve' && manualDraft) manualDraft.curve = manualDrag.originalCurve;
  manualDrag = null; if (manualDraft) manualDraft.preview = null;
});
$('pitch').addEventListener('dblclick', manualDoubleClick);
$('online-create').addEventListener('click', () => { void createOnlineRoom(); });
$('online-join').addEventListener('click', () => { void joinOnlineRoom(); });
$('online-room-code').addEventListener('input', () => { $('online-room-code').value = $('online-room-code').value.replace(/\D/g, '').slice(0, 6); });
$('online-copy').addEventListener('click', () => {
  const code = $('online-room-number').textContent; void globalThis.navigator?.clipboard?.writeText?.(code);
  $('online-room-status').textContent = `Oda numarası ${code} kopyalandı.`;
});
const initialModes = { 'choose-normal': 'normal', 'choose-manual': 'manual', 'choose-online': 'online', 'choose-debug': 'debug', 'choose-free': 'free', 'choose-free-kick': 'freeKick' };
for (const [id, mode] of Object.entries(initialModes)) $(id).addEventListener('click', () => {
  $('match-mode').value = mode; $('mode-gate').hidden = true; document.body.classList.remove('choosing-mode');
  updateFreeModeControls(); updateModeLayout(mode); void loadMatch();
});
document.addEventListener('keydown', event => {
  if (event.code === 'Escape' && pitchExpanded) { event.preventDefault(); void togglePitchFullscreen(); return; }
  const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName) || event.target?.isContentEditable;
  if (editing) return;
  if (DRIVE_KEYS[event.code] && ['manual', 'free', 'online'].includes(matchMode)) {
    event.preventDefault();
    if (manualKeys.has(event.code)) return;
    manualKeys.add(event.code);
    if (playback.manualPause && manualDraft?.kind === 'manual' && !manualDraft.passTo && !manualDraft.aim) void startKeyboardDribble();
    else sendManualDrive();
    return;
  }
  const owner = game?.owner && game.players[game.owner - 1];
  if (event.code !== 'Space' || !['manual', 'free', 'online'].includes(matchMode) || !running || manualStopRequested || playback.manualPause
    || !owner || owner.team !== 0 || owner.decision?.reason !== 'manual-dribble') return;
  event.preventDefault(); manualStopRequested = true; status('SPACE · VURUŞ KARARI BEKLENİYOR'); controls();
  void controlMatch('manualPause').catch(error => { manualStopRequested = false; notice(error.message); controls(); void requestChunk(); });
});
document.addEventListener('keyup', event => {
  if (!DRIVE_KEYS[event.code] || !manualKeys.has(event.code)) return;
  event.preventDefault?.(); manualKeys.delete(event.code); sendManualDrive();
});
$('match-mode').addEventListener('change', () => { updateFreeModeControls(); if (!started) void loadMatch(); });
$('free-home-count').addEventListener('input', updateFreeModeControls); $('free-away-count').addEventListener('input', updateFreeModeControls);
for (const id of ['free-home-count', 'free-away-count']) $(id).addEventListener('change', () => { if (!started && $('match-mode').value === 'free') void loadMatch(); });
$('reset').addEventListener('click', () => { void loadMatch(); });
$('selected-player').addEventListener('change', () => { $('decision-player').value = $('selected-player').value; decisionUntil = null; updateStats(); controls(); });
$('decision-player').addEventListener('change', () => { $('selected-player').value = $('decision-player').value; decisionUntil = null; updateStats(); controls(); });
$('decision-pause').addEventListener('click', () => pause('KARAR İNCELEMESİ'));
$('decision-next').addEventListener('click', () => {
  const p = selectedPlayer('decision-player');
  if (!p?.active || running || failed || game.ended) return;
  start(); decisionUntil = { id: p.id, thoughts: p.thoughts };
});
for (const id of formationInputs) $(id).addEventListener('change', () => { if (!started) void loadMatch(); });
for (const id of Object.values(SPEED_INPUTS)) {
  $(id).addEventListener('input', updateSpeedLabels);
  $(id).addEventListener('change', () => { void sendSpeeds(); });
}
$('speed-reset').addEventListener('click', () => {
  for (const [key, id] of Object.entries(SPEED_INPUTS)) $(id).value = String(DEFAULT_SPEEDS[key]);
  void sendSpeeds();
});
updateSpeedLabels();
updateManualKickControls();

function handleMatchMessage(message, epoch) {
  if (epoch !== generation) return;
  if (message.type === 'room') {
    if (message.status === 'waiting') { onlineRoomReady = false; $('online-room-status').textContent = 'Oda hazır. Arkadaşının oda numarasıyla katılması bekleniyor.'; status('ONLINE · RAKİP BEKLENİYOR'); }
    if (message.status === 'ready') {
      onlineRoomReady = true; $('online-room-status').textContent = `${TEAM_NAMES[onlineTeam]} ile bağlandın. İki oyuncu da hazır.`;
      if (playback.manualPause) openManualControl();
    }
    if (message.status === 'resume') {
      const firstKickoff = !started; playback.releaseManual(); manualDraft = null; manualDrag = null; updateManualPanel();
      started = true; running = true; lastFrame = performance.now(); if (firstKickoff) playWhistle('start');
      status('ONLINE MAÇ CANLI', true); controls(); void requestChunk();
    }
    return;
  }
  if (message.type === 'ready') {
    if (Number.isInteger(message.onlineTeam)) onlineTeam = message.onlineTeam;
    seed = message.seed; matchId = message.matchId; playback.reset(message.frame); game = playback.view();
    $('selected-player').replaceChildren(...playerOptions()); $('selected-player').value = 'auto';
    $('decision-player').replaceChildren(...playerOptions()); $('decision-player').value = 'auto';
    $('connection-label').textContent = matchMode === 'online' ? `Online oda ${onlineRoomCode}` : 'Yerel maç motoru hazır'; $('connection-dot').classList.toggle('ready', true);
    const chosen = message.formations;
    $('home-formation-label').textContent = `${chosen[0]} · HÜCUM →`; $('away-formation-label').textContent = `← HÜCUM · ${chosen[1]}`;
    $('pitch-formations').textContent = `${chosen[0]} / ${chosen[1]}`; $('pitch-caption').textContent = `Lime FC →    ${chosen[0]} × ${chosen[1]}    ← Coral United`;
    for (const [team, id] of ['home-role-list', 'away-role-list'].entries()) $(id).textContent = game.players.filter(p => p.team === team).map(p => `${p.number} ${p.roleName}`).join(' · ');
    updateStats();
    if (matchMode === 'online' && !onlineRoomReady) { $('manual-panel').hidden = true; status('ONLINE · RAKİP BEKLENİYOR'); controls(); }
    else if (playback.manualPause) openManualControl(); else { status('HAZIR'); controls(); void requestChunk(); }
  } else if (message.type === 'frames') {
    chunkRequested = false; playback.append(message);
    if (message.manualRequested === false) { manualStopRequested = false; notice('Top artık kontrol ettiğin takımda olmadığı için Space komutu uygulanamadı.'); }
    if (playback.buffered < bufferTarget() && !message.ended && !playback.hasManualCheckpoint) void requestChunk();
  }
}

async function loadMatch() {
  const epoch = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  playback = new Playback(); game = null; running = failed = false; stepUntil = null; lastEvent = 0; matchId = null; chunkRequested = false; lastAutoPlayerId = 10;
  manualDraft = null; manualDrag = null; applyingManual = false; manualStopRequested = false; manualKeys.clear(); $('manual-panel').hidden = true; $('pitch-stage').classList.toggle('manual-drawing', false);
  rosterCells.clear(); $('player-roster').replaceChildren();
  decisionUntil = null; decisionKey = '';
  $('decision-summary').textContent = 'Saha hazırlanıyor.'; $('decision-timing').textContent = ''; $('decision-ball').textContent = '';
  $('decision-actions').replaceChildren(); $('decision-movement').replaceChildren();
  started = false; const formations = selectedFormations();
  const mode = $('match-mode').value || 'normal'; matchMode = mode;
  updateModeLayout(mode);
  onlineRoomCode = null; onlinePlayerToken = null; onlineTeam = null; onlineRoomReady = false;
  updateFreeModeControls();
  $('debug-panel').hidden = mode !== 'debug'; $('debug-options').replaceChildren();
  $('debug-summary').textContent = 'İlk pas bekleniyor. Her pas çıkmadan görüntü durur.'; $('debug-context').textContent = '';
  goalUntil = eventUntil = exitUntil = 0; $('goal-overlay').hidden = true; $('event-overlay').hidden = true; $('exit-overlay').hidden = true; $('final-overlay').hidden = true;
  requestedSpeeds = selectedSpeeds(); $('speed-status').textContent = 'Maç motoruna uygulanıyor';
  notice(); status('SAHA HAZIRLANIYOR'); controls();
  $('connection-label').textContent = 'Yerel sunucuya bağlanılıyor'; $('connection-dot').classList.toggle('ready', false);
  $('pass-log').replaceChildren(Object.assign(document.createElement('div'), { className: 'empty-log', textContent: 'Başlama düdüğü bekleniyor.' }));
  if (mode === 'online') {
    requestedSpeeds = null; $('speed-status').textContent = 'Oda açıldığında uygulanacak';
    $('connection-label').textContent = 'Online oda bekleniyor'; $('online-room-result').hidden = true;
    $('online-room-status').textContent = 'Oda oluştur veya arkadaşının gönderdiği 6 haneli oda numarasıyla katıl.';
    status('ONLINE ODA BEKLENİYOR'); controls(); return;
  }
  try {
    const response = await fetch('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formations, mode, speeds: selectedSpeeds(), controlled: true,
      ...(mode === 'free' ? { freePlayers: selectedFreePlayers() } : {}) }), signal });
    await readMatch(response, message => handleMatchMessage(message, epoch), () => waitForRoom(signal));
  } catch (error) {
    if (epoch !== generation || signal.aborted) return;
    failed = true; pause('BAĞLANTI KESİLDİ'); notice(error.message); $('connection-label').textContent = 'Yeni maç ile tekrar bağlan';
    $('connection-dot').classList.toggle('ready', false);
  }
}
async function connectOnlineRoom(info) {
  const epoch = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  playback = new Playback(); game = null; running = failed = started = false; stepUntil = null; lastEvent = 0; chunkRequested = false;
  manualDraft = null; manualDrag = null; applyingManual = false; manualStopRequested = false; manualKeys.clear();
  matchMode = 'online'; onlineRoomCode = info.roomCode; onlinePlayerToken = info.playerToken; onlineTeam = info.team; onlineRoomReady = info.team === 1;
  $('online-room-result').hidden = false; $('online-room-number').textContent = info.roomCode;
  $('online-room-status').textContent = info.team === 0 ? 'Oda oluşturuldu. Bu numarayı arkadaşına gönder; katılması bekleniyor.' : `Odaya katıldın · ${TEAM_NAMES[1]}`;
  $('connection-label').textContent = `Online oda ${info.roomCode}`; status(info.team === 0 ? 'ONLINE · RAKİP BEKLENİYOR' : 'ONLINE · BAĞLANIYOR');
  controls();
  try {
    const response = await fetch('/api/online/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: info.roomCode, playerToken: info.playerToken }), signal });
    await readMatch(response, message => handleMatchMessage(message, epoch), () => waitForRoom(signal));
  } catch (error) {
    if (epoch !== generation || signal.aborted) return;
    failed = true; pause('ONLINE BAĞLANTI KESİLDİ'); notice(error.message); $('connection-dot').classList.toggle('ready', false);
  }
}
async function createOnlineRoom() {
  $('online-create').disabled = $('online-join').disabled = true; $('online-room-status').textContent = 'Oda oluşturuluyor…';
  try {
    const response = await fetch('/api/online/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formations: selectedFormations(), speeds: selectedSpeeds() }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Oda oluşturulamadı.');
    void connectOnlineRoom(body);
  } catch (error) { $('online-room-status').textContent = error.message; }
  finally { $('online-create').disabled = $('online-join').disabled = false; }
}
async function joinOnlineRoom() {
  const roomCode = $('online-room-code').value.trim();
  if (!/^\d{6}$/.test(roomCode)) { $('online-room-status').textContent = '6 haneli oda numarasını yaz.'; return; }
  $('online-create').disabled = $('online-join').disabled = true; $('online-room-status').textContent = 'Odaya bağlanılıyor…';
  try {
    const response = await fetch('/api/online/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Odaya katılınamadı.');
    void connectOnlineRoom(body);
  } catch (error) { $('online-room-status').textContent = error.message; }
  finally { $('online-create').disabled = $('online-join').disabled = false; }
}
function logEvents() {
  for (const e of game.events.filter(e => e.serial > lastEvent)) {
    if (!lastEvent) $('pass-log').replaceChildren(); lastEvent = e.serial;
    if (e.type === 'kick') { playMatchSound(kickAudio); continue; }
    const row = document.createElement('div'); row.className = `log-row${e.type === 'goal' ? ' goal-event' : ''}`;
    const label = e.long ? 'UZAKTAN ŞUT' : e.type === 'pass' && e.throughBall ? 'ARA PASI' : eventNames[e.type];
    if (overlayEvents[e.type]) {
      $('event-title').textContent = overlayEvents[e.type];
      $('event-detail').textContent = e.type === 'offside'
        ? `${TEAM_NAMES[e.team]} ${shirt(e.to)} ofsaytta · ${TEAM_NAMES[1 - e.team]} kullanacak`
        : `${TEAM_NAMES[e.team]} kullanacak${e.to ? ` · ${shirt(e.to)}` : ''}`;
      $('event-overlay').hidden = false; eventUntil = performance.now() + 2100;
    }
    if (e.type === 'goalKick' || e.type === 'corner') {
      $('event-overlay').hidden = true; eventUntil = 0; $('goal-overlay').hidden = true; goalUntil = 0;
      showExitMap(e); $('exit-overlay').hidden = false; exitUntil = performance.now() + 4200;
    }
    if (e.type === 'goal') {
      stopMatchSound(shotAudio); shotRoarActive = false; playMatchSound(goalAudio);
      $('event-overlay').hidden = true; eventUntil = 0; $('exit-overlay').hidden = true; exitUntil = 0;
      $('goal-detail').textContent = `${game.score[0]} – ${game.score[1]}`; showGoalMap(e);
      $('goal-overlay').classList.toggle('away-goal', e.team === 1);
      $('goal-overlay').hidden = false; goalUntil = performance.now() + 4200;
    }
    if (e.type === 'shot' && (e.distance ?? Infinity) <= 26) playMatchSound(dangerAudio);
    if (e.type === 'fullTime') { stopMatchSound(shotAudio); shotRoarActive = false; playWhistle('end'); showFinalStats(); }
    for (const text of [clock(e.time), label, TEAM_NAMES[e.team] || '—', [shirt(e.from), shirt(e.to)].filter(Boolean).join(' → ')]) {
      const span = document.createElement('span'); span.textContent = text; row.append(span);
    }
    $('pass-log').prepend(row); while ($('pass-log').children.length > 7) $('pass-log').lastElementChild.remove();
    $('pitch-caption').textContent = `${label}${e.team !== null ? ` · ${TEAM_NAMES[e.team]}` : ''}${e.from ? ` ${shirt(e.from)}` : ''}`;
  }
}
function updateStats() {
  if (!game) return;
  if (requestedSpeeds && game.speedSettings && Object.keys(DEFAULT_SPEEDS).every(key => Math.abs(game.speedSettings[key] - requestedSpeeds[key]) < .01)) {
    $('speed-status').textContent = 'Sahada etkin'; requestedSpeeds = null;
  }
  $('offsides').textContent = (game.offsides ?? [0, 0]).join(' / ');
  $('clock').textContent = clock(playback.time); $('home-score').textContent = game.score[0]; $('away-score').textContent = game.score[1];
  $('pitch-score').textContent = `Lime ${game.score[0]} – ${game.score[1]} Coral · ${clock(playback.time)}`;
  $('decisions').textContent = number(game.decisionCount); $('segments').textContent = game.deadBallVersion;
  for (const [id, values] of [['passes', game.passes], ['shots', game.shots], ['long-shots', game.longShots], ['saves', game.saves], ['tackles', game.tackles], ['fouls', game.fouls], ['yellow-cards', game.yellowCards], ['red-cards', game.redCards], ['injuries', game.injuries ?? [0, 0]]]) $(id).textContent = `${values[0]} / ${values[1]}`;
  $('home-phase').textContent = phases[game.phases[0]]; $('away-phase').textContent = phases[game.phases[1]];
  const total = game.possession[0] + game.possession[1], home = total ? Math.round(game.possession[0] / total * 100) : 50;
  $('possession').textContent = `%${home} / %${100 - home}`;
  $('buffer-count').textContent = `${playback.buffered.toFixed(1)} sn`;
  $('seed').textContent = String(seed);
  const p = selectedPlayer('selected-player'), decisionPlayer = selectedPlayer('decision-player'), traits = p.traits;
  const movement = p.decision?.report?.movement, baseSpeed = movement?.speed ?? game.speedSettings.offBall;
  const effectiveSpeed = baseSpeed * traits.pace * (.82 + .18 * p.energy);
  $('player-card-name').textContent = `${TEAM_NAMES[p.team]} #${p.number}`; $('player-card-role').textContent = p.roleName;
  $('trait-shot-power').textContent = `${traits.shotPower} m`;
  $('trait-shot-accuracy').textContent = `%${Math.round(traits.shotAccuracy * 100)}`;
  $('trait-pass-accuracy').textContent = `%${Math.round(traits.passAccuracy * 100)}`;
  $('trait-pace').textContent = `%${Math.round(traits.pace * 100)}`;
  $('trait-pace-detail').textContent = `${(effectiveSpeed * 3.6).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/sa anlık tavan`;
  $('trait-stamina').textContent = `${traits.stamina} / 90`; $('player-energy').textContent = `%${Math.round(p.energy * 100)}`; $('player-energy').style.color = energyColor(p.energy);
  $('player-role').textContent = p.roleName;
  $('player-action').textContent = p.injured ? 'Sakatlandı' : p.active ? decisionAction(p) : 'İhraç edildi';
  $('player-reason').textContent = reasons[p.decision?.reason] || 'Takım düzenine uyum';
  $('player-target').textContent = p.decision?.target ? shirt(p.decision.target) : '—';
  $('player-thoughts').textContent = number(p.thoughts);
  updateRosterTable(); showDecision(decisionPlayer);
}
function showDecision(p) {
  const d = p.decision, report = d?.report, f = n => Number(n).toFixed(2), uv = point => `(${f(point.u)}, ${f(point.v)})`;
  const triggers = { initial: 'İlk yerleşim', possession: 'Top sahibi değişti', event: 'Oyun olayı / yeniden başlama', interval: 'Periyodik analiz' };
  $('decision-summary').textContent = `${TEAM_NAMES[p.team]} #${p.number} · ${p.roleName} · Son karar: ${p.injured ? 'Sakatlandı' : p.active ? decisionAction(p) : 'İhraç edildi'}${d?.target ? ` → ${shirt(d.target)}` : ''}${d?.throughBall ? ` · koşu yoluna ${f(d.leadDistance)} m öne` : ''} · şut gücü ${p.traits.shotPower} m · şut isabeti %${Math.round(p.traits.shotAccuracy * 100)} · pas isabeti %${Math.round(p.traits.passAccuracy * 100)}`;
  const timing = game.timing;
  $('decision-timing').textContent = report ? `Son karar ${f(report.at)} sn · ${triggers[report.trigger]} · Görüntü anı ${f(game.elapsed)} sn · Kararın yaşı ${f(Math.max(0, game.elapsed - report.at))} sn. ` +
    (game.ended ? 'Maç bitti.' : timing?.restart > 0 ? `Duran top beklemesi: ${f(timing.restart)} sn. Bu sırada yeni analiz yapılmaz.` : 'Top sahipliği / olay değişirse bir sonraki fizik adımında tekrar analiz edilir.') : 'Henüz karar yok.';
  $('decision-ball').textContent = p.injured ? 'Oyuncu düşük enerji altında uzun süre yüksek eforla oynadığı için sakatlandı; yeni karar almaz.' : !p.active ? 'Oyuncu sahada değil; yeni karar almaz.' : game.owner === p.id ?
    `Top şu anda bu oyuncuda. ${timing?.setPiece ? 'Duran top beklemesinden sonra seçilen vuruş uygulanır.' : `Vuruşa kalan kontrol süresi: ${f(timing?.touch ?? 0)} sn. Pas/şut seçilmişse süre bittiğinde, top hâlâ oyuncudaysa ve plan geçerliyse uygulanır.`} Top sürme seçiminde süre dolması otomatik pas üretmez.` :
    `Top şu anda bu oyuncuda değil. ${report?.hadBall ? 'Aşağıdaki top aksiyonu, son karar anında top kendisindeyken verilmişti; top değişimi sonraki fizik adımında yeniden değerlendirilir.' : 'Pas veya şut uygulayamaz; hareket ve savunma görevini yürütür.'}`;
  const key = `${generation}:${p.id}:${p.thoughts}:${p.active}`; if (decisionKey === key) return; decisionKey = key;
  const rows = (id, entries) => {
    $(id).replaceChildren();
    for (const { cells, selected = false } of entries) {
      const row = document.createElement('tr'); row.className = selected ? 'chosen-pass' : '';
      for (const text of cells) { const td = document.createElement('td'); td.textContent = text; row.append(td); }
      $(id).append(row);
    }
  };
  rows('decision-actions', report?.hadBall ? report.choices.map((c, i) => ({ selected: c.selected, cells: [`${i + 1}. ${reasons[c.reason] || c.reason}`, c.selected ? 'SEÇİLDİ' : c.skipped ? 'Sıra gelmedi' : c.ok ? 'Uygun' : 'Koşul sağlanmadı', c.skipped ? 'Daha önceki öncelik seçildiği için bu adım çalıştırılmadı.' : c.detail] })) :
    [{ cells: ['Topsuz oyun', p.active ? actions[d?.action] || 'Bekleme' : 'İhraç', 'Bu karar anında top sahibi değildi; pas/şut sırası çalıştırılmadı. Aşağıdaki hareket hedefi hesaplandı.'] }]);
  const m = report?.movement;
  if (!m) { rows('decision-movement', []); return; }
  const override = { shape: 'Takım şekli ve mevki hedefi korunur', keeper: 'Kaleci: u=kısıtla(3,5 + top.u × 0,035, 3,5, 7); v=kısıtla(34 + (top.v−34) × 0,25, 29, 39). Rakip şutunda v, şut hedefine yönelir',
    'carry-forward': 'İleri top sürme: u + 7 m; merkeze doğru v değişimi = kısıtla((34−v) × 0,3, −3, 3)',
    'carry-diagonal': 'Açık kale yolunda arkadan gelen rakibin ters tarafına 4,5 m çapraz çıkıp 7 m ileri gider; orta sahaya dönmez',
    'carry-shield': 'Açık kale yolunda düşük tempoyla 1,2 m ileri giderken vücudunu rakiple top arasına koyar; orta sahaya dönmez', onBallHold: 'Pas/şut için mevcut konum hedeflenir',
    press: 'Pres için topun konumu hedeflenir', chase: 'Boş topa en yakın uygun oyuncu olarak topa koşar', receive: 'Pasın tahmin edilen varış noktası hedeflenir',
    coverRunner: `Tehlikeli hücumcunun gol tarafına geçilir${m.cover ? `: ${shirt(m.cover.threat)} oyuncusundan 2,5 m kaleye yakın hedef` : ''}` };
  const pressRadius = m.phase === 'recover' ? 9 : 15, pressLimit = m.phase === 'recover' ? 1 : 2;
  rows('decision-movement', [
    { cells: ['1. Durumu oku', `${phases[m.phase]} · oyuncu ${uv(m.current)} · top ${uv(m.ball)} · topa mesafe ${f(m.ballDistance)} m`] },
    { cells: ['2. Mevki hedefi', `u = ${m.anchor.formula} = ${f(m.anchor.u)} m; savunma hattı ${f(m.anchor.back)} m. v = mevki merkezi + kısıtla((top.v−34) × 0,13, −4, 4) = ${f(m.anchor.v)} m`] },
    { cells: ['3. Yerleşim düzeltmesi', `Mevki hedefine sınırlı niyet farkı eklenir: Δu=${f(m.adjusted.u - m.anchor.u)}, Δv=${f(m.adjusted.v - m.anchor.v)}; sonuç ${uv(m.adjusted)}. u farkı ±7, v farkı ±5 içinde tutulup 0,35 ile çarpılır.`] },
    { cells: ['4. Özel görev', `${override[m.override]}. Sınırlar öncesi hedef ${uv(m.beforeLimit)}.`] },
    { cells: ['Pres / topa koşu seçimi', `Top mevki koridorunda (±2 m): ${m.inBallLane ? 'evet' : 'hayır'}. Savunmada ${pressRadius} m içindeki uygun oyunculardan en yakın ${pressLimit} oyuncu pres yapar. Seçilenler: ${m.pressers.map(shirt).join(', ') || 'yok'}. Boş topa koşan: ${m.chasers.map(shirt).join(', ') || 'yok'}.`] },
    { cells: ['5. Sınırları uygula', `u: 1–${m.maxU} m · v: ${m.lane.join('–')} m · ${m.offsideLimit === null ? 'Bu görevde ofsayt hedef sınırı yok' : `ofsayt çizgisinin 0,6 m gerisi: u ≤ ${f(m.offsideLimit)}`}. Son hedef ${uv(m.final)}.`] },
    { cells: ['6. Sahadaki hedef / hız', `x=${f(d.x)}, y=${f(d.y)} m · ${({ onBall: 'toplu', offBall: 'normal topsuz / kontra', sprint: 'depar', keeper: 'kaleci' })[m.speedMode]} temel hızı ${f(m.speed)} × oyuncu hızı ${f(m.pace)} × enerji etkisi ${f(m.fatigue)} = ${f(m.speed * m.pace * m.fatigue)} m/sn. Dayanıklılık ${m.stamina}/90, anlık enerji %${Math.round(m.energy * 100)}. ${m.recovering ? 'Savunmaya geri koşu hesabı etkin.' : ''}${m.cover ? ` ${shirt(m.cover.threat)} oyuncusunun gol tarafı kapatılıyor.` : ''} Bu üst hedeftir; ivmelenme, hedefe yaklaşma ve oyuncu çarpışmaları gerçek hareketi etkiler.`] },
    { cells: ['Müdahale', `${({ cautious: 'Temkinli', normal: 'Normal', hard: 'Sert' })[report.tackle]}. Top kapma/faul için rakiple 2,1 m içinde temas, müdahale beklemesinin ve ilk kontrol korumasının bitmesi gerekir. Çapraz sürüş ve top saklamada pas tekniği, hız, dayanıklılık ve anlık enerji top koruma hesabını etkiler.`] },
  ]);
}
function showPassDebug(trace) {
  const f = n => Number(n).toFixed(3), selected = trace.candidates?.find(c => c.id === trace.to);
  const special = trace.reason === 'better-chance', keyPass = trace.reason === 'key-pass', restart = trace.reason === 'restart';
  $('debug-summary').textContent = `${TEAM_NAMES[trace.team]} ${shirt(trace.from)} → ${shirt(trace.to)} · ${reasons[trace.reason] || trace.reason}. ` +
    (trace.fallback ? 'Duran top hedefi geçersiz olduğu için en yakın takım arkadaşı seçildi.' : selected?.option?.throughBall ? `Koşu yolu açık: top ayağa değil, kaleye gidiş yoluna ${f(selected.option.leadDistance)} m öne bırakılacak. ${special ? `Gol fırsatı puanı ${f(selected.chanceValue)} ile ${f(selected.chanceThreshold)} eşiğini aşıyor.` : keyPass ? `Kilit pas puanı ${f(selected.keyPassValue)}.` : `Normal pas puanı ${f(selected.value)}.`}` : special ? `Gol fırsatı puanı ${f(selected?.chanceValue)} ile ${f(selected?.chanceThreshold)} eşiğini aşıyor; uygun adaylar arasında en yüksek.` : `Uygun normal pas adayları arasında en yüksek puan: ${f(selected?.value)}.`);
  $('debug-context').textContent = `Pas anı ${f(trace.at)} sn · Karar anı ${f(trace.evaluatedAt)} sn · Görüş ${f(trace.vision)} · En yakın rakip ${f(trace.pressure)} m. ` +
    (restart ? 'Duran top pası zorunlu; uygun hedef yoksa en yakın oyuncu kullanılır. ' : 'Normal pas tetikleyicisi: kaleci olmak, (puan > 0,55 ve ilerleme > 3 m) veya rakibin 4 m içine gelmesi. ') +
    (trace.offside.exempt ? 'Bu doğrudan duran top pasında ofsayt muafiyeti var.' : `Pas anındaki ofsayt sınırı x=${f(trace.offside.x)} m.`);
  $('debug-options').replaceChildren();
  for (const c of trace.candidates ?? []) {
    const chosen = c.id === trace.to, row = document.createElement('tr'); row.className = chosen ? 'chosen-pass' : '';
    const normal = c.exclusions.length ? c.exclusions.join('; ') : chosen && !special && !keyPass ? 'En yüksek uygun normal pas puanı' : special || keyPass ? 'Daha yüksek öncelikli pas aşaması seçildi' : 'Seçilen adaydan düşük puan (eşitlikte kadro sırası)';
    const opportunity = c.chanceExclusions.length ? c.chanceExclusions.join('; ') : chosen && special ? 'En yüksek uygun gol fırsatı' : 'Daha düşük fırsat puanı (eşitlikte kadro sırası)';
    const keyOpportunity = c.keyPassExclusions.length ? c.keyPassExclusions.join('; ') : chosen && keyPass ? 'En yüksek uygun kilit pas puanı' : `Kilit pas puanı ${f(c.keyPassValue)}`;
    const runway = c.option?.throughBall ? ` · ARA PASI: koşu yoluna +${f(c.option.leadDistance)} m` : c.option?.runwayBlockers?.length ? ` · Koşu yolu rakip nedeniyle kapalı: ${c.option.runwayBlockers.map(shirt).join(', ')}` : '';
    const text = [ `${chosen ? '✓ ' : ''}#${c.number} ${c.role}`, `${f(c.length)} m / ${f(c.progress)} m${runway} · pas isabeti %${Math.round((c.option?.accuracy ?? 0) * 100)} · beklenen sapma ${f(c.option?.errorRadius ?? 0)} m`,
      `${f(c.terms.progress)} + ${f(c.terms.space)} + isabet ${f(c.terms.accuracy)} − ${f(-c.terms.distance)} − ${f(-c.terms.keeper)} = ${f(c.value)}`,
      `${c.option?.throughBall ? `${f(c.arrivalQuality)} × 0,84` : `min(${f(c.chanceQuality)}, ${f(c.arrivalQuality)})`} − mesafe ${f(c.length * .0015)} − sapma ${f((c.option?.errorRadius ?? 0) * .02)} = ${f(c.chanceValue)}; eşik > ${f(c.chanceThreshold)}`,
      `${chosen ? 'SEÇİLDİ. ' : ''}Normal: ${normal}. Fırsat: ${opportunity}. Kilit pas: ${keyOpportunity}.` ];
    for (const value of text) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    $('debug-options').append(row);
  }
}
function frame(now) {
  const dt = Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
  updateManualPowerMeter(now);
  if (running && game) {
    game = playback.advance(Math.min(dt, .2), stepUntil ?? Infinity, decisionUntil); logEvents(); updateStats(); wakeRoom();
    if (playback.debugPause) { showPassDebug(game.debugPass); pause('DEBUG · PAS ÖNCESİ'); }
    else if (playback.manualPause) openManualControl();
    else if (game.ended) pause('MAÇ BİTTİ');
    else if (decisionUntil && !game.players.find(p => p.id === decisionUntil.id)?.active) pause('OYUNCU İHRAÇ EDİLDİ');
    else if (decisionUntil && game.players.find(p => p.id === decisionUntil.id)?.thoughts > decisionUntil.thoughts) pause('YENİ OYUNCU KARARI');
    else if (stepUntil !== null && playback.time >= stepUntil - .000001) pause('10 SANİYELİK OYUN TAMAMLANDI');
    else status(playback.buffered < .05 && !playback.complete ? 'GÖRÜNTÜ BEKLENİYOR' : 'MAÇ CANLI', true);
  }
  if (game) render(game, $('show-paths').checked, manualRenderDraft());
  updateMatchAudio();
  if (goalUntil && now >= goalUntil) { $('goal-overlay').hidden = true; goalUntil = 0; }
  if (exitUntil && now >= exitUntil) { $('exit-overlay').hidden = true; exitUntil = 0; }
  if (eventUntil && now >= eventUntil) { $('event-overlay').hidden = true; eventUntil = 0; }
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && running) pause('SEKME DURAKLATILDI'); });
updateStadiumButton(); requestAnimationFrame(frame); void loadMatch();
