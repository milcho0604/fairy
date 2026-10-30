// 채팅 이용권을 쓸 수 있는가, 못 쓰면 왜인가. 화면(AI 고르기)과 메인(보내기 막기)이 같은 판단을 쓴다.
// 조건은 main/server-core.ts 의 aiAvailable 과 같다: 서버 계정, 만 18세 이상, 로그인, 운영자가 열어 둠. 거기에 남은 장수.
import type { AgeAnswer } from '../server-account.ts';

/** 못 쓰는 까닭. 없으면(undefined) 쓸 수 있다 */
export type TicketBlock =
  | 'closed' // 이 앱에 서버가 없거나 운영자가 기능을 꺼 둠
  | 'age' // 만 18세 미만
  | 'serverOff' // 서버 계정을 쓰지 않음 (켜지 않았거나 나이를 아직 안 답함)
  | 'signedOut' // 로그인 안 함
  | 'checking' // 로그인했지만 운영자 설정을 아직 못 받음
  | 'notAllowed' // 운영자가 허락한 계정이 아님
  | 'blocked' // 이 계정만 막힘
  | 'waitlisted' // 자리가 차서 대기 중
  | 'empty'; // 남은 장수 0

export interface TicketGateInput {
  /** 이 빌드에 서버 주소가 있다 */
  enabled: boolean;
  age: AgeAnswer | null;
  /** 서버 계정을 켰고 토큰을 다룰 수 있다 */
  serverReady: boolean;
  signedIn: boolean;
  access: 'ok' | 'off' | 'not_allowed' | 'blocked' | 'waitlisted' | null;
  /** 남은 장수 (아직 모르면 null) */
  tickets: number | null;
}

export function ticketBlock(i: TicketGateInput): TicketBlock | undefined {
  if (!i.enabled) return 'closed';
  if (i.age === 'under14' || i.age === 'teen') return 'age';
  if (!i.serverReady || i.age !== 'adult') return 'serverOff';
  if (!i.signedIn) return 'signedOut';
  if (i.access === null) return 'checking';
  if (i.access === 'off') return 'closed';
  if (i.access === 'not_allowed') return 'notAllowed';
  if (i.access === 'blocked') return 'blocked';
  if (i.access === 'waitlisted') return 'waitlisted';
  if (i.tickets === 0) return 'empty';
  return undefined;
}

/**
 * 이용권으로 보내도 되는가 (메인의 마지막 문). 장수를 아직 모르면(null) 서버가 판단하도록 보낸다.
 * 국외 전송 안내에 "알겠어"를 눌렀는지는 따로 본다 (첫 사용 확인이라 못 쓰는 까닭이 아니다)
 */
export const canSendTicket = (block: TicketBlock | undefined): boolean => block === undefined;

/** 기본으로 고를 만큼 쓸 수 있는가: 막힘이 없고 남은 장수가 1장 이상 */
export const ticketIsDefaultable = (block: TicketBlock | undefined, tickets: number | null): boolean =>
  block === undefined && tickets !== null && tickets > 0;

export type DefaultPick = 'ticket' | 'saved' | 'auto';

/**
 * 새 대화와 처음 켤 때 기본으로 고를 AI.
 * saved: 사용자가 직접 골라 기억해 둔 AI (없으면 undefined), savedUsable: 그 AI 가 지금 설치되어 쓸 수 있다.
 * 직접 고른 AI 가 쓸 수 있으면 그것(saved), 아니면 이용권을 쓸 수 있을 때 이용권(ticket), 그것도 아니면 예전처럼 자동(auto)
 */
export function chooseDefault(i: {
  ticketUsable: boolean;
  saved: string | undefined;
  savedUsable: boolean;
}): DefaultPick {
  if (i.saved && i.savedUsable) return 'saved';
  if (i.ticketUsable) return 'ticket';
  return 'auto';
}
