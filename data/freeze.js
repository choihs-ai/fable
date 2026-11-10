// 설정 객체를 깊게 동결한다. data/** 의 값은 실행 중에 바뀌지 않는다.

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
