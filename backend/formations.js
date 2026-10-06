// Team-relative positions: u runs towards the opposing goal, v runs left to right.
const role = (code, name, type, startU, v, lane, maxU, range, offset = 0) => ({ code, name, type, startU, v, lane, maxU, range, offset });
const GK = role('GK', 'Kaleci', 'keeper', 6, 34, [25, 43], 16, 0);
const LB = role('LB', 'Sol bek', 'fullBack', 20, 10, [1, 25], 88, 24);
const RB = role('RB', 'Sağ bek', 'fullBack', 20, 58, [43, 67], 88, 24);
const LCB = role('LCB', 'Sol stoper', 'centreBack', 17, 25, [17, 35], 62, 18);
const RCB = role('RCB', 'Sağ stoper', 'centreBack', 17, 43, [33, 51], 62, 18);
const LM = role('LM', 'Sol orta saha', 'wideMid', 34, 10, [1, 29], 94, 28);
const RM = role('RM', 'Sağ orta saha', 'wideMid', 34, 58, [39, 67], 94, 28);
const LCM = role('LCM', 'Sol merkez', 'central', 34, 26, [14, 38], 87, 30, -10);
const RCM = role('RCM', 'Sağ merkez', 'central', 34, 42, [30, 54], 87, 30, -4);
const DM = role('DM', 'Ön libero', 'holding', 29, 34, [21, 47], 78, 30);
const LW = role('LW', 'Sol kanat', 'winger', 45, 12, [1, 30], 102, 28);
const RW = role('RW', 'Sağ kanat', 'winger', 45, 56, [38, 67], 102, 28);
const ST = role('ST', 'Santrfor', 'striker', 48, 34, [22, 46], 103, 28);
const LST = role('LST', 'Sol forvet', 'striker', 48, 28, [18, 40], 103, 28);
const RST = role('RST', 'Sağ forvet', 'striker', 48, 40, [28, 50], 103, 28);
export const FORMATIONS = {
  '4-4-2': [GK, LB, LCB, RCB, RB, LM, LCM, RCM, RM, LST, RST],
  '4-3-3': [GK, LB, LCB, RCB, RB, DM, { ...LCM, startU: 36, offset: -2 }, { ...RCM, startU: 36, offset: 1 }, LW, ST, RW],
  '4-2-3-1': [GK, LB, LCB, RCB, RB,
    role('LDM', 'Sol ön libero', 'holding', 29, 26, [15, 38], 78, 30),
    role('RDM', 'Sağ ön libero', 'holding', 29, 42, [30, 53], 78, 30),
    { ...LW, startU: 41 }, role('AM', 'Ofansif orta saha', 'attackingMid', 41, 34, [20, 48], 96, 30), { ...RW, startU: 41 }, ST],
  '3-5-2': [GK,
    { ...LCB, v: 20, lane: [10, 30] }, role('CB', 'Merkez stoper', 'centreBack', 17, 34, [23, 45], 62, 18), { ...RCB, v: 48, lane: [38, 58] },
    role('LWB', 'Sol kanat bek', 'wingBack', 31, 8, [1, 25], 94, 26), LCM, DM, RCM,
    role('RWB', 'Sağ kanat bek', 'wingBack', 31, 60, [43, 67], 94, 26), LST, RST],
};
export const FORMATION_IDS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATIONS = ['4-4-2', '4-4-2'];
export const validFormations = value => Array.isArray(value) && value.length === 2 && value.every(id => typeof id === 'string' && Object.hasOwn(FORMATIONS, id));
export function formationPair(value = DEFAULT_FORMATIONS) {
  if (!validFormations(value)) throw new RangeError('Her takım için geçerli bir diziliş seçin.');
  return [...value];
}
