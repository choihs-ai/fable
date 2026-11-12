// 그림체 시안: 장면을 렌더 타깃에 그린 뒤(색 + 깊이), 화면 전체에 후처리 셰이더를 씌운다.
//   base     지금 그림 그대로(후처리 없음)
//   ink      먹선 판화: 깊이·밝기의 경계에 먹선, 종이색 4단 명암, 그늘에 빗금, 선명한 색만 남김
//   pixel    픽셀 3D: 낮은 해상도로 그려 키움, 색 단계 + 점묘(디더), 1픽셀 외곽선
//   diorama  미니어처: 화면 위아래 흐림(틸트시프트), 채도·대비·따뜻함, 가장자리 어둡게, 빛 번짐
// 수치는 data/config.js 의 RENDER.looks. 이 파일의 렌더 타깃·셰이더는 렌더러와 함께 산다(층이 바뀌어도 그대로).

import * as THREE from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;
float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
float viewDist(vec2 uv) { return -perspectiveDepthToViewZ(rawDepth(uv), cameraNear, cameraFar); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 colorAt(vec2 uv) { return toSrgb(texture2D(tColor, uv).rgb); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 saturate3(vec3 c, float s) { float l = luma(c); return mix(vec3(l), c, s); }
`;

const INK = /* glsl */ `${COMMON}
uniform vec3 paper; uniform vec3 mid; uniform vec3 shade; uniform vec3 ink; uniform vec3 voidColor;
uniform float exposure; uniform vec3 steps; uniform float smoothPx; uniform vec2 accentSat;
uniform float lineWidth; uniform float lineDepth; uniform float lineColor; uniform float accent; uniform float hatch; uniform float grain;
void main() {
  float g = hash(floor(gl_FragCoord.xy / 2.0));
  if (rawDepth(vUv) >= 1.0) { gl_FragColor = vec4(voidColor * (1.0 - grain * g), 1.0); return; }
  vec3 c = colorAt(vUv);
  vec2 o = texel * lineWidth;
  // 깊이의 꺾임(라플라시안)과 밝기의 경계(소벨)를 먹선으로.
  float z = viewDist(vUv);
  float lap = abs(viewDist(vUv - vec2(o.x, 0.0)) + viewDist(vUv + vec2(o.x, 0.0)) + viewDist(vUv - vec2(0.0, o.y)) + viewDist(vUv + vec2(0.0, o.y)) - 4.0 * z) / z;
  float gx = luma(colorAt(vUv + vec2(o.x, 0.0))) - luma(colorAt(vUv - vec2(o.x, 0.0)));
  float gy = luma(colorAt(vUv + vec2(0.0, o.y))) - luma(colorAt(vUv - vec2(0.0, o.y)));
  float edge = max(smoothstep(lineDepth, lineDepth * 2.0, lap), 0.85 * smoothstep(lineColor, lineColor * 2.0, length(vec2(gx, gy))));
  // 밝기를 종이색 4단으로.
  // 바닥 무늬의 잔 얼룩이 명암 경계를 넘나들며 자글거리지 않게, 둘레를 평균한 밝기로 단을 정한다.
  vec2 so = texel * smoothPx;
  float lm = (luma(c) * 2.0 + luma(colorAt(vUv + vec2(so.x, 0.0))) + luma(colorAt(vUv - vec2(so.x, 0.0))) + luma(colorAt(vUv + vec2(0.0, so.y))) + luma(colorAt(vUv - vec2(0.0, so.y)))) / 6.0;
  float t = clamp(lm * exposure, 0.0, 1.0);
  vec3 tone = t > steps.x ? paper : t > steps.y ? mid : t > steps.z ? shade : mix(ink, shade, 0.35);
  // 그늘에는 빗금.
  float line = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / hatch));
  if (t <= steps.y) tone = mix(tone, ink, line * (t > steps.z ? 0.35 : 0.55));
  // 선명한 색(적의 탄·예고, 축복 빛)은 몇 단계로 끊어 남긴다.
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  vec3 vivid = floor(saturate3(c, 1.2) * 4.0 + 0.5) / 4.0;
  tone = mix(tone, vivid, accent * smoothstep(accentSat.x, accentSat.y, sat));
  tone *= 1.0 - grain * g;
  gl_FragColor = vec4(mix(tone, ink, edge), 1.0);
}`;

const PIXEL = /* glsl */ `${COMMON}
uniform vec2 lowSize; uniform float levels; uniform float dither; uniform float saturation; uniform float outline; uniform float outlineDepth; uniform vec3 voidColor;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 cell = floor(vUv * lowSize);
  vec2 uv = (cell + 0.5) / lowSize;
  if (rawDepth(uv) >= 1.0) { gl_FragColor = vec4(voidColor, 1.0); return; }
  // 칸마다 네 점을 평균한다(렌더 타깃은 칸의 두 배 해상도) — 바닥 무늬가 칸마다 튀는 색 잡음이 되지 않게.
  vec2 q = 0.25 / lowSize;
  vec3 c = (colorAt(uv + vec2(-q.x, -q.y)) + colorAt(uv + vec2(q.x, -q.y)) + colorAt(uv + vec2(-q.x, q.y)) + colorAt(uv + vec2(q.x, q.y))) * 0.25;
  c = saturate3(c, saturation);
  // 점묘는 밝기에만: 색 채널을 따로 끊으면 회색에 분홍·초록 점이 박힌다. 색조는 점묘 없이 두 배 단계로 끊는다.
  float d = (bayer4(cell) - 0.5) * dither;
  float l = max(luma(c), 1e-3);
  float lq = floor(l * (levels - 1.0) + 0.5 + d) / (levels - 1.0);
  vec3 hue = floor(c / l * (levels * 0.5) + 0.5) / (levels * 0.5);
  c = hue * lq;
  // 1픽셀 외곽선: 이웃 칸이 확 멀어지면(뒤쪽이면) 어둡게.
  float z = viewDist(uv);
  vec2 o = 1.0 / lowSize;
  float far = max(max(viewDist(uv + vec2(o.x, 0.0)), viewDist(uv - vec2(o.x, 0.0))), max(viewDist(uv + vec2(0.0, o.y)), viewDist(uv - vec2(0.0, o.y))));
  if ((far - z) / z > outlineDepth) c *= outline;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const DIORAMA = /* glsl */ `${COMMON}
uniform float focusY; uniform float band; uniform float maxBlur; uniform float saturation; uniform float contrast; uniform float warmth; uniform float vignette; uniform float bloom;
void main() {
  // 틸트시프트: 초점 띠에서 멀수록 흐리게(황금각 원반 표본 16개).
  float blur = smoothstep(band, band + 0.3, abs(vUv.y - focusY)) * maxBlur;
  vec3 acc = vec3(0.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0);
    float a = float(i) * 2.39996;
    vec2 off = vec2(cos(a), sin(a)) * r;
    vec3 s = colorAt(vUv + off * blur * texel);
    acc += s;
    // 빛 번짐: 넓게 본 밝은 부분.
    vec3 w = colorAt(vUv + off * 14.0 * texel);
    glow += max(w - 0.62, 0.0);
  }
  vec3 c = acc / 16.0 + bloom * glow / 16.0;
  c = saturate3(c, saturation);
  c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
  float l = luma(c);
  c += warmth * vec3(1.0, 0.45, -0.6) * l - warmth * 0.5 * vec3(0.2, -0.1, -0.35) * (1.0 - l);
  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * dot(q, q) * 1.6;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const SHADERS = { ink: INK, pixel: PIXEL, diorama: DIORAMA };

const color = (hex) => new THREE.Color(hex);

/** 그림체마다 셰이더 uniforms 를 data 의 수치로 만든다. */
function uniformsOf(name, cfg) {
  if (name === 'ink') {
    return {
      paper: { value: color(cfg.paper) }, mid: { value: color(cfg.mid) }, shade: { value: color(cfg.shade) }, ink: { value: color(cfg.ink) },
      voidColor: { value: color(cfg.void) }, exposure: { value: cfg.exposure }, steps: { value: new THREE.Vector3(...cfg.steps) },
      smoothPx: { value: cfg.smooth }, accentSat: { value: new THREE.Vector2(...cfg.accentSat) },
      lineWidth: { value: cfg.lineWidth }, lineDepth: { value: cfg.lineDepth }, lineColor: { value: cfg.lineColor },
      accent: { value: cfg.accent }, hatch: { value: cfg.hatch }, grain: { value: cfg.grain },
    };
  }
  if (name === 'pixel') {
    return {
      lowSize: { value: new THREE.Vector2(1, 1) }, levels: { value: cfg.levels }, dither: { value: cfg.dither }, saturation: { value: cfg.saturation },
      outline: { value: cfg.outline }, outlineDepth: { value: cfg.outlineDepth }, voidColor: { value: color(cfg.void) },
    };
  }
  return {
    focusY: { value: cfg.focusY }, band: { value: cfg.band }, maxBlur: { value: cfg.maxBlur }, saturation: { value: cfg.saturation },
    contrast: { value: cfg.contrast }, warmth: { value: cfg.warmth }, vignette: { value: cfg.vignette }, bloom: { value: cfg.bloom },
  };
}

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {object} options.config RENDER.looks
 */
export function createLooks({ renderer, config }) {
  const names = Object.keys(config);
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  target.depthTexture = new THREE.DepthTexture(1, 1);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const materials = {};
  for (const name of Object.keys(SHADERS)) {
    if (!config[name]) continue;
    materials[name] = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: SHADERS[name],
      uniforms: {
        tColor: { value: target.texture }, tDepth: { value: target.depthTexture }, texel: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 }, cameraFar: { value: 100 }, ...uniformsOf(name, config[name]),
      },
      depthTest: false,
      depthWrite: false,
    });
  }
  let current = 'base';
  const buffer = new THREE.Vector2();
  let css = { width: 1, height: 1 };

  /** 렌더 타깃 크기를 그림체에 맞춘다(픽셀은 낮은 해상도). */
  function fit() {
    if (current === 'base') return;
    renderer.getDrawingBufferSize(buffer);
    let w = buffer.x;
    let h = buffer.y;
    if (current === 'pixel') {
      const cw = Math.max(1, Math.floor(css.width / config.pixel.pixelSize));
      const ch = Math.max(1, Math.floor(css.height / config.pixel.pixelSize));
      materials.pixel.uniforms.lowSize.value.set(cw, ch);
      w = cw * 2;
      h = ch * 2;
    }
    const filter = THREE.LinearFilter;
    if (target.texture.magFilter !== filter) {
      target.texture.magFilter = filter;
      target.texture.minFilter = filter;
      target.texture.needsUpdate = true;
    }
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    materials[current].uniforms.texel.value.set(1 / w, 1 / h);
  }

  return {
    names,
    get current() {
      return current;
    },
    /** 그림체를 바꾼다. 모르는 이름이면 base. */
    set(name) {
      current = Object.hasOwn(materials, name) ? name : 'base';
      if (current !== 'base') quad.material = materials[current];
      fit();
      return current;
    },
    /** 이 그림체의 빛 설정. */
    light() {
      return config[current].light;
    },
    /** 이 그림체가 그림자를 켜 두는가. */
    wantsShadows() {
      return config[current].shadows === true;
    },
    resize(width, height) {
      css = { width, height };
      fit();
    },
    /** 장면을 그린다(base 면 그대로, 시안이면 렌더 타깃을 거쳐 후처리). */
    render(scene, camera) {
      if (current === 'base') {
        renderer.render(scene, camera);
        return;
      }
      fit();
      const m = materials[current];
      m.uniforms.cameraNear.value = camera.near;
      m.uniforms.cameraFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
    /** 미리 컴파일: 지금 그림체의 후처리 셰이더. */
    compile() {
      if (current !== 'base') renderer.compile(quadScene, quadCamera);
    },
    dispose() {
      target.depthTexture.dispose();
      target.dispose();
      quad.geometry.dispose();
      for (const m of Object.values(materials)) m.dispose();
    },
  };
}
