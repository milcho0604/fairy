import { main, page, sleep } from './cdp.mjs';
const PHOTO = process.env.PHOTO;
await main('__jj.maker.open(); 1');
await sleep(2000);
const m = await page('maker');
await m.shot('maker-pick');
const doc = await m.send('DOM.getDocument', {});
const q = await m.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
const t0 = Date.now();
await m.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [PHOTO] });
let lastPct = -1;
for (let i = 0; i < 600; i++) {
  await sleep(500);
  const state = await m.ev(`document.querySelector('.steps li.on')?.innerText.replace(/\\n/g,'') + '|' + (document.querySelector('.bar i')?.style.width ?? '') + '|' + (document.querySelector('.error')?.innerText ?? '')`);
  const [stepName, pct, err] = state.split('|');
  if (err) { console.log('오류:', err); break; }
  if (pct && pct !== lastPct && (Math.round(parseFloat(pct)) % 25 === 0)) { console.log(`받는 중 ${Math.round(parseFloat(pct))}% (${Math.round((Date.now() - t0) / 1000)}초)`); lastPct = pct; }
  if (await m.ev(`!!document.querySelector('.edit canvas')`)) { console.log(`다듬기 화면 (${Math.round((Date.now() - t0) / 1000)}초):`, await m.ev(`document.querySelector('.edit .hint').innerText.slice(-20)`)); break; }
}
await sleep(500);
await m.shot('maker-edit');
// 지우개로 왼쪽 위를 한 번 긁는다
const r = await m.ev(`(() => { const b = document.querySelector('.edit canvas').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`);
const [x, y, w, h] = r;
const mouse = (type, px, py) => m.send('Input.dispatchMouseEvent', { type, x: px, y: py, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await mouse('mousePressed', x + w * 0.05, y + h * 0.1);
for (let i = 1; i <= 10; i++) await mouse('mouseMoved', x + w * (0.05 + i * 0.03), y + h * 0.1);
await mouse('mouseReleased', x + w * 0.35, y + h * 0.1);
await sleep(300);
console.log('되돌리기 버튼 켜짐:', await m.ev(`![...document.querySelectorAll('.tools .ghost')].at(-1).disabled`));
await m.ev(`[...document.querySelectorAll('.actions .primary')].at(-1).click()`);
await sleep(800);
await m.shot('maker-name');
await m.ev(`document.querySelector('.name input').select()`);
await m.send('Input.insertText', { text: '까망이' });
await m.ev(`document.querySelector('.name .primary').click()`);
await sleep(1500);
console.log('완료 글:', await m.ev(`document.querySelector('.done')?.innerText`));
console.log('설정:', await main(`JSON.stringify({ name: __jj.settings.get().petName, image: __jj.settings.get().petImage })`));
await sleep(1500);
const pet = await page('pet');
await pet.shot('pet-photo');
process.exit(0);
