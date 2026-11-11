// 사용자 설정의 목록·기본값·허용 범위. 설정은 게임 상태(state)에 들어가지 않고 따로 저장된다.
// 형식: int { min, max }, bool, enum { values }. 저장된 값이 형식에 맞지 않으면 기본값으로 되돌린다.

import { deepFreeze } from './freeze.js';

/** 설정 스키마 버전. 항목의 뜻이 바뀌면 올리고 logic/save/migrate.js 에 마이그레이션을 추가한다. */
export const SETTINGS_VERSION = 1;

export const SETTINGS = deepFreeze({
  /** 음량(0~100). audio 단계에서 쓴다. */
  masterVolume: { type: 'int', min: 0, max: 100, default: 80 },
  musicVolume: { type: 'int', min: 0, max: 100, default: 60 },
  sfxVolume: { type: 'int', min: 0, max: 100, default: 80 },
  /** 피격·처치 때 진동. */
  vibration: { type: 'bool', default: true },
  /** 렌더 품질. render 단계에서 쓴다. */
  quality: { type: 'enum', values: ['low', 'medium', 'high'], default: 'medium' },
  /** 조작부 좌우 반전. ui 단계에서 쓴다. */
  leftHanded: { type: 'bool', default: false },
});
