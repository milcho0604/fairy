import { useState } from 'react';
import { formatBytes } from '../../../../shared/bytes.ts';
import { t } from '../../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../../shared/ipc.ts';
import { isPersonalPet } from '../../../../shared/settings.ts';
import { ExportBox, ExportedRow } from '../ExportBox.tsx';
import { bridge, Section, type TabProps } from '../ui.tsx';

/** 데이터 탭: 백업과 옮기기, 저장 공간 */
export function DataTab({ snap, setSnap, flash }: TabProps) {
  const [exported, setExported] = useState<string>();
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
              else if (r) {
                flash(t('settings.exported'));
                setExported(r);
              }
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
              else if (r) {
                flash(t('settings.petExported'));
                setExported(r);
              }
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
        {/* 다른 캐릭터를 닮게 말로 만든 페어리: 막지 않고 한 줄만 (shared/pet-share.ts personalOnly) */}
        {isPersonalPet(snap.settings) && <small>{t('pet.share.personalHint')}</small>}
        <ExportedRow path={exported} />
      </Section>
      <ExportBox flash={flash} />
      <Section title={t('settings.storage')}>
        <Storage
          list={snap.storage}
          onDelete={async (id) => {
            try {
              const r = await bridge.deleteModel(id);
              setSnap(
                (v) => v && { ...v, storage: r.storage, models: { ...v.models, localReady: r.localReady } },
              );
              const copy = id.startsWith('copy:');
              flash(
                t(
                  r.ok
                    ? copy
                      ? 'settings.storage.copyDeleted'
                      : 'settings.storage.deleted'
                    : 'settings.storage.busy',
                ),
              );
            } catch {
              flash(t('settings.storage.busy'));
            }
          }}
        />
      </Section>
      <Section title={t('settings.aiHistory')}>
        <AiHistory
          bytes={snap.aiHistoryBytes}
          onClear={async () => {
            try {
              const r = await bridge.clearAiHistory();
              setSnap((v) => v && { ...v, aiHistoryBytes: r.bytes });
              flash(t(r.ok ? 'settings.aiHistory.cleared' : 'settings.aiHistory.failed'), !r.ok);
            } catch {
              flash(t('settings.aiHistory.failed'), true);
            }
          }}
        />
      </Section>
    </>
  );
}

/** AI CLI 가 짝꿍 전용 폴더에 남긴 대화 기록과 지우기 (두 번 눌러 지운다) */
function AiHistory({ bytes, onClear }: { bytes: number; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <small>{t('settings.aiHistory.hint')}</small>
      <div className="action-row">
        <button
          type="button"
          className={`ghost${confirm ? ' danger' : ''}`}
          disabled={bytes === 0}
          onClick={() => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            onClear();
          }}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? t('settings.aiHistory.sure') : t('settings.aiHistory.clear')}
        </button>
      </div>
      <small className="below">
        {bytes > 0
          ? t('settings.aiHistory.size', { size: formatBytes(bytes) })
          : t('settings.aiHistory.none')}
      </small>
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
