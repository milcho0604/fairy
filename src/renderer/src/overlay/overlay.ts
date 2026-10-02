import { dragRect, isClick } from '../../../shared/capture.ts';
import type { Point } from '../../../shared/geometry.ts';

// 같이 보기 오버레이. 드래그로 영역을 고르고, 그냥 누르면 이 모니터 전체, Esc 는 취소.
const bridge = window.jjakkungOverlay;
const sel = document.getElementById('sel') as HTMLDivElement;
const size = document.getElementById('size') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;

const name = new URLSearchParams(location.search).get('name') ?? '짝꿍이랑';
hint.textContent = `${name} 같이 볼 곳을 끌어서 골라 줘. 그냥 누르면 이 화면 전체, Esc 는 취소`;

let start: Point | undefined;
let done = false;

const view = () => ({ width: window.innerWidth, height: window.innerHeight });

function draw(end: Point) {
  if (!start) return;
  const r = dragRect(start, end, view());
  sel.hidden = false;
  Object.assign(sel.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  size.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`;
  document.body.classList.toggle('selecting', !isClick(r));
}

function finish(rect: Parameters<typeof bridge.select>[0]) {
  if (done) return;
  done = true;
  sel.hidden = true;
  document.body.style.visibility = 'hidden';
  bridge.select(rect);
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  document.body.setPointerCapture(e.pointerId);
});

window.addEventListener('pointermove', (e) => draw({ x: e.clientX, y: e.clientY }));

window.addEventListener('pointerup', (e) => {
  if (!start || e.button !== 0) return;
  finish(dragRect(start, { x: e.clientX, y: e.clientY }, view()));
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish(null);
});

// 오른쪽 버튼도 취소로 본다.
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  finish(null);
});
