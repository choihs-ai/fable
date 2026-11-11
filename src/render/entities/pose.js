// 캐릭터의 자세 계산(걷기·공격·피격·대시·처치). 수식만 있다(Three.js 를 모른다) — Node 에서 테스트한다.
// 각도는 라디안, 길이는 칸.

/** 무기마다 휘두르는 모양: 'slash'(옆으로 베기), 'thrust'(찌르기), 'smash'(내려찍기), 'shoot'(반동), 'spin'(회전). */
export const SWING = Object.freeze({
  sword: 'slash', dagger: 'thrust', spear: 'thrust', greatsword: 'slash', dual: 'slash', hammer: 'smash',
  pistol: 'shoot', staff: 'shoot', bow: 'shoot', smg: 'shoot', shotgun: 'shoot', sniper: 'shoot', laser: 'shoot', rocket: 'shoot',
  claw: 'slash', bite: 'thrust', none: 'slash',
});

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** 빠르게 나갔다가 천천히 돌아온다. */
const strike = (t) => (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75);

/**
 * @param {object} p
 * @param {number} p.walk 걸음 위상(라디안, 걸은 거리에 비례)
 * @param {number} p.speed 지금 이동 빠르기(0~1, 걷기 흔들림의 크기)
 * @param {number} p.attack 공격 진행(0~1, 공격하지 않으면 -1)
 * @param {string} p.swing SWING 의 값
 * @param {number} p.windup 준비 중이면 0~1(예고 자세), 아니면 -1
 * @param {number} p.hurt 피격 직후 1 에서 0 으로 줄어드는 값
 * @param {boolean} p.dash 대시 중인가
 * @param {number} p.time 흐른 시간(초, 숨쉬기)
 * @returns {{ bob:number, lean:number, twist:number, legL:number, legR:number, armL:number, armR:number, armRSide:number, weaponPush:number, head:number, squash:number }}
 */
export function poseOf(p) {
  const swingAmp = 0.7 * clamp01(p.speed);
  const legL = Math.sin(p.walk) * swingAmp;
  const legR = -legL;
  let armL = -legL * 0.8;
  let armR = legL * 0.6;
  let armRSide = 0;
  let twist = 0;
  let weaponPush = 0;
  let lean = 0.12 * clamp01(p.speed);
  let bob = Math.abs(Math.sin(p.walk)) * 0.06 * clamp01(p.speed) + Math.sin(p.time * 2.2) * 0.012;
  let squash = 1;

  if (p.windup >= 0) {
    // 준비: 무기를 뒤로 당기고 몸을 움츠린다(상대가 읽을 수 있게 크게).
    const t = clamp01(p.windup);
    armR = -1.3 * t;
    armRSide = 0.4 * t;
    twist = -0.5 * t;
    lean = -0.15 * t;
    squash = 1 - 0.08 * t;
  }
  if (p.attack >= 0) {
    const t = clamp01(p.attack);
    const k = strike(t);
    if (p.swing === 'slash') {
      twist = -0.9 + 1.8 * clamp01(t / 0.35);
      armR = -1.4 * (1 - k * 0.3);
      armRSide = 1.1 * k;
      lean = 0.18 * k;
    } else if (p.swing === 'thrust') {
      armR = -1.5;
      weaponPush = 0.45 * k;
      lean = 0.25 * k;
    } else if (p.swing === 'smash') {
      armR = -2.6 + 3.2 * clamp01(t / 0.3);
      lean = 0.35 * k;
      squash = 1 - 0.12 * k;
    } else if (p.swing === 'spin') {
      twist = Math.PI * 2 * clamp01(t / 0.6);
      armRSide = 1.3;
      armR = -1.5;
    } else {
      // 쏘기: 팔을 앞으로 뻗고 반동으로 살짝 젖힌다.
      armR = -1.5 + 0.35 * k;
      armL = -1.2;
      weaponPush = -0.12 * k;
      lean = -0.08 * k;
    }
  }
  if (p.dash) {
    lean = 0.55;
    armL = 0.9;
    armR = 0.9;
    bob = 0.05;
    squash = 0.9;
  }
  if (p.hurt > 0) {
    lean -= 0.35 * p.hurt;
    squash *= 1 - 0.1 * p.hurt;
  }
  return { bob, lean, twist, legL, legR, armL, armR, armRSide, weaponPush, head: -lean * 0.5, squash };
}

/**
 * 처치당한 몸이 튕겨 나가는 궤적.
 * @param {{ vx:number, vy:number, up:number, gravity:number, spin:number }} c 처음 속도(칸/초), 위로 솟는 속도, 중력, 회전 속도
 * @param {number} t 지난 시간(초)
 * @returns {{ dx:number, dz:number, h:number, roll:number }} 바닥 위 이동, 높이(바닥 아래로 내려가지 않는다), 회전
 */
export function corpseAt(c, t) {
  const h = Math.max(0, c.up * t - 0.5 * c.gravity * t * t);
  // 바닥에 닿은 뒤로는 미끄러지며 느려진다.
  const air = c.gravity > 0 ? (2 * c.up) / c.gravity : t;
  const slide = t <= air ? t : air + (t - air) * 0.35;
  return { dx: c.vx * slide, dz: c.vy * slide, h, roll: c.spin * Math.min(t, air) };
}
