// 한 층의 맵 그리기: 바닥·벽·문·소품을 종류마다 InstancedMesh 하나로 그린다(칸마다 메시를 만들지 않는다).
//
// - 방 단위 공개: 구역(방·복도)마다 밝기를 따로 두고, 드러나면 FEEL.reveal.roomSec 동안 구역 전체가 함께 밝아진다.
//   칸마다 끊기며 드러나지 않는다. 바뀌는 구역이 있을 때만 그 구역의 인스턴스 색을 고친다.
// - 벽 낮추기: 플레이어 앞(카메라 쪽)의 벽을 낮추되 높이를 보간한다(칸을 넘는 순간 튀지 않는다).
// - 문: 잠기면 창살이 솟고 열리면 내려간다(보간). 숨은 문은 벽처럼 보이다가 찾으면 내려간다.
// - 문 위의 보상 아이콘: 드러난 방에서 아직 들어가지 않은 방으로 가는 문 위에 그 방의 보상을 띄운다.
// - 층마다 새로 만들고, 층을 떠날 때 dispose() 로 인스턴스 버퍼·텍스처·이 층의 메시를 버린다. 지오메트리·머티리얼은 공유 자원이라 버리지 않는다.

import * as THREE from 'three';
import { RENDER } from '../../../data/config.js';
import { FEEL } from '../../../data/feel.js';
import { DECOR } from '../../../data/decor.js';
import { ZONES } from '../../../data/zones.js';
import { REWARD, ROOM_KIND } from '../../logic/world/floors.js';
import { readStructure } from '../../logic/world/structure.js';
import { TILE } from '../../logic/world/tiles.js';
import { cutawayCells } from '../camera-rig.js';
import { buildFigure, buildWeapon, LOOKS } from '../entities/models.js';
import { approach, regionTargets, stepToward, wallBrightness, wallNeighbors } from './reveal.js';

const C = RENDER.colors;
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3();
const pos = new THREE.Vector3();
const color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ICONS = 24;

/** 바닥 무늬 한 칸(32×32, 회색 — 구역 색은 인스턴스 색으로 입힌다). 칸마다 되풀이되므로 가장자리가 이어지게 그린다. */
const FLOOR_PATTERNS = {
  /** 돌판: 칸 둘레의 홈과, 칸을 넷으로 나눈 얕은 홈. */
  flagstone: (x, y, n) => (x === 0 || y === 0 ? 0.62 : x === 16 || y === 16 ? 0.86 : 1) * (0.88 + n * 0.12),
  /** 벽돌: 8칸 높이의 줄, 줄마다 반 장씩 어긋난다. */
  brick: (x, y, n) => {
    const row = y >> 3;
    const bx = (x + (row % 2) * 8) % 16;
    return (y % 8 === 0 || bx === 0 ? 0.55 : 1) * (0.84 + n * 0.16);
  },
  /** 흙: 줄 없이 얼룩덜룩. */
  soil: (x, y, n) => 0.8 + 0.1 * ((((x >> 2) * 7 + (y >> 2) * 11) % 5) / 5) + n * 0.07 - ((x * 7 + y * 13) % 29 === 0 ? 0.22 : 0),
  /** 널빤지: 세로로 8칸 폭, 판 사이 틈과 나뭇결. */
  planks: (x, y, n) => (x % 8 === 0 ? 0.5 : 1) * (0.86 + 0.1 * (((y + (x >> 3) * 5) % 6) / 6) + n * 0.06) - (x % 8 === 4 && y % 16 === 3 ? 0.3 : 0),
  /** 갈라진 현무암: 어두운 바탕에 굵은 금. */
  basalt: (x, y, n) => {
    const crack = Math.abs(((x * 3 + y * 5) % 32) - 16) < 1 || Math.abs(((x * 5 - y * 2 + 64) % 32) - 9) < 1;
    return (x === 0 || y === 0 ? 0.7 : 1) * (crack ? 0.45 : 0.82 + n * 0.14);
  },
  /** 바둑판: 16칸 네모 넷, 두 가지 밝기. */
  tiles: (x, y, n) => ((x === 0 || y === 0 || x === 16 || y === 16) ? 0.6 : ((x >> 4) + (y >> 4)) % 2 === 0 ? 1 : 0.8) * (0.94 + n * 0.06),
};

function makeFloorTexture(rng, pattern) {
  const shade = FLOOR_PATTERNS[pattern] ?? FLOOR_PATTERNS.flagstone;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = Math.round(255 * Math.max(0, Math.min(1, shade(x, y, rng.float()))));
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 꾸밈 부품 하나의 행렬(칸 안의 위치·회전·크기). 회전 값은 반 바퀴 단위. */
function partMatrix(part) {
  const [sx, sy, sz] = part.s;
  const [ox, oy, oz] = part.o;
  const euler = new THREE.Euler((part.tilt ?? 0) * Math.PI, (part.r ?? 0) * Math.PI, (part.roll ?? 0) * Math.PI);
  return new THREE.Matrix4().compose(new THREE.Vector3(ox, oy, oz), new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(sx, sy, sz));
}

/** 보상 아이콘 하나(여러 모양을 미리 달아 두고 하나만 켠다). */
function makeIcon(assets) {
  const group = new THREE.Group();
  const shapes = {};
  const add = (name, ...meshes) => {
    const g = new THREE.Group();
    meshes.forEach((m) => g.add(m));
    g.visible = false;
    group.add(g);
    shapes[name] = g;
  };
  const mesh = (geometry, material, s, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(assets.geometries[geometry], material);
    m.scale.setScalar(s);
    m.position.set(x, y, z);
    return m;
  };
  add('boon', mesh('orb', assets.glow(C.reward.boon, 0.95), 0.2), mesh('star', assets.glow(0xffffff, 0.6), 0.12));
  const sword = buildWeapon(assets, 'sword').group;
  sword.rotation.z = Math.PI * 0.75;
  sword.position.set(-0.25, 0.25, 0);
  add('weapon', sword);
  add('gold', mesh('coin', assets.toon(C.gold), 0.2));
  add('health', mesh('orb', assets.toon(C.health), 0.12, -0.08, 0.04), mesh('orb', assets.toon(C.health), 0.12, 0.08, 0.04), mesh('star', assets.toon(C.health), 0.13, 0, -0.07));
  add('elite', mesh('head', assets.toon(0xd83a3a, 0x5a0a0a), 0.17), mesh('cube', assets.glow(0xffe14a), 0.04, -0.06, 0.02, 0.15), mesh('cube', assets.glow(0xffe14a), 0.04, 0.06, 0.02, 0.15));
  add('boss', mesh('head', assets.toon(0xe8e0c8), 0.22), mesh('spike', assets.toon(0xd83a3a), 0.08, -0.15, 0.12), mesh('spike', assets.toon(0xd83a3a), 0.08, 0.15, 0.12));
  add('shop', mesh('coin', assets.toon(C.shop), 0.2), mesh('coin', assets.toon(C.gold), 0.12, 0, 0, 0.04));
  // 받침: 빛나는 고리.
  const halo = mesh('ring', assets.glow(0xffffff, 0.35), 0.32, 0, -0.35, 0);
  group.add(halo);
  group.visible = false;
  return { group, shapes, shown: null };
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {object} options.assets createAssets() 의 결과
 * @param {object} options.world 로직의 맵(읽기만 한다)
 * @param {object} options.rng 꾸밈용 난수(게임 상태와 무관)
 * @param {object} options.quality 품질 설정(소품 비율, 횃불 빛 수)
 */
export function createFloorView({ scene, assets, world, rng, quality }) {
  const { width, height, tiles, rooms, doors, links } = world;
  const zone = ZONES.find((z) => z.id === world.zoneId) ?? ZONES[0];
  const floorTint = new THREE.Color(zone.palette.floor).multiplyScalar(1.7);
  const wallTint = new THREE.Color(zone.palette.wall).multiplyScalar(2.4);
  const decor = DECOR[zone.id] ?? DECOR.crypt;
  const { regionAt } = readStructure(tiles, width, height, rooms);
  const regionCount = rooms.length + links.length;
  const added = [];
  const addToScene = (...objects) => {
    for (const o of objects) {
      scene.add(o);
      added.push(o);
    }
  };

  // ── 바닥과 벽 ──
  const floorCells = [];
  const wallCells = [];
  const doorCell = new Uint8Array(width * height);
  for (const door of doors) for (const c of door.cells) doorCell[c] = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (tiles[cell] !== TILE.WALL) {
        floorCells.push(cell);
        continue;
      }
      // 바닥에 맞닿은 벽만 만든다(나머지 벽은 어디서도 보이지 않는다).
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && tiles[ny * width + nx] !== TILE.WALL) {
            touches = true;
            break;
          }
        }
      }
      if (touches) wallCells.push(cell);
    }
  }

  const texture = makeFloorTexture(rng, decor.floor.pattern);
  assets.materials.floor.map = texture;
  assets.materials.floor.needsUpdate = true;

  const floor = new THREE.InstancedMesh(assets.geometries.floor, assets.materials.floor, Math.max(1, floorCells.length));
  const walls = new THREE.InstancedMesh(assets.geometries.wall, assets.materials.wall, Math.max(1, wallCells.length));
  floor.count = floorCells.length;
  walls.count = wallCells.length;
  floor.receiveShadow = true;
  walls.receiveShadow = true;
  walls.castShadow = true;
  // 맵 전체가 한 메시라 경계 구가 크다. 가려내기(컬링)를 끄는 편이 싸다.
  floor.frustumCulled = false;
  walls.frustumCulled = false;

  const floorRegion = floorCells.map((c) => regionAt[c]);
  // 칸마다의 바닥 색: 구역 색을 조금씩 흔들고, 방마다 얼룩(이끼·물웅덩이·용암 자국…)을 몇 군데 섞는다.
  const floorColors = new Float32Array(floorCells.length * 3);
  {
    const patchColor = new THREE.Color(decor.floor.patch.color).multiplyScalar(1.7);
    const patches = [];
    for (const room of rooms) {
      const count = Math.round(room.w * room.h * decor.floor.patch.chance);
      for (let k = 0; k < count; k++) patches.push({ x: room.x + rng.float() * room.w, y: room.y + rng.float() * room.h, r: decor.floor.patch.radius * (0.6 + rng.float() * 0.8) });
    }
    floorCells.forEach((cell, i) => {
      const cx = (cell % width) + 0.5;
      const cy = Math.floor(cell / width) + 0.5;
      color.copy(floorTint).multiplyScalar(1 - decor.floor.jitter + rng.float() * decor.floor.jitter * 2);
      for (const p of patches) {
        const d2 = (cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y);
        if (d2 < p.r * p.r) color.lerp(patchColor, 0.6 * (1 - Math.sqrt(d2) / p.r));
      }
      color.toArray(floorColors, i * 3);
    });
  }
  const wallIndex = new Int32Array(width * height).fill(-1);
  const wallHeight = new Float32Array(wallCells.length).fill(RENDER.wall.height);
  const wallTarget = new Float32Array(wallCells.length).fill(RENDER.wall.height);
  const wallRegions = wallNeighbors(regionAt, width, height, wallCells);
  // 벽마다 조금씩 다른 높이·색(돌담이 단조롭지 않게).
  const wallJitter = wallCells.map(() => 0.9 + rng.float() * 0.2);
  /** 구역 → 그 구역의 바닥 인스턴스, 그 구역에 맞닿은 벽 인스턴스. */
  const regionFloors = Array.from({ length: regionCount }, () => []);
  const regionWalls = Array.from({ length: regionCount }, () => []);
  floorRegion.forEach((r, i) => {
    if (r >= 0) regionFloors[r].push(i);
  });
  wallRegions.forEach((list, i) => {
    for (const r of list) regionWalls[r].push(i);
  });

  const setWall = (i) => {
    const cell = wallCells[i];
    matrix.makeScale(1, wallHeight[i], 1).setPosition((cell % width) + 0.5, 0, Math.floor(cell / width) + 0.5);
    walls.setMatrixAt(i, matrix);
  };
  floorCells.forEach((cell, i) => {
    matrix.makeTranslation((cell % width) + 0.5, 0, Math.floor(cell / width) + 0.5);
    floor.setMatrixAt(i, matrix);
  });
  wallCells.forEach((cell, i) => {
    wallIndex[cell] = i;
    setWall(i);
  });
  addToScene(floor, walls);

  // ── 문: 칸마다 창살 하나 ──
  const doorBars = [];
  for (const door of doors) {
    for (const c of door.cells) {
      const x = c % width;
      const y = Math.floor(c / width);
      // 지나가는 방향: 문 칸과 맞닿은 방 칸 쪽.
      let alongX = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (regionAt[(y + dy) * width + x + dx] === door.room) alongX = dx !== 0;
      }
      doorBars.push({ door, cell: c, x: x + 0.5, y: y + 0.5, alongX, h: door.open ? 0 : 1, region: regionAt[c] });
    }
  }
  const doorMesh = new THREE.InstancedMesh(assets.geometries.box, assets.materials.door, Math.max(1, doorBars.length));
  doorMesh.count = doorBars.length;
  doorMesh.castShadow = true;
  doorMesh.frustumCulled = false;
  const setDoor = (i) => {
    const bar = doorBars[i];
    const secretClosed = bar.door.secret && !bar.door.open;
    // 숨은 문은 닫혀 있는 동안 벽과 똑같은 덩어리로, 그 밖의 문은 얇은 창살 판으로 그린다.
    const full = secretClosed ? RENDER.wall.height : RENDER.door.height;
    const hgt = Math.max(0.001, bar.h * full);
    if (secretClosed) scale.set(1, hgt, 1);
    else scale.set(bar.alongX ? 0.22 : 1, hgt, bar.alongX ? 1 : 0.22);
    // 다 내려가면 바닥 아래로 숨긴다.
    matrix.compose(pos.set(bar.x, bar.h > 0.001 ? 0 : -1, bar.y), quat.identity(), scale);
    doorMesh.setMatrixAt(i, matrix);
  };
  doorBars.forEach((_, i) => setDoor(i));
  addToScene(doorMesh);

  // ── 꾸밈(data/decor.js): 북쪽 벽의 등불과 거는 것, 바닥의 소품, 보스 방의 문양 ──
  // 모두 밟아도 되는 그림이다(로직은 모른다). 키 큰 소품은 방 둘레 띠에만, 문과 표식(포털·상인) 옆은 비운다.
  const torches = [];
  /** 꾸밈 종류마다: 놓을 자리 목록과 부품. */
  const kinds = decor.props.map((kind) => ({ kind, parts: kind.parts, spots: [] }));
  const wallKind = { kind: { id: 'wall' }, parts: decor.wall.parts, spots: [] };
  const sigilKind = {
    kind: { id: 'sigil' },
    parts: [
      // 적의 공격 예고(붉게 차오르는 바닥)와 헷갈리지 않게 아주 흐리게.
      { geo: 'ring', glow: true, color: decor.sigil, s: [2.6, 1, 2.6], o: [0, 0.015, 0], dim: 0.12 },
      { geo: 'ring', glow: true, color: decor.sigil, s: [1.5, 1, 1.5], o: [0, 0.015, 0], dim: 0.12 },
      { geo: 'disc', glow: true, color: decor.sigil, s: [1.3, 1, 1.3], o: [0, 0.01, 0], dim: 0.05 },
    ],
    spots: [],
  };
  const totalWeight = decor.props.reduce((a, k) => a + k.weight, 0);
  const pickKind = () => {
    let roll = rng.float() * totalWeight;
    for (const k of kinds) {
      roll -= k.kind.weight;
      if (roll < 0) return k;
    }
    return kinds[kinds.length - 1];
  };
  /** 문 칸이 둘레 8칸(키 큰 것은 둘레 두 칸) 안에 있는가. */
  const nearDoor = (x, y, reach) => {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && doorCell[ny * width + nx]) return true;
      }
    }
    return false;
  };
  for (const room of rooms) {
    const feature = room.feature;
    const taken = new Set();
    // 바닥 소품.
    const n = Math.round(((room.w * room.h) / 22) * decor.density * quality.props);
    for (let k = 0; k < n * 2 && taken.size < n; k++) {
      const pick = pickKind();
      const tall = pick.kind.tall === true;
      let x;
      let y;
      if (tall || rng.float() < 0.55) {
        // 방 둘레 띠(늘 비어 있는 곳).
        const edge = rng.float() < 0.5;
        x = edge ? room.x + (rng.float() < 0.5 ? 0 : room.w - 1) : room.x + Math.floor(rng.float() * room.w);
        y = edge ? room.y + Math.floor(rng.float() * room.h) : room.y + (rng.float() < 0.5 ? 0 : room.h - 1);
      } else {
        x = room.x + Math.floor(rng.float() * room.w);
        y = room.y + Math.floor(rng.float() * room.h);
      }
      const cell = y * width + x;
      if (taken.has(cell) || regionAt[cell] !== room.id || tiles[cell] === TILE.WALL) continue;
      if (nearDoor(x, y, tall ? 2 : 1)) continue;
      if (feature && Math.abs(feature.x - x) <= 1.5 && Math.abs(feature.y - y) <= 1.5) continue;
      taken.add(cell);
      const j = tall ? 0.25 : 0.5;
      pick.spots.push({ x: x + 0.5 + (rng.float() - 0.5) * j, y: y + 0.5 + (rng.float() - 0.5) * j, region: room.id, rot: rng.float() * 2, s: (decor.scale ?? 1) * (0.85 + rng.float() * 0.35) });
    }
    // 보스 방: 가운데 바닥의 문양.
    if (room.kind === ROOM_KIND.BOSS) sigilKind.spots.push({ x: room.x + room.w / 2, y: room.y + room.h / 2, region: room.id, rot: 0, s: 1 });
    // 북쪽 벽: 등불(양 끝 쪽)과 거는 것(그 사이).
    if (room.shape !== 'rect') continue;
    const north = room.y - 1;
    const spots = [];
    for (let x = room.x + 1; x < room.x + room.w - 1; x += 1) {
      const cell = north * width + x;
      if (tiles[cell] === TILE.WALL && !doorCell[cell] && regionAt[(north + 1) * width + x] === room.id) spots.push(x);
    }
    const want = Math.round((room.kind === ROOM_KIND.BOSS ? 4 : 2) * quality.props);
    for (let k = 0; k < Math.min(want, spots.length); k++) {
      const x = spots[Math.floor(((k + 0.5) / want) * spots.length)];
      torches.push({ x: x + 0.5, y: north + 0.92, region: room.id });
    }
    if (rng.float() < decor.wall.rate * quality.props && spots.length > 4) {
      const x = spots[Math.floor(spots.length / 2)];
      wallKind.spots.push({ x: x + 0.5, y: north + 0.95, region: room.id, rot: 0, s: 1 });
    }
  }
  const instanced = (geometry, material, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.count = count;
    mesh.frustumCulled = false;
    addToScene(mesh);
    return mesh;
  };
  const glowWhite = assets.glow(0xffffff, 0.9);
  const torchPost = instanced(assets.geometries.box, assets.materials.prop, torches.length);
  const torchFlame = instanced(assets.geometries.star, glowWhite, torches.length);
  const flameSize = decor.lamp.size;
  torches.forEach((t, i) => {
    torchPost.setMatrixAt(i, matrix.compose(pos.set(t.x, 0.9, t.y), quat.identity(), scale.set(0.08, 0.32, 0.08)));
    torchFlame.setMatrixAt(i, matrix.compose(pos.set(t.x, 1.22 + 0.1 * flameSize, t.y), quat.identity(), scale.set(0.1 * flameSize, 0.16 * flameSize, 0.1 * flameSize)));
  });
  /** 부품마다 InstancedMesh 하나: { mesh, part, spots }. */
  const decorMeshes = [];
  const place = new THREE.Matrix4();
  for (const k of [...kinds, wallKind, sigilKind]) {
    for (const part of k.parts) {
      if (!assets.geometries[part.geo]) throw new Error(`floor-view: 꾸밈 "${k.kind.id}" 의 지오메트리 "${part.geo}" 가 없다`);
      const mesh = instanced(assets.geometries[part.geo], part.glow ? glowWhite : assets.materials.prop, k.spots.length);
      if (!part.glow) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      }
      const local = partMatrix(part);
      k.spots.forEach((spot, i) => {
        quat.setFromAxisAngle(UP, spot.rot * Math.PI);
        place.compose(pos.set(spot.x, 0, spot.y), quat, scale.setScalar(spot.s));
        mesh.setMatrixAt(i, matrix.multiplyMatrices(place, local));
      });
      decorMeshes.push({ mesh, part, spots: k.spots });
    }
  }

  // ── 횃불 빛: 플레이어에게 가까운 것부터 몇 개만 켠다(빛은 비싸다) ──
  const lights = [];
  for (let i = 0; i < quality.lights; i++) {
    const light = new THREE.PointLight(decor.lamp.light, 0, 7, 1.6);
    light.position.set(0, -10, 0);
    addToScene(light);
    lights.push(light);
  }

  // ── 표식: 출구 포털, 상인 ──
  const exitRoom = rooms.find((r) => r.kind === ROOM_KIND.EXIT);
  const shopRoom = rooms.find((r) => r.kind === ROOM_KIND.SHOP);
  const bossRoom = rooms.find((r) => r.kind === ROOM_KIND.BOSS);
  let portal = null;
  if (exitRoom) {
    portal = new THREE.Group();
    const ring = new THREE.Mesh(assets.geometries.portal, assets.glow(C.portal, 0.9));
    ring.scale.setScalar(0.9);
    ring.position.y = 1.0;
    const inner = new THREE.Mesh(assets.geometries.disc, assets.glow(C.portal, 0.35));
    inner.rotation.x = Math.PI / 2;
    inner.scale.setScalar(0.8);
    inner.position.y = 1.0;
    const base = new THREE.Mesh(assets.geometries.ring, assets.glow(C.portal, 0.5));
    base.scale.setScalar(1.1);
    base.position.y = 0.02;
    portal.add(ring, inner, base);
    portal.position.set(exitRoom.feature.x + 0.5, 0, exitRoom.feature.y + 0.5);
    portal.userData = { ring, inner };
    addToScene(portal);
  }
  let merchant = null;
  if (shopRoom) {
    const fig = buildFigure(assets, LOOKS.merchant);
    fig.root.position.set(shopRoom.feature.x + 0.5, 0, shopRoom.feature.y + 0.2);
    const stall = new THREE.Mesh(assets.geometries.box, assets.toon(0x7a5a3a));
    stall.scale.set(1.6, 0.6, 0.5);
    stall.position.set(shopRoom.feature.x + 0.5, 0, shopRoom.feature.y + 0.85);
    stall.castShadow = true;
    merchant = { fig, stall };
    addToScene(fig.root, stall);
  }

  // ── 보상 아이콘 ──
  const icons = [];
  for (let i = 0; i < ICONS; i++) {
    const icon = makeIcon(assets);
    addToScene(icon.group);
    icons.push(icon);
  }

  // ── 밝기(방 단위 공개) ──
  const brightness = new Float32Array(regionCount);
  const target = regionTargets(world);
  // 처음 층에 들어선 순간 이미 드러난 곳(시작 방)은 곧바로 보인다. 화면 페이드가 덮고 있다.
  brightness.set(target);
  function paintRegion(r) {
    const b = brightness[r];
    for (const i of regionFloors[r]) {
      color.fromArray(floorColors, i * 3).multiplyScalar(b);
      floor.setColorAt(i, color);
    }
    for (const i of regionWalls[r]) {
      const wb = wallBrightness(wallRegions[i], brightness);
      color.copy(wallTint).multiplyScalar(wb * wallJitter[i]);
      walls.setColorAt(i, color);
    }
  }
  function paintAll() {
    for (let r = 0; r < regionCount; r++) paintRegion(r);
    // 구역에 속하지 않은 바닥은 없다(검증기가 보장한다). 혹시 있으면 어둡게 둔다.
    floorRegion.forEach((r, i) => {
      if (r < 0) floor.setColorAt(i, color.setRGB(0, 0, 0));
    });
    wallRegions.forEach((list, i) => {
      if (list.length === 0) walls.setColorAt(i, color.setRGB(0, 0, 0));
    });
    paintProps();
    floor.instanceColor.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  }
  function paintProps() {
    const tint = (mesh, list, base, dim = 1) => {
      list.forEach((item, i) => {
        color.set(base ?? item.color ?? 0xffffff).multiplyScalar((brightness[item.region] ?? 0) * dim);
        mesh.setColorAt(i, color);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    tint(torchPost, torches, decor.lamp.post);
    tint(torchFlame, torches, decor.lamp.flame);
    for (const d of decorMeshes) tint(d.mesh, d.spots, d.part.color, d.part.dim ?? 1);
    doorBars.forEach((bar, i) => {
      const locked = !bar.door.open && rooms[bar.door.room].state === 'active';
      const base = bar.door.secret && !bar.door.open ? C.secretWall : locked ? C.doorLocked : C.door;
      color.set(base).multiplyScalar(Math.max(brightness[bar.region] ?? 0, brightness[bar.door.room] ?? 0));
      doorMesh.setColorAt(i, color);
    });
    if (doorMesh.instanceColor) doorMesh.instanceColor.needsUpdate = true;
  }
  paintAll();

  let lastPlayerCell = -1;
  let lowered = [];
  /** 확인용: 한 프레임에 벽 높이가 가장 크게 바뀐 양, 구역이 중간 밝기로 그려진 프레임 수. */
  let maxWallStep = 0;
  let maxWallFraction = 0;
  let fadeFrames = 0;
  /** 높이가 목표와 다른 벽(보간 중). */
  const moving = new Set();
  let lightCell = -1;
  let doorSig = '';

  function placeLights(px, py) {
    const lit = torches
      .filter((t) => brightness[t.region] > 0.5)
      .map((t) => ({ t, d: (t.x - px) * (t.x - px) + (t.y - py) * (t.y - py) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, lights.length);
    lights.forEach((light, i) => {
      if (i < lit.length) {
        light.position.set(lit[i].t.x, 1.5, lit[i].t.y + 0.35);
        light.userData.base = 3.2;
      } else {
        light.userData.base = 0;
        light.intensity = 0;
      }
    });
  }

  return {
    /**
     * 상태에 맞춰 공개·벽 낮추기·문·아이콘·표식을 갱신한다.
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {{x:number,y:number}|null} player 화면의 플레이어 위치
     * @param {number} dtSec
     * @param {number} time 렌더러의 시계(초)
     */
    update(state, player, dtSec, time) {
      // 방 단위 공개.
      const next = regionTargets(world);
      const changed = stepToward(brightness, next, FEEL.reveal.roomSec, dtSec);
      for (const r of changed) {
        if (brightness[r] > 0 && brightness[r] < 1) fadeFrames++;
      }
      if (changed.length > 0) {
        for (const r of changed) paintRegion(r);
        floor.instanceColor.needsUpdate = true;
        if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
        paintProps();
        lightCell = -1;
      }

      // 벽 낮추기: 플레이어가 다른 칸으로 넘어가면 목표 높이를 바꾸고, 높이는 매 프레임 보간한다.
      if (player) {
        const cell = Math.floor(player.y) * width + Math.floor(player.x);
        if (cell !== lastPlayerCell) {
          lastPlayerCell = cell;
          const nextCut = cutawayCells(tiles, width, height, player.x, player.y, RENDER.wall.cutDepth, RENDER.wall.cutHalfWidth);
          for (const c of lowered) {
            const i = wallIndex[c];
            if (i >= 0) {
              wallTarget[i] = RENDER.wall.height;
              moving.add(i);
            }
          }
          for (const c of nextCut) {
            const i = wallIndex[c];
            if (i >= 0) {
              wallTarget[i] = RENDER.wall.cutHeight;
              moving.add(i);
            }
          }
          lowered = nextCut;
        }
        if (cell !== lightCell) {
          lightCell = cell;
          placeLights(player.x, player.y);
        }
      }
      if (moving.size > 0) {
        for (const i of moving) {
          const before = wallHeight[i];
          wallHeight[i] = approach(wallHeight[i], wallTarget[i], FEEL.reveal.wallRate, dtSec);
          maxWallStep = Math.max(maxWallStep, Math.abs(wallHeight[i] - before));
          // 남은 거리 가운데 한 프레임에 움직인 비율(1 이면 한 번에 튄 것이다).
          const gap = Math.abs(wallTarget[i] - before);
          if (gap > 0.05) maxWallFraction = Math.max(maxWallFraction, Math.abs(wallHeight[i] - before) / gap);
          setWall(i);
          if (wallHeight[i] === wallTarget[i]) moving.delete(i);
        }
        walls.instanceMatrix.needsUpdate = true;
      }

      // 문: 열림·닫힘에 맞춰 창살을 올리고 내린다.
      let doorDirty = false;
      doorBars.forEach((bar, i) => {
        const goal = bar.door.open ? 0 : 1;
        if (bar.h === goal) return;
        const step = RENDER.door.speed * dtSec;
        bar.h = Math.abs(goal - bar.h) <= step ? goal : bar.h + Math.sign(goal - bar.h) * step;
        setDoor(i);
        doorDirty = true;
      });
      if (doorDirty) doorMesh.instanceMatrix.needsUpdate = true;
      const sig = rooms.map((r) => r.state[0]).join('') + doors.map((d) => (d.open ? 1 : 0)).join('');
      if (sig !== doorSig) {
        doorSig = sig;
        paintProps();
      }

      // 횃불 빛의 일렁임.
      for (let i = 0; i < lights.length; i++) {
        const base = lights[i].userData.base ?? 0;
        lights[i].intensity = base * (0.85 + 0.15 * Math.sin(time * 11 + i * 1.7) * Math.sin(time * 7.3 + i));
      }

      // 문 위의 보상 아이콘: 드러난 방에서, 아직 들어가지 않은 방으로 가는 열린 문 위에.
      let used = 0;
      if (!state.encounter) {
        for (const door of doors) {
          if (used >= icons.length) break;
          const from = rooms[door.room];
          const to = rooms[door.to];
          if (!from.seen || to.state !== 'idle' || !door.open || door.secret) continue;
          // 복도의 이쪽 끝(드러난 방 쪽) 문에만 띄운다.
          let shape = to.reward;
          if (to.kind === ROOM_KIND.ELITE) shape = 'elite';
          if (to.kind === ROOM_KIND.BOSS) shape = 'boss';
          if (to.kind === ROOM_KIND.SHOP) shape = 'shop';
          if (!shape || !(shape in icons[0].shapes)) continue;
          const icon = icons[used++];
          if (icon.shown !== shape) {
            if (icon.shown) icon.shapes[icon.shown].visible = false;
            icon.shapes[shape].visible = true;
            icon.shown = shape;
          }
          icon.group.visible = true;
          icon.group.position.set(door.x, 1.9 + Math.sin(time * 2.4 + door.id) * 0.08, door.y);
          icon.group.rotation.y = time * 1.2;
        }
      }
      for (let i = used; i < icons.length; i++) icons[i].group.visible = false;

      // 포털: 보스를 잡기 전에는 흐리다.
      if (portal) {
        const ready = !bossRoom || bossRoom.state === 'cleared';
        const b = brightness[exitRoom.id];
        portal.visible = b > 0.01;
        portal.userData.ring.rotation.z = time * (ready ? 2 : 0.4);
        portal.userData.inner.material = assets.glow(C.portal, ready ? 0.45 : 0.08);
      }
      if (merchant) {
        const b = brightness[shopRoom.id];
        merchant.fig.root.visible = b > 0.5;
        merchant.stall.visible = b > 0.5;
        merchant.fig.body.position.y = merchant.fig.hipY + Math.sin(time * 2) * 0.01;
      }
    },
    /**
     * 미리 컴파일용: 처음에는 숨어 있는 것(문 위 아이콘의 모든 모양, 포털, 상인)을 잠깐 모두 보이게 한다.
     * `renderer.compile` 은 보이는 것만 컴파일하므로, 숨겨 두면 처음 드러나는 순간 셰이더가 새로 생긴다.
     * @returns {() => void} 원래대로 되돌리는 함수
     */
    prewarm() {
      const saved = [];
      const show = (o) => {
        saved.push([o, o.visible]);
        o.visible = true;
      };
      for (const icon of icons) {
        show(icon.group);
        for (const shape of Object.values(icon.shapes)) show(shape);
      }
      if (portal) show(portal);
      if (merchant) {
        show(merchant.fig.root);
        show(merchant.stall);
      }
      return () => {
        for (let i = saved.length - 1; i >= 0; i--) saved[i][0].visible = saved[i][1];
      };
    },
    /** 문 위 아이콘이 쓸 보상 이름(테스트·확인용). */
    rewardIcons() {
      return icons.filter((i) => i.group.visible).map((i) => i.shown);
    },
    stats() {
      let seen = 0;
      let fading = 0;
      for (let r = 0; r < regionCount; r++) {
        if (brightness[r] === 1) seen++;
        else if (brightness[r] > 0) fading++;
      }
      return {
        floors: floorCells.length, walls: wallCells.length, doors: doorBars.length, torches: torches.length, props: decorMeshes.reduce((a, d) => a + d.spots.length, 0), decorMeshes: decorMeshes.length,
        lights: lights.length, lowered: lowered.filter((c) => wallIndex[c] >= 0).length, movingWalls: moving.size,
        regions: { total: regionCount, seen, fading },
        icons: icons.filter((i) => i.group.visible).length,
        maxWallStep, maxWallFraction, fadeFrames,
      };
    },
    /** 구역의 지금 밝기(확인용). */
    brightnessOf(region) {
      return brightness[region];
    },
    /** 이 층에서 만든 것을 모두 버린다: 인스턴스 버퍼, 바닥 텍스처, 빛, 이 층의 메시. */
    dispose() {
      for (const o of added) scene.remove(o);
      for (const mesh of [floor, walls, doorMesh, torchPost, torchFlame, ...decorMeshes.map((d) => d.mesh)]) mesh.dispose();
      for (const light of lights) light.dispose();
      added.length = 0;
      if (assets.materials.floor.map === texture) {
        assets.materials.floor.map = null;
        assets.materials.floor.needsUpdate = true;
      }
      texture.dispose();
    },
  };
}

export { REWARD };
