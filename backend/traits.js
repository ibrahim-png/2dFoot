export const PACE_MIN = .87;
export const PACE_MAX = PACE_MIN * 1.3;
export const STAMINA_MIN = 60;
export const STAMINA_MAX = 90;

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const level = (index, multiplier, shift) => ((index * multiplier + shift) % 11) / 10;
const between = (min, max, amount, places = 2) => round(min + (max - min) * amount, places);

export function playerTraits(index, team) {
  return {
    shotPower: between(20, 40, level(index, 9, team * 2), 0),
    curvePower: between(40, 100, level(index, 5, team * 4), 0),
    shotAccuracy: between(.55, .9, level(index, 4, team * 3)),
    passAccuracy: between(.7, .96, level(index, 6, team * 4)),
    pace: between(PACE_MIN, PACE_MAX, level(index, 7, team * 3), 3),
    stamina: between(STAMINA_MIN, STAMINA_MAX, level(index, 3, team * 5), 0),
    // These existing behavioural traits remain internal for vision and tackle style.
    vision: between(.85, 1.05, level(index, 3, team * 2)),
    aggression: between(.25, .65, level(index, 7, team), 2),
  };
}
