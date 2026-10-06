import { net } from 'electron';
import type { EventStore } from '../shared/event-store.ts';
import { cleanIcsUrl, parseIcs } from '../shared/ics.ts';
import { settings } from './settings.ts';

const EVERY_MS = 30 * 60_000;
const BACK_MS = 86_400_000;
const AHEAD_MS = 60 * 86_400_000;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * 캘린더 가져오기 (v2): 설정의 .ics 주소(구글 캘린더 비공개 주소 등)를 30분마다 읽어 일정에 맞춘다.
 * 어제부터 60일 뒤까지. 주소는 비밀이라 로그에 남기지 않는다.
 */
export function watchCalendar(o: {
  events: EventStore;
  onChanged: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let last = '';

  const done = (msg: string) => {
    last = msg;
    return msg;
  };

  async function sync(): Promise<string> {
    const raw = settings.get().icsUrl;
    if (!raw) return '캘린더 주소가 없어';
    const url = cleanIcsUrl(raw);
    if (!url) return '주소가 https 가 아니야';
    try {
      const res = await net.fetch(url, { headers: { accept: 'text/calendar' } });
      if (!res.ok) return done(`가져오지 못했어 (${res.status})`);
      const text = await res.text();
      if (text.length > MAX_BYTES) return done('캘린더가 너무 커');
      if (!text.includes('BEGIN:VCALENDAR')) return done('캘린더 파일이 아니야. 주소를 확인해 줘');
      const now = Date.now();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const list = parseIcs(text, tz, now - BACK_MS, now + AHEAD_MS);
      const r = o.events.syncExternal('ics', list, now - BACK_MS, now + AHEAD_MS, now);
      o.log('calendar', '맞춤', JSON.stringify(r));
      if (r.added || r.updated || r.removed) o.onChanged();
      return done(`일정 ${list.length}개 (새로 ${r.added}, 바뀜 ${r.updated}, 지움 ${r.removed})`);
    } catch (err) {
      o.log('calendar', '실패', err instanceof Error ? err.name : 'error');
      return done('가져오지 못했어 (인터넷 연결을 봐 줘)');
    }
  }

  setTimeout(() => void sync(), 20_000).unref();
  setInterval(() => void sync(), EVERY_MS).unref();
  return {
    sync,
    get last() {
      return last;
    },
  };
}
