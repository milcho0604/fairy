import { cleanIcsUrl } from '../../../shared/ics.ts';

/** 설정 검사(shared/settings.ts icsOf)가 받는 주소 길이 상한과 같다 */
const ICS_URL_MAX = 2000;

/**
 * 캘린더 주소 칸에 넣은 글을 어떻게 할지 (설정 창 비서 탭).
 * 설정 검사는 https 가 아닌 주소를 조용히 버린다. 그대로 보내면 화면에는 "저장했어"가 뜨고
 * 칸에는 틀린 주소가 남은 채 옛 주소로 계속 가져왔다. 보내기 전에 같은 기준(cleanIcsUrl)으로 본다
 */
export type IcsInput = { kind: 'same' } | { kind: 'clear' } | { kind: 'save'; url: string } | { kind: 'bad' };

export function icsInput(value: string, saved: string | undefined): IcsInput {
  const raw = value.trim();
  if (!raw) return saved ? { kind: 'clear' } : { kind: 'same' };
  const url = raw.length < ICS_URL_MAX ? cleanIcsUrl(raw) : undefined;
  if (!url) return { kind: 'bad' };
  return url === saved ? { kind: 'same' } : { kind: 'save', url };
}
