import { useState } from 'react';
import { formatBytes } from '../../../../shared/bytes.ts';
import { t } from '../../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../../shared/ipc.ts';
import { bridge, Section, type TabProps } from '../ui.tsx';

/** 데이터 탭: 백업과 옮기기, 저장 공간 */
export function DataTab({ snap, setSnap, flash }: TabProps) {
  return (
    <>
      <Section title={t('settings.backup')}>
        <small>{t('settings.backupHint')}</small>
        <div className="action-row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              // 실패하면(쓰기 권한, 디스크 등) 아무 표시 없이 끝나지 않게 상태줄에 알린다
              const r = await bridge.exportData().catch(() => undefined);
              if (r === undefined) flash(t('settings.exportFailed'));
              else if (r) flash(t('settings.exported'));
            }}
          >
            {t('settings.export')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const r = await bridge.importData().catch(() => undefined);
              if (r === undefined) flash(t('settings.importFailed'));
              else if (r) flash(r);
            }}
          >
            {t('settings.import')}
          </button>
        </div>
        <small>{t('settings.petOnlyHint')}</small>
        <div className="action-row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              // 쓰기 실패(권한, 디스크, 그림 파일 읽기)도 말 없이 끝나지 않게 알린다
              const r = await bridge.exportPet().catch(() => undefined);
              if (r === undefined) flash(t('settings.petExportFailed'), true);
              else if (r) flash(t('settings.petExported'));
            }}
          >
            {t('settings.exportPet')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const r = await bridge.importPet();
              if (r.message) flash(r.message);
            }}
          >
            {t('settings.importPet')}
          </button>
        </div>
      </Section>
      <Section title={t('settings.storage')}>
        <Storage
          list={snap.storage}
          onDelete={async (id) => {
            try {
              const r = await bridge.deleteModel(id);
              setSnap(
                (v) => v && { ...v, storage: r.storage, models: { ...v.models, localReady: r.localReady } },
              );
              flash(t(r.ok ? 'settings.storage.deleted' : 'settings.storage.busy'));
            } catch {
              flash(t('settings.storage.busy'));
            }
          }}
        />
      </Section>
    </>
  );
}

/** 받은 모델과 크기, 지우기 */
function Storage({ list, onDelete }: { list: SettingsSnapshot['storage']; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const total = list.reduce((a, m) => a + m.bytes, 0);
  if (list.length === 0) return <small className="below">{t('settings.storage.empty')}</small>;
  return (
    <>
      <ul className="storage">
        {list.map((m) => (
          <li key={m.id}>
            <span className="model-name">{m.label}</span>
            <b>{formatBytes(m.bytes)}</b>
            <button
              type="button"
              className={`ghost small${confirm === m.id ? ' danger' : ''}`}
              onClick={() => {
                if (confirm === m.id) onDelete(m.id);
                else setConfirm(m.id);
              }}
              onBlur={() => setConfirm('')}
            >
              {confirm === m.id ? t('settings.storage.sure') : t('settings.storage.delete')}
            </button>
          </li>
        ))}
      </ul>
      <small className="below">{t('settings.storage.hint', { total: formatBytes(total) })}</small>
    </>
  );
}
