// 押しているキー（controls）から、1 tick 分の物理の入力を作る。本物のクライアント（tools/live/realplayer.mjs）と
// サンドボックスの体（sim-env.js）が同じこれを使う。ここがずれると、実機とサンドボックスで動きが変わる。
//
// 走り（sprint）の決まり（全部 BDS 1.26.51.1 に本物のクライアントで入って確かめた。tools/live/realcheck.mjs の checkSprintLatch）:
//   1. 掛け金: 走るキーと前を同時に押すと走り出し、前を離すまで走りつづける（走るキーを離しても止まらない）。
//      走り 8 tick → 走るキーだけ離して前を 40 tick 押すと、サーバーは最後まで走っている（審判の isSprinting が真）
//   2. 前の二度押し: 地面で前を押し始めると 7 tick の時計が動き、時計が 0 になる前に地面でもう一度押し始めると走り出す。
//      「押していた tick 数 ＋ 離していた tick 数 ≦ 6」なら走る（p1 r5・p2 r4・p4 r1 は走る、p1 r6・p2 r5・p4 r3 は歩く）。
//      二度目を空中で押しても走らない。一度目を空中で押した場合は測っていない（Java 版と同じく地面のときだけ時計を動かす）
//   3. 走り跳びの後押し（0.2）は、跳ぶ tick に後ろを押していると付かない（前＋後ろ＋跳ぶ。跳ぶ tick に後ろを離せば付く。2026-09-20 に測った）
//   クライアントがこれと違う動きを送ると、サーバーは 0.5 ブロックまでは受け入れ、超えたところで訂正を送ってくる
//   （学んだ方策が実機でだけ落ちた。歩く → 止まる → すぐ歩く、が二度押しになっていた）。
export const DOUBLE_TAP_TICKS = 7;

export function createControlState() {
  let latched = false;
  let prevForward = false;
  let timer = 0;
  return {
    /**
     * controls = { forward, back, left, right, sprint, jump }。onGround はこの tick を動く前に地面にいたか。
     * 戻りは物理の入力（yaw は別に足す）
     */
    input(controls, { onGround = true } = {}) {
      const c = controls;
      if (timer > 0) timer--;
      const forward = Boolean(c.forward);
      if (forward && !prevForward && onGround && !latched) {
        if (c.sprint) latched = true;
        else if (timer > 0) latched = true;
        else timer = DOUBLE_TAP_TICKS;
      }
      if (c.sprint && forward) latched = true;
      if (!forward) latched = false;
      prevForward = forward;
      return {
        move: { x: (c.left ? 1 : 0) - (c.right ? 1 : 0), z: (forward ? 1 : 0) - (c.back ? 1 : 0) },
        sprint: latched,
        jump: Boolean(c.jump),
        // 走り跳びの後押しは、跳ぶ tick に後ろを押していると付かない（実機で測った: 前＋後ろ＋跳ぶで、付けるとサーバーが訂正を返す）
        ...(c.back ? { jumpBoost: false } : {}),
      };
    },
    get sprinting() { return latched; },
    reset() { latched = false; prevForward = false; timer = 0; },
    save: () => [latched, prevForward, timer],
    load([a, b, c]) { latched = a; prevForward = b; timer = c; },
  };
}
