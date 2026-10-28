import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../../../shared/bytes.ts';
import { locale, t } from '../../../../shared/i18n/index.ts';
import type { RestoreOffer, RestoreState, SettingsSnapshot } from '../../../../shared/ipc.ts';
import { featureOn, serverView } from '../../../../shared/server-account.ts';
import { isPersonalPet } from '../../../../shared/settings.ts';
import { AdminBox } from '../AdminBox.tsx';
import { CoinReset } from '../CoinReset.tsx';
import { EventsBox } from '../EventsBox.tsx';
import { ExportBox, ExportedRow } from '../ExportBox.tsx';
import { FriendsBox } from '../FriendsBox.tsx';
import { exportFlash, type Flash, importFlash, storageFlash } from '../flash-of.ts';
import { ServerAccountBox, useServerStatus } from '../ServerAccountBox.tsx';
import { bridge, Section, type TabProps } from '../ui.tsx';

/** 데이터 탭: 백업과 옮기기, 코인 초기화, 저장 공간 */
export function DataTab({ snap, setSnap, flash }: TabProps) {
  const [exported, setExported] = useState<string>();
  const [resetConfirm, setResetConfirm] = useState(false);
  // 코인 초기화는 기능 키 coin_reset 이 켜졌다고 서버가 알려 줄 때만 보인다 (기본 숨김, #102). 코드는 그대로 둔다
  const [server] = useServerStatus();
  /** 실패는 빨간 글씨로 (이슈 #65: 못 했다는 말도 초록이었다) */
  const show = (f: Flash | undefined) => {
    if (f) flash(f.text, f.error);
  };
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
              show(exportFlash(r));
              if (r?.path) setExported(r.path);
            }}
          >
            {t('settings.export')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              // 가져올 수 있으면 아래 확인 칸이 뜬다 (메인이 보내는 복원 상태). 못 하면 까닭만
              show(importFlash(await bridge.importData('file').catch(() => undefined)));
            }}
          >
            {t('settings.import')}
          </button>
          <button
            type="button"
            className="ghost small"
            title={t('settings.importFolderHint')}
            onClick={async () => {
              show(importFlash(await bridge.importData('folder').catch(() => undefined)));
            }}
          >
            {t('settings.importFolder')}
          </button>
        </div>
        <Restore flash={flash} />
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
              if (r.message) flash(r.message, !r.ok);
            }}
          >
            {t('settings.importPet')}
          </button>
        </div>
        {/* 다른 캐릭터를 닮게 말로 만든 페어리: 막지 않고 한 줄만 (shared/pet-share.ts personalOnly) */}
        {isPersonalPet(snap.settings) && <small>{t('pet.share.personalHint')}</small>}
        <ExportedRow path={exported} />
      </Section>
      <ServerAccountBox />
      <EventsBox />
      <FriendsBox flash={flash} />
      <AdminBox />
      <ExportBox flash={flash} />
      {featureOn(server, 'coin_reset') && (
        <Section title={t('settings.coinReset')}>
          <CoinReset flash={flash} />
        </Section>
      )}
      <Section title={t('settings.storage')}>
        <Storage
          list={snap.storage}
          onDelete={async (id) => {
            try {
              const r = await bridge.deleteModel(id);
              setSnap(
                (v) => v && { ...v, storage: r.storage, models: { ...v.models, localReady: r.localReady } },
              );
              show(storageFlash(r.ok, id.startsWith('copy:')));
            } catch {
              show(storageFlash(undefined, false));
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
      <Section title={t('settings.resetPreferences')}>
        <small>{t('settings.resetPreferencesHint')}</small>
        <div className="action-row">
          <button
            type="button"
            className={`ghost${resetConfirm ? ' danger' : ''}`}
            onBlur={() => setResetConfirm(false)}
            onClick={async () => {
              if (!resetConfirm) {
                setResetConfirm(true);
                return;
              }
              setResetConfirm(false);
              try {
                const settings = await bridge.reset();
                setSnap((v) => v && { ...v, settings });
                flash(t('settings.resetPreferencesDone'));
              } catch {
                flash(t('settings.resetPreferencesFailed'), true);
              }
            }}
          >
            {t(resetConfirm ? 'settings.resetPreferencesSure' : 'settings.resetPreferencesButton')}
          </button>
        </div>
      </Section>
    </>
  );
}

const dateText = (at: number) =>
  new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

/** 확인 칸 맨 위 줄 아래: 언제 만든(보관한) 것인지 */
function madeLine(o: RestoreOffer): string {
  if (!o.at) return o.name;
  const date = dateText(o.at);
  if (o.kind === 'undo') return t('settings.restore.keptAt', { date });
  return o.app ? t('settings.restore.madeApp', { date, app: o.app }) : t('settings.restore.made', { date });
}

/**
 * 백업 복원 확인 칸과 되돌리기 (이슈 #90). 바꿀지는 OS 창 없이 이 칸에서 묻는다 (코인 초기화와 같은 꼴).
 * 백업 파일을 두 번 눌러 열거나 가져오기로 고르면 메인이 검사한 뒤 상태를 보내 이 칸이 뜬다
 */
function Restore({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [state, setState] = useState<RestoreState>({});
  const [busy, setBusy] = useState(false);
  // 서버 모드에서는 백업에서 코인과 산 물건을 되살리지 않는다 (기획서 7절)
  const [server] = useServerStatus();
  const serverCoins = serverView(server) === 'server';
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    bridge
      .restoreState()
      .then(setState)
      .catch(() => undefined);
    return bridge.onRestoreChanged(setState);
  }, []);
  const offer = state.offer;
  // 확인 칸이 뜨면 보이게 내리고 "그만두기"에 초점 (Enter 를 잘못 눌러도 바꾸지 않게)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 새 확인 칸(id)이 뜰 때만
  useEffect(() => {
    if (!offer) return;
    boxRef.current?.scrollIntoView({ block: 'nearest' });
    cancelRef.current?.focus();
  }, [offer?.id]);

  const sure = async () => {
    if (!offer || busy) return;
    setBusy(true);
    try {
      const r = await bridge.restoreConfirm(offer.id);
      if (r.message) flash(r.message, !r.ok);
    } catch {
      flash(t('settings.importFailed'), true);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (offer && !busy) bridge.restoreCancel(offer.id);
  };

  if (!offer)
    return state.undoAt ? (
      <div className="action-row restore-undo">
        <small>{t('settings.restore.undoHint', { date: dateText(state.undoAt) })}</small>
        <button
          type="button"
          className="ghost small"
          onClick={async () => {
            const r = await bridge.restoreUndo().catch(() => undefined);
            if (!r) flash(t('settings.importFailed'), true);
            else if (!r.ok && r.message) flash(r.message, true);
          }}
        >
          {t('settings.restore.undo')}
        </button>
      </div>
    ) : null;
  return (
    <div
      ref={boxRef}
      className="notice restore-ask"
      role="alertdialog"
      aria-labelledby="restore-ask-text"
      aria-describedby="restore-ask-what"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <small id="restore-ask-text" className="restore-title">
        {t(offer.kind === 'undo' ? 'settings.restore.askUndo' : 'settings.restore.ask')}
      </small>
      <small className="restore-from" title={offer.name}>
        {madeLine(offer)}
      </small>
      {offer.kind !== 'undo' && offer.at > 0 && <small className="restore-name">{offer.name}</small>}
      <small id="restore-ask-what">
        {t(
          serverCoins
            ? 'settings.restore.whatServer'
            : offer.kind === 'undo'
              ? 'settings.restore.whatUndo'
              : 'settings.restore.what',
        )}
      </small>
      {offer.customAi > 0 && <small>{t('settings.restore.customAi', { n: offer.customAi })}</small>}
      <small>{t('settings.restore.keep')}</small>
      <small className="restore-note">{t('settings.restore.restart')}</small>
      <div className="action-row">
        <button type="button" className="ghost danger" disabled={busy} onClick={() => void sure()}>
          {t('settings.restore.sure')}
        </button>
        <button type="button" className="ghost" ref={cancelRef} disabled={busy} onClick={cancel}>
          {t('settings.restore.cancel')}
        </button>
      </div>
    </div>
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
