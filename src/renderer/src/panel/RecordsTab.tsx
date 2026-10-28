import { useRef } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { FocusMonth } from './FocusMonth.tsx';
import { DiaryBox, WeekBox } from './TodayTab.tsx';
import { TrashBox } from './TrashBox.tsx';
import { useKeepScroll } from './view-keep.ts';
import { WeekCardButton } from './WeekCard.tsx';

/**
 * 기록 구역 (큰 창 사이드바, 이슈 #166): 집중 월간 잔디, 이번 주, 일기, 휴지통을 한 곳에 펼쳐 보인다.
 * 작은 패널에서 오늘 탭(잔디, 이번 주, 일기)과 할 일 탭(휴지통)에 흩어진 구성요소를 그대로 가져다 쓴다.
 * 줄을 새로 만들지 않고 처음부터 펼쳐 둘 뿐이라 작은 패널 쪽 동작은 바뀌지 않는다.
 * 넓음(>=860)은 두 열, 그보다 좁으면 한 열 (panel/records.css)
 */
export function RecordsTab({ s }: { s: PanelState }) {
  const scroller = useRef<HTMLDivElement>(null);
  useKeepScroll(scroller, 'records');
  return (
    <div className="scroll today records-tab" ref={scroller}>
      <div className="records-cols">
        <div className="records-col">
          <h2 className="records-col-title">{t('records.col.focus')}</h2>
          <FocusMonth s={s} open />
          {s.week && (
            <WeekBox week={s.week} today={s.today} open>
              <WeekCardButton s={s} />
            </WeekBox>
          )}
        </div>
        <div className="records-col">
          <h2 className="records-col-title">{t('records.col.keep')}</h2>
          <DiaryBox s={s} open />
          <TrashBox s={s} always />
        </div>
      </div>
    </div>
  );
}
