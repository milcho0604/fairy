// 이벤트 목록 (docs/server-plan.md 9절, 이슈 #101): 홈페이지 정적 파일 events.json 을 켤 때와 6시간마다 받아 둔다.
// 홈서버가 아니라 홈페이지(Vercel)라 서버가 꺼져도 목록은 보인다. 서버도 계정도 없이 파일만 받으므로 만 14세 미만
// 앱 안 모드에서도 목록은 보인다 (선물 받기 단추만 서버 모드에서). 마지막으로 받은 것은 site-events.json 에 둔다.
import { app, ipcMain, net, type WebContents } from 'electron';
import { EVENTS, type EventList, eventsUrl } from '../shared/events-ipc.ts';
import { EVENTS_MAX_BYTES, parseEvents, type SiteEvent, visibleEvents } from '../shared/site-events.ts';
import { SITE_URL } from '../shared/update-policy.ts';
import { readCapped } from './read-capped.ts';
import { readJson, writeJson } from './store.ts';

const FIRST_MS = 8_000;
const EVERY_MS = 6 * 3_600_000;
const FILE = 'site-events';

export function watchSiteEvents(o: {
  isSettings: (wc: WebContents) => boolean;
  target: () => Electron.BrowserWindow | undefined;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  const url = eventsUrl(SITE_URL, process.env.JJ_EVENTS_URL, app.isPackaged);
  const saved = readJson(FILE) as { text?: unknown; claimed?: unknown } | undefined;
  let events: SiteEvent[] = (typeof saved?.text === 'string' && parseEvents(saved.text)?.events) || [];
  let text = typeof saved?.text === 'string' ? saved.text : '';
  /** 이 컴퓨터에서 받은 선물 (서버가 정본이고, 이건 단추를 "받았어" 로 보이려는 사본) */
  const claimed = new Set<string>(
    Array.isArray(saved?.claimed)
      ? (saved.claimed as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  );

  const save = () => {
    try {
      writeJson(FILE, { text, claimed: [...claimed].slice(-200) });
    } catch (err) {
      o.log('events', '저장 못 함', err instanceof Error ? err.message : String(err));
    }
  };
  const list = (): EventList => ({ events: visibleEvents(events, Date.now()), claimed: [...claimed] });
  const push = () => {
    const w = o.target();
    if (w && !w.isDestroyed()) w.webContents.send(EVENTS.changed, list());
  };

  async function refresh(): Promise<void> {
    try {
      const res = await net.fetch(url, {
        headers: { accept: 'application/json', 'user-agent': `fairy/${app.getVersion()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return o.log('events', '받지 못함', res.status);
      const body = await readCapped(res, EVENTS_MAX_BYTES);
      const parsed = body === undefined ? undefined : parseEvents(body);
      // 깨진 파일이면 지난 목록을 그대로 둔다
      if (!parsed || body === undefined) return o.log('events', '파일을 읽지 못함');
      if (body === text) return;
      text = body;
      events = parsed.events;
      save();
      push();
      o.log('events', '목록 받음', events.length);
    } catch (err) {
      o.log('events', '받기 실패', err instanceof Error ? err.message : String(err));
    }
  }

  ipcMain.handle(EVENTS.list, (e) => (o.isSettings(e.sender) ? list() : undefined));
  setTimeout(() => void refresh(), FIRST_MS).unref();
  setInterval(() => void refresh(), EVERY_MS).unref();

  return {
    refresh,
    list,
    /** 선물을 받았다 (또는 서버가 이미 받았다고 했다) */
    markClaimed(id: string) {
      if (claimed.has(id)) return;
      claimed.add(id);
      save();
      push();
    },
    /** 탈퇴: 이 계정의 받은 기록을 비운다 */
    forgetClaims() {
      claimed.clear();
      save();
      push();
    },
    get events() {
      return events;
    },
  };
}

export type SiteEvents = ReturnType<typeof watchSiteEvents>;
