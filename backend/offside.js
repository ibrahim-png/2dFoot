// Players are represented by centre points in this 2D engine.
const forward = (point, team) => team ? 105 - point.x : point.x;
export function offsideLine(game, team) {
  const opponents = game.players.filter(p => p.active !== false && p.team !== team)
    .map(p => forward(p, team)).sort((a, b) => b - a);
  const defender = opponents[1] ?? 0, ball = forward(game.ball, team);
  const u = Math.max(52.5, defender, ball);
  return { team, u, x: team ? 105 - u : u, defender, ball };
}
export function exemptRestart(game) {
  return ['throwIn', 'goalKick', 'corner'].includes(game.setPiece?.kind);
}
export function inOffsidePosition(game, p) {
  return !exemptRestart(game) && forward(p, p.team) > offsideLine(game, p.team).u + 1e-7;
}
export function captureOffside(game, kicker) {
  const line = offsideLine(game, kicker.team), exempt = exemptRestart(game);
  return { ...line, at: game.elapsed, from: kicker.id, exempt,
    candidates: exempt ? [] : game.players.filter(p => p.active !== false && p.team === kicker.team && p.id !== kicker.id && forward(p, p.team) > line.u + 1e-7).map(p => p.id) };
}
export const offsideParticipant = (game, p) => game.offsidePhase?.candidates.includes(p.id) ?? false;
