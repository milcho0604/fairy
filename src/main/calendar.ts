import { net } from 'electron';
import type { EventStore } from '../shared/event-store.ts';
import { t } from '../shared/i18n/index.ts';
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
    if (!raw) return t('panel.calendar.noUrl');
    const url = cleanIcsUrl(raw);
    if (!url) return t('panel.calendar.notHttps');
    try {
      const res = await net.fetch(url, { headers: { accept: 'text/calendar' } });
      if (!res.ok) return done(t('panel.calendar.failedStatus', { status: res.status }));
      const text = await res.text();
      if (text.length > MAX_BYTES) return done(t('panel.calendar.tooBig'));
      if (!text.includes('BEGIN:VCALENDAR')) return done(t('panel.calendar.notIcs'));
      const now = Date.now();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const list = parseIcs(text, tz, now - BACK_MS, now + AHEAD_MS);
      const r = o.events.syncExternal('ics', list, now - BACK_MS, now + AHEAD_MS, now);
      o.log('calendar', '맞춤', JSON.stringify(r));
      if (r.added || r.updated || r.removed) o.onChanged();
      return done(
        t('panel.calendar.synced', {
          n: list.length,
          added: r.added,
          updated: r.updated,
          removed: r.removed,
        }),
      );
    } catch (err) {
      o.log('calendar', '실패', err instanceof Error ? err.name : 'error');
      return done(t('panel.calendar.offline'));
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
