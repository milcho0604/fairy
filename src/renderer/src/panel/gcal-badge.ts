// 일정 줄의 구글 표식: 구글로 보낸 일정, 보내는 중, 구글이 받지 않음, 페어리에만 있음, 캘린더에서 가져옴, 구글에서 가져옴.
// 표식(GcalMark)은 메인이 저장 파일에서 정한다 (main/gcal.ts marks). 여기는 글과 툴팁만 고른다.
import type { EventSource } from '../../../shared/event-store.ts';
import type { GcalMark, GcalProblem } from '../../../shared/gcal.ts';
import { t } from '../../../shared/i18n/index.ts';

export type GcalBadgeKind = GcalMark | 'imported' | 'fromGoogle';

export interface GcalBadge {
  kind: GcalBadgeKind;
  label: string;
  tip: string;
}

/**
 * source 가 ics(캘린더 가져오기)면 연결과 상관없이 "가져옴", google(구글에서 읽어 옴)이면 "구글에서".
 * 짝꿍 일정은 표식이 있을 때만 (구글에 연결했을 때).
 * 보내는 중의 툴팁은 멈춘 까닭에 따라: 인터넷이 안 됨, 연결이나 캘린더 문제(설정을 봐 달라), 그냥 차례를 기다림
 */
export function gcalBadge(
  source: EventSource,
  mark: GcalMark | undefined,
  problem: GcalProblem | null | undefined,
): GcalBadge | null {
  if (source === 'google')
    return { kind: 'fromGoogle', label: t('gcal.mark.fromGoogle'), tip: t('gcal.mark.fromGoogleTip') };
  if (source === 'ics')
    return { kind: 'imported', label: t('gcal.mark.imported'), tip: t('gcal.mark.importedTip') };
  switch (mark) {
    case 'sent':
      return { kind: 'sent', label: t('gcal.mark.sent'), tip: t('gcal.mark.sentTip') };
    case 'pending':
      return {
        kind: 'pending',
        label: t('gcal.mark.pending'),
        tip: t(
          problem === 'offline'
            ? 'gcal.mark.offlineTip'
            : problem
              ? 'gcal.mark.stuckTip'
              : 'gcal.mark.pendingTip',
        ),
      };
    case 'failed':
      return { kind: 'failed', label: t('gcal.mark.failed'), tip: t('gcal.mark.failedTip') };
    case 'local':
      return { kind: 'local', label: t('gcal.mark.local'), tip: t('gcal.mark.localTip') };
    default:
      return null;
  }
}
