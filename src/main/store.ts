import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { type JsonTrouble, readJsonFile, writeJsonFile } from './json-file.ts';

// 작은 JSON 저장소. 파일은 사용자 데이터 폴더에 둔다. 쓰기와 읽기는 json-file.ts 한 곳이 맡는다
// (fsync 하고 이름 바꾸기, 깨진 파일은 옆으로 옮기고 알린다).

function pathOf(name: string): string {
  return join(app.getPath('userData'), `${name}.json`);
}

/** 잘 읽은 마지막 내용을 <이름>.json.bak 으로 남기는 파일 (깨지면 그것으로 되살린다) */
const KEEP_BAK = new Set(['settings', 'planner', 'chat-settings', 'ai-custom', 'server-state']);

/** 깨진 파일을 만난 일. 듣는 쪽(펫 말풍선)이 붙기 전에 생긴 것은 모아 뒀다 붙을 때 준다 */
const troubles: JsonTrouble[] = [];
let troubleListener: ((t: JsonTrouble) => void) | undefined;

function report(t: JsonTrouble): void {
  if (troubleListener) troubleListener(t);
  else troubles.push(t);
}

/** 깨진 저장 파일을 알린다 (index.ts 가 펫 말풍선으로). 붙기 전에 생긴 것도 바로 준다 */
export function onJsonTrouble(listener: (t: JsonTrouble) => void): void {
  troubleListener = listener;
  for (const t of troubles.splice(0)) listener(t);
}

/** 없거나 깨졌으면 undefined (깨졌으면 옆으로 옮기고 알린다. .bak 이 있으면 그 값). 내용 검사는 부르는 쪽이 한다. */
export function readJson(name: string): unknown {
  const r = readJsonFile(pathOf(name), { keepBak: KEEP_BAK.has(name) });
  if (r.trouble) report(r.trouble);
  return r.value;
}

/** 임시 파일에 쓰고 fsync 한 뒤 이름을 바꿔, 쓰다가 꺼져도 파일이 반쯤 깨지지 않게 한다. */
export function writeJson(name: string, value: unknown): void {
  writeJsonFile(pathOf(name), value);
}

/** 지운다. 없으면 그냥 넘어간다 (떠난 친구 펫의 위치 파일 등) */
export function removeJson(name: string): void {
  rmSync(pathOf(name), { force: true });
}
