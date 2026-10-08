// 두더지 잡기 놀이 창 그림: 구멍 여섯 개, 가짜(돌멩이, 나뭇잎), 점수와 남은 시간, 잡았을 때 별.
// 펫은 여기 그리지 않는다 (펫 창이 이 창 위에서 구멍을 옮겨 다닌다). 스크립트 없는 창이라 메인이 class 만 바꾼다.
import { MOLE, type MoleField } from '../shared/minigames.ts';

/** 가짜가 솟는 칸 (구멍 가운데 기준) */
export function decoyBox(f: MoleField): { w: number; h: number } {
  return { w: Math.round(f.holeW * 0.5), h: Math.round(f.holeW * 0.46) };
}

const PEBBLE = `<svg class="pebble" viewBox="0 0 60 56"><path d="M8 46c-4-10 1-24 13-29 9-4 22-3 29 5 7 8 6 20-1 26-8 6-34 7-41-2z" fill="#a8a29e" stroke="#78716c" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 26c4-4 10-5 15-4" fill="none" stroke="#e7e5e4" stroke-width="3" stroke-linecap="round"/><ellipse cx="38" cy="38" rx="4" ry="2.6" fill="#8b8580"/><ellipse cx="22" cy="42" rx="2.6" ry="1.8" fill="#8b8580"/><path d="M30 17c-1-6 2-11 8-13-1 6-3 10-8 13z" fill="#7cc06b" stroke="#4d8b3d" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const LEAF = `<svg class="leaf" viewBox="0 0 60 56"><path d="M30 54C14 46 8 30 14 14c10 2 26 4 32 16 5 11-4 20-16 24z" fill="#86c66f" stroke="#4d8b3d" stroke-width="2.4" stroke-linejoin="round"/><path d="M30 54C28 40 24 28 16 17M24 34l-7-3M27 43l-8 0M27 28l3-8M29 38l8-6" fill="none" stroke="#4d8b3d" stroke-width="1.8" stroke-linecap="round"/><path d="M44 18c3-6 8-8 12-8-1 5-5 9-12 8z" fill="#a8d88f" stroke="#4d8b3d" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/** 구멍 하나: 흙 둔덕과 어두운 구멍(뒤), 가짜가 솟는 칸, 앞 둔덕(가짜 아랫부분을 가린다), 잡았을 때 별과 +1 (펫 창에 가리지 않게 오른쪽 위) */
function hole(f: MoleField, i: number): string {
  const h = f.holes[i] ?? { x: 0, y: 0 };
  const x = h.x - f.rect.x;
  const y = h.y - f.rect.y;
  const W = f.holeW;
  const H = f.holeH;
  const R = W / 2;
  const r = H / 2;
  // 구멍(어두운 곳)은 둔덕 안쪽 위
  const a = R * 0.74;
  const b = r * 0.62;
  const c = -r * 0.1;
  const box = decoyBox(f);
  const vb = `${-R} ${-r} ${W} ${H}`;
  const back = `<svg class="bk" viewBox="${vb}" style="left:${-R}px;top:${-r}px;width:${W}px;height:${H}px"><ellipse rx="${R - 1}" ry="${r - 1}" fill="#c9a07a" stroke="#a87d55" stroke-width="2"/><ellipse cy="${c}" rx="${a}" ry="${b}" fill="#3b2a20"/><ellipse cy="${c - b * 0.25}" rx="${a * 0.82}" ry="${b * 0.6}" fill="#24180f"/></svg>`;
  // 앞 둔덕: 구멍 아래 반원에서 둔덕 아래 반원까지
  const lip = `M${-a} ${c}A${a} ${b} 0 0 0 ${a} ${c}L${R - 1} 0A${R - 1} ${r - 1} 0 0 1 ${-(R - 1)} 0Z`;
  const front = `<svg class="fr" viewBox="${vb}" style="left:${-R}px;top:${-r}px;width:${W}px;height:${H}px"><path d="${lip}" fill="#c9a07a" stroke="#a87d55" stroke-width="2" stroke-linejoin="round"/><path d="M${-R * 0.55} ${r * 0.55}q${R * 0.2} ${r * 0.18} ${R * 0.42} 0" fill="none" stroke="#e2c4a2" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pit = `<div class="pit" style="left:${-box.w / 2}px;top:${c - box.h}px;width:${box.w}px;height:${box.h + b * 0.4}px"><div class="d" style="height:${box.h}px">${PEBBLE}${LEAF}</div></div>`;
  const fx = `<div class="fx" id="x${i}" style="left:${R * 0.3}px;top:${-r - W * 0.55}px;width:${R}px;height:${W * 0.55}px"><svg class="st" viewBox="-30 -30 60 60"><g stroke="#fbbf24" stroke-width="3.2" stroke-linecap="round"><path d="M0-26v8M0 18v8M-26 0h8M18 0h8M-18-18l5 5M13 13l5 5M18-18l-5 5M-13 13l-5 5"/></g></svg><b class="p">+1</b><b class="m">-1</b></div>`;
  return `<div class="h" id="h${i}" style="left:${x}px;top:${y}px">${back}${pit}${front}${fx}</div>`;
}

export function moleBody(f: MoleField): string {
  const holes = f.holes.map((_, i) => hole(f, i)).join('');
  const paw = `<svg viewBox="0 0 24 24"><g fill="#8a5a33"><ellipse cx="12" cy="16" rx="5.4" ry="4.4"/><circle cx="5.6" cy="10.4" r="2.3"/><circle cx="9.6" cy="6.6" r="2.3"/><circle cx="14.4" cy="6.6" r="2.3"/><circle cx="18.4" cy="10.4" r="2.3"/></g></svg>`;
  return `<div class="hd">${paw}<span id="n">0</span><i class="bar"><i></i></i></div>${holes}`;
}

export const MOLE_CSS = `
body{font:700 15px/1 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif}
.hd{position:absolute;left:50%;top:2px;transform:translateX(-50%);height:${MOLE.header - 6}px;display:flex;align-items:center;gap:6px;padding:0 10px 0 7px;border-radius:999px;background:rgba(255,251,245,.92);box-shadow:0 1px 4px rgba(60,40,20,.28);color:#5b3a1e}
.hd svg{width:16px;height:16px}
.hd span{min-width:1.2em;text-align:center;font-variant-numeric:tabular-nums}
.bar{display:block;width:64px;height:6px;border-radius:3px;background:#ead9c6;overflow:hidden}
.bar i{display:block;height:100%;background:#d08a4c;transform-origin:left;animation:time ${MOLE.ms}ms linear forwards paused}
body.go .bar i{animation-play-state:running}
.h{position:absolute;width:0;height:0}
.h>*{position:absolute}
.pit{overflow:hidden}
.d{position:absolute;left:0;right:0;top:0;transform:translateY(105%);transition:transform .16s ease-out}
.d svg{display:none;width:100%;height:100%}
.h.on .d{transform:none}
.h[data-k=pebble] .pebble,.h[data-k=leaf] .leaf{display:block}
.h.on.oops .d{animation:shake .32s ease-in-out}
.fx{pointer-events:none;display:flex;align-items:center;justify-content:center}
.fx>*{position:absolute;opacity:0}
.fx .st{width:56%;height:auto}
.fx b{font-size:20px;text-shadow:0 1px 0 #fff,0 0 4px #fff}
.fx .p{color:#d97706}
.fx .m{color:#78716c}
.fx.hit .st{animation:spark .4s ease-out}
.fx.hit .p,.fx.oops .m{animation:up .7s ease-out}
@keyframes time{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@keyframes spark{0%{opacity:1;transform:scale(.5)}100%{opacity:0;transform:scale(1.3)}}
@keyframes up{0%{opacity:1;transform:translateY(8px)}70%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
@keyframes shake{0%,100%{transform:none}25%{transform:translateX(-5px) rotate(-6deg)}75%{transform:translateX(5px) rotate(6deg)}}
@keyframes fade{0%,70%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){
.d{transition:none}
.h.on.oops .d{animation:none}
.fx.hit .st{animation:none}
.fx.hit .p,.fx.oops .m{animation:fade .7s linear}
}`;
