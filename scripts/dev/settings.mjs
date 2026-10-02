import { main, page, sleep } from './cdp.mjs';
await main('__jj.chat.open(__jj.pet.bounds()); __jj.settingsWindow.open(); 1');
await sleep(2500);
const st = await page('settings');
await st.shot('settings-light'); await st.dark(true); await sleep(200); await st.shot('settings-dark'); await st.dark(false);
await main('__jj.settingsWindow.window.setSize(360, 560); 1'); await sleep(400); await st.shot('settings-narrow');
await main('__jj.settingsWindow.window.setSize(440, 620); 1'); await sleep(300);
const over = await st.ev(`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.tagName + '.' + e.className).slice(0,5).join(', ')`);
console.log('가로 넘침:', over || '없음');
// 이름 바꾸기: 입력칸 비우고 "밤" 입력 뒤 Enter
await st.ev(`(() => { const i = document.querySelector('.field input'); i.focus(); i.select(); })()`);
await st.send('Input.insertText', { text: '밤' });
await st.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(800);
console.log('설정의 이름:', await main('__jj.settings.get().petName'));
console.log('채팅 창 제목:', await main('__jj.chat.window.getTitle()'));
const chat = await page('chat');
console.log('채팅 창 빈 화면 안내:', (await chat.ev(`document.querySelector('.empty .hint')?.innerText`))?.slice(0, 30));
console.log('설정 창 미리보기:', await st.ev(`document.querySelector('.field small').innerText.slice(0, 40)`));
// 크기 슬라이더
await st.ev(`(() => { const r = document.querySelector('input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '1.5'); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(600);
console.log('슬라이더 1.5 뒤 펫 크기:', await main('JSON.stringify(__jj.pet.bounds())'));
// 돌아다니기 끄기
await st.ev(`document.querySelector('[role=switch]').click()`); await sleep(400);
console.log('돌아다니기:', await main('__jj.settings.get().wander'));
const petPage = await page('pet');
const before = await main('__jj.pet.bounds().x');
await petPage.ev('__pet.requestActivity()'); await sleep(1500);
console.log('돌아다니기 끈 뒤 행동 요청: x', before, '→', await main('__jj.pet.bounds().x'));
await st.shot('settings-after');
// 되돌리기
await main(`__jj.settings.set({ petName: '콩이', wander: true }); __jj.pet.setScale(1); 1`);
await sleep(300);
console.log('되돌림:', await main('JSON.stringify(__jj.settings.get())'));
process.exit(0);
