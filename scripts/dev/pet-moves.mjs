// 펫 움직임과 입력이 겹칠 때 되풀이 점검 (2026-10-13 버그잡이). 띄워 둔 시험 인스턴스(JJ_NO_FOCUS=1, 빈 JJ_USER_DATA)에 붙는다.
// 진짜 마우스는 쓰지 않는다: 누르기는 CDP 로 화면에 넣고, 끄는 동안 메인이 읽는 커서 자리는 가짜로 바꿔 끼운다.
// 사용자가 자리에 있는 것처럼(유휴 0초) 바꿔 펫이 졸려서 걷기를 마다하지 않게 한다. 끝나면 둘 다 되돌린다.
//   JJ_INSPECT_PORT=<메인> JJ_PAGE_PORT=<화면> node scripts/dev/pet-moves.mjs
import { main, page, sleep } from './cdp.mjs';

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const J = JSON.stringify;
const bounds = async () => JSON.parse(await main('JSON.stringify(__jj.pet.bounds())'));

await main(`(() => {
  const E = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
  globalThis.__petMoves = { E, cursor: E.screen.getCursorScreenPoint, idle: E.powerMonitor.getSystemIdleTime, at: { x: 0, y: 0 } };
  E.screen.getCursorScreenPoint = () => ({ ...globalThis.__petMoves.at });
  E.powerMonitor.getSystemIdleTime = () => 0;
  __jj.settings.set({ friends: [], osNotify: false });
  return 1;
})()`);
const area = JSON.parse(await main('JSON.stringify(__petMoves.E.screen.getDisplayMatching(__jj.pet.bounds()).workArea)'));
const floor = area.y + area.height;
const pet = await page('pet');
// 화면이 유휴 0초를 받을 때까지 (5초마다 온다)
await sleep(6000);

/** 펫 가운데를 눌러 끌기 시작, 가짜 커서를 to 로 옮기며 ms 동안 끌고 놓는다 */
async function drag(to, ms) {
  const c = JSON.parse(
    await pet.ev(
      `(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height * 0.6 }); })()`,
    ),
  );
  const w = JSON.parse(await main('JSON.stringify(__jj.pet.win.getBounds())'));
  await main(`__petMoves.at = ${J({ x: Math.round(w.x + c.x), y: Math.round(w.y + c.y) })}; 1`);
  const m = (type, dx, buttons) =>
    pet.send('Input.dispatchMouseEvent', { type, x: c.x + dx, y: c.y + dx, button: 'left', buttons, clickCount: 1 });
  await m('mouseMoved', 0, 0);
  await m('mousePressed', 0, 1);
  await m('mouseMoved', 12, 1);
  await m('mouseMoved', 24, 1);
  await main(`__petMoves.at = ${J(to)}; 1`);
  await sleep(ms);
  await m('mouseReleased', 24, 0);
}

// 1. 깡충 뛰는 중에 잡으면 뛰기를 멈춘다 (뛴 자리를 저장하지 않고, 끝까지 뛰었다고 하지 않는다)
await main(`__jj.pet.debugMoveTo(300, ${floor}); globalThis.__hop = 'pending'; 1`);
await sleep(300);
await main(`__jj.pet.jumpTo(${area.x + area.width - 300}, ${area.y + 200}).then((v) => (globalThis.__hop = v)); 1`);
await sleep(120);
await drag({ x: area.x + 400, y: floor - 300 }, 900);
await sleep(400);
const hop = await main('String(globalThis.__hop)');
const afterHop = await bounds();
check('뛰는 중에 잡으면 뛰기가 끊긴다', hop === 'false', `뛰기 결과 ${hop}`);
check('놓은 자리에 그대로 있다', Math.abs(afterHop.x - (area.x + 400 - 80)) < 40, J(afterHop));

// 2. 걷는 중에 크기를 바꿔도 화면 밖으로 나가지 않는다
await main(`__jj.pet.setScale(1); __jj.pet.debugMoveTo(${area.x + area.width - 600}, ${floor}); 1`);
// 잡혔다 놓인 기분(내려앉기)이 끝나야 화면이 걷기를 받는다
await sleep(3000);
await main(`__jj.pet.walkTo(${area.x + area.width - 170}, 120); 1`);
let maxRight = 0;
for (let i = 0; i < 28; i++) {
  await sleep(150);
  if (i === 6) await main('__jj.pet.setScale(3); 1');
  const b = await bounds();
  maxRight = Math.max(maxRight, b.x + b.width);
}
// 걷기가 끊겨 안 걸었으면 시험이 아니다: 오른쪽 끝 가까이까지 걸었어야 한다
check('걷다가 커져도 화면 안', maxRight <= area.x + area.width && maxRight > area.x + area.width - 60, `오른쪽 끝 ${maxRight} / 화면 ${area.x + area.width}`);
await main('__jj.pet.setScale(1); 1');

// 3. 끄는 동안 온 답 알림은 놓은 뒤에 뜬다
await main(`__jj.pet.debugMoveTo(${area.x + 600}, ${floor}); globalThis.__ans = 'pending'; 1`);
await sleep(400);
const dragging = drag({ x: area.x + 700, y: floor - 100 }, 1200);
await sleep(500);
await main(
  `__jj.pet.say({ kind: 'answer', text: 'pet-moves', buttons: [{ id: 'open', label: 'open' }], ttlMs: 6000 }).then((v) => (globalThis.__ans = v)); 1`,
);
await dragging;
await sleep(2500);
const shown = await pet.ev(`!document.getElementById('bubble').hidden && document.querySelector('#bubble p').textContent`);
check('끄는 동안 온 답 알림을 놓은 뒤 띄운다', shown === 'pet-moves', `말풍선 ${J(shown)}`);
await pet.ev(`document.getElementById('bubble').click()`);

// 4. 큰 기본 펫 옆에 온 친구는 바닥에 선다, 왼쪽 끝이면 겹치지 않고 오른쪽에 선다
for (const [label, scale, x] of [
  ['큰 펫 옆', 3, area.x + 900],
  ['왼쪽 끝', 1, area.x],
]) {
  await main(`__jj.settings.set({ friends: [] }); __jj.pet.setScale(${scale}); __jj.pet.debugMoveTo(${x}, ${floor}); 1`);
  await sleep(1200);
  await main(
    `__jj.settings.set({ friends: [{ id: 'f-pm0', name: 'pm0', kind: 'cat' }, { id: 'f-pm1', name: 'pm1', kind: 'dog' }] }); 1`,
  );
  await sleep(3000);
  const all = JSON.parse(await main('JSON.stringify([__jj.pet.bounds(), ...__jj.friends.pets().map((p) => p.bounds())])'));
  const onFloor = all.every((b) => b.y + b.height === floor);
  const xs = all.map((b) => b.x);
  check(`친구 자리: ${label}`, onFloor && new Set(xs).size === xs.length, J(all.map((b) => [b.x, b.y + b.height])));
}

// 5. 숨긴 동안 데려온 친구는 혼자 보이지 않는다
await main(`__jj.settings.set({ friends: [] }); __jj.pet.setScale(1); 1`);
await sleep(1200);
await main('__jj.toggleHidden(); 1');
await sleep(600);
await main(`__jj.settings.set({ friends: [{ id: 'f-pm2', name: 'pm2', kind: 'bunny' }] }); 1`);
await sleep(3000);
const visible = JSON.parse(await main('JSON.stringify(__jj.friends.pets().map((p) => p.win.isVisible()))'));
check('숨긴 동안 온 친구는 숨어 있다', visible.length === 1 && !visible[0], J(visible));
await main('__jj.toggleHidden(); 1');
await sleep(800);

await main(`(() => {
  const s = globalThis.__petMoves;
  s.E.screen.getCursorScreenPoint = s.cursor;
  s.E.powerMonitor.getSystemIdleTime = s.idle;
  __jj.settings.set({ friends: [] });
  return 1;
})()`);
console.log(results.every(Boolean) ? 'ALL PASS' : `${results.filter((r) => !r).length} FAIL`);
process.exit(results.every(Boolean) ? 0 : 1);
