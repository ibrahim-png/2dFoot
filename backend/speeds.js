export const SPEED_KEYS = ['onBall', 'offBall', 'sprint', 'keeper'];
export const DEFAULT_SPEEDS = Object.freeze({ onBall: 4.9, offBall: 5.7, sprint: 7.1, keeper: 4.8 });
export const SPEED_LIMITS = Object.freeze({ min: 3, max: 9 });

export function validSpeeds(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === SPEED_KEYS.length
    && SPEED_KEYS.every(key => Object.hasOwn(value, key) && Number.isFinite(value[key])
      && value[key] >= SPEED_LIMITS.min && value[key] <= SPEED_LIMITS.max);
}

export function speedSettings(value) {
  return validSpeeds(value) ? Object.fromEntries(SPEED_KEYS.map(key => [key, Math.round(value[key] * 10) / 10])) : { ...DEFAULT_SPEEDS };
}
