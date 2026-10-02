import { main, page, sleep } from './cdp.mjs';
const pet = await page('pet');
const say = (text, buttons) => main(`__jj.pet.say({ kind: 'answer', text: ${JSON.stringify(text)}, buttons: ${JSON.stringify(buttons)}, ttlMs: 60000 }); 1`);
const long = '답 왔어: 이건 아주 긴 답의 앞부분이야. 말풍선이 세 줄 넘게 늘어날 때 어떻게 보이는지 확인하려고 일부러 길게 썼어.';
const two = [{ id: 'open', label: '보기' }, { id: 'later', label: '나중에' }];
const orig = await main('__jj.pet.bounds()');
const shots = [
  ['mid', -800, 600, 1, long, two],
  ['short', -800, 600, 1, '컴퓨터가 바빠 보여서 잠깐 가만히 있을게.', []],
  ['top', -800, 40, 1, long, two],
  ['left', -1512, 700, 1, long, two],
  ['right', -160, 700, 1, long, two],
  ['small', -800, 700, 0.5, long, two],
  ['big', -800, 400, 3, '답 왔어: 큰 펫', two],
];
for (const [name, x, y, scale, text, buttons] of shots) {
  await main(`__jj.pet.debugScale(${scale}); __jj.pet.debugMoveTo(${x}, ${y}); 1`);
  await sleep(300);
  await say(text, buttons);
  await sleep(700);
  const b = await main('JSON.stringify([__jj.pet.win.getBounds(), __jj.pet.bounds()])');
  console.log(name, b);
  await pet.shot(`pet-${name}-light`);
  if (name === 'mid' || name === 'top') { await pet.dark(true); await sleep(200); await pet.shot(`pet-${name}-dark`); await pet.dark(false); }
  await pet.ev(`document.getElementById('bubble').click()`);
  await sleep(300);
}
// 50% 크기에서 상태별 모습
await main(`__jj.pet.debugScale(0.5); __jj.pet.debugMoveTo(-800, 700); 1`);
await sleep(300);
const base = '{hidden:false,grabbed:false,thinking:false,talkingUntil:0,systemBusy:false,excitedUntil:0,userIdleMs:0,focusTimer:false,sulkLevel:0}';
for (const [name, patch] of [['busy', '{systemBusy:true}'], ['sleep', '{userIdleMs:600000}'], ['think', '{thinking:true}']]) {
  await pet.ev(`__pet.setInputs(Object.assign(${base}, ${patch}))`);
  await sleep(1300);
  await pet.shot(`mood50-${name}`);
}
await pet.ev(`__pet.setInputs(${base})`);
await main(`__jj.pet.debugScale(1); __jj.pet.debugMoveTo(${orig.x}, ${orig.y}); 1`);
process.exit(0);
