import { dragRect, isClick } from '../../../shared/capture.ts';
import type { Point } from '../../../shared/geometry.ts';
import { t } from '../../../shared/i18n/index.ts';
import { initLang } from '../lang.ts';

initLang('common.title.overlay');

// 같이 보기 오버레이. 드래그로 영역을 고르고, 그냥 누르면 이 모니터 전체, Esc 는 취소.
const bridge = window.jjakkungOverlay;
const sel = document.getElementById('sel') as HTMLDivElement;
const size = document.getElementById('size') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;

const name = new URLSearchParams(location.search).get('name') ?? t('common.appName');
const updateHint = () => {
  hint.textContent = t('chat.look.hint', { name });
};
updateHint();
window.jjakkungLanguage.onChanged(updateHint);

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
