import { parentPort, workerData } from 'node:worker_threads';
import { Simulation } from './simulation.js';
import { speedSettings } from './speeds.js';
const simulation = new Simulation(workerData.seed, workerData.formations, workerData.mode, workerData.speeds, workerData.freePlayers);
const reportVersions = new Map(simulation.game.players.map(p => [p.id, p.thoughts]));
parentPort.postMessage({ type: 'ready', frame: simulation.readyFrame(), seed: workerData.seed, formations: simulation.game.formations, speeds: simulation.game.speedSettings,
  freePlayers: simulation.freePlayers, duration: 300 });
function postChunk(chunk) {
  for (const frame of chunk.frames) for (const p of frame.players) {
    if (!p.decision) continue;
    if (reportVersions.get(p.id) === p.thoughts) delete p.decision.report;
    else reportVersions.set(p.id, p.thoughts);
  }
  parentPort.postMessage(chunk);
}
parentPort.on('message', message => {
  if (message === 'next' || message?.type === 'next') {
    postChunk(simulation.next(message?.seconds));
  }
  if (message?.type === 'speeds') simulation.game.speedSettings = speedSettings(message.speeds);
  if (message?.type === 'manualPlan') simulation.applyManualPlan(message.plan);
  if (message?.type === 'manualDrive') simulation.steerManual(message.direction);
  if (message?.type === 'freeKickPlan') simulation.applyFreeKickPlan(message.plan);
  if (message?.type === 'manualPause') postChunk(simulation.pauseManual());
});
