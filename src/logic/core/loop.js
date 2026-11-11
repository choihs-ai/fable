// 고정 타임스텝 루프(순수 로직). 시간은 바깥에서 주입한다 — 여기서는 시계를 읽지 않는다.
//
// 브라우저 쪽(main.js)이 프레임마다 경과 시간(ms)을 advance() 에 넘기면,
// 누적된 시간만큼 update(stepSec) 를 0번 이상 호출하고 보간 계수 alpha 를 돌려준다.
// update 에는 항상 같은 dt 가 들어가므로 프레임률과 무관하게 로직 결과가 같다.

export class FixedStepLoop {
  #stepMs;
  #stepSec;
  #maxFrameMs;
  #update;
  #accumulatorMs = 0;

  /**
   * @param {object} options
   * @param {number} options.stepMs 로직 한 틱의 길이(ms)
   * @param {number} options.maxFrameMs 한 번의 advance 에 반영할 최대 경과 시간(ms)
   * @param {(stepSec: number) => void} options.update 틱마다 호출되는 함수
   */
  constructor({ stepMs, maxFrameMs, update }) {
    if (!(Number.isFinite(stepMs) && stepMs > 0)) throw new RangeError('FixedStepLoop: stepMs 는 양수여야 합니다');
    if (!(Number.isFinite(maxFrameMs) && maxFrameMs >= stepMs)) {
      throw new RangeError('FixedStepLoop: maxFrameMs 는 stepMs 이상이어야 합니다');
    }
    if (typeof update !== 'function') throw new TypeError('FixedStepLoop: update 함수가 필요합니다');
    this.#stepMs = stepMs;
    this.#stepSec = stepMs / 1000;
    this.#maxFrameMs = maxFrameMs;
    this.#update = update;
  }

  /**
   * 경과 시간을 반영한다.
   * @param {number} elapsedMs 직전 호출 이후 흐른 시간. 음수·NaN·Infinity 는 0 으로 취급한다.
   * @returns {{ steps: number, alpha: number }} 실행된 틱 수와, 다음 틱까지의 진행도 [0, 1)
   */
  advance(elapsedMs) {
    const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.min(elapsedMs, this.#maxFrameMs) : 0;
    this.#accumulatorMs += elapsed;
    let steps = 0;
    while (this.#accumulatorMs >= this.#stepMs) {
      this.#accumulatorMs -= this.#stepMs;
      steps++;
      this.#update(this.#stepSec);
    }
    return { steps, alpha: this.#accumulatorMs / this.#stepMs };
  }

  /** 누적 시간을 버린다(일시정지 해제, 씬 전환 직후 등). */
  reset() {
    this.#accumulatorMs = 0;
  }
}
