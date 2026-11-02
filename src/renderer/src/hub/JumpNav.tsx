// 구역 안 묶음으로 건너뛰기 (페어리, 비서 구역 맨 위). 스크롤하는 칸은 구역 쪽이고, 묶음은 id 로 찾는다
import { t } from '../../../shared/i18n/index.ts';

const looseT = t as unknown as (key: string) => string;

export function JumpNav({ ns, keys }: { ns: 'pet' | 'assist'; keys: readonly string[] }) {
  return (
    <nav className="settings-jump" aria-label={t('hub.jump')}>
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() =>
            document
              .getElementById(`hub-${ns}-${key}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          {looseT(`hub.${ns}.${key}`)}
        </button>
      ))}
    </nav>
  );
}
