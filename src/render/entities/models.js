// 코드로 만드는 로우폴리 모델: 캐릭터·적·보스·상인과 무기 14종.
// 그림체: 머리가 큰 땅딸막한 몸(머리가 키의 40% 남짓), 짧은 팔다리, 과장해서 큰 무기, 굵은 검은 외곽선.
// 모든 부품은 assets 의 공유 지오메트리·머티리얼을 쓴다(모델을 만들어도 GPU 자원은 늘지 않는다).
//
// 모델의 뼈대(위에서 아래로):
//   root(바닥 위치, y 축 회전 = 바라보는 방향, +z 가 앞)
//     shadow                         바닥 그림자
//     scaleGroup(키 배율)
//       body(엉덩이 높이 = fig.hipY)   흔들림·기울기·비틀기
//         torso, head(+얼굴·장식)
//         armL / armR(어깨에 매달림)   armR 끝의 hand 에 무기
//       legL / legR(엉덩이에 매달림)
// 팔·다리는 아래(-y)로 매달려 있고, rotation.x 가 음수면 앞으로 든다. 무기도 손에서 -y 쪽으로 뻗는다(팔을 들면 앞을 향한다).
// 부품마다 외곽선 껍데기(assets.materials.outline)를 자식으로 붙인다. 껍데기는 번쩍임 목록(fig.parts)에 넣지 않는다.

import * as THREE from 'three';

/**
 * 모델의 생김새. scale 은 키 배율, form 은 'biped'(두 발) | 'bat'(날개) | 'quad'(네 발) | 'blob'(말랑한 덩어리).
 * face: 'visor'(투구 틈의 빛나는 눈) | 'glow'(어두운 얼굴에 빛나는 눈) | 'skull'(해골: 검은 눈구멍 + 불씨) | 'eyes'(점 눈)
 * eye: 빛나는 눈의 색. extras: 장식 이름들.
 */
export const LOOKS = Object.freeze({
  // 주인공들
  knight: { form: 'biped', scale: 1.18, body: 0x3a6fc4, trim: 0x262b40, skin: 0xd9e0ea, face: 'visor', eye: 0x7af2ff, weaponScale: 1.3, extras: ['plume', 'scarf'] },
  mage: { form: 'biped', scale: 1.18, body: 0x7a3fc0, trim: 0xf0b83a, skin: 0x1c1430, face: 'glow', eye: 0xffd84a, weaponScale: 1.3, extras: ['hood', 'robe'] },
  rogue: { form: 'biped', scale: 1.14, body: 0x1f8a80, trim: 0x16242c, skin: 0x10141c, face: 'glow', eye: 0xff5a7a, weaponScale: 1.3, thin: true, extras: ['cowl', 'scarf'] },
  brute: { form: 'biped', scale: 1.3, body: 0xc0452e, trim: 0x3a2018, skin: 0xe8b890, face: 'eyes', eye: 0x2a1410, weaponScale: 1.25, extras: ['horns', 'pauldrons'] },
  gunner: { form: 'biped', scale: 1.18, body: 0x8a5a32, trim: 0x3a2a1e, skin: 0xe8c49a, face: 'eyes', eye: 0x2a1a14, weaponScale: 1.3, extras: ['hat', 'pack'] },
  shaman: { form: 'biped', scale: 1.16, body: 0xc8323c, trim: 0xf0b83a, skin: 0xf6f0e0, face: 'eyes', eye: 0x1a1014, weaponScale: 1.3, extras: ['hood', 'robe'] },
  jester: { form: 'biped', scale: 1.12, body: 0xe8a020, trim: 0x7a2ac0, skin: 0xfff3d6, face: 'eyes', eye: 0x1a1014, weaponScale: 1.3, thin: true, extras: ['horns', 'scarf'] },
  revenant: { form: 'biped', scale: 1.22, body: 0x3a5a4c, trim: 0x1c2a26, skin: 0xcfe0d0, face: 'skull', eye: 0x7dffb0, weaponScale: 1.3, extras: ['jaw', 'cowl', 'cape'] },
  // 지하 묘지
  skeleton: { form: 'biped', scale: 1.08, body: 0xefe7d2, trim: 0x6a5a48, skin: 0xefe7d2, face: 'skull', eye: 0xff8a2a, thin: true, weapon: 'sword', extras: ['jaw'] },
  bone_archer: { form: 'biped', scale: 1.08, body: 0x3f7a4a, trim: 0x2a3a26, skin: 0xe6dcc4, face: 'skull', eye: 0x9aff6a, thin: true, weapon: 'bow', extras: ['jaw', 'cowl'] },
  zombie: { form: 'biped', scale: 1.12, body: 0x7a5038, trim: 0x3a2a24, skin: 0x86b85a, face: 'eyes', eye: 0xfff6c8, weapon: null, reach: true, extras: ['stitch'] },
  bat: { form: 'bat', scale: 1, body: 0x5a3a86, trim: 0x2e1d4a, skin: 0xff5a8a, eye: 0xff5a8a, extras: [] },
  rat: { form: 'quad', scale: 1, body: 0x8a6a52, trim: 0x4a382c, skin: 0xf0a0b0, eye: 0xff3a3a, extras: [] },
  // 지하 수로
  slime: { form: 'blob', scale: 1, body: 0x6fd04a, trim: 0x3a7a2a, skin: 0x6fd04a, eye: 0x1a1418, extras: [] },
  slimelet: { form: 'blob', scale: 0.65, body: 0x8fe06a, trim: 0x3a7a2a, skin: 0x8fe06a, eye: 0x1a1418, extras: [] },
  leech: { form: 'blob', scale: 0.8, body: 0x8a2a3a, trim: 0x4a141c, skin: 0x8a2a3a, eye: 0xffe08a, glowEye: true, extras: [] },
  sludge_king: { form: 'blob', scale: 2.7, body: 0x4aa83a, trim: 0xd8a84a, skin: 0x4aa83a, eye: 0xfff2a0, glowEye: true, extras: ['crown'] },
  // 버섯 동굴
  sporeling: { form: 'blob', scale: 0.85, body: 0xf0e0c8, trim: 0xe0457a, skin: 0xf0e0c8, eye: 0x1a1418, extras: ['cap'] },
  cave_spider: { form: 'quad', scale: 1.15, body: 0x3a3048, trim: 0x1c1626, skin: 0x5a4a70, eye: 0xff3a3a, extras: [] },
  fungal_brute: { form: 'biped', scale: 1.45, body: 0xa05ab0, trim: 0x5a2a6a, skin: 0xe8d8c0, face: 'eyes', eye: 0x1a1418, weapon: null, extras: ['hat'] },
  spore_mother: { form: 'blob', scale: 2.7, body: 0xe8d8c0, trim: 0xc0306a, skin: 0xe8d8c0, eye: 0x2a0a1a, extras: ['cap'] },
  // 버려진 광산
  kobold: { form: 'biped', scale: 0.95, body: 0xa0703a, trim: 0x4a3020, skin: 0x9ac05a, face: 'eyes', eye: 0x1a1418, thin: true, weapon: null, extras: ['horns'] },
  miner_ghoul: { form: 'biped', scale: 1.12, body: 0x5a6a7a, trim: 0x2a3038, skin: 0x9ab0a0, face: 'skull', eye: 0xffe14a, weapon: 'hammer', extras: ['hat'] },
  stone_golem: { form: 'biped', scale: 1.6, body: 0x8a8478, trim: 0x5a564e, skin: 0xa8a294, face: 'glow', eye: 0x5af0ff, weapon: null, extras: ['pauldrons'] },
  foreman: { form: 'biped', scale: 2.0, body: 0x6a5a3a, trim: 0x2a2620, skin: 0x9ab0a0, face: 'skull', eye: 0xffb020, weapon: 'hammer', weaponScale: 1.15, extras: ['jaw', 'hat', 'pauldrons'] },
  // 용암 굴
  fire_imp: { form: 'bat', scale: 1, body: 0xe8452a, trim: 0x8a1c14, skin: 0xffe14a, eye: 0xffe14a, extras: [] },
  magma_hound: { form: 'quad', scale: 1.3, body: 0x7a2a1c, trim: 0x3a1410, skin: 0xff8a3a, eye: 0xffe14a, extras: [] },
  ash_wraith: { form: 'biped', scale: 1.1, body: 0x5a5560, trim: 0x2a2830, skin: 0x1a181e, face: 'glow', eye: 0xff7a2a, thin: true, weapon: null, extras: ['hood', 'robe'] },
  cinder_drake: { form: 'quad', scale: 2.7, body: 0xc0381c, trim: 0x5a1810, skin: 0xffa23a, eye: 0xffe14a, extras: [] },
  // 심연의 성채
  dark_knight: { form: 'biped', scale: 1.35, body: 0x2a2e48, trim: 0x14162a, skin: 0x3a4060, face: 'visor', eye: 0xff3a5a, weapon: 'greatsword', extras: ['plume', 'pauldrons'] },
  cultist: { form: 'biped', scale: 1.08, body: 0x4a2a7a, trim: 0xd0a040, skin: 0x140e20, face: 'glow', eye: 0xc77dff, weapon: 'staff', extras: ['hood', 'robe'] },
  gargoyle: { form: 'bat', scale: 1.5, body: 0x6a7088, trim: 0x3a4058, skin: 0x7ab8ff, eye: 0x7ab8ff, extras: [] },
  shade: { form: 'biped', scale: 1.05, body: 0x1c1c30, trim: 0x0c0c18, skin: 0x0c0c18, face: 'glow', eye: 0x7af2ff, thin: true, weapon: null, extras: ['cowl'] },
  abyss_lord: { form: 'biped', scale: 2.4, body: 0x1c1640, trim: 0x7a3fc0, skin: 0x0c0a1c, face: 'glow', eye: 0xff3ad8, weapon: 'scythe', weaponScale: 1.15, extras: ['horns', 'pauldrons', 'cape'] },
  bone_warden: { form: 'biped', scale: 2.1, body: 0x2e2a3e, trim: 0x1c1826, skin: 0xefe7d2, face: 'skull', eye: 0xff3a2a, weapon: 'greatsword', weaponScale: 1.15, extras: ['jaw', 'horns', 'pauldrons', 'cape'] },
  merchant: { form: 'biped', scale: 1.15, body: 0x2f7a5a, trim: 0xd8a84a, skin: 0xf2c8a0, face: 'eyes', eye: 0x2a1a14, weapon: null, extras: ['hat', 'pack'] },
});

/** 정의가 없는 적의 생김새: 이름에서 색을 정한다. */
export function lookOf(type) {
  if (Object.hasOwn(LOOKS, type)) return LOOKS[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (Math.imul(hash, 31) + type.charCodeAt(i)) >>> 0;
  const color = new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.55).getHex();
  return { form: 'biped', scale: 1.1, body: color, trim: 0x2a2430, skin: color, face: 'eyes', eye: 0x1a1418, weapon: 'sword', extras: [] };
}

/**
 * 메시 하나: 지오메트리·머티리얼은 공유, 크기·자리만 이 메시의 것이다.
 * outline 이면 같은 지오메트리의 외곽선 껍데기를 자식으로 붙인다(눈·작은 장식은 빼서 뭉개지지 않게).
 */
function part(assets, geometry, material, sx, sy, sz, x = 0, y = 0, z = 0, outline = true) {
  if (!assets.geometries[geometry]) throw new RangeError(`part: 알 수 없는 지오메트리 "${geometry}"`);
  const mesh = new THREE.Mesh(assets.geometries[geometry], material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (outline && assets.geometries[geometry].attributes.outlineNormal) {
    const shell = new THREE.Mesh(assets.geometries[geometry], assets.materials.outline);
    shell.userData.outline = true;
    mesh.add(shell);
  }
  return mesh;
}
/** 외곽선 없는 작은 부품(눈·불씨). */
const bit = (assets, geometry, material, sx, sy, sz, x, y, z) => part(assets, geometry, material, sx, sy, sz, x, y, z, false);

// ── 무기 ─────────────────────────────────────────────────────────────────────

const METAL = 0xc8ccd6;
const DARK = 0x3a3a42;
const WOOD = 0x8a5a32;
const GOLD = 0xd8b04a;

/**
 * 무기 하나를 만든다. 손잡이가 원점이고 -y 쪽으로 뻗는다.
 * @returns {{ group:THREE.Group, tip:number, off:THREE.Group|null }} tip: 끝까지의 길이(총구 섬광 위치), off: 왼손에 드는 것(쌍검)
 */
export function buildWeapon(assets, look) {
  const g = new THREE.Group();
  const t = (c) => assets.toon(c);
  let tip = 0.6;
  let off = null;
  const add = (...parts) => parts.forEach((p) => g.add(p));
  switch (look) {
    case 'sword':
      add(part(assets, 'cube', t(WOOD), 0.07, 0.18, 0.07, 0, -0.04, 0), part(assets, 'cube', t(GOLD), 0.26, 0.05, 0.07, 0, -0.14, 0), part(assets, 'limb', t(METAL), 0.09, 0.7, 0.03, 0, -0.16, 0));
      tip = 0.86;
      break;
    case 'dagger':
      add(part(assets, 'cube', t(WOOD), 0.06, 0.12, 0.06, 0, -0.02, 0), part(assets, 'limb', t(METAL), 0.07, 0.36, 0.03, 0, -0.08, 0));
      tip = 0.44;
      break;
    case 'dual': {
      add(part(assets, 'cube', t(DARK), 0.06, 0.12, 0.06, 0, -0.02, 0), part(assets, 'limb', t(0xb0e0ff), 0.07, 0.42, 0.03, 0, -0.08, 0));
      off = new THREE.Group();
      off.add(part(assets, 'cube', t(DARK), 0.06, 0.12, 0.06, 0, -0.02, 0), part(assets, 'limb', t(0xb0e0ff), 0.07, 0.42, 0.03, 0, -0.08, 0));
      tip = 0.5;
      break;
    }
    case 'spear':
      add(part(assets, 'limb', t(WOOD), 0.05, 1.5, 0.05, 0, 0.45, 0), part(assets, 'spike', t(METAL), 0.08, 0.28, 0.08, 0, -1.05, 0));
      g.children[1].rotation.x = Math.PI;
      tip = 1.33;
      break;
    case 'greatsword':
      add(part(assets, 'cube', t(DARK), 0.08, 0.3, 0.08, 0, -0.05, 0), part(assets, 'cube', t(GOLD), 0.4, 0.07, 0.1, 0, -0.22, 0), part(assets, 'limb', t(0xa8aebc), 0.2, 1.15, 0.05, 0, -0.25, 0));
      tip = 1.4;
      break;
    case 'hammer':
      add(part(assets, 'limb', t(WOOD), 0.06, 0.9, 0.06, 0, 0.1, 0), part(assets, 'cube', t(0x6a6e78), 0.42, 0.24, 0.24, 0, -0.85, 0));
      tip = 0.95;
      break;
    case 'pistol':
      add(part(assets, 'cube', t(DARK), 0.08, 0.14, 0.1, 0, -0.02, 0), part(assets, 'limb', t(0x5a5e68), 0.09, 0.3, 0.09, 0, -0.06, 0.02));
      tip = 0.38;
      break;
    case 'staff':
      add(part(assets, 'limb', t(WOOD), 0.05, 1.3, 0.05, 0, 0.4, 0), part(assets, 'orb', assets.glow(0x9a7aff, 0.9), 0.13, 0.13, 0.13, 0, -0.95, 0));
      tip = 0.98;
      break;
    case 'bow': {
      const arc = part(assets, 'arc', t(WOOD), 0.45, 0.45, 0.45, 0, -0.1, 0);
      arc.rotation.set(0, Math.PI / 2, -Math.PI / 2);
      add(arc, part(assets, 'limb', t(0xe0e0d0), 0.01, 0.9, 0.01, 0, 0.35, -0.0));
      tip = 0.4;
      break;
    }
    case 'smg':
      add(part(assets, 'cube', t(DARK), 0.1, 0.16, 0.12, 0, -0.03, 0), part(assets, 'limb', t(0x50545e), 0.1, 0.42, 0.11, 0, -0.08, 0.02), part(assets, 'cube', t(DARK), 0.06, 0.18, 0.07, 0, -0.2, 0.1));
      tip = 0.52;
      break;
    case 'shotgun':
      add(part(assets, 'cube', t(WOOD), 0.1, 0.22, 0.12, 0, 0.0, 0), part(assets, 'limb', t(0x5a5e68), 0.13, 0.62, 0.08, 0, -0.1, 0.02));
      tip = 0.74;
      break;
    case 'sniper':
      add(part(assets, 'cube', t(WOOD), 0.09, 0.26, 0.11, 0, 0.02, 0), part(assets, 'limb', t(0x404450), 0.06, 0.95, 0.06, 0, -0.12, 0.02), part(assets, 'limb', t(DARK), 0.06, 0.26, 0.06, 0, -0.2, 0.1));
      tip = 1.08;
      break;
    case 'laser':
      add(part(assets, 'cube', t(0xe0e4ec), 0.12, 0.2, 0.14, 0, -0.02, 0), part(assets, 'limb', assets.glow(0x5af0ff, 0.9), 0.07, 0.42, 0.07, 0, -0.12, 0.02));
      tip = 0.56;
      break;
    case 'rocket':
      add(part(assets, 'tube', t(0x5a7a4a), 0.11, 0.85, 0.11, 0, 0.25, 0.02), part(assets, 'cube', t(DARK), 0.08, 0.18, 0.1, 0, -0.05, -0.08));
      g.children[0].rotation.x = Math.PI;
      tip = 0.62;
      break;
    case 'whip':
      add(part(assets, 'cube', t(DARK), 0.07, 0.18, 0.07, 0, -0.04, 0), part(assets, 'limb', t(0x6a3a22), 0.045, 1.25, 0.045, 0, -0.12, 0), part(assets, 'spike', t(0xd8b04a), 0.05, 0.14, 0.05, 0, -1.5, 0));
      g.children[2].rotation.x = Math.PI;
      g.children[2].position.y = -1.36;
      tip = 1.45;
      break;
    case 'gauntlets':
      add(part(assets, 'rbox', t(0xb8863a), 0.22, 0.22, 0.24, 0, -0.03, 0), part(assets, 'cube', t(DARK), 0.24, 0.06, 0.26, 0, 0.07, 0));
      off = new THREE.Group();
      off.add(part(assets, 'rbox', t(0xb8863a), 0.22, 0.22, 0.24, 0, -0.03, 0), part(assets, 'cube', t(DARK), 0.24, 0.06, 0.26, 0, 0.07, 0));
      tip = 0.22;
      break;
    case 'katana':
      add(part(assets, 'cube', t(0x7a1c24), 0.06, 0.24, 0.06, 0, -0.03, 0), part(assets, 'cube', t(GOLD), 0.16, 0.035, 0.12, 0, -0.16, 0), part(assets, 'limb', t(0xe6ecf4), 0.05, 0.92, 0.025, 0, -0.18, 0));
      tip = 1.1;
      break;
    case 'scythe': {
      const blade = part(assets, 'spike', t(METAL), 0.11, 0.62, 0.03, 0.05, -1.0, 0);
      blade.rotation.z = -1.25;
      add(part(assets, 'limb', t(DARK), 0.05, 1.55, 0.05, 0, 0.5, 0), blade);
      tip = 1.08;
      break;
    }
    case 'shuriken':
      add(part(assets, 'star', t(METAL), 0.17, 0.17, 0.035, 0, -0.1, 0), part(assets, 'cube', t(DARK), 0.05, 0.05, 0.05, 0, -0.1, 0));
      tip = 0.22;
      break;
    case 'crossbow':
      add(part(assets, 'cube', t(WOOD), 0.09, 0.22, 0.1, 0, 0, 0), part(assets, 'limb', t(DARK), 0.07, 0.5, 0.07, 0, -0.08, 0.02), part(assets, 'cube', t(WOOD), 0.56, 0.05, 0.06, 0, -0.5, 0.02), part(assets, 'limb', t(METAL), 0.025, 0.4, 0.025, 0, -0.14, 0.07));
      tip = 0.62;
      break;
    case 'froststaff':
      add(part(assets, 'limb', t(0xcfd6e2), 0.05, 1.3, 0.05, 0, 0.4, 0), part(assets, 'spike', t(0xbfe8ff), 0.1, 0.26, 0.1, 0, -0.9, 0), part(assets, 'orb', assets.glow(0x7ad7ff, 0.9), 0.11, 0.11, 0.11, 0, -0.84, 0));
      g.children[1].rotation.x = Math.PI;
      g.children[1].position.y = -0.86;
      tip = 1.0;
      break;
    case 'flamethrower':
      add(part(assets, 'tube', t(0x8a3a2a), 0.1, 0.62, 0.1, 0, 0.1, 0.02), part(assets, 'cube', t(0x4a4e58), 0.16, 0.28, 0.16, 0, 0.12, -0.1), part(assets, 'orb', assets.glow(0xff8a2a, 0.9), 0.07, 0.07, 0.07, 0, -0.55, 0.02));
      g.children[0].rotation.x = Math.PI;
      tip = 0.58;
      break;
    case 'claw':
    default:
      tip = 0.25;
      break;
  }
  return { group: g, tip, off };
}

// ── 몸 ───────────────────────────────────────────────────────────────────────

/** 얼굴: 머리 앞면(z = 앞)에 붙이는 눈. */
function addFace(assets, head, look, w, h, d) {
  const front = d / 2 + 0.006;
  const eyeY = h * 0.5;
  if (look.face === 'visor') {
    // 투구: 어두운 틈 + 빛나는 두 눈.
    head.add(bit(assets, 'cube', assets.toon(0x14101c), w * 0.78, h * 0.18, 0.02, 0, eyeY, front));
    for (const sx of [-1, 1]) head.add(bit(assets, 'cube', assets.glow(look.eye, 1), w * 0.12, h * 0.1, 0.02, sx * w * 0.18, eyeY, front + 0.005));
  } else if (look.face === 'glow') {
    for (const sx of [-1, 1]) head.add(bit(assets, 'rbox', assets.glow(look.eye, 1), w * 0.14, h * 0.2, 0.03, sx * w * 0.17, eyeY, front));
  } else if (look.face === 'skull') {
    // 해골: 크고 검은 눈구멍 안의 작은 불씨, 코 구멍.
    for (const sx of [-1, 1]) {
      head.add(bit(assets, 'rbox', assets.toon(0x120a10), w * 0.26, h * 0.26, 0.03, sx * w * 0.19, eyeY, front));
      head.add(bit(assets, 'cube', assets.glow(look.eye, 1), w * 0.08, h * 0.08, 0.02, sx * w * 0.19, eyeY - h * 0.02, front + 0.012));
    }
    head.add(bit(assets, 'spike', assets.toon(0x120a10), w * 0.05, h * 0.1, 0.02, 0, eyeY - h * 0.28, front));
  } else {
    // 점 눈(살아 있는 것들): 흰자 위의 검은 눈동자. 좀비는 한쪽이 크다.
    for (const sx of [-1, 1]) {
      const big = look.extras.includes('stitch') && sx > 0 ? 1.4 : 1;
      head.add(bit(assets, 'rbox', assets.toon(0xfaf6ea), w * 0.17 * big, h * 0.22 * big, 0.03, sx * w * 0.18, eyeY, front));
      head.add(bit(assets, 'cube', assets.toon(look.eye === 0xfff6c8 ? 0x1a1418 : look.eye), w * 0.08, h * 0.12, 0.02, sx * w * 0.18, eyeY - h * 0.02, front + 0.015));
    }
  }
}

/**
 * 모델 하나를 만든다.
 * @param {object} assets
 * @param {object} look LOOKS 의 값
 * @param {{ elite?:boolean }} [options]
 * @returns {object} { root, body, torso, head, armL, armR, legL, legR, hand, handL, shadow, parts:[{mesh, material}], hover, hipY, height, form, scale }
 */
export function buildFigure(assets, look, { elite = false } = {}) {
  const glow = elite ? 0x5a1a0a : 0;
  const bodyMat = assets.toon(look.body, glow);
  const trimMat = assets.toon(look.trim, glow);
  const skinMat = assets.toon(look.skin, glow);
  const root = new THREE.Group();
  const shadow = new THREE.Mesh(assets.geometries.disc, assets.materials.shadow);
  shadow.position.y = 0.012;
  root.add(shadow);
  const body = new THREE.Group();
  const scaleGroup = new THREE.Group();
  scaleGroup.scale.setScalar(look.scale);
  scaleGroup.add(body);
  root.add(scaleGroup);
  const fig = {
    root, body, scaleGroup, shadow, form: look.form, scale: look.scale, hover: 0, hipY: 0.22, height: 1,
    armL: null, armR: null, legL: null, legR: null, hand: null, handL: null, head: null, wings: [],
  };
  const has = (name) => look.extras.includes(name);
  const limb = look.thin ? 0.08 : 0.115;

  if (look.form === 'biped') {
    const hip = 0.28;
    fig.hipY = hip;
    body.position.y = hip;
    // 몸통: 작고 둥근 덩어리 + 허리띠.
    fig.torso = part(assets, 'rbox', bodyMat, look.thin ? 0.3 : 0.38, 0.3, look.thin ? 0.22 : 0.28, 0, 0.15, 0);
    const belt = part(assets, 'rbox', trimMat, look.thin ? 0.32 : 0.4, 0.07, look.thin ? 0.24 : 0.3, 0, 0.03, 0);
    if (look.thin) {
      // 갈비뼈 무늬.
      for (const y of [0.11, 0.19]) fig.torso.add(bit(assets, 'cube', assets.toon(0x3a2e2a), 0.8, 0.12, 0.05, 0, (y - 0.15) / 0.3, 0.5));
    }
    // 머리: 크다(키의 40% 남짓).
    const hw = 0.5;
    const hh = 0.44;
    const hd = 0.44;
    const head = new THREE.Group();
    head.position.y = 0.3;
    const skull = part(assets, 'rbox', skinMat, hw, hh, hd, 0, hh / 2, 0);
    head.add(skull);
    addFace(assets, head, look, hw, hh, hd);
    if (has('jaw')) head.add(part(assets, 'rbox', skinMat, hw * 0.62, 0.1, hd * 0.7, 0, 0.02, 0.05));
    if (has('plume')) {
      head.add(part(assets, 'cone', assets.toon(0xe8353a), 0.07, 0.3, 0.16, 0, hh - 0.02, -0.04));
      head.add(part(assets, 'rbox', trimMat, hw * 1.04, 0.07, hd * 1.04, 0, hh * 0.82, 0));
    }
    if (has('hood')) {
      head.add(part(assets, 'rbox', bodyMat, hw * 1.16, hh * 1.1, hd * 0.96, 0, hh * 0.56, -0.05));
      const tipCone = part(assets, 'cone', bodyMat, 0.16, 0.34, 0.16, 0, hh * 1.0, -0.12);
      tipCone.rotation.x = -0.5;
      head.add(tipCone);
      head.add(part(assets, 'rbox', trimMat, hw * 1.18, 0.05, hd * 0.98, 0, hh * 0.1, -0.04));
    }
    if (has('cowl')) {
      head.add(part(assets, 'rbox', bodyMat, hw * 1.12, hh * 0.9, hd * 0.8, 0, hh * 0.62, -0.08));
    }
    if (has('stitch')) head.add(bit(assets, 'cube', assets.toon(0x2a1a14), 0.04, 0.16, 0.02, -0.12, hh * 0.86, hd / 2 + 0.01));
    if (has('hat')) {
      head.add(part(assets, 'tube', trimMat, 0.4, 0.04, 0.4, 0, hh - 0.02, 0), part(assets, 'cone', bodyMat, 0.22, 0.42, 0.22, 0, hh, 0));
    }
    if (has('horns')) {
      for (const sx of [-1, 1]) {
        const horn = part(assets, 'spike', assets.toon(0x2a2224), 0.07, 0.38, 0.07, sx * hw * 0.42, hh * 0.8, -0.02);
        horn.rotation.z = -sx * 0.7;
        head.add(horn);
      }
    }
    if (has('pauldrons')) for (const sx of [-1, 1]) body.add(part(assets, 'rbox', assets.toon(0xd0a040, glow), 0.2, 0.12, 0.24, sx * 0.25, 0.3, 0));
    if (has('scarf')) {
      body.add(part(assets, 'rbox', assets.toon(0xe8353a), 0.34, 0.08, 0.3, 0, 0.3, 0));
      const tail = part(assets, 'limb', assets.toon(0xe8353a), 0.12, 0.3, 0.04, 0.08, 0.31, -0.15);
      tail.rotation.x = 0.5;
      body.add(tail);
    }
    if (has('cape')) {
      const cape = part(assets, 'limb', assets.toon(0x8a1c24), 0.44, 0.5, 0.04, 0, 0.3, -0.16);
      cape.rotation.x = 0.25;
      body.add(cape);
    }
    if (has('pack')) body.add(part(assets, 'rbox', assets.toon(0x8a5a32), 0.32, 0.36, 0.2, 0, 0.2, -0.2));
    if (has('robe')) {
      // 로브 자락: 다리를 덮는 짧은 원뿔(걸을 때 다리 끝만 보인다).
      const skirt = part(assets, 'cone', bodyMat, 0.27, 0.34, 0.27, 0, -0.26, 0);
      body.add(skirt);
    }
    // 팔: 짧고, 손은 둥근 주먹.
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    const shoulder = look.thin ? 0.2 : 0.24;
    armL.position.set(-shoulder, 0.26, 0);
    armR.position.set(shoulder, 0.26, 0);
    for (const arm of [armL, armR]) arm.add(part(assets, 'limb', bodyMat, limb, 0.18, limb), part(assets, 'rbox', skinMat, limb * 1.25, 0.11, limb * 1.25, 0, -0.21, 0));
    const hand = new THREE.Group();
    hand.position.y = -0.22;
    armR.add(hand);
    const handL = new THREE.Group();
    handL.position.y = -0.22;
    armL.add(handL);
    // 다리: 짧고 굵게 + 장화.
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(-0.1, hip, 0);
    legR.position.set(0.1, hip, 0);
    for (const leg of [legL, legR]) leg.add(part(assets, 'limb', trimMat, limb * 1.2, hip - 0.06, limb * 1.25), part(assets, 'rbox', trimMat, limb * 1.4, 0.08, limb * 1.9, 0, -(hip - 0.04), 0.03));
    body.add(fig.torso, belt, head, armL, armR);
    scaleGroup.add(legL, legR);
    fig.height = hip + 0.3 + hh + (has('hat') || has('plume') ? 0.2 : 0.05);
    Object.assign(fig, { head, armL, armR, legL, legR, hand, handL });
  } else if (look.form === 'bat') {
    // 박쥐: 동그란 몸 하나에 큰 귀와 큰 날개.
    fig.hover = 0.85;
    fig.hipY = 0.85;
    fig.height = 1.3;
    body.position.y = fig.hover;
    fig.torso = part(assets, 'rbox', bodyMat, 0.36, 0.34, 0.32, 0, 0, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.04, 0.12);
    for (const sx of [-1, 1]) {
      const ear = part(assets, 'spike', bodyMat, 0.08, 0.2, 0.06, sx * 0.12, 0.12, -0.06);
      ear.rotation.z = -sx * 0.35;
      head.add(ear);
      head.add(bit(assets, 'rbox', assets.glow(look.eye, 1), 0.08, 0.1, 0.03, sx * 0.08, 0.02, 0.05));
    }
    head.add(bit(assets, 'spike', assets.toon(0xffffff), 0.025, 0.06, 0.02, -0.04, -0.07, 0.05), bit(assets, 'spike', assets.toon(0xffffff), 0.025, 0.06, 0.02, 0.04, -0.07, 0.05));
    head.children.at(-1).rotation.x = Math.PI;
    head.children.at(-2).rotation.x = Math.PI;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.x = 0.15 * side;
      // 날개는 앞뒤 두 면이라 외곽선 법선이 0 이 된다 — 껍데기 없이.
      const wing = bit(assets, 'wing', assets.toon(look.trim), 0.75 * side, 0.75, 0.75, 0, 0, 0);
      pivot.add(wing);
      body.add(pivot);
      fig.wings.push(pivot);
    }
    body.add(fig.torso, head);
    fig.head = head;
  } else if (look.form === 'blob') {
    // 말랑한 덩어리(슬라임·포자): 납작한 둥근 몸 하나에 눈 둘. 장식으로 버섯 갓이나 왕관을 얹는다.
    fig.hipY = 0.24;
    fig.height = 0.62;
    body.position.y = fig.hipY;
    fig.torso = part(assets, 'rbox', bodyMat, 0.62, 0.46, 0.58, 0, 0.02, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.04, 0);
    const eyeMat = look.glowEye ? assets.glow(look.eye, 1) : assets.toon(look.eye);
    for (const sx of [-1, 1]) {
      if (!look.glowEye) head.add(bit(assets, 'rbox', assets.toon(0xfaf6ea), 0.13, 0.15, 0.03, sx * 0.14, 0.04, 0.29));
      head.add(bit(assets, 'cube', eyeMat, look.glowEye ? 0.1 : 0.06, look.glowEye ? 0.08 : 0.08, 0.02, sx * 0.14, 0.03, 0.305));
    }
    if (has('cap')) {
      head.add(part(assets, 'tube', trimMat, 0.46, 0.1, 0.46, 0, 0.2, 0), part(assets, 'head', trimMat, 0.4, 0.2, 0.4, 0, 0.32, 0));
      for (const [x, z] of [[-0.2, 0.18], [0.22, 0.05], [0, -0.24]]) head.add(bit(assets, 'rbox', assets.toon(0xfaf6ea), 0.09, 0.05, 0.09, x, 0.42, z));
      fig.height = 0.85;
    }
    if (has('crown')) {
      head.add(part(assets, 'tube', trimMat, 0.2, 0.07, 0.2, 0, 0.24, 0));
      for (const [x, z] of [[-0.14, 0.08], [0.14, 0.08], [0, -0.15], [0, 0.17]]) head.add(part(assets, 'spike', trimMat, 0.05, 0.16, 0.05, x, 0.3, z));
      fig.height = 0.8;
    }
    body.add(fig.torso, head);
    fig.head = head;
  } else {
    // 네 발(쥐): 동그랗고 낮은 몸, 큰 귀, 긴 분홍 꼬리.
    fig.hipY = 0.24;
    fig.height = 0.75;
    body.position.y = 0.24;
    fig.torso = part(assets, 'rbox', bodyMat, 0.36, 0.28, 0.52, 0, 0.06, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.1, 0.3);
    head.add(part(assets, 'rbox', bodyMat, 0.28, 0.24, 0.26, 0, 0, 0));
    const snout = part(assets, 'spike', bodyMat, 0.1, 0.16, 0.1, 0, -0.02, 0.12);
    snout.rotation.x = Math.PI / 2;
    head.add(snout, bit(assets, 'rbox', assets.toon(look.skin), 0.05, 0.05, 0.05, 0, -0.02, 0.29));
    for (const sx of [-1, 1]) {
      head.add(part(assets, 'head', assets.toon(look.skin), 0.09, 0.09, 0.03, sx * 0.13, 0.15, -0.04));
      head.add(bit(assets, 'cube', assets.glow(look.eye, 1), 0.05, 0.05, 0.02, sx * 0.08, 0.05, 0.13));
    }
    const tail = part(assets, 'limb', assets.toon(look.skin), 0.035, 0.45, 0.035, 0, 0.08, -0.26);
    tail.rotation.x = -1.1;
    body.add(fig.torso, head, tail);
    fig.head = head;
    const legs = [];
    for (const [x, z] of [[-0.13, 0.17], [0.13, 0.17], [-0.13, -0.17], [0.13, -0.17]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.18, z);
      leg.add(part(assets, 'limb', trimMat, 0.08, 0.18, 0.09));
      scaleGroup.add(leg);
      legs.push(leg);
    }
    fig.legL = legs[0];
    fig.legR = legs[1];
    fig.quadLegs = legs;
  }

  // 번쩍임을 위해 부품과 원래 머티리얼을 기억해 둔다(외곽선 껍데기와 그림자는 빼고).
  fig.parts = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj !== shadow && !obj.userData.outline) fig.parts.push({ mesh: obj, material: obj.material });
  });
  fig.weaponScale = look.weaponScale ?? 1.15;
  return fig;
}

/** 손에 무기를 쥐어 준다(앞의 것은 뗀다). 무기 부품도 번쩍임 목록에 넣는다. */
export function equip(assets, fig, look) {
  if (!fig.hand) return null;
  const strip = (group) => {
    if (!group) return;
    fig.parts = fig.parts.filter((p) => {
      let inside = false;
      group.traverse((o) => {
        if (o === p.mesh) inside = true;
      });
      return !inside;
    });
    group.removeFromParent();
  };
  strip(fig.weapon);
  strip(fig.offWeapon);
  fig.weapon = null;
  fig.offWeapon = null;
  fig.tip = 0.3;
  if (!look) return null;
  const built = buildWeapon(assets, look);
  // 무기는 과장해서 크게(몸이 작으니 무기가 눈에 띄어야 한다).
  const k = fig.weaponScale ?? 1;
  built.group.scale.setScalar(k);
  if (built.off) built.off.scale.setScalar(k);
  fig.hand.add(built.group);
  fig.weapon = built.group;
  fig.tip = built.tip * k;
  if (built.off && fig.handL) {
    fig.handL.add(built.off);
    fig.offWeapon = built.off;
  }
  for (const group of [built.group, built.off]) {
    if (!group) continue;
    group.traverse((obj) => {
      if (obj.isMesh && !obj.userData.outline) {
        obj.castShadow = true;
        fig.parts.push({ mesh: obj, material: obj.material });
      }
    });
  }
  return built;
}
