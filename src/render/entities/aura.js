// 축복의 기운: 계열마다 몸 둘레를 도는 구슬과, 축복이 쌓일수록 늘어나는 발밑 고리.
// 강해지는 것이 눈에 보이게 한다. 개수·색은 aura-plan.js 가 정하고 여기서는 그리기만 한다(로직 상태를 읽기만 한다).

import * as THREE from 'three';
import { BOONS } from '../../../data/boons.js';
import { FEEL } from '../../../data/feel.js';
import { auraPlan } from './aura-plan.js';

const A = FEEL.aura;
const FAMILIES = ['fire', 'bolt', 'ice'];

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {object} options.assets
 */
export function createAura({ scene, assets }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  // 구슬: 계열마다 최대 maxOrbs 개를 미리 만들어 둔다(머티리얼도 미리 — 플레이 중에 셰이더가 새로 생기지 않게).
  const orbs = {};
  for (const family of FAMILIES) {
    orbs[family] = [];
    for (let i = 0; i < A.maxOrbs; i++) {
      const core = new THREE.Mesh(assets.geometries.orb, assets.glow(A.colors[family], 0.95));
      const halo = new THREE.Mesh(assets.geometries.orb, assets.glow(A.colors[family], 0.3));
      core.scale.setScalar(A.size);
      halo.scale.setScalar(A.size * 2.1);
      const orb = new THREE.Group();
      orb.add(core, halo);
      orb.visible = false;
      group.add(orb);
      orbs[family].push(orb);
    }
  }
  const ringMaterials = Object.fromEntries(Object.entries(A.colors).map(([k, c]) => [k, assets.glow(c, A.ringOpacity)]));
  const rings = A.ringsAt.map((_, i) => {
    const ring = new THREE.Mesh(assets.geometries.ring, ringMaterials.none);
    ring.scale.setScalar(0.62 + i * 0.16);
    ring.position.y = 0.02 + i * 0.002;
    ring.visible = false;
    group.add(ring);
    return ring;
  });
  let key = '';
  let plan = auraPlan([], BOONS, A);

  return {
    /**
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {{x:number,y:number}|null} at 화면의 플레이어 위치
     * @param {number} time 렌더러의 시계(초)
     */
    update(state, at, time) {
      const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
      if (!at || !player || player.dead) {
        group.visible = false;
        return;
      }
      const boons = state.run.boons;
      const next = boons.join(',');
      if (next !== key) {
        key = next;
        plan = auraPlan(boons, BOONS, A);
        for (const family of FAMILIES) orbs[family].forEach((o) => { o.visible = false; });
        for (const o of plan.orbs) orbs[o.family][o.index].visible = true;
        rings.forEach((ring, i) => {
          ring.visible = i < plan.rings;
          ring.material = ringMaterials[plan.dominant];
        });
      }
      group.visible = plan.orbs.length > 0 || plan.rings > 0;
      group.position.set(at.x, 0, at.y);
      // 계열마다 위상을 달리해 고르게 돈다.
      const total = plan.orbs.length;
      plan.orbs.forEach((o, k) => {
        const angle = time * A.speed + (k / Math.max(1, total)) * Math.PI * 2;
        const orb = orbs[o.family][o.index];
        orb.position.set(Math.cos(angle) * A.radius, A.height + Math.sin(time * 3 + k) * A.bob, Math.sin(angle) * A.radius);
      });
      rings.forEach((ring, i) => {
        ring.rotation.y = time * (i % 2 === 0 ? 0.6 : -0.45);
      });
    },
    /** 미리 컴파일용: 모두 잠깐 보이게 한다. @returns {() => void} 되돌리는 함수 */
    prewarm() {
      const saved = [[group, group.visible]];
      group.visible = true;
      for (const family of FAMILIES) for (const o of orbs[family]) saved.push([o, o.visible]);
      for (const r of rings) saved.push([r, r.visible, r.material]);
      for (const family of FAMILIES) for (const o of orbs[family]) o.visible = true;
      // 고리 머티리얼은 색만 다르고 셰이더는 같다 — 하나만 보이면 된다.
      for (const r of rings) r.visible = true;
      return () => {
        for (const [o, v, m] of saved) {
          o.visible = v;
          if (m) o.material = m;
        }
      };
    },
    clear() {
      group.visible = false;
      key = '';
    },
    dispose() {
      scene.remove(group);
    },
  };
}
