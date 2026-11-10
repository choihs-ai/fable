// Three.js 렌더러. 로직 상태는 읽기만 한다 — 여기서 state 를 수정하지 않는다.

import * as THREE from 'three';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} options.config data/config.js 의 RENDER
 */
export function createRenderer({ canvas, config }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(config.clearColor);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(config.fovDeg, 1, config.near, config.far);
  camera.position.set(0, 8, 10);
  camera.lookAt(0, 0, 0);

  // WebGL 이 실제로 그려지는지 눈으로 확인하기 위한 바닥 격자. 맵 렌더가 생기면 제거한다.
  // TODO(world 단계): 격자를 지우고 render/world 에서 맵 메시를 만든다.
  scene.add(new THREE.GridHelper(20, 20, 0x3a4660, 0x1c2230));

  return {
    /**
     * @param {object} state 로직 상태(읽기 전용)
     * @param {number} alpha 직전 틱과 다음 틱 사이 보간 계수 [0, 1)
     */
    render(state, alpha) {
      // TODO(이후 단계): state 를 읽어 씬 객체를 갱신하고 alpha 로 위치를 보간한다.
      renderer.render(scene, camera);
    },

    resize(width, height, pixelRatio) {
      renderer.setPixelRatio(Math.min(pixelRatio, config.maxPixelRatio));
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },

    dispose() {
      renderer.dispose();
    },
  };
}
