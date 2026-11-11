// 구역 데이터. 배열 순서가 곧 등장 순서이고, 구역마다 WORLD.floorsPerZone 층을 차지한다.
//
// - size: 일반 층의 맵 크기(칸)
// - algorithms: 생성 알고리즘별 가중치(합이 1일 필요는 없다)
// - tileset / palette: 렌더 단계에서 쓸 타일 이름과 색(0xRRGGBB)
// - enemies: 적 풀(가중치 뽑기). cost 는 웨이브 예산에서 차지하는 몫, minDepth 는 이 깊이부터 나온다(data/encounters.js)
// - enemyCount / itemCount / size / algorithms: 방 단위 구조로 바꾸기 전의 값. 지금은 첫 구역만 쓰고, 나머지 구역은 확장할 때 다시 맞춘다
// - boss: 구역 마지막 층의 보스. kind 는 'mid'(중간보스) 또는 'final'(최종보스), 없으면 null

import { deepFreeze } from './freeze.js';

export const ZONES = deepFreeze([
  {
    id: 'crypt',
    name: '지하 묘지',
    size: { w: 40, h: 40 },
    algorithms: { rooms: 0.9, cave: 0.1 },
    tileset: { floor: 'crypt_floor', wall: 'crypt_wall', stairs: 'crypt_stairs', props: ['coffin', 'urn', 'candle'] },
    palette: { floor: 0x4a4a52, wall: 0x2b2b33, accent: 0x9fb4c8, fog: 0x12131a, ambient: 0x6f7a8c },
    enemies: [
      { id: 'skeleton', weight: 5, cost: 2, minDepth: 0 },
      { id: 'bat', weight: 3, cost: 1, minDepth: 0 },
      { id: 'bone_archer', weight: 3, cost: 3, minDepth: 1 },
      { id: 'zombie', weight: 2, cost: 3, minDepth: 2 },
      { id: 'rat', weight: 2, cost: 1, minDepth: 2 },
    ],
    enemyCount: [5, 8],
    itemCount: [2, 3],
    boss: { kind: 'mid', id: 'bone_warden' },
  },
  {
    id: 'sewer',
    name: '지하 수로',
    size: { w: 44, h: 44 },
    algorithms: { rooms: 0.7, cave: 0.3 },
    tileset: { floor: 'sewer_floor', wall: 'sewer_brick', stairs: 'sewer_grate', props: ['pipe', 'barrel', 'moss'] },
    palette: { floor: 0x3d4a3f, wall: 0x232d27, accent: 0x7fd18b, fog: 0x0d1410, ambient: 0x5c7a63 },
    enemies: [
      { id: 'rat', weight: 5 },
      { id: 'slime', weight: 4 },
      { id: 'leech', weight: 2 },
      { id: 'skeleton', weight: 1 },
    ],
    enemyCount: [6, 9],
    itemCount: [2, 4],
    boss: null,
  },
  {
    id: 'fungal',
    name: '버섯 동굴',
    size: { w: 48, h: 48 },
    algorithms: { rooms: 0.2, cave: 0.8 },
    tileset: { floor: 'fungal_soil', wall: 'fungal_rock', stairs: 'fungal_hollow', props: ['mushroom', 'spore_pod', 'root'] },
    palette: { floor: 0x4a3f55, wall: 0x2a2233, accent: 0xc77dff, fog: 0x140f1c, ambient: 0x7d6a99 },
    enemies: [
      { id: 'sporeling', weight: 5 },
      { id: 'cave_spider', weight: 3 },
      { id: 'fungal_brute', weight: 2 },
    ],
    enemyCount: [7, 11],
    itemCount: [3, 4],
    boss: { kind: 'mid', id: 'spore_mother' },
  },
  {
    id: 'mine',
    name: '버려진 광산',
    size: { w: 48, h: 48 },
    algorithms: { rooms: 0.5, cave: 0.5 },
    tileset: { floor: 'mine_plank', wall: 'mine_rock', stairs: 'mine_shaft', props: ['cart', 'lantern', 'ore_vein'] },
    palette: { floor: 0x5a4a38, wall: 0x33291f, accent: 0xffc857, fog: 0x17120c, ambient: 0x8c7355 },
    enemies: [
      { id: 'kobold', weight: 5 },
      { id: 'miner_ghoul', weight: 3 },
      { id: 'cave_spider', weight: 2 },
      { id: 'stone_golem', weight: 1 },
    ],
    enemyCount: [8, 12],
    itemCount: [3, 5],
    boss: null,
  },
  {
    id: 'magma',
    name: '용암 굴',
    size: { w: 52, h: 52 },
    algorithms: { rooms: 0.3, cave: 0.7 },
    tileset: { floor: 'magma_basalt', wall: 'magma_obsidian', stairs: 'magma_vent', props: ['lava_pool', 'ember', 'charred_bone'] },
    palette: { floor: 0x4d2f2a, wall: 0x241412, accent: 0xff6b35, fog: 0x1a0a08, ambient: 0x99513f },
    enemies: [
      { id: 'fire_imp', weight: 5 },
      { id: 'magma_hound', weight: 3 },
      { id: 'ash_wraith', weight: 2 },
      { id: 'stone_golem', weight: 1 },
    ],
    enemyCount: [9, 13],
    itemCount: [3, 5],
    boss: { kind: 'mid', id: 'cinder_drake' },
  },
  {
    id: 'citadel',
    name: '심연의 성채',
    size: { w: 56, h: 56 },
    algorithms: { rooms: 0.85, cave: 0.15 },
    tileset: { floor: 'citadel_marble', wall: 'citadel_blackstone', stairs: 'citadel_gate', props: ['banner', 'brazier', 'statue'] },
    palette: { floor: 0x3a3f5c, wall: 0x1a1c2e, accent: 0x6ea8fe, fog: 0x0a0b14, ambient: 0x5b6699 },
    enemies: [
      { id: 'dark_knight', weight: 4 },
      { id: 'cultist', weight: 4 },
      { id: 'gargoyle', weight: 2 },
      { id: 'shade', weight: 2 },
    ],
    enemyCount: [10, 15],
    itemCount: [4, 6],
    boss: { kind: 'final', id: 'abyss_lord' },
  },
]);
