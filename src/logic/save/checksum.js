// 세이브 본문의 체크섬(FNV-1a 32비트). 암호학적 보호가 아니라 "저장 도중 잘렸거나 일부가 바뀌었는지"를 알아내는 용도다.
// 정수 연산만 쓰므로 엔진과 무관하게 같은 값이 나온다.

/**
 * @param {string} text
 * @returns {string} 8자리 16진수
 */
export function checksumOf(text) {
  if (typeof text !== 'string') throw new TypeError('checksumOf: 문자열이 아닙니다');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    // UTF-16 코드 단위를 두 바이트로 나눠 섞는다(한글 시드도 구분되도록).
    const code = text.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193);
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
