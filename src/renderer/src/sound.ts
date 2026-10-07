// 효과음 내기 (Web Audio). 처음 낼 때 AudioContext 를 만들고, 다 울리면 멈춰 둔다(오디오 스레드가 CPU 를 쓰지 않게).
import { SOUNDS, type SoundKind, soundLength } from '../../shared/sound.ts';

let ctx: AudioContext | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export function playSound(kind: SoundKind): void {
  try {
    ctx ??= new AudioContext();
    const audio = ctx;
    void audio.resume();
    const t0 = audio.currentTime + 0.02;
    for (const n of SOUNDS[kind]) {
      const start = t0 + n.at / 1000;
      const end = start + n.dur / 1000;
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.freqEnd) osc.frequency.exponentialRampToValueAtTime(n.freqEnd, end);
      // 톡 튀지 않게 8ms 에 올리고 끝까지 부드럽게 줄인다
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(n.gain, start + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(amp).connect(audio.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void audio.suspend(), soundLength(kind) + 400);
  } catch {
    // 소리를 못 내도 펫은 그대로 (오류 창을 띄우지 않는다)
  }
}
