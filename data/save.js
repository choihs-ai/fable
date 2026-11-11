// 세이브 설정: 저장소 키, 형식 이름, 읽을 때 쓰는 상한값.
// 상한값은 밸런스 수치가 아니라 "이 범위를 벗어나면 손상된 세이브로 본다"는 안전선이다.
// 정상 플레이에서 나올 수 있는 값보다 넉넉하게 잡는다(수치를 조정해도 기존 세이브가 거부되지 않도록).

import { deepFreeze } from './freeze.js';

export const SAVE = deepFreeze({
  /** 봉투의 format 값. 다른 프로그램이 같은 키에 쓴 값과 구분한다. */
  format: 'fable-save',
  /** 저장소 키. 런·메타·설정을 따로 보관한다(런이 깨져도 메타는 남는다). */
  keys: { run: 'fable:run', meta: 'fable:meta', settings: 'fable:settings' },
  /** 직전에 성공한 저장본(백업)과, 읽지 못한 원본(격리)을 두는 키의 접미사. */
  backupSuffix: ':bak',
  quarantineSuffix: ':bad',
  /** 저장소를 쓸 수 있는지 시험할 때 쓰는 키. */
  probeKey: 'fable:probe',
  /** 이보다 긴 글은 세이브로 읽지 않는다(정상 런 세이브는 5만 자 안팎). */
  maxTextLength: 2_000_000,
  /** 검증에 쓰는 상한. */
  limits: {
    seedLength: 128,
    tick: 2_000_000_000,
    /** 타이머(재사용 대기·지속시간 등)는 현재 틱에서 이만큼 뒤까지만 허용한다(1시간). */
    timerAhead: 216_000,
    id: 2_000_000_000,
    level: 999,
    xp: 1_000_000_000,
    gold: 1_000_000_000,
    count: 1_000_000,
    /** 능력치 옵션 하나의 절댓값. */
    statValue: 100_000,
    hp: 100_000_000,
    itemLevel: 999,
    /** 격자 한 변의 길이. */
    mapSide: 512,
    listLength: 4096,
  },
});
