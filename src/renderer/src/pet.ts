import { GestureTracker } from '../../shared/gesture.ts';
import {
  canBlink,
  EXCITED_MS,
  INITIAL_INPUTS,
  isAnimated,
  moodOf,
  nextChangeAt,
  type PetInputs,
  type PetMood,
  TALK_MS,
} from '../../shared/pet-mood.ts';
import { CANVAS_SIZE, drawPet } from './draw.ts';

const bridge = window.jjakkung;
function setupCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.getElementById('pet');
  if (!(el instanceof HTMLCanvasElement)) throw new Error('#pet canvas 가 없다');
  // 마우스가 펫 위인지 픽셀로 판정하려고 자주 읽는다. 작은 캔버스라 CPU 쪽에 두는 편이 낫다.
  const context = el.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2d 컨텍스트를 못 얻었다');
  return [el, context];
}
const [canvas, ctx] = setupCanvas();

// ---- 그리기 루프 ----
// 정지 상태는 한 번 그리고 멈춘다. 계속 그리면 fps 와 무관하게 CPU 를 먹는다 (L10).

const BLINK_MS = 180;
const ANIMATED_FPS: Partial<Record<PetMood, number>> = { excited: 30, thinking: 8 };

let inputs: PetInputs = { ...INITIAL_INPUTS };
let mood: PetMood = moodOf(inputs, performance.now());
let moodSince = performance.now();
let blinkStart = -1;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let blinkTimer: ReturnType<typeof setTimeout> | undefined;

function setInputs(patch: Partial<PetInputs>) {
  inputs = { ...inputs, ...patch };
  // 신남, 말하기가 끝나는 시각에 한 번 다시 그린다.
  clearTimeout(changeTimer);
  const now = performance.now();
  const at = nextChangeAt(inputs, now);
  if (at !== undefined) changeTimer = setTimeout(requestFrame, at - now + 1);
  requestFrame();
}

function requestFrame() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(frame, 0);
}

function frame() {
  frameTimer = undefined;
  const now = performance.now();
  const next = moodOf(inputs, now);
  if (next !== mood) {
    mood = next;
    moodSince = now;
    blinkStart = -1;
    scheduleBlink();
  }
  let blink = -1;
  if (blinkStart >= 0) {
    blink = (now - blinkStart) / BLINK_MS;
    if (blink >= 1) {
      blink = -1;
      blinkStart = -1;
    }
  }
  drawPet(ctx, { mood, elapsed: now - moodSince, blink });

  const fps = isAnimated(mood) ? (ANIMATED_FPS[mood] ?? 30) : blinkStart >= 0 ? 30 : 0;
  if (fps > 0) frameTimer = setTimeout(frame, 1000 / fps);
}

/** 3~7초에 한 번 깜빡인다. 깜빡일 수 없는 상태(잠, 바쁨)에서는 타이머도 걸지 않는다. */
function scheduleBlink() {
  clearTimeout(blinkTimer);
  if (!canBlink(mood)) return;
  blinkTimer = setTimeout(
    () => {
      if (canBlink(mood)) {
        blinkStart = performance.now();
        requestFrame();
      }
      scheduleBlink();
    },
    3000 + Math.random() * 4000,
  );
}

// ---- 화면 배율과 펫 크기 ----
// 모니터를 옮기면 화면 배율(1, 2)이, 크기를 조절하면 창 크기가 바뀐다. 둘 다 캔버스 해상도를 맞춰 다시 그린다.
// 그리기는 늘 160 기준 좌표로 하고 변환으로 키운다.
let viewSize = CANVAS_SIZE;

function fitToScreen() {
  const dpr = window.devicePixelRatio || 1;
  viewSize = window.innerWidth || CANVAS_SIZE;
  canvas.width = Math.round(viewSize * dpr);
  canvas.height = Math.round(viewSize * dpr);
  const k = (dpr * viewSize) / CANVAS_SIZE;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  requestFrame();
}

function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
    'change',
    () => {
      fitToScreen();
      watchPixelRatio();
    },
    { once: true },
  );
}
window.addEventListener('resize', fitToScreen);
watchPixelRatio();
fitToScreen();
scheduleBlink();

// ---- 마우스 ----

const gesture = new GestureTracker();
let overPet = false;

/** 커서 아래 픽셀이 비어 있지 않으면 펫 위다. 투명한 곳은 클릭을 아래 앱으로 넘긴다. */
function hitTest(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= viewSize || y >= viewSize) return false;
  const dpr = canvas.width / viewSize;
  const alpha = ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data[3] ?? 0;
  return alpha > 16;
}

function setOverPet(hit: boolean) {
  if (hit === overPet) return;
  overPet = hit;
  bridge.hover(hit);
}

// 창이 클릭을 통과시키는 동안에도 forward 옵션 덕분에 마우스 이동은 들어온다.
window.addEventListener('mousemove', (e) => {
  if (!gesture.dragging) setOverPet(hitTest(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => {
  if (!gesture.dragging) setOverPet(false);
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
  canvas.setPointerCapture(e.pointerId);
  gesture.down(e.button, e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  const event = gesture.move(e.clientX, e.clientY);
  if (!event) return;
  setInputs({ grabbed: true });
  bridge.gesture(event);
});

canvas.addEventListener('pointerup', (e) => {
  const event = gesture.up(e.button);
  if (!event) return;
  bridge.gesture(event);
  if (event.type === 'drag-end') setInputs({ grabbed: false });
  // 클릭하면 메인이 채팅 창을 연다(패널은 2단계). 펫은 반가워서 잠깐 신난다.
  else setInputs({ excitedUntil: performance.now() + EXCITED_MS });
});

canvas.addEventListener('lostpointercapture', () => {
  const event = gesture.cancel();
  if (!event) return;
  bridge.gesture(event);
  setInputs({ grabbed: false });
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hitTest(e.clientX, e.clientY)) bridge.contextMenu();
});

// 펫 위 휠: Cmd(Ctrl) + 휠이나 트랙패드 핀치(ctrlKey 로 온다)는 크기 조절, 그냥 휠은 아래 창으로.
// 트랙패드는 이벤트가 잘게 많이 오므로 한 프레임(16ms) 동안 모아서 보낸다.
let wheelDelta = 0;
let wheelZoom = false;
let wheelTimer: ReturnType<typeof setTimeout> | undefined;
canvas.addEventListener(
  'wheel',
  (e) => {
    const zoom = e.ctrlKey || e.metaKey;
    if (zoom) e.preventDefault();
    if (wheelTimer && zoom !== wheelZoom) return;
    wheelZoom = zoom;
    wheelDelta += e.deltaY;
    wheelTimer ??= setTimeout(() => {
      bridge.wheel(wheelDelta, wheelZoom);
      wheelDelta = 0;
      wheelTimer = undefined;
    }, 16);
  },
  { passive: false },
);

// ---- 메인이 알려 주는 환경 ----
bridge.onEnv((env) => setInputs({ systemBusy: env.systemBusy, userIdleMs: env.userIdleMs }));
// AI 답을 기다리는 동안 생각 중, 답이 오면 잠깐 말하기 동작.
bridge.onAi((ai) =>
  setInputs({ thinking: ai.thinking, ...(ai.answered ? { talkingUntil: performance.now() + TALK_MS } : {}) }),
);

// 개발용: DevTools 에서 상태를 바꿔 보는 손잡이. 빌드에도 남지만 외부에서 부를 길은 없다.
Object.assign(window, {
  __pet: {
    setInputs,
    get mood() {
      return mood;
    },
  },
});
