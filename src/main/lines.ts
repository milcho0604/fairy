import { type IpcMainInvokeEvent, ipcMain, type WebContents } from 'electron';
import { dicts, type I18nKey, setLineOverrides } from '../shared/i18n/index.ts';
import {
  buildCatalog,
  buildLinesState,
  isLineLang,
  type LineLang,
  type LineOverrides,
  parseOverrides,
  pruneOverrides,
  resetOverride,
  setOverride,
} from '../shared/lines.ts';
import { LINES, type LineSaveResult, type LinesState } from '../shared/lines-ipc.ts';
import { voiced } from '../shared/persona-voice.ts';
import { readJson, writeJson } from './store.ts';

// 펫 대사 고치기 (#125). 고친 칸만 사용자 데이터 폴더의 speech-lines.json 에 둔다 ({ko: {키: 글}, en: {키: 글}}).
// 기본 대사는 사전(shared/i18n)에 있어 업데이트로 기본이 바뀌어도 이 파일의 칸은 그대로다.
// 시작할 때 지금 사전에 맞춰 정리하고(사라진 키, 값이 안 맞게 된 칸 버림) 말풍선이 쓰는 사전 찾기에 넣는다 (i18n setLineOverrides)

const FILE = 'speech-lines';

let current: LineOverrides = { ko: {}, en: {} };

function apply(): void {
  setLineOverrides(current);
}

/** 시작할 때 한 번: 파일을 읽어 정리하고 말풍선에 쓰게 한다. 버린 칸이 있으면 파일도 고쳐 쓴다 */
let syncRegistered = false;

export function initLines(log?: (tag: string, ...rest: unknown[]) => void): void {
  try {
    const raw = parseOverrides(readJson(FILE));
    current = pruneOverrides(raw, dicts);
    const dropped =
      Object.keys(raw.ko).length +
      Object.keys(raw.en).length -
      (Object.keys(current.ko).length + Object.keys(current.en).length);
    if (dropped > 0) {
      writeJson(FILE, current);
      log?.('lines', '맞지 않게 된 고친 대사를 버림', dropped);
    }
  } catch (err) {
    log?.('lines', '고친 대사 못 읽음', err instanceof Error ? err.message : String(err));
    current = { ko: {}, en: {} };
  }
  apply();
  // 창(preload)이 뜰 때 동기로 묻는다. 창을 만들기 전에 등록해야 하니 시작할 때 한 번만
  if (!syncRegistered) {
    syncRegistered = true;
    ipcMain.on(LINES.sync, (e) => {
      e.returnValue = current;
    });
  }
}

/** 백업 되살리기 등으로 파일이 바뀐 뒤 다시 읽는다 */
export const reloadLines = (): void => initLines();

export interface LinesOptions {
  /** 설정 창에서 온 요청인지 */
  isSettings: (wc: WebContents) => boolean;
  petName: () => string;
  log: (tag: string, ...rest: unknown[]) => void;
}

export function registerLines(o: LinesOptions): void {
  const stateOf = (lang: LineLang): LinesState => buildLinesState(dicts[lang], lang, current, o.petName());
  const ours = (e: IpcMainInvokeEvent) => o.isSettings(e.sender);

  ipcMain.handle(LINES.state, (e, lang: unknown) => {
    if (!ours(e) || !isLineLang(lang)) return undefined;
    return stateOf(lang);
  });

  ipcMain.handle(LINES.save, (e, lang: unknown, key: unknown, text: unknown): LineSaveResult | undefined => {
    if (!ours(e) || !isLineLang(lang) || typeof key !== 'string' || typeof text !== 'string')
      return undefined;
    const def = buildCatalog(dicts[lang]).find((d) => d.key === key);
    if (!def) return { ok: false, reason: 'nokey' };
    const r = setOverride(current, lang, def, text);
    if (!r.ok) {
      const { reason } = r.check;
      return { ok: false, reason, ...('vars' in r.check && r.check.vars ? { vars: r.check.vars } : {}) };
    }
    current = r.overrides;
    writeJson(FILE, current);
    apply();
    o.log('lines', '대사 고침', lang, key);
    return { ok: true, state: stateOf(lang) };
  });

  ipcMain.handle(LINES.reset, (e, lang: unknown, key: unknown) => {
    if (!ours(e) || !isLineLang(lang) || (key !== undefined && typeof key !== 'string')) return undefined;
    current = resetOverride(current, lang, key);
    writeJson(FILE, current);
    apply();
    o.log('lines', '기본 대사로 되돌림', lang, key ?? '전부');
    return stateOf(lang);
  });
}

/** 개발용 손잡이(__jj.lines): 지금 고친 칸 */
export const debugLines = () => ({
  overrides: () => current,
  reload: reloadLines,
  /** 지금 성격 말투와 고친 대사가 합쳐진 말풍선 글 (펫이 그 키로 말할 때 나오는 글) */
  line: (key: string, vars?: Record<string, string | number>) => voiced(key as I18nKey, vars),
});
