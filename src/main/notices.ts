// 공지 (docs/server-plan.md 23절, 1.6 단계): 홈페이지 정적 파일 notices.json 을 켤 때와 몇 시간마다 받아 공지 창을 띄우고,
// 파일의 minVersion 을 업데이트 확인에 넘긴다 (main/update.ts setNoticeMin). 서버도 계정도 없이 파일만 받는다.
// 판단은 shared/notices.ts, 창은 main/notice-window.ts.
import { app, shell } from 'electron';
import { getLang, t } from '../shared/i18n/index.ts';
import type { NoticeButton, NoticeView } from '../shared/notice-ipc.ts';
import {
  allowedLink,
  forceNotice,
  markConfirmed,
  markShown,
  NOTICES_MAX_BYTES,
  type Notice,
  type NoticeFile,
  type NoticeSeen,
  type NoticeTarget,
  noticesUrl,
  parseNotices,
  pickNotice,
  pruneSeen,
  readSeen,
  sameMinVersion,
} from '../shared/notices.ts';
import { localDay } from '../shared/todo-store.ts';
import { mainFetch } from './net-fetch.ts';
import { createNoticeWindow } from './notice-window.ts';
import { readCapped } from './read-capped.ts';
import { readJson, writeJson } from './store.ts';
import type { AskForce } from './update.ts';

/** 켜고 처음 받는 때 (펫 창이 뜬 뒤), 그 뒤 받는 간격 */
const FIRST_MS = 5_000;
const EVERY_MS = 4 * 3_600_000;
/** 최소 버전을 넘기기 전에 한 번 더 받아 보는 간격 (업데이트 확인과 같다) */
const CONFIRM_MS = 10_000;
/** 미뤄 둔 공지(집중 중, 하루 상한)를 다시 보는 간격 */
const TICK_MS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const SEEN_FILE = 'notices-seen';

type Fetched = { kind: 'ok'; file: NoticeFile } | { kind: 'failed' } | { kind: 'bad' };

export function watchNotices(o: {
  log: (tag: string, ...rest: unknown[]) => void;
  /** 집중 중이면 강제 말고는 미룬다 */
  focusing: () => boolean;
  /** 강제 업데이트로 잠겼는지. 잠긴 동안은 강제 창만 (askForce) */
  locked: () => boolean;
  /** 업데이트 확인이 새 버전을 찾았는지 (권장 공지) */
  newerAvailable: () => boolean;
  /** 두 번 받아 같은 최소 버전 (못 받았거나 없으면 undefined) */
  setMinVersion: (min: string | undefined) => void;
  /** 권장 공지의 업데이트 단추 */
  install: () => void;
  /** 공지를 띄웠다 (쪽지함에 모은다). 강제 업데이트 창은 아니다 */
  onShown?: (n: {
    id: string;
    title: { ko: string; en: string };
    body: { ko: string; en: string };
    link?: string;
  }) => void;
}) {
  const url = noticesUrl(process.env.JJ_NOTICES_URL, app.isPackaged);
  let file: NoticeFile | undefined;
  /** 조건부 요청(If-None-Match)에 쓰는 지난 응답. 304 면 지난 파일을 그대로 쓴다 */
  let etag: string | undefined;
  let cached: NoticeFile | undefined;
  /** 두 번 받아 넘긴 최소 버전 */
  let confirmedMin: string | undefined;
  let seen: NoticeSeen = readSeen(readJson(SEEN_FILE));
  const shownThisRun = new Set<string>();
  /** 공지 창이 답을 기다리는 중 (강제 말고) */
  let busy = false;
  let refreshing = false;

  const save = () => {
    try {
      writeJson(SEEN_FILE, seen);
    } catch (err) {
      o.log('notice', '기록 저장 못 함', err instanceof Error ? err.message : String(err));
    }
  };

  const win = createNoticeWindow({
    openLink: (key) => {
      const n = file?.notices.find((x) => x.id === key);
      // 받을 때 걸렀지만 열기 직전에 한 번 더 본다
      const link = allowedLink(n?.link);
      if (link) void shell.openExternal(link);
    },
    log: o.log,
  });

  async function fetchFile(conditional: boolean): Promise<Fetched> {
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': `fairy/${app.getVersion()}`,
      };
      if (conditional && etag && cached) headers['if-none-match'] = etag;
      const res = await mainFetch(url, {
        headers,
        // 두 번 받기가 첫 응답을 그대로 받지 않게 앱의 HTTP 캐시는 쓰지 않는다. 바뀌었는지는 ETag 로 묻는다
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 304 && cached) return { kind: 'ok', file: cached };
      if (!res.ok) {
        o.log('notice', '받지 못함', res.status);
        return { kind: 'failed' };
      }
      const text = await readCapped(res, NOTICES_MAX_BYTES);
      const parsed = text === undefined ? undefined : parseNotices(text);
      if (!parsed) {
        o.log('notice', '파일을 읽지 못함', text === undefined ? '너무 큼' : '형식');
        return { kind: 'bad' };
      }
      cached = parsed;
      etag = res.headers.get('etag') ?? undefined;
      return { kind: 'ok', file: parsed };
    } catch (err) {
      o.log('notice', '받기 실패', err instanceof Error ? err.message : String(err));
      return { kind: 'failed' };
    }
  }

  function setMin(min: string | undefined) {
    confirmedMin = min;
    o.setMinVersion(min);
  }

  /** 받아서 공지 목록과 최소 버전을 새로 한다. 실패하면 조용히: 아무것도 띄우지 않고 잠그지도 않는다 */
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const first = await fetchFile(true);
      if (first.kind !== 'ok') {
        file = undefined;
        setMin(undefined);
        return;
      }
      file = first.file;
      seen = pruneSeen(seen, first.file);
      save();
      const min = first.file.minVersion;
      if (!min) setMin(undefined);
      else if (min !== confirmedMin) {
        // 한 번 잘못 온 파일(캐시, 잠깐 잘못 올린 값)로 잠기지 않게 따로 한 번 더 받아 같아야 넘긴다
        await wait(CONFIRM_MS);
        const second = await fetchFile(false);
        if (second.kind === 'ok' && sameMinVersion(first.file, second.file)) setMin(min);
        else {
          o.log('notice', '최소 버전이 두 번째와 달라 넘기지 않음');
          setMin(undefined);
        }
      }
    } finally {
      refreshing = false;
    }
    void tick();
  }

  const target = (): NoticeTarget => ({
    version: app.getVersion(),
    platform: process.platform,
    now: Date.now(),
  });
  const text = (v: { ko: string; en: string }) => v[getLang()];

  function viewOf(n: Notice): NoticeView {
    const buttons: NoticeButton[] = [];
    if (n.link) buttons.push({ id: 'link', label: t('notice.link') });
    if (n.kind === 'update')
      buttons.push(
        { id: 'later', label: t('notice.later') },
        { id: 'update', label: t('notice.update'), primary: true },
      );
    else if (n.kind === 'important') buttons.push({ id: 'ok', label: t('notice.ok'), primary: true });
    else buttons.push({ id: 'ok', label: t('notice.close'), primary: true });
    return {
      key: n.id,
      kind: n.kind,
      badge: t(`notice.kind.${n.kind}`),
      title: text(n.title),
      body: text(n.body),
      notes: [],
      buttons,
    };
  }

  /** 띄울 공지가 있으면 하나 띄운다. 잠겼거나, 창이 떠 있거나, 집중 중이면 다음 틱으로 */
  async function tick() {
    if (busy || o.locked() || win.current || !file) return;
    const now = Date.now();
    const n = pickNotice(file.notices, {
      ...target(),
      now,
      today: localDay(now),
      seen,
      shownThisRun,
      newerAvailable: o.newerAvailable(),
      recommendVersion: file.recommendVersion,
      focusing: o.focusing(),
    });
    if (!n) return;
    busy = true;
    try {
      shownThisRun.add(n.id);
      o.onShown?.({ id: n.id, title: n.title, body: n.body, ...(n.link ? { link: n.link } : {}) });
      seen = markShown(seen, n, localDay(now));
      save();
      const answer = await win.show(viewOf(n));
      o.log('notice', '닫힘', n.id, answer ?? '바뀜');
      if (n.kind === 'important' && answer === 'ok') {
        seen = markConfirmed(seen, n.id);
        save();
      }
      if (n.kind === 'update' && answer === 'update') o.install();
    } finally {
      busy = false;
    }
    // 차례를 기다리는 공지가 있으면 잠깐 뒤에
    setTimeout(() => void tick(), 1500).unref?.();
  }

  /** 강제 업데이트 창 (update.ts nag). 공지 파일에 해당하는 강제 공지가 있으면 그 글, 없으면 앱의 기본 글 */
  const askForce: AskForce = async ({ version, min, ready, signal }) => {
    if (signal.aborted) return undefined;
    const fn = file ? forceNotice(file.notices, target()) : undefined;
    const view: NoticeView = {
      key: 'force',
      kind: 'force',
      badge: t('notice.kind.force'),
      title: fn ? text(fn.title) : t('notice.force.title'),
      body: fn ? text(fn.body) : t('notice.force.body'),
      notes: [
        t('notice.force.versions', { current: app.getVersion(), min, latest: version }),
        t('notice.force.escape', { mac: process.platform === 'darwin' }),
      ],
      buttons: [
        ready
          ? { id: 'restart', label: t('main.update.restart'), primary: true }
          : { id: 'get', label: t('main.update.get'), primary: true },
      ],
    };
    const onAbort = () => {
      if (win.current?.kind === 'force') win.close();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const answer = await win.show(view);
      return answer === 'close' ? undefined : answer;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  setTimeout(() => void refresh(), FIRST_MS).unref();
  setInterval(() => void refresh(), EVERY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();

  return {
    askForce,
    refresh,
    tick,
    /** 잠긴 기능을 쓰려 했다: 강제 창이 떠 있으면 다시 앞으로 */
    raise: () => {
      if (win.current?.kind === 'force') win.raise();
    },
    window: win,
    /** 개발용 (메인 디버거의 __jj): 본 기록과 이번 실행 기록을 비운다 (하루 상한을 넘겨 다음 종류를 찍을 때) */
    debugForget() {
      seen = { done: [], shownDay: {} };
      shownThisRun.clear();
      save();
    },
    get file() {
      return file;
    },
    get seen() {
      return seen;
    },
  };
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms).unref?.());
}
