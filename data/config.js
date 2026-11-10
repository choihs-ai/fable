// 엔진 설정값. 밸런스 수치(적·아이템·전투 등)는 단계별로 data/ 아래 별도 파일로 추가한다.
// data/** 는 다른 계층을 import 하지 않는다(순수 값만).

export const LOOP = Object.freeze({
  /** 로직 틱 주파수(Hz). 로직은 항상 1/tickRate 초 단위로만 전진한다. */
  tickRate: 60,
  /** 한 프레임에 반영할 최대 경과 시간(ms). 탭 복귀 등으로 생긴 긴 공백을 잘라낸다. */
  maxFrameMs: 250,
});

export const RENDER = Object.freeze({
  /** devicePixelRatio 상한. 고해상도 모바일에서 픽셀 수 폭증을 막는다. */
  maxPixelRatio: 2,
  clearColor: 0x0b0d12,
  fovDeg: 60,
  near: 0.1,
  far: 200,
});
