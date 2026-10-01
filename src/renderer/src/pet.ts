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

// ---- 화면 배율 ----
// 모니터를 옮기면 배율(1, 2)이 바뀐다. 그때 캔버스 해상도를 맞춰 다시 그린다.
function fitToScreen() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_SIZE * dpr;
  canvas.height = CANVAS_SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestFrame();
  matchMedia(`(resolution: ${dpr}dppx)`).addEventListener('change', fitToScreen, { once: true });
}
fitToScreen();
scheduleBlink();

// ---- 마우스 ----

const gesture = new GestureTracker();
let overPet = false;

/** 커서 아래 픽셀이 비어 있지 않으면 펫 위다. 투명한 곳은 클릭을 아래 앱으로 넘긴다. */
function hitTest(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return false;
  const dpr = canvas.width / CANVAS_SIZE;
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
  // 패널(2단계)이 생기기 전까지 클릭하면 신난다.
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

// ---- 메인이 알려 주는 환경 ----
bridge.onEnv((env) => setInputs({ systemBusy: env.systemBusy, userIdleMs: env.userIdleMs }));

// 개발용: DevTools 에서 상태를 바꿔 보는 손잡이. 빌드에도 남지만 외부에서 부를 길은 없다.
Object.assign(window, {
  __pet: {
    setInputs,
    get mood() {
      return mood;
    },
  },
});
