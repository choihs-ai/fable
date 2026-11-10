// 보스 데이터. 구역 데이터(zones.js)의 boss.id 는 모두 여기에 있어야 한다.
//
// phases: 체력 구간별 행동. until 은 그 페이즈가 끝나는 체력 비율(마지막 페이즈는 0).
//   - 체력이 until 에 닿으면 한 번에 그 아래로 내려가지 않고 멈춘 뒤 다음 페이즈로 넘어간다(페이즈를 건너뛸 수 없다).
//   - 전환 중에는 transitionSec 동안 무적이고, 걸려 있던 상태이상이 모두 풀리며, BOSS_PHASE_CHANGED 이벤트가 나간다.
//   move: 'chase'(keepDist 까지 다가감) 또는 'keepAway'(band [최소, 최대] 거리 유지)
//   pauseSec: 패턴과 패턴 사이의 틈.  speedMul: 이동 속도 배율.
//   patterns: { ability, weight, minDist?, maxDist? } — 쓸 수 있는 것들 가운데 가중치로 고른다.
// 기술 형식은 data/player.js 설명 참고. 방향 회전값은 [cos, sin] 으로 미리 계산해 둔다(로직에서 삼각함수를 쓰지 않는다).

import { deepFreeze } from './freeze.js';

const R0 = [1, 0];
const R15 = [0.9659, 0.2588];
const R15N = [0.9659, -0.2588];
const R30 = [0.866, 0.5];
const R30N = [0.866, -0.5];
/** 한 바퀴를 8·12 방향으로 나눈 회전값. */
const RING8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
const RING12 = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5],
  [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];
/** 목표 지점 둘레에 장판을 놓는 위치(칸). */
const AROUND4 = [[0, 0], [2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]];
const AROUND6 = [[0, 0], [2.2, 0], [-2.2, 0], [1.1, 1.9], [-1.1, 1.9], [1.1, -1.9], [-1.1, -1.9]];
const TRIANGLE = [[0, 0], [1.8, 1.4], [-1.8, 1.4]];

export const BOSSES = deepFreeze({
  // ── 지하 묘지 중간보스: 근접 위주, 뼈 투척, 내려찍기, 2페이즈에 해골 소환 ──
  bone_warden: {
    name: '뼈의 감시자', hp: 420, speed: 2.4, radius: 0.7, mass: 10, armor: 1, aggroRadius: 10,
    immune: ['poison', 'bleed'], statusResist: { stun: 0.4, freeze: 0, slow: 0.5 },
    transitionSec: 1.5,
    phases: [
      {
        until: 0.5, move: 'chase', keepDist: 1.5, pauseSec: 0.8,
        patterns: [
          { ability: 'cleave', weight: 4, maxDist: 2.3 },
          { ability: 'bone_volley', weight: 3, minDist: 2.5 },
          { ability: 'slam', weight: 2, maxDist: 2.6 },
        ],
      },
      {
        until: 0, move: 'chase', keepDist: 1.5, pauseSec: 0.5, speedMul: 1.25,
        patterns: [
          { ability: 'cleave', weight: 4, maxDist: 2.3 },
          { ability: 'bone_storm', weight: 3, minDist: 2 },
          { ability: 'slam', weight: 2, maxDist: 2.6 },
          { ability: 'raise_dead', weight: 3 },
        ],
      },
    ],
    abilities: {
      cleave: { windup: 0.55, recovery: 0.4, cooldown: 1.5, effects: [{ type: 'arc', range: 2.4, cosHalf: 0.2, damage: 14 }] },
      bone_volley: {
        windup: 0.5, recovery: 0.3, cooldown: 3,
        effects: [{ type: 'projectile', speed: 9, radius: 0.2, range: 12, damage: 9, spread: [R0, R15, R15N] }],
      },
      bone_storm: {
        windup: 0.6, recovery: 0.3, cooldown: 3.5,
        effects: [{ type: 'projectile', speed: 9, radius: 0.2, range: 12, damage: 9, spread: [R0, R15, R15N, R30, R30N] }],
      },
      slam: {
        windup: 0.9, recovery: 0.6, cooldown: 6, needsLos: false,
        effects: [{ type: 'circle', radius: 3, damage: 16, status: { id: 'stun', duration: 0.8 } }],
      },
      raise_dead: { windup: 1.0, recovery: 0.3, cooldown: 12, needsLos: false, effects: [{ type: 'summon', enemy: 'skeleton', count: 2, max: 4 }] },
    },
  },

  // ── 버섯 동굴 중간보스: 느리다. 독 구름 장판, 포자 덩이 소환, 뿌리 폭발 ──
  spore_mother: {
    name: '포자의 어머니', hp: 380, speed: 1.3, radius: 0.8, mass: 12, armor: 0, aggroRadius: 10,
    immune: ['poison'], statusResist: { stun: 0.4, freeze: 0, slow: 0.5 },
    transitionSec: 1.5,
    phases: [
      {
        until: 0.5, move: 'chase', keepDist: 3.5, pauseSec: 1.0,
        patterns: [
          { ability: 'spore_cloud', weight: 4 },
          { ability: 'spawn_sporelings', weight: 3 },
          { ability: 'lash', weight: 4, maxDist: 2.8 },
        ],
      },
      {
        until: 0, move: 'chase', keepDist: 3.5, pauseSec: 0.6,
        patterns: [
          { ability: 'spore_cloud', weight: 3 },
          { ability: 'spawn_sporelings', weight: 3 },
          { ability: 'root_burst', weight: 4 },
          { ability: 'lash', weight: 4, maxDist: 2.8 },
        ],
      },
    ],
    abilities: {
      spore_cloud: {
        windup: 0.6, recovery: 0.3, cooldown: 4, needsLos: false,
        effects: [{ type: 'hazard', delay: 0.8, duration: 5, interval: 0.5, radius: 1.8, damage: 2, status: { id: 'poison' } }],
      },
      spawn_sporelings: { windup: 0.8, recovery: 0.3, cooldown: 8, needsLos: false, effects: [{ type: 'summon', enemy: 'sporeling', count: 2, max: 4 }] },
      root_burst: {
        windup: 0.7, recovery: 0.4, cooldown: 6, needsLos: false,
        effects: [{ type: 'hazard', offsets: AROUND6, delay: 1.0, radius: 1.1, damage: 14, status: { id: 'slow' } }],
      },
      lash: { windup: 0.5, recovery: 0.4, cooldown: 2, effects: [{ type: 'arc', range: 3.0, cosHalf: 0, damage: 12 }] },
    },
  },

  // ── 용암 굴 중간보스: 빠르다. 화염 숨결, 돌진, 불비 ──
  cinder_drake: {
    name: '잿불 드레이크', hp: 460, speed: 3.0, radius: 0.75, mass: 10, armor: 1, aggroRadius: 10,
    immune: ['burn'], statusResist: { stun: 0.4, freeze: 0.5, slow: 0.5 },
    transitionSec: 1.5,
    phases: [
      {
        until: 0.5, move: 'chase', keepDist: 2.5, pauseSec: 0.8,
        patterns: [
          { ability: 'flame_breath', weight: 4, maxDist: 4.2 },
          { ability: 'drake_charge', weight: 3, minDist: 3.5 },
          { ability: 'tail_swipe', weight: 3, maxDist: 2.2 },
          { ability: 'fire_rain', weight: 2 },
        ],
      },
      {
        until: 0, move: 'chase', keepDist: 2.5, pauseSec: 0.5, speedMul: 1.2,
        patterns: [
          { ability: 'flame_breath', weight: 4, maxDist: 4.2 },
          { ability: 'drake_charge', weight: 3, minDist: 3.5 },
          { ability: 'tail_swipe', weight: 3, maxDist: 2.2 },
          { ability: 'fire_storm', weight: 3 },
        ],
      },
    ],
    abilities: {
      flame_breath: {
        windup: 0.7, recovery: 0.5, cooldown: 3,
        effects: [{ type: 'arc', range: 4.6, cosHalf: 0.7, damage: 12, status: { id: 'burn' } }],
      },
      drake_charge: {
        windup: 0.6, recovery: 0.5, cooldown: 6, needsClearPath: true,
        effects: [{ type: 'dash', speed: 12, distance: 10, damage: 18, stopOnWall: true, stunOnWall: 0.8 }],
      },
      tail_swipe: { windup: 0.4, recovery: 0.3, cooldown: 2.5, needsLos: false, effects: [{ type: 'circle', radius: 2.3, damage: 10 }] },
      fire_rain: {
        windup: 0.6, recovery: 0.3, cooldown: 5, needsLos: false,
        effects: [{ type: 'hazard', offsets: TRIANGLE, delay: 0.9, radius: 1.4, damage: 12, status: { id: 'burn' } }],
      },
      fire_storm: {
        windup: 0.6, recovery: 0.3, cooldown: 5, needsLos: false,
        effects: [{ type: 'hazard', offsets: AROUND6, delay: 0.9, radius: 1.3, damage: 12, status: { id: 'burn' } }],
      },
    },
  },

  // ── 최종보스: 3페이즈. 1) 근접+탄막  2) 순간이동·전방위 탄막·그림자 소환  3) 광폭화 + 공허 장판 ──
  abyss_lord: {
    name: '심연의 군주', hp: 700, speed: 2.6, radius: 0.9, mass: 20, armor: 2, aggroRadius: 12,
    immune: ['poison'], statusResist: { stun: 0.3, freeze: 0, slow: 0.5, bleed: 0.5, burn: 0.5 },
    transitionSec: 2.0,
    phases: [
      {
        until: 0.66, move: 'chase', keepDist: 2.0, pauseSec: 0.8,
        patterns: [
          { ability: 'void_sweep', weight: 4, maxDist: 2.8 },
          { ability: 'shadow_bolts', weight: 3, minDist: 2.5 },
        ],
      },
      {
        until: 0.33, move: 'keepAway', band: [4, 7], pauseSec: 0.7,
        patterns: [
          { ability: 'blink', weight: 2, maxDist: 3.5 },
          { ability: 'bolt_nova', weight: 3 },
          { ability: 'summon_shades', weight: 3 },
          { ability: 'shadow_bolts', weight: 3, minDist: 2.5 },
        ],
      },
      {
        until: 0, move: 'chase', keepDist: 2.0, pauseSec: 0.4, speedMul: 1.35,
        patterns: [
          { ability: 'void_sweep', weight: 4, maxDist: 2.8 },
          { ability: 'bolt_storm', weight: 3 },
          { ability: 'void_zones', weight: 3 },
          { ability: 'blink', weight: 2, minDist: 5 },
        ],
      },
    ],
    abilities: {
      void_sweep: { windup: 0.6, recovery: 0.4, cooldown: 1.6, effects: [{ type: 'arc', range: 3.0, cosHalf: 0, damage: 16 }] },
      shadow_bolts: {
        windup: 0.5, recovery: 0.3, cooldown: 2.5,
        effects: [{ type: 'projectile', speed: 10, radius: 0.2, range: 14, damage: 10, status: { id: 'slow' }, spread: [R0, R15, R15N] }],
      },
      blink: { windup: 0.3, recovery: 0.2, cooldown: 5, needsLos: false, effects: [{ type: 'teleport', min: 4.5, max: 7 }] },
      bolt_nova: {
        windup: 0.7, recovery: 0.4, cooldown: 4, needsLos: false,
        effects: [{ type: 'projectile', speed: 8, radius: 0.2, range: 12, damage: 9, spread: RING8 }],
      },
      bolt_storm: {
        windup: 0.6, recovery: 0.3, cooldown: 3.5, needsLos: false,
        effects: [{ type: 'projectile', speed: 9, radius: 0.2, range: 12, damage: 9, spread: RING12 }],
      },
      summon_shades: { windup: 0.9, recovery: 0.3, cooldown: 10, needsLos: false, effects: [{ type: 'summon', enemy: 'shade', count: 2, max: 3 }] },
      void_zones: {
        windup: 0.5, recovery: 0.3, cooldown: 4.5, needsLos: false,
        effects: [{ type: 'hazard', offsets: AROUND4, delay: 0.8, radius: 1.5, damage: 16 }],
      },
    },
  },
});
