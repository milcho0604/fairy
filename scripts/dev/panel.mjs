import { main, page, sleep } from './cdp.mjs';
const pet = await page('pet');
console.log('빠른 입력 단축키:', await main("__jj.globalShortcut.isRegistered('CommandOrControl+Alt+Shift+N')"));
// 펫 클릭 → 패널
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
  await pet.send('Input.dispatchMouseEvent', { type, x: 80, y: 110, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
await sleep(2000);
const p = await page('panel');
await p.shot('panel-empty');
const type = async (text) => {
  await p.ev(`document.querySelector('.add input').focus()`);
  await p.send('Input.insertText', { text });
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(300);
};
await type('메일 답장');
await type('내일 보고서 쓰기!');
await type('오늘 장보기');
await type('아주 긴 할 일 제목이 두 줄 넘어가도 줄이 예쁘게 바뀌는지 보려고 일부러 길게 적은 할 일');
console.log('목록:', await p.ev(`[...document.querySelectorAll('.todos .todo')].map(li => li.querySelector('.title').innerText + '[' + li.querySelector('.due').innerText + (li.querySelector('.star.on') ? ',중요' : '') + ']').join(' / ')`));
await p.shot('panel-list');
// 끝내기
await p.ev(`[...document.querySelectorAll('.todos .todo')].find(li => li.innerText.includes('장보기')).querySelector('.check').click()`);
await sleep(400);
console.log('끝낸 뒤 토스트:', await p.ev(`document.querySelector('.toast span')?.innerText`), '/ 코인:', await p.ev(`document.querySelector('.coins').innerText`), '/ 펫:', await pet.ev('__pet.mood'));
await p.shot('panel-toast');
await p.ev(`document.querySelector('.toast .undo').click()`); await sleep(400);
console.log('되돌린 뒤 코인:', await p.ev(`document.querySelector('.coins').innerText`), '/ 남은 할 일:', await p.ev(`document.querySelectorAll('.todos .todo').length`));
// 두 개 끝내고 밥 주기
for (const name of ['장보기', '메일']) { await p.ev(`[...document.querySelectorAll('.todos .todo')].find(li => li.innerText.includes('${name}')).querySelector('.check').click()`); await sleep(300); }
console.log('코인:', await p.ev(`document.querySelector('.coins').innerText`));
await p.ev(`document.querySelector('.fullness button').click()`); await sleep(600);
console.log('밥 준 뒤 코인:', await p.ev(`document.querySelector('.coins').innerText`), '/ 배부름:', await p.ev(`document.querySelector('.fullness .value').innerText`));
await p.ev(`document.querySelector('.done-toggle').click()`); await sleep(200);
await p.shot('panel-done'); await p.dark(true); await sleep(200); await p.shot('panel-dark'); await p.dark(false);
console.log('펫 말풍선:', await pet.ev(`document.querySelector('#bubble').hidden ? '(없음)' : document.querySelector('#bubble p').textContent`));
// 빠른 입력
await main('__jj.panel.openQuick(); 1'); await sleep(1500);
const q = await page('quick');
await q.shot('quick');
await q.ev(`document.querySelector('input').focus()`);
await q.send('Input.insertText', { text: '모레 운동하기!' });
await q.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(1200);
console.log('빠른 입력 뒤 창:', await main('!!__jj.panel.quickWindow'), '/ 저장소:', await main(`JSON.stringify(__jj.store.list(Date.now()).open.map(t => [t.title, t.due, t.important]))`));
process.exit(0);
