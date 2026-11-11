// 한 층의 맵 그리기: 바닥과 벽을 각각 InstancedMesh 하나로 그린다(칸마다 메시를 만들지 않는다).
// 시야 안개는 인스턴스 색의 밝기로, 벽 가림은 인스턴스 행렬의 높이로 표현한다.
// 층마다 새로 만들고, 층을 떠날 때 dispose() 로 인스턴스 버퍼와 그 층의 텍스처를 버린다. 지오메트리·머티리얼은 공유 자원이라 버리지 않는다.

import * as THREE from 'three';
import { RENDER } from '../../../data/config.js';
import { ZONES } from '../../../data/zones.js';
import { cutawayCells } from '../camera-rig.js';
import { FOG, floorLevel, updateLevels, wallLevel } from './fog.js';

const BRIGHTNESS = [RENDER.fog.hidden, RENDER.fog.explored, RENDER.fog.visible];
const matrix = new THREE.Matrix4();
const color = new THREE.Color();

/** 그 층의 바닥 무늬: 작은 얼룩 텍스처(구역 색은 인스턴스 색으로 입힌다). */
function makeFloorTexture(rng) {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const edge = i % size === 0 || i < size ? 0.82 : 1; // 칸의 경계선
    const v = Math.round(255 * edge * (0.86 + rng.float() * 0.14));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {object} options.assets createAssets() 의 결과
 * @param {object} options.world 로직의 맵(읽기만 한다)
 * @param {object} options.rng 꾸밈용 난수(게임 상태와 무관)
 */
export function createFloorView({ scene, assets, world, rng }) {
  const { width, height, tiles } = world;
  const zone = ZONES.find((z) => z.id === world.zoneId) ?? ZONES[0];
  const floorTint = new THREE.Color(zone.palette.floor).multiplyScalar(1.9);
  const wallTint = new THREE.Color(zone.palette.wall).multiplyScalar(2.6);

  // 바닥 칸과, 바닥에 맞닿은 벽 칸만 인스턴스로 만든다(나머지 벽은 어디서도 보이지 않는다).
  const floorCells = [];
  const wallCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (tiles[cell] === 1) floorCells.push(cell);
      else {
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && tiles[ny * width + nx] === 1) {
              touches = true;
              break;
            }
          }
        }
        if (touches) wallCells.push(cell);
      }
    }
  }

  const texture = makeFloorTexture(rng);
  assets.materials.floor.map = texture;
  assets.materials.floor.needsUpdate = true;

  const floor = new THREE.InstancedMesh(assets.geometries.floor, assets.materials.floor, floorCells.length);
  const walls = new THREE.InstancedMesh(assets.geometries.wall, assets.materials.wall, Math.max(1, wallCells.length));
  walls.count = wallCells.length;
  floor.receiveShadow = true;
  walls.receiveShadow = true;
  walls.castShadow = true;
  // 맵 전체가 한 메시라 경계 구가 크다. 가려내기(컬링)를 끄는 편이 싸다.
  floor.frustumCulled = false;
  walls.frustumCulled = false;

  const wallIndex = new Int32Array(width * height).fill(-1);
  const setWall = (i, h) => {
    const cell = wallCells[i];
    matrix.makeScale(1, h, 1).setPosition((cell % width) + 0.5, 0, Math.floor(cell / width) + 0.5);
    walls.setMatrixAt(i, matrix);
  };
  color.setRGB(0, 0, 0);
  floorCells.forEach((cell, i) => {
    matrix.makeTranslation((cell % width) + 0.5, 0, Math.floor(cell / width) + 0.5);
    floor.setMatrixAt(i, matrix);
    floor.setColorAt(i, color);
  });
  wallCells.forEach((cell, i) => {
    wallIndex[cell] = i;
    setWall(i, RENDER.wall.height);
    walls.setColorAt(i, color);
  });
  scene.add(floor, walls);

  // 표식: 계단, 상점, 제단. 공유 지오메트리·머티리얼을 쓰는 평범한 메시다.
  const markers = [];
  const addMarker = (geometry, material, cell, x, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0, z);
    mesh.visible = false;
    scene.add(mesh);
    markers.push({ mesh, cell });
    return mesh;
  };
  const stairs = world.stairs
    ? addMarker(assets.geometries.stairs, assets.flat(RENDER.colors.stairs), world.stairs.y * width + world.stairs.x, world.stairs.x + 0.5, world.stairs.y + 0.5)
    : null;
  for (const room of world.eventRooms) {
    const { x, y } = room.feature;
    addMarker(assets.geometries.marker, assets.lit(room.kind === 'shop' ? RENDER.colors.shop : RENDER.colors.altar), y * width + x, x + 0.5, y + 0.5);
  }

  const floorLevels = new Uint8Array(floorCells.length);
  const wallLevels = new Uint8Array(wallCells.length);
  let lastVisionTile = -2;
  let lastPlayerCell = -1;
  let lowered = [];
  let stairsOpen = null;

  return {
    /**
     * 상태에 맞춰 안개·벽 가림·표식을 갱신한다. 플레이어가 다른 칸으로 넘어갔을 때만 일한다.
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {{x:number,y:number}|null} player 플레이어 위치
     * @param {boolean} open 계단이 열려 있는가
     */
    update(state, player, open) {
      const { vision } = state;
      if (vision && vision.tile !== lastVisionTile) {
        lastVisionTile = vision.tile;
        const paint = (mesh, tint) => (i, level) => {
          color.copy(tint).multiplyScalar(BRIGHTNESS[level]);
          mesh.setColorAt(i, color);
        };
        if (updateLevels(floorLevels, floorCells, (cell) => floorLevel(vision, cell), paint(floor, floorTint)) > 0) floor.instanceColor.needsUpdate = true;
        if (wallCells.length > 0 && updateLevels(wallLevels, wallCells, (cell) => wallLevel(vision, width, height, cell), paint(walls, wallTint)) > 0) {
          walls.instanceColor.needsUpdate = true;
        }
        for (const marker of markers) marker.mesh.visible = vision.explored[marker.cell] === 1;
      }
      if (player) {
        const cell = Math.floor(player.y) * width + Math.floor(player.x);
        if (cell !== lastPlayerCell) {
          lastPlayerCell = cell;
          const next = cutawayCells(tiles, width, height, player.x, player.y, RENDER.wall.cutDepth, RENDER.wall.cutHalfWidth);
          const nextSet = new Set(next);
          const before = new Set(lowered);
          let dirty = false;
          for (const c of lowered) {
            if (!nextSet.has(c) && wallIndex[c] >= 0) {
              setWall(wallIndex[c], RENDER.wall.height);
              dirty = true;
            }
          }
          for (const c of next) {
            if (!before.has(c) && wallIndex[c] >= 0) {
              setWall(wallIndex[c], RENDER.wall.cutHeight);
              dirty = true;
            }
          }
          lowered = next;
          if (dirty) walls.instanceMatrix.needsUpdate = true;
        }
      }
      if (stairs && open !== stairsOpen) {
        stairsOpen = open;
        stairs.material = assets.flat(open ? RENDER.colors.stairs : RENDER.colors.stairsLocked);
      }
    },
    stats() {
      return { floors: floorCells.length, walls: wallCells.length, lowered: lowered.length, markers: markers.length };
    },
    /** 이 층에서 만든 것을 모두 버린다: 인스턴스 버퍼, 바닥 텍스처, 표식 메시. */
    dispose() {
      scene.remove(floor, walls);
      floor.dispose();
      walls.dispose();
      for (const marker of markers) scene.remove(marker.mesh);
      markers.length = 0;
      if (assets.materials.floor.map === texture) {
        assets.materials.floor.map = null;
        assets.materials.floor.needsUpdate = true;
      }
      texture.dispose();
    },
  };
}

export { FOG };
