// 소리 설정. 녹음된 파일 없이 WebAudio 로 합성한다.
//
// 효과음: wave(파형: sine|square|sawtooth|triangle|noise), freq [시작, 끝] Hz(끝으로 미끄러진다), dur 초, gain 0~1.
// 배경음: 구역마다 으뜸음(Hz)·음계(반음 간격)·빠르기(분당 박), 베이스와 선율의 음 번호 수열(음계 안의 자리, -1 은 쉼).

import { deepFreeze } from './freeze.js';

export const SFX = deepFreeze({
  click: { wave: 'square', freq: [660, 880], dur: 0.05, gain: 0.12 },
  deny: { wave: 'square', freq: [220, 150], dur: 0.12, gain: 0.14 },
  swing: { wave: 'noise', freq: [1800, 500], dur: 0.09, gain: 0.16 },
  heavy: { wave: 'noise', freq: [900, 160], dur: 0.2, gain: 0.24 },
  shot: { wave: 'noise', freq: [3200, 300], dur: 0.07, gain: 0.18 },
  blast: { wave: 'noise', freq: [1400, 90], dur: 0.16, gain: 0.24 },
  zap: { wave: 'sawtooth', freq: [1400, 2200], dur: 0.06, gain: 0.08 },
  magic: { wave: 'triangle', freq: [520, 980], dur: 0.12, gain: 0.12 },
  bow: { wave: 'triangle', freq: [300, 900], dur: 0.08, gain: 0.12 },
  empty: { wave: 'square', freq: [180, 160], dur: 0.05, gain: 0.1 },
  dash: { wave: 'noise', freq: [600, 2400], dur: 0.12, gain: 0.14 },
  skill: { wave: 'sawtooth', freq: [220, 880], dur: 0.35, gain: 0.18 },
  swap: { wave: 'square', freq: [700, 500], dur: 0.05, gain: 0.08 },
  hit: { wave: 'square', freq: [260, 120], dur: 0.07, gain: 0.16 },
  crit: { wave: 'square', freq: [520, 180], dur: 0.14, gain: 0.2 },
  hurt: { wave: 'sawtooth', freq: [180, 70], dur: 0.2, gain: 0.24 },
  kill: { wave: 'triangle', freq: [300, 80], dur: 0.22, gain: 0.2 },
  bossKill: { wave: 'sawtooth', freq: [220, 40], dur: 0.9, gain: 0.3 },
  explosion: { wave: 'noise', freq: [700, 60], dur: 0.35, gain: 0.3 },
  bolt: { wave: 'sawtooth', freq: [2400, 600], dur: 0.09, gain: 0.12 },
  coin: { wave: 'square', freq: [1200, 1700], dur: 0.07, gain: 0.1 },
  pickup: { wave: 'triangle', freq: [520, 880], dur: 0.12, gain: 0.14 },
  boon: { wave: 'triangle', freq: [440, 1320], dur: 0.5, gain: 0.22 },
  doorLock: { wave: 'square', freq: [140, 90], dur: 0.25, gain: 0.22 },
  doorOpen: { wave: 'triangle', freq: [300, 600], dur: 0.3, gain: 0.18 },
  wave: { wave: 'sawtooth', freq: [160, 320], dur: 0.25, gain: 0.14 },
  clear: { wave: 'triangle', freq: [520, 1560], dur: 0.6, gain: 0.22 },
  secret: { wave: 'sine', freq: [300, 1200], dur: 0.7, gain: 0.2 },
  portal: { wave: 'sine', freq: [520, 180], dur: 0.6, gain: 0.2 },
  phase: { wave: 'sawtooth', freq: [90, 360], dur: 0.7, gain: 0.26 },
  death: { wave: 'sawtooth', freq: [300, 40], dur: 1.2, gain: 0.3 },
  victory: { wave: 'triangle', freq: [440, 1760], dur: 1.2, gain: 0.26 },
});

/** 무기 모양별로 내는 소리. */
export const WEAPON_SFX = deepFreeze({
  sword: 'swing', dagger: 'swing', dual: 'swing', spear: 'swing', greatsword: 'heavy', hammer: 'heavy',
  pistol: 'shot', smg: 'shot', sniper: 'blast', shotgun: 'blast', rocket: 'blast', staff: 'magic', laser: 'zap', bow: 'bow',
});

/** 같은 효과음은 이 시간(초) 안에 다시 내지 않는다(여럿이 한꺼번에 맞을 때 소리가 뭉개지지 않도록). */
export const SFX_MIN_GAP = 0.04;

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const MUSIC = deepFreeze({
  /** 미리 예약해 두는 시간(초)과 예약기를 돌리는 간격(ms). */
  lookahead: 0.25,
  intervalMs: 80,
  bossTempoMul: 1.3,
  gain: { bass: 0.16, lead: 0.07 },
  zones: {
    crypt: { root: 55, scale: MINOR, bpm: 76, bass: [0, -1, 0, 4, 0, -1, 3, 4], lead: [7, 9, 11, 9, 7, -1, 6, -1] },
    sewer: { root: 49, scale: DORIAN, bpm: 84, bass: [0, 0, 3, -1, 4, 4, 3, -1], lead: [9, 7, 8, -1, 11, 9, 8, 7] },
    fungal: { root: 58.27, scale: PHRYGIAN, bpm: 72, bass: [0, -1, 1, -1, 0, -1, 4, 3], lead: [7, 8, 7, 10, -1, 8, 7, -1] },
    mine: { root: 61.74, scale: MINOR, bpm: 96, bass: [0, 4, 0, 4, 3, 4, 2, 4], lead: [11, -1, 9, 7, 11, -1, 12, 9] },
    magma: { root: 51.91, scale: PHRYGIAN, bpm: 104, bass: [0, 0, 1, 0, 0, 0, 4, 1], lead: [7, 8, 10, 8, 7, 8, 12, -1] },
    citadel: { root: 46.25, scale: MINOR, bpm: 112, bass: [0, 4, 5, 4, 0, 4, 6, 4], lead: [14, 12, 11, 9, 12, 11, 9, 7] },
  },
});
