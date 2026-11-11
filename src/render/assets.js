// 공유 자원: 지오메트리와 머티리얼을 한 번만 만들어 모든 층·모든 객체가 함께 쓴다.
// 층을 옮길 때 이것들은 버리지 않는다(버리는 것은 층마다 만드는 InstancedMesh 와 텍스처뿐이다).
// 렌더러를 없앨 때 dispose() 로 한꺼번에 정리한다.

import * as THREE from 'three';

export function createAssets() {
  const geometries = {
    /** 바닥 한 칸(XZ 평면, 가운데가 원점). */
    floor: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    /** 벽 한 칸(높이 1, 바닥이 y = 0). 인스턴스 행렬로 높이를 정한다. */
    wall: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    /** 몸통(지름 1, 높이 1, 바닥이 y = 0). */
    body: new THREE.CylinderGeometry(0.42, 0.5, 1, 14).translate(0, 0.5, 0),
    /** 바라보는 방향 표시. */
    nose: new THREE.BoxGeometry(0.28, 0.18, 0.5).translate(0, 0, 0.25),
    /** 체력 막대(왼쪽 끝이 원점). */
    bar: new THREE.PlaneGeometry(1, 0.09).translate(0.5, 0, 0),
    orb: new THREE.SphereGeometry(1, 10, 8),
    /** 바닥에 깔리는 원(장판·예고·상태이상 표시). */
    disc: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
    gem: new THREE.OctahedronGeometry(0.22),
    marker: new THREE.BoxGeometry(0.7, 0.9, 0.7).translate(0, 0.45, 0),
    stairs: new THREE.BoxGeometry(0.8, 0.12, 0.8).translate(0, 0.06, 0),
  };
  /** 색 → 머티리얼. 같은 색은 한 번만 만든다(적 종류 수만큼만 생긴다). */
  const lit = new Map();
  const flat = new Map();
  const materials = {
    floor: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    wall: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    barBack: new THREE.MeshBasicMaterial({ color: 0x1a1d24, depthTest: false, transparent: true, opacity: 0.85 }),
    barFill: new THREE.MeshBasicMaterial({ color: 0xe5484d, depthTest: false }),
    barBoss: new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false }),
  };

  return {
    geometries,
    materials,
    /** 빛을 받는 단색 머티리얼(행동체, 표식). */
    lit(color) {
      let material = lit.get(color);
      if (!material) {
        material = new THREE.MeshLambertMaterial({ color });
        lit.set(color, material);
      }
      return material;
    },
    /** 빛과 무관한 반투명 머티리얼(장판, 투사체, 전리품). */
    flat(color, opacity = 1) {
      const key = `${color}:${opacity}`;
      let material = flat.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
        flat.set(key, material);
      }
      return material;
    },
    /** 그림자 설정이 바뀌면 셰이더를 다시 만들어야 한다. */
    refresh() {
      for (const material of [...Object.values(materials), ...lit.values()]) material.needsUpdate = true;
    },
    counts() {
      return { geometries: Object.keys(geometries).length, materials: Object.keys(materials).length + lit.size + flat.size };
    },
    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      for (const material of [...Object.values(materials), ...lit.values(), ...flat.values()]) material.dispose();
      lit.clear();
      flat.clear();
    },
  };
}
