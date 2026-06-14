// アセット不要の効果音（Web Audio APIで合成）。
// ブラウザの自動再生制限のため、最初のユーザー操作後にAudioContextが有効化される。

let ctx: AudioContext | null = null;

function isMutedStored(): boolean {
  try {
    return localStorage.getItem("suisan-muted") === "1";
  } catch {
    return false;
  }
}
let muted = isMutedStored();

export function isMuted(): boolean {
  return muted;
}
export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem("suisan-muted", m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 単音を鳴らす。start/dur は秒。 */
function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.2,
): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** セリ結果：木槌コンコン。 */
export function playGavel(): void {
  if (muted) return;
  tone(200, 0, 0.07, "square", 0.22);
  tone(140, 0.08, 0.12, "square", 0.22);
}
/** 販売成立：コインのチャリン（上昇）。 */
export function playCoin(): void {
  if (muted) return;
  tone(880, 0, 0.06, "triangle", 0.18);
  tone(1320, 0.06, 0.11, "triangle", 0.18);
}
/** 決算：やわらかな2音。 */
export function playSettle(): void {
  if (muted) return;
  tone(440, 0, 0.12, "sine", 0.16);
  tone(330, 0.12, 0.2, "sine", 0.16);
}
/** ゲーム終了：ファンファーレ。 */
export function playFanfare(): void {
  if (muted) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.28, "triangle", 0.2));
}
/** 汎用クリック。 */
export function playClick(): void {
  if (muted) return;
  tone(620, 0, 0.04, "square", 0.1);
}
