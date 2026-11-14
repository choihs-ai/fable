// 구역마다의 꾸밈: 바닥 무늬, 바닥 얼룩, 벽 등불의 색, 벽에 거는 것, 바닥에 놓는 소품, 보스 방의 문양.
// 모두 그림일 뿐이다(로직은 이 파일을 모른다 — 밟아도 되고 막지 않는다). 키는 ZONES 의 id.
//
// - floor.pattern: 바닥 텍스처 무늬. 'flagstone'(돌판) | 'brick'(벽돌) | 'soil'(흙) | 'planks'(널빤지) | 'basalt'(갈라진 현무암) | 'tiles'(바둑판)
// - floor.jitter: 칸마다 밝기를 이만큼 흔든다(0~1). floor.patch: 칸 무리에 섞는 얼룩 색과 비율(chance = 방마다 얼룩 수 / 칸 수), radius 칸
// - lamp: 북쪽 벽 등불. post 기둥 색, flame 불꽃 색(빛나는 재질), light 빛의 색, size 불꽃 크기
// - wall: 북쪽 벽에 거는 것(방마다 rate 확률로 하나 — 깃발 대신)
// - props: 바닥에 놓는 소품. weight 뽑기 가중치, tall 이면 문 앞을 피해 놓는다
//   parts: 부품 목록 { geo: 공유 지오메트리 이름, glow: 빛나는가, color, s: [가로, 높이, 세로], o: [x, y, z] 칸 안의 위치, r: y 축 회전(라디안의 비율 — 1 = 반 바퀴), tilt: x 축 기울임(같은 단위) }
// - density: 방 넓이 22칸마다 소품 몇 개(품질의 props 비율을 곱한다). scale: 바닥 소품 전체의 크기 배율(부품 크기는 1 기준으로 적었다)
// - sigil: 보스 방 바닥 가운데의 문양 색

import { deepFreeze } from './freeze.js';

const P = (geo, color, s, o = [0, 0, 0], extra = {}) => ({ geo, color, s, o, ...extra });
const G = (geo, color, s, o = [0, 0, 0], extra = {}) => ({ geo, color, s, o, glow: true, ...extra });

export const DECOR = deepFreeze({
  crypt: {
    floor: { pattern: 'flagstone', jitter: 0.1, patch: { color: 0x2c2838, chance: 0.05, radius: 1.6 } },
    lamp: { post: 0x3a3048, flame: 0x8ff5dc, light: 0x6fe0c0, size: 1 },
    wall: { rate: 0.6, parts: [P('limb', 0x5a2a5a, [0.5, 0.95, 0.04], [0, 1.55, 0]), P('cube', 0xd8d0b8, [0.14, 0.14, 0.05], [0, 1.25, 0.02])] },
    density: 2.2,
    scale: 1.7,
    sigil: 0x6fe0c0,
    props: [
      { id: 'bones', weight: 4, parts: [P('cube', 0xd8d0b8, [0.32, 0.05, 0.07], [0, 0.03, 0], { r: 0.2 }), P('cube', 0xd8d0b8, [0.07, 0.05, 0.26], [0.06, 0.03, 0.04], { r: 0.1 }), P('head', 0xe8e0c8, [0.09, 0.08, 0.09], [-0.12, 0.07, -0.05])] },
      { id: 'tombstone', weight: 2, tall: true, parts: [P('box', 0x6a6478, [0.42, 0.55, 0.14]), P('box', 0x4a4458, [0.5, 0.08, 0.22]), P('cube', 0x3a3448, [0.2, 0.04, 0.02], [0, 0.38, 0.075])] },
      { id: 'urn', weight: 2, parts: [P('orb', 0x8a5a3a, [0.15, 0.19, 0.15], [0, 0.18, 0]), P('tube', 0x6a4028, [0.07, 0.08, 0.07], [0, 0.33, 0])] },
      { id: 'candles', weight: 3, parts: [P('tube', 0xe8e0c8, [0.035, 0.2, 0.035], [0, 0, 0]), G('star', 0x9ff5dc, [0.035, 0.07, 0.035], [0, 0.25, 0]), P('tube', 0xe8e0c8, [0.03, 0.12, 0.03], [0.09, 0, 0.05]), G('star', 0x9ff5dc, [0.03, 0.06, 0.03], [0.09, 0.16, 0.05])] },
    ],
  },
  sewer: {
    floor: { pattern: 'brick', jitter: 0.12, patch: { color: 0x1c3a34, chance: 0.08, radius: 2.2 } },
    lamp: { post: 0x2a3a34, flame: 0xd2f57a, light: 0xa8e07a, size: 0.9 },
    wall: { rate: 0.9, parts: [P('tube', 0x4a6a62, [0.09, 1, 0.09], [0.5, 1.15, 0.05], { roll: 0.5 }), P('tube', 0x2a4a42, [0.13, 0.08, 0.13], [0.04, 1.15, 0.05], { roll: 0.5 }), G('orb', 0x9fe05a, [0.05, 0.05, 0.05], [0, 0.95, 0.1])] },
    density: 2,
    scale: 1.7,
    sigil: 0x9fe05a,
    props: [
      { id: 'puddle', weight: 4, parts: [G('disc', 0x2a6a5a, [0.38, 1, 0.3], [0, 0.012, 0])] },
      { id: 'barrel', weight: 2, tall: true, parts: [P('tube', 0x6a4a2a, [0.2, 0.42, 0.2]), P('tube', 0x2a2a2a, [0.21, 0.04, 0.21], [0, 0.08, 0]), P('tube', 0x2a2a2a, [0.21, 0.04, 0.21], [0, 0.32, 0]), G('disc', 0x9fe05a, [0.16, 1, 0.16], [0, 0.425, 0])] },
      { id: 'moss', weight: 3, parts: [P('head', 0x4a7a3a, [0.14, 0.06, 0.12], [0, 0.03, 0]), P('head', 0x5a8a3a, [0.1, 0.05, 0.09], [0.12, 0.025, 0.06])] },
      { id: 'grate', weight: 1, parts: [P('cube', 0x1a2a26, [0.5, 0.02, 0.5], [0, 0.01, 0]), P('cube', 0x3a4a46, [0.5, 0.03, 0.05], [0, 0.02, -0.12]), P('cube', 0x3a4a46, [0.5, 0.03, 0.05], [0, 0.02, 0.12])] },
    ],
  },
  fungal: {
    floor: { pattern: 'soil', jitter: 0.16, patch: { color: 0x6a2a6a, chance: 0.07, radius: 1.8 } },
    lamp: { post: 0xe8d8e8, flame: 0xff8ae0, light: 0xd070ff, size: 1.5 },
    wall: { rate: 0.8, parts: [G('orb', 0xff7ad8, [0.26, 0.08, 0.16], [-0.2, 1.4, 0.06]), G('orb', 0xffa0e8, [0.18, 0.06, 0.12], [0.15, 1.1, 0.06]), G('orb', 0xff7ad8, [0.14, 0.05, 0.1], [-0.05, 0.85, 0.06])] },
    density: 2.8,
    scale: 1.7,
    sigil: 0xff7ad8,
    props: [
      { id: 'mushroom', weight: 4, tall: true, parts: [P('tube', 0xe8d8c8, [0.05, 0.26, 0.05]), P('orb', 0xd84aa8, [0.17, 0.08, 0.17], [0, 0.28, 0]), G('orb', 0xffd0f0, [0.03, 0.03, 0.03], [0.07, 0.33, 0.06]), G('orb', 0xffd0f0, [0.03, 0.03, 0.03], [-0.06, 0.34, -0.04])] },
      { id: 'shrooms', weight: 3, parts: [P('tube', 0xe8d8c8, [0.025, 0.1, 0.025]), G('orb', 0xff7ad8, [0.06, 0.03, 0.06], [0, 0.11, 0]), P('tube', 0xe8d8c8, [0.02, 0.07, 0.02], [0.08, 0, 0.05]), G('orb', 0x9a7aff, [0.05, 0.025, 0.05], [0.08, 0.08, 0.05])] },
      { id: 'pod', weight: 2, parts: [G('orb', 0xff9ae8, [0.1, 0.12, 0.1], [0, 0.1, 0]), P('head', 0x5a2a5a, [0.12, 0.04, 0.12], [0, 0.02, 0])] },
      { id: 'root', weight: 2, parts: [P('cube', 0x4a3028, [0.48, 0.05, 0.07], [0, 0.025, 0], { r: 0.3 }), P('cube', 0x4a3028, [0.26, 0.04, 0.05], [0.1, 0.02, 0.1], { r: -0.2 })] },
    ],
  },
  mine: {
    floor: { pattern: 'planks', jitter: 0.12, patch: { color: 0x3a2a1a, chance: 0.05, radius: 1.5 } },
    lamp: { post: 0x2a2018, flame: 0xffd27a, light: 0xffb85a, size: 0.85 },
    wall: { rate: 1, parts: [P('box', 0x6a4a2a, [0.14, 1.6, 0.14], [-0.42, 0, 0.1]), P('box', 0x6a4a2a, [0.14, 1.6, 0.14], [0.42, 0, 0.1]), P('cube', 0x5a3a20, [1.05, 0.14, 0.16], [0, 1.6, 0.1])] },
    density: 2.2,
    scale: 1.7,
    sigil: 0xffc857,
    props: [
      { id: 'crate', weight: 3, tall: true, parts: [P('box', 0x8a6a3a, [0.34, 0.32, 0.34], [0, 0, 0], { r: 0.1 }), P('cube', 0x5a3a20, [0.36, 0.04, 0.05], [0, 0.16, 0.16], { r: 0.1 })] },
      { id: 'ore', weight: 3, parts: [P('head', 0x4a3a2a, [0.14, 0.08, 0.12], [0, 0.04, 0]), G('spike', 0xffc857, [0.05, 0.16, 0.05], [0.03, 0.04, 0], { tilt: 0.1 }), G('spike', 0x7ad8ff, [0.04, 0.12, 0.04], [-0.06, 0.03, 0.03], { tilt: -0.12 })] },
      { id: 'rail', weight: 2, parts: [P('cube', 0x3a3a3a, [0.6, 0.03, 0.04], [0, 0.02, -0.12]), P('cube', 0x3a3a3a, [0.6, 0.03, 0.04], [0, 0.02, 0.12]), P('cube', 0x5a3a20, [0.08, 0.02, 0.34], [-0.18, 0.01, 0]), P('cube', 0x5a3a20, [0.08, 0.02, 0.34], [0.18, 0.01, 0])] },
      { id: 'rubble', weight: 2, parts: [P('head', 0x6a5a4a, [0.1, 0.07, 0.09], [0, 0.04, 0]), P('head', 0x5a4a3a, [0.07, 0.05, 0.06], [0.1, 0.03, 0.06]), P('head', 0x7a6a5a, [0.06, 0.04, 0.06], [-0.08, 0.02, 0.08])] },
    ],
  },
  magma: {
    floor: { pattern: 'basalt', jitter: 0.1, patch: { color: 0x7a2a14, chance: 0.06, radius: 1.4 } },
    lamp: { post: 0x1a1010, flame: 0xff6a2a, light: 0xff5a2a, size: 1.3 },
    wall: { rate: 0.7, parts: [G('cube', 0xff6a2a, [0.06, 0.9, 0.02], [-0.1, 1.2, 0.04], { r: 0 }), G('cube', 0xffa04a, [0.04, 0.5, 0.02], [0.15, 1.0, 0.04])] },
    density: 2.4,
    scale: 1.7,
    sigil: 0xff7a35,
    props: [
      { id: 'crack', weight: 4, parts: [G('cube', 0xff5a1a, [0.5, 0.01, 0.05], [0, 0.012, 0], { r: 0.25 }), G('cube', 0xffa03a, [0.24, 0.01, 0.04], [0.12, 0.012, 0.08], { r: -0.15 })] },
      { id: 'obsidian', weight: 2, tall: true, parts: [P('spike', 0x2a1a24, [0.12, 0.4, 0.12], [0, 0, 0], { tilt: 0.05 }), P('spike', 0x3a2030, [0.08, 0.26, 0.08], [0.12, 0, 0.05], { tilt: -0.1 })] },
      { id: 'embers', weight: 3, parts: [P('head', 0x2a1a14, [0.12, 0.05, 0.1], [0, 0.025, 0]), G('star', 0xff7a2a, [0.04, 0.04, 0.04], [0.02, 0.07, 0]), G('star', 0xffc04a, [0.03, 0.03, 0.03], [-0.05, 0.06, 0.04])] },
      { id: 'brazier', weight: 1, tall: true, parts: [P('tube', 0x2a2020, [0.04, 0.32, 0.04]), P('tube', 0x3a2a2a, [0.14, 0.08, 0.14], [0, 0.32, 0]), G('star', 0xff8a3a, [0.1, 0.16, 0.1], [0, 0.46, 0])] },
    ],
  },
  citadel: {
    floor: { pattern: 'tiles', jitter: 0.06, patch: { color: 0x5a1a2a, chance: 0.03, radius: 1.2 } },
    lamp: { post: 0x1a1a30, flame: 0xb48aff, light: 0x9a7aff, size: 1.1 },
    // 벽에 걸린 훔친 탈들.
    wall: { rate: 1, parts: [P('head', 0xd84a4a, [0.14, 0.17, 0.06], [-0.32, 1.45, 0.06]), P('head', 0xf1e4c8, [0.14, 0.17, 0.06], [0, 1.5, 0.06]), P('head', 0x4a8ad8, [0.14, 0.17, 0.06], [0.32, 1.45, 0.06]), P('cube', 0x2a2a3a, [0.9, 0.04, 0.04], [0, 1.68, 0.04])] },
    density: 1.6,
    scale: 1.7,
    sigil: 0x7ab8ff,
    props: [
      { id: 'statue', weight: 2, tall: true, parts: [P('box', 0x4a4a6a, [0.32, 0.18, 0.32]), P('box', 0x6a6a8a, [0.16, 0.3, 0.14], [0, 0.18, 0]), P('head', 0x8a8aaa, [0.11, 0.12, 0.11], [0, 0.56, 0])] },
      { id: 'chain', weight: 2, parts: [P('cube', 0x3a3a4a, [0.06, 0.04, 0.06], [-0.12, 0.02, 0]), P('cube', 0x3a3a4a, [0.06, 0.04, 0.06], [-0.04, 0.02, 0.02]), P('cube', 0x3a3a4a, [0.06, 0.04, 0.06], [0.04, 0.02, 0]), P('cube', 0x3a3a4a, [0.06, 0.04, 0.06], [0.12, 0.02, 0.02])] },
      { id: 'fallen_mask', weight: 3, parts: [P('head', 0xf1e4c8, [0.1, 0.03, 0.12], [0, 0.02, 0], { r: 0.2 }), P('cube', 0x120b14, [0.025, 0.012, 0.025], [-0.03, 0.04, -0.02]), P('cube', 0x120b14, [0.025, 0.012, 0.025], [0.03, 0.04, -0.02])] },
      { id: 'candelabra', weight: 1, tall: true, parts: [P('tube', 0x8a7a4a, [0.03, 0.42, 0.03]), P('cube', 0x8a7a4a, [0.24, 0.03, 0.03], [0, 0.4, 0]), G('star', 0xb48aff, [0.03, 0.06, 0.03], [-0.11, 0.46, 0]), G('star', 0xb48aff, [0.03, 0.06, 0.03], [0.11, 0.46, 0]), G('star', 0xb48aff, [0.03, 0.06, 0.03], [0, 0.48, 0])] },
    ],
  },
});
