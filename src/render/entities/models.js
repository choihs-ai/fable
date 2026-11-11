// 코드로 만드는 로우폴리 모델: 캐릭터·적·보스·상인과 무기 14종.
// 모든 부품은 assets 의 공유 지오메트리·머티리얼을 쓴다(모델을 만들어도 GPU 자원은 늘지 않는다).
//
// 모델의 뼈대(위에서 아래로):
//   root(바닥 위치, y 축 회전 = 바라보는 방향, +z 가 앞)
//     shadow                         바닥 그림자
//     body(엉덩이 높이)               흔들림·기울기·비틀기
//       torso, head(+장식)
//       armL / armR(어깨에 매달림)     armR 끝의 hand 에 무기
//     legL / legR(엉덩이에 매달림)
// 팔·다리는 아래(-y)로 매달려 있고, rotation.x 가 음수면 앞으로 든다. 무기도 손에서 -y 쪽으로 뻗는다(팔을 들면 앞을 향한다).

import * as THREE from 'three';

/** 모델의 생김새. scale 은 키 배율, form 은 'biped'(두 발) | 'bat'(날개) | 'quad'(네 발). */
export const LOOKS = Object.freeze({
  knight: { form: 'biped', scale: 1, body: 0x8fa3b8, trim: 0x4a5a70, skin: 0xf0c8a0, extras: ['helm', 'plume'] },
  mage: { form: 'biped', scale: 1, body: 0x6a4fb0, trim: 0x3a2a70, skin: 0xf0c8a0, extras: ['hood'] },
  skeleton: { form: 'biped', scale: 0.95, body: 0xe8e2cc, trim: 0x8a7a5a, skin: 0xe8e2cc, thin: true, weapon: 'sword', extras: [] },
  bone_archer: { form: 'biped', scale: 0.95, body: 0xd8d2bc, trim: 0x5a6a3a, skin: 0xd8d2bc, thin: true, weapon: 'bow', extras: ['hood'] },
  zombie: { form: 'biped', scale: 1.02, body: 0x5a4a3a, trim: 0x3a3028, skin: 0x7aa05a, weapon: null, reach: true, extras: [] },
  bat: { form: 'bat', scale: 0.8, body: 0x4a3a5a, trim: 0x2a1f35, skin: 0xff4a4a, extras: [] },
  rat: { form: 'quad', scale: 0.8, body: 0x7a6a5a, trim: 0x4a3a30, skin: 0xd09a9a, extras: [] },
  bone_warden: { form: 'biped', scale: 1.9, body: 0x3a3d48, trim: 0x8a6a2a, skin: 0xe0d8c0, weapon: 'greatsword', extras: ['horns', 'pauldrons'] },
  merchant: { form: 'biped', scale: 1.05, body: 0x3f7a4a, trim: 0xc9a24a, skin: 0xf0c8a0, weapon: null, extras: ['hat'] },
});

/** 정의가 없는 적의 생김새: 이름에서 색을 정한다. */
export function lookOf(type) {
  if (Object.hasOwn(LOOKS, type)) return LOOKS[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (Math.imul(hash, 31) + type.charCodeAt(i)) >>> 0;
  const color = new THREE.Color().setHSL((hash % 360) / 360, 0.45, 0.5).getHex();
  return { form: 'biped', scale: 1, body: color, trim: 0x303030, skin: color, weapon: 'sword', extras: [] };
}

/** 메시 하나: 지오메트리·머티리얼은 공유, 크기·자리만 이 메시의 것이다. */
function part(assets, geometry, material, sx, sy, sz, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(assets.geometries[geometry], material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

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
    case 'claw':
    default:
      tip = 0.25;
      break;
  }
  return { group: g, tip, off };
}

// ── 몸 ───────────────────────────────────────────────────────────────────────

/**
 * 모델 하나를 만든다.
 * @param {object} assets
 * @param {object} look LOOKS 의 값
 * @param {{ elite?:boolean }} [options]
 * @returns {object} { root, body, torso, head, armL, armR, legL, legR, hand, handL, shadow, parts:[{mesh, material}], hover, form, scale }
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
  const fig = { root, body, scaleGroup, shadow, form: look.form, scale: look.scale, hover: 0, armL: null, armR: null, legL: null, legR: null, hand: null, handL: null, head: null, wings: [] };
  const limb = look.thin ? 0.07 : 0.11;

  if (look.form === 'biped') {
    body.position.y = 0.5;
    fig.torso = part(assets, 'box', bodyMat, 0.4, 0.44, 0.24, 0, 0, 0);
    const belt = part(assets, 'box', trimMat, 0.42, 0.07, 0.26, 0, 0.02, 0);
    const head = new THREE.Group();
    head.position.y = 0.6;
    head.add(part(assets, 'head', skinMat, 0.17, 0.18, 0.17, 0, 0.1, 0));
    // 눈: 앞을 보는 쪽을 알 수 있게.
    const eyes = look === LOOKS.bone_warden || look.thin ? assets.glow(0xff5a2a, 1) : assets.toon(0x202028);
    head.add(part(assets, 'cube', eyes, 0.04, 0.04, 0.02, -0.06, 0.12, 0.15), part(assets, 'cube', eyes, 0.04, 0.04, 0.02, 0.06, 0.12, 0.15));
    for (const extra of look.extras) {
      if (extra === 'helm') head.add(part(assets, 'head', trimMat, 0.19, 0.13, 0.19, 0, 0.17, -0.01));
      if (extra === 'plume') head.add(part(assets, 'cone', assets.toon(0xd83a3a), 0.05, 0.28, 0.12, 0, 0.26, -0.04));
      if (extra === 'hood') head.add(part(assets, 'cone', trimMat, 0.22, 0.42, 0.22, 0, 0.0, -0.02));
      if (extra === 'hat') {
        head.add(part(assets, 'tube', trimMat, 0.27, 0.03, 0.27, 0, 0.22, 0), part(assets, 'cone', bodyMat, 0.15, 0.32, 0.15, 0, 0.24, 0));
      }
      if (extra === 'horns') {
        const l = part(assets, 'spike', assets.toon(0xe8e0c8), 0.05, 0.3, 0.05, -0.15, 0.2, 0);
        const r = part(assets, 'spike', assets.toon(0xe8e0c8), 0.05, 0.3, 0.05, 0.15, 0.2, 0);
        l.rotation.z = 0.6;
        r.rotation.z = -0.6;
        head.add(l, r);
      }
      if (extra === 'pauldrons') body.add(part(assets, 'head', trimMat, 0.13, 0.1, 0.13, -0.26, 0.42, 0), part(assets, 'head', trimMat, 0.13, 0.1, 0.13, 0.26, 0.42, 0));
    }
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(-0.26, 0.4, 0);
    armR.position.set(0.26, 0.4, 0);
    armL.add(part(assets, 'limb', bodyMat, limb, 0.36, limb), part(assets, 'cube', skinMat, limb * 1.1, 0.08, limb * 1.1, 0, -0.38, 0));
    armR.add(part(assets, 'limb', bodyMat, limb, 0.36, limb), part(assets, 'cube', skinMat, limb * 1.1, 0.08, limb * 1.1, 0, -0.38, 0));
    const hand = new THREE.Group();
    hand.position.y = -0.4;
    armR.add(hand);
    const handL = new THREE.Group();
    handL.position.y = -0.4;
    armL.add(handL);
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(-0.1, 0.5, 0);
    legR.position.set(0.1, 0.5, 0);
    legL.add(part(assets, 'limb', trimMat, limb * 1.25, 0.48, limb * 1.4));
    legR.add(part(assets, 'limb', trimMat, limb * 1.25, 0.48, limb * 1.4));
    body.add(fig.torso, belt, head, armL, armR);
    scaleGroup.add(legL, legR);
    Object.assign(fig, { head, armL, armR, legL, legR, hand, handL });
  } else if (look.form === 'bat') {
    fig.hover = 0.9;
    body.position.y = fig.hover;
    fig.torso = part(assets, 'head', bodyMat, 0.2, 0.22, 0.24, 0, 0, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.08, 0.16);
    head.add(part(assets, 'head', bodyMat, 0.12, 0.12, 0.12), part(assets, 'cube', assets.glow(look.skin, 1), 0.04, 0.03, 0.02, -0.05, 0.03, 0.1), part(assets, 'cube', assets.glow(look.skin, 1), 0.04, 0.03, 0.02, 0.05, 0.03, 0.1));
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.x = 0.12 * side;
      const wing = new THREE.Mesh(assets.geometries.wing, assets.toon(look.trim));
      wing.scale.set(0.55 * side, 0.55, 0.55);
      pivot.add(wing);
      body.add(pivot);
      fig.wings.push(pivot);
    }
    body.add(fig.torso, head);
    fig.head = head;
  } else {
    // 네 발: 낮은 몸통, 앞으로 내민 머리, 꼬리.
    body.position.y = 0.22;
    fig.torso = part(assets, 'cube', bodyMat, 0.3, 0.22, 0.5, 0, 0.05, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.08, 0.3);
    const snout = part(assets, 'spike', bodyMat, 0.1, 0.24, 0.1, 0, 0, 0);
    snout.rotation.x = Math.PI / 2;
    head.add(snout, part(assets, 'cube', assets.glow(0xff3a3a, 1), 0.03, 0.03, 0.02, -0.05, 0.06, 0.08), part(assets, 'cube', assets.glow(0xff3a3a, 1), 0.03, 0.03, 0.02, 0.05, 0.06, 0.08));
    const tail = part(assets, 'limb', skinMat, 0.03, 0.4, 0.03, 0, 0.05, -0.25);
    tail.rotation.x = -1.2;
    body.add(fig.torso, head, tail);
    fig.head = head;
    const legs = [];
    for (const [x, z] of [[-0.12, 0.17], [0.12, 0.17], [-0.12, -0.17], [0.12, -0.17]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.18, z);
      leg.add(part(assets, 'limb', trimMat, 0.06, 0.18, 0.06));
      scaleGroup.add(leg);
      legs.push(leg);
    }
    fig.legL = legs[0];
    fig.legR = legs[1];
    fig.quadLegs = legs;
  }

  // 번쩍임을 위해 부품과 원래 머티리얼을 기억해 둔다.
  fig.parts = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj !== shadow) fig.parts.push({ mesh: obj, material: obj.material });
  });
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
  fig.hand.add(built.group);
  fig.weapon = built.group;
  fig.tip = built.tip;
  if (built.off && fig.handL) {
    fig.handL.add(built.off);
    fig.offWeapon = built.off;
  }
  for (const group of [built.group, built.off]) {
    if (!group) continue;
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        fig.parts.push({ mesh: obj, material: obj.material });
      }
    });
  }
  return built;
}
