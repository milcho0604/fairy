import { net } from 'electron';
import type { EventStore } from '../shared/event-store.ts';
import { t } from '../shared/i18n/index.ts';
import {
  CAL_FAIL_START,
  calFailStep,
  calStatusResult,
  calTellNow,
  cleanIcsUrl,
  parseIcs,
} from '../shared/ics.ts';
import { readCapped } from './read-capped.ts';
import { settings } from './settings.ts';

const EVERY_MS = 30 * 60_000;
const BACK_MS = 86_400_000;
const AHEAD_MS = 60 * 86_400_000;
const MAX_BYTES = 10 * 1024 * 1024;
/** 응답이 이만큼 안 끝나면 그만둔다 (버그잡이 7차: 걸린 연결이 끝없이 매달렸다) */
const TIMEOUT_MS = 20_000;

/**
 * 캘린더 가져오기 (v2): 설정의 .ics 주소(구글 캘린더 비공개 주소 등)를 30분마다 읽어 일정에 맞춘다.
 * 어제부터 60일 뒤까지. 주소는 비밀이라 로그에 남기지 않는다.
 */
export function watchCalendar(o: {
  events: EventStore;
  onChanged: () => void;
  /** 연달아 못 읽었다 (CAL_FAIL_TELL 번째에 한 번). 펫이 알리고 설정을 열 수 있게 한다 */
  onBroken?: () => void;
  /** 지금은 알리지 않는다 (설정 창이 열려 있으면 거기서 결과를 이미 본다) */
  quiet?: () => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let last = '';
  /** 연달아 못 읽은 수 (calFailStep). 앱을 다시 켜면 처음부터 */
  let fails = CAL_FAIL_START;

  /** byUser: 사용자가 설정에서 누르거나 주소를 바꾼 것. 결과 글을 바로 보니 펫이 또 알리지 않는다 */
  const finish = (msg: string, result: 'ok' | 'offline' | 'fail', byUser: boolean) => {
    last = msg;
    const step = calFailStep(fails, result);
    fails = step.state;
    if (step.tell) {
      o.log('calendar', '계속 못 읽음', fails.n);
      if (calTellNow(true, { byUser, settingsOpen: !!o.quiet?.() })) o.onBroken?.();
    }
    return msg;
  };

  async function sync(byUser = false): Promise<string> {
    const done = (msg: string, result: 'ok' | 'offline' | 'fail' = 'fail') => finish(msg, result, byUser);
    const raw = settings.get().icsUrl;
    if (!raw) return t('panel.calendar.noUrl');
    const url = cleanIcsUrl(raw);
    if (!url) return t('panel.calendar.notHttps');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    // 받기와 다루기를 나눈다: 받다가 난 오류(인터넷 끊김, 시간 끝)만 캘린더 탓이 아니고,
    // 읽거나 맞추다 난 오류는 센다 (리뷰 LOW: 예전에는 무엇이 던져도 인터넷 끊김으로 보아 조용히 넘어갔다)
    let text: string | undefined;
    try {
      const res = await net.fetch(url, { headers: { accept: 'text/calendar' }, signal: ac.signal });
      if (!res.ok)
        return done(t('panel.calendar.failedStatus', { status: res.status }), calStatusResult(res.status));
      // 다 받은 뒤 재지 않고 받으면서 잰다: 상한을 넘으면 그 자리에서 끊는다
      text = await readCapped(res, MAX_BYTES);
    } catch (err) {
      o.log('calendar', '실패', err instanceof Error ? err.name : 'error');
      return done(t('panel.calendar.offline'), 'offline');
    } finally {
      clearTimeout(timer);
    }
    if (text === undefined) return done(t('panel.calendar.tooBig'));
    if (!text.includes('BEGIN:VCALENDAR')) return done(t('panel.calendar.notIcs'));
    // 받는 사이 주소를 바꾸거나 지웠으면 옛 주소의 일정으로 맞추지 않는다 (늦게 온 옛 응답이 새 캘린더 일정을 지웠다)
    // 이 결과 글은 남기지 않는다 (새 주소의 맞추기가 따로 알린다)
    if (settings.get().icsUrl !== raw) return settings.get().icsUrl ? last : t('panel.calendar.noUrl');
    try {
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
        'ok',
      );
    } catch (err) {
      o.log('calendar', '읽기 실패', err instanceof Error ? err.name : 'error');
      return done(t('panel.calendar.notIcs'));
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
