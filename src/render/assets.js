// 공유 자원: 지오메트리와 머티리얼을 한 번만 만들어 모든 층·모든 객체가 함께 쓴다.
// 층을 옮길 때 이것들은 버리지 않는다(버리는 것은 층마다 만드는 InstancedMesh 와 텍스처뿐이다).
// 렌더러를 없앨 때 dispose() 로 한꺼번에 정리한다.
//
// 빛을 받는 것은 모두 툰 셰이딩(MeshToonMaterial + 명암 단계 텍스처 하나)이다. 색마다 머티리얼을 하나씩만 만든다.
// 캐릭터·무기 부품에는 굵은 외곽선을 붙인다(뒷면만 그리는 껍데기를 법선 방향으로 부풀림 — materials.outline).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RENDER } from '../../data/config.js';

/** 명암 단계 텍스처: 픽셀 몇 개짜리 1차원 텍스처. 가장 가까운 픽셀을 쓰면 명암이 계단처럼 끊긴다. */
function makeGradient(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const texture = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** 위쪽 끝이 원점인 상자(팔·다리처럼 어깨·엉덩이에서 매달리는 부품). */
const hanging = () => new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
/** 아래쪽 끝이 원점인 상자(몸통·소품). */
const standing = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** 법선을 계산해 그 지오메트리를 돌려준다(`computeVertexNormals` 는 아무것도 돌려주지 않는다). */
function withNormals(geometry) {
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 외곽선용 법선: 같은 자리의 꼭짓점들의 법선을 평균한다. 면마다 따로인 법선으로 부풀리면 모서리가 갈라지므로
 * 껍데기는 이 매끈한 법선으로 부풀린다.
 */
function withOutlineNormals(geometry) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const sums = new Map();
  const keyOf = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const v = sums.get(k) ?? [0, 0, 0];
    v[0] += nor.getX(i);
    v[1] += nor.getY(i);
    v[2] += nor.getZ(i);
    sums.set(k, v);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sums.get(keyOf(i));
    const len = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / len;
    out[i * 3 + 1] = y / len;
    out[i * 3 + 2] = z / len;
  }
  geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  return geometry;
}

/** 벽: 윗면은 밝게, 옆면은 어둡게(정점 색). 인스턴스 색과 곱해져 벽 덩어리의 윗면이 바닥과 구별된다. */
function shadedWall(top, side) {
  const geometry = standing();
  const nor = geometry.attributes.normal;
  const colors = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const v = nor.getY(i) > 0.5 ? top : side;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const OUTLINE_VERTEX = /* glsl */ `
attribute vec3 outlineNormal;
uniform float width;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * outlineNormal);
  world.xyz += n * width;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

/** 바닥에 눕힌 부채꼴(가운데가 +z 방향). */
function sector(cosHalf) {
  const half = Math.acos(Math.max(-1, Math.min(1, cosHalf)));
  return new THREE.CircleGeometry(1, 28, Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2);
}

export function createAssets() {
  const gradient = makeGradient(RENDER.toonSteps);
  const geometries = {
    /** 바닥 한 칸(XZ 평면, 가운데가 원점). */
    floor: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    /** 벽 한 칸(높이 1, 바닥이 y = 0). 인스턴스 행렬로 높이를 정한다. */
    wall: shadedWall(RENDER.wallShade.top, RENDER.wallShade.side),
    /** 벽 위의 덮개(높이 0.12). 벽 윗면이 바닥과 구별되게 한다. */
    cap: new THREE.BoxGeometry(1.04, 0.12, 1.04).translate(0, 0.06, 0),
    // ── 캐릭터 부품 ──
    limb: hanging(),
    box: standing(),
    cube: new THREE.BoxGeometry(1, 1, 1),
    head: new THREE.IcosahedronGeometry(1, 0),
    /** 둥근 상자(가운데가 원점): 머리·몸통·손발. 모서리를 둥글려 인형 같은 덩어리감을 낸다. */
    rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.18),
    cone: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0),
    spike: new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0),
    tube: new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, 0.5, 0),
    arc: new THREE.TorusGeometry(1, 0.06, 4, 10, Math.PI),
    /** 날개: 삼각형 하나를 앞뒤 두 면으로(공유 머티리얼의 side 를 바꾸지 않으려고). */
    wing: withNormals(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0.15, -0.2), new THREE.Vector3(0.7, -0.05, 0.45),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.7, -0.05, 0.45), new THREE.Vector3(1, 0.15, -0.2),
    ])),
    // ── 효과 ──
    /** 체력 막대(왼쪽 끝이 원점). */
    bar: new THREE.PlaneGeometry(1, 0.09).translate(0.5, 0, 0),
    orb: new THREE.IcosahedronGeometry(1, 1),
    /** 바닥에 깔리는 원(장판·예고·그림자). */
    disc: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
    /** 바닥에 깔리는 고리. */
    ring: new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2),
    /** 바닥에 깔리는 띠(시작점이 원점, +z 쪽으로 길이 1). 예고선·광선. */
    strip: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
    /** 세운 띠(광선). */
    beam: new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
    star: new THREE.OctahedronGeometry(1, 0),
    coin: new THREE.CylinderGeometry(1, 1, 0.25, 10).rotateX(Math.PI / 2),
    portal: new THREE.TorusGeometry(1, 0.12, 6, 24),
  };
  // 빈 지오메트리는 그려지지 않고 조용히 지나간다(박쥐 날개가 그랬다) — 만들 때 바로 잡는다.
  for (const [name, geometry] of Object.entries(geometries)) {
    if (!geometry || !geometry.isBufferGeometry || !geometry.attributes.position) throw new Error(`createAssets: 지오메트리 "${name}" 가 비어 있다`);
  }
  for (const name of ['limb', 'box', 'cube', 'rbox', 'head', 'cone', 'spike', 'tube', 'arc', 'orb', 'star', 'coin']) withOutlineNormals(geometries[name]);
  /** 부채꼴: cosHalf → 지오메트리(종류가 몇 개뿐이라 처음 쓸 때 만든다). */
  const sectors = new Map();
  /** 색 → 머티리얼. 같은 색은 한 번만 만든다. */
  const toon = new Map();
  const flat = new Map();
  const glow = new Map();
  const materials = {
    floor: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }),
    wall: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, vertexColors: true }),
    cap: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }),
    prop: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }),
    door: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }),
    barBack: new THREE.MeshBasicMaterial({ color: 0x1a1d24, depthTest: false, transparent: true, opacity: 0.85 }),
    barFill: new THREE.MeshBasicMaterial({ color: 0xe5484d, depthTest: false }),
    barBoss: new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false }),
    /** 맞았을 때 잠깐 하얗게 번쩍이는 몸. */
    flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    /** 캐릭터·무기의 외곽선(뒷면 껍데기). 굵기는 세계 단위라 큰 보스도 작은 박쥐도 같은 굵기다. */
    outline: new THREE.ShaderMaterial({
      vertexShader: OUTLINE_VERTEX,
      fragmentShader: OUTLINE_FRAGMENT,
      uniforms: { color: { value: new THREE.Color(RENDER.outline.color) }, width: { value: RENDER.outline.width } },
      side: THREE.BackSide,
    }),
  };

  return {
    geometries,
    materials,
    gradient,
    /** 툰 셰이딩 머티리얼. emissive 를 주면 스스로 빛나는 색이 섞인다(정예의 기운). */
    toon(color, emissive = 0) {
      const key = `${color}:${emissive}`;
      let material = toon.get(key);
      if (!material) {
        material = new THREE.MeshToonMaterial({ color, gradientMap: gradient, emissive, emissiveIntensity: emissive ? 0.55 : 0 });
        toon.set(key, material);
      }
      return material;
    },
    /** 빛과 무관한 단색(반투명 가능): 장판, 예고, 체력 막대. */
    flat(color, opacity = 1) {
      const key = `${color}:${opacity}`;
      let material = flat.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
        flat.set(key, material);
      }
      return material;
    },
    /** 빛나는 것(탄, 포털, 섬광): 더해서 그린다. */
    glow(color, opacity = 1) {
      const key = `${color}:${opacity}`;
      let material = glow.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
        glow.set(key, material);
      }
      return material;
    },
    /** 바닥에 눕힌 부채꼴(반각의 코사인으로 찾는다). */
    sector(cosHalf) {
      const key = cosHalf.toFixed(3);
      let geometry = sectors.get(key);
      if (!geometry) {
        geometry = sector(cosHalf);
        sectors.set(key, geometry);
      }
      return geometry;
    },
    /** 지금까지 만든 머티리얼 전부(셰이더 미리 컴파일용). */
    allMaterials() {
      return [...Object.values(materials), ...toon.values(), ...flat.values(), ...glow.values()];
    },
    /** 그림자 설정이 바뀌면 셰이더를 다시 만들어야 한다. */
    refresh() {
      for (const material of this.allMaterials()) material.needsUpdate = true;
    },
    counts() {
      return { geometries: Object.keys(geometries).length + sectors.size, materials: Object.keys(materials).length + toon.size + flat.size + glow.size };
    },
    dispose() {
      for (const geometry of [...Object.values(geometries), ...sectors.values()]) geometry.dispose();
      for (const material of this.allMaterials()) material.dispose();
      gradient.dispose();
      toon.clear();
      flat.clear();
      glow.clear();
      sectors.clear();
    },
  };
}
