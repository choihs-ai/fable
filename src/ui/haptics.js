// 진동. 지원하지 않는 기기(아이폰의 사파리 등)에서는 아무 일도 하지 않는다.

import { INPUT } from '../../data/ui.js';

export function createHaptics() {
  let enabled = true;
  const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return {
    supported,
    setEnabled(value) {
      enabled = value === true;
    },
    /** @param {'hurt'|'kill'|'levelUp'|'death'|'deny'} name */
    pulse(name) {
      if (!enabled || !supported) return false;
      try {
        return navigator.vibrate(INPUT.vibration[name]);
      } catch {
        return false;
      }
    },
  };
}
