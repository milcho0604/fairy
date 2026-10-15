// 이벤트 목록 통로 (설정 창 ↔ 메인, 이슈 #101). 목록은 홈페이지 정적 파일 events.json 이라 서버 없이도 보인다.
// 판단은 shared/site-events.ts, 받기는 main/site-events.ts.
import type { SiteEvent } from './site-events.ts';

export const EVENTS = {
  /** 설정 → 메인: 지금 보일 이벤트 */
  list: 'site-events:list',
  /** 메인 → 설정: 목록이 바뀌었다 */
  changed: 'site-events:changed',
} as const;

export interface EventList {
  /** 보일 이벤트 (진행 중, 곧, 막 끝남) */
  events: SiteEvent[];
  /** 이 기기 계정(합쳐진 계정 포함)이 이미 받은 선물 이벤트 id */
  claimed: string[];
}

export interface EventsBridge {
  list(): Promise<EventList | undefined>;
  onChanged(listener: (l: EventList) => void): () => void;
}

/** 받을 이벤트 목록 주소. 시험 주소(JJ_EVENTS_URL)는 설치판이 아닌 실행에서 이 컴퓨터 http 일 때만 */
export function eventsUrl(site: string, override: string | undefined, packaged: boolean): string {
  const real = `${site}/events.json`;
  if (!override || packaged) return real;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override) ? override : real;
}
