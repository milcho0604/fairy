import { t } from '../../../shared/i18n/index.ts';

/** 긴 목록 끝의 "더 보기" 줄 (paging.ts). 남은 것이 없으면 그리지 않는다 */
export function MoreRow({ rest, onMore }: { rest: number; onMore: () => void }) {
  if (rest <= 0) return null;
  return (
    <li className="more">
      <button type="button" className="link" onClick={onMore}>
        {t('panel.list.more', { n: rest })}
      </button>
    </li>
  );
}
