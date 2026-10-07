// 효과음 (기본 끔). 파일 없이 펫 화면이 Web Audio 로 그 자리에서 만든다. 작고 짧게.
// 여기에는 음표만 적는다 (시험할 수 있게). 소리 내기는 renderer/src/sound.ts.

export type SoundKind = 'happy' | 'fed' | 'purr' | 'bell' | 'wave' | 'dance';

export interface Note {
  /** 시작 (ms, 소리 처음부터) */
  at: number;
  /** 길이 (ms) */
  dur: number;
  /** 높이 (Hz). freqEnd 가 있으면 그쪽으로 미끄러진다 */
  freq: number;
  freqEnd?: number;
  type: 'sine' | 'triangle';
  /** 크기 (0~1). 작게 */
  gain: number;
}

/** 가장 큰 소리. 펫은 옆에서 조그맣게 말한다 */
export const MAX_GAIN = 0.07;

const C6 = 1046.5;
const E6 = 1318.5;
const G6 = 1568;
const C7 = 2093;
const G5 = 784;

export const SOUNDS: Record<SoundKind, readonly Note[]> = {
  // 할 일 끝냄: 올라가는 두 음 "띠링"
  happy: [
    { at: 0, dur: 110, freq: C6, type: 'triangle', gain: 0.05 },
    { at: 95, dur: 170, freq: E6, type: 'triangle', gain: 0.05 },
  ],
  // 밥: 짧게 두 번 "냠냠" (높이가 살짝 내려간다)
  fed: [
    { at: 0, dur: 80, freq: 560, freqEnd: 430, type: 'sine', gain: 0.06 },
    { at: 140, dur: 80, freq: 560, freqEnd: 430, type: 'sine', gain: 0.06 },
  ],
  // 쓰다듬기: 낮게 가르릉 (짧은 떨림 여섯 번)
  purr: Array.from({ length: 6 }, (_, i) => ({
    at: i * 55,
    dur: 45,
    freq: 170 + (i % 2) * 12,
    type: 'sine' as const,
    gain: 0.045,
  })),
  // 일정 알림: 맑은 종 두 번 "딩동"
  bell: [
    { at: 0, dur: 260, freq: C6, type: 'sine', gain: 0.055 },
    { at: 220, dur: 380, freq: G5, type: 'sine', gain: 0.055 },
  ],
  // 손 흔들기: 위로 "뿅"
  wave: [{ at: 0, dur: 170, freq: 660, freqEnd: 1000, type: 'triangle', gain: 0.045 }],
  // 빙글 춤: 도미솔도
  dance: [C6, E6, G6, C7].map((freq, i) => ({
    at: i * 75,
    dur: 110,
    freq,
    type: 'triangle' as const,
    gain: 0.04,
  })),
};

/** 소리 길이 (ms) */
export function soundLength(kind: SoundKind): number {
  return Math.max(...SOUNDS[kind].map((n) => n.at + n.dur));
}

/** 지금 소리를 내도 되는지: 설정을 켰고, 집중, 잠, 졸음, 바쁨, 숨김이 아닐 때 */
export function canPlay(o: { enabled: boolean; focus: boolean; mood: string }): boolean {
  return o.enabled && !o.focus && !['sleeping', 'dozing', 'busy', 'hidden'].includes(o.mood);
}
