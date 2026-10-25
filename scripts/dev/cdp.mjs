// 디자인 점검 도우미: 메인 디버거(9229)와 화면(9344)을 다룬다. 다른 포트로 띄웠으면 JJ_INSPECT_PORT, JJ_PAGE_PORT
import { writeFileSync } from 'node:fs';
export const OUT = process.env.OUT;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); r(m); } };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, send };
}

let mainConn;
export async function main(expr) {
  if (!mainConn) { const [t] = await (await fetch(`http://127.0.0.1:${process.env.JJ_INSPECT_PORT ?? 9229}/json/list`)).json(); mainConn = await connect(t.webSocketDebuggerUrl); }
  const m = await mainConn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text);
  return m.result?.result?.value;
}

const pages = {};
/** 재시작/종료 전에 inspector도 닫는다. 연결이 남으면 Node가 debugger 종료를 기다린다. */
export function disconnect() {
  mainConn?.ws.close();
  mainConn = undefined;
  for (const [name, connection] of Object.entries(pages)) {
    connection.ws.close();
    delete pages[name];
  }
}

export async function page(name) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://localhost:${process.env.JJ_PAGE_PORT ?? 9344}/json`)).json();
    const p = list.find((x) => x.type === 'page' && x.url.includes(`${name}.html`));
    if (p) {
      if (pages[name]?.id !== p.id) pages[name] = { id: p.id, ...(await connect(p.webSocketDebuggerUrl)) };
      const c = pages[name];
      return {
        send: c.send,
        ev: async (expr) => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value,
        shot: async (file) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${file}.png`, Buffer.from(r.result.data, 'base64')); },
        dark: async (on) => c.send('Emulation.setEmulatedMedia', { features: on ? [{ name: 'prefers-color-scheme', value: 'dark' }] : [] }),
      };
    }
    await sleep(250);
  }
  throw new Error(`no page ${name}`);
}
