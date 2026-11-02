// 설정 찾기에서 옮긴 항목이 나오면: 어느 구역의 어느 묶음에 있는지 한 줄씩, 그 구역으로 가는 단추
import type { HubItem, HubTarget } from '../../../shared/hub-index.ts';
import { t } from '../../../shared/i18n/index.ts';
import { bridge } from './ui.tsx';

const whereName = (w: HubTarget) => t(w === 'pet' ? 'home.nav.pet' : 'home.nav.assist');

const looseT = t as unknown as (key: string) => string;

export function MovedHits({ hits }: { hits: readonly HubItem[] }) {
  if (hits.length === 0) return null;
  const places = [...new Set(hits.map((h) => h.where))];
  return (
    <section className="moved-hits" aria-label={t('settings.moved.title')}>
      <h2>{t('settings.moved.title')}</h2>
      <div className="card">
        <ul className="moved-list">
          {hits.map((h) => (
            <li key={`${h.where}-${h.group}`}>
              {t('settings.moved.in', {
                where: whereName(h.where),
                group: looseT(`hub.${h.where}.${h.group}`),
              })}
            </li>
          ))}
        </ul>
        <div className="action-row">
          {places.map((w) => (
            <button key={w} type="button" className="ghost" onClick={() => bridge.openHome(w)}>
              {t('settings.moved.open', { where: whereName(w) })}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
