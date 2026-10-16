// 서버 백업 (이슈 #102, 기획서 7절): 설정 > 데이터 > 서버 계정 칸 안. 로그인했을 때만 보인다.
// 민감정보 안내에 따로 동의해야 올리기 단추가 켜진다. 받으면 개인 백업 파일과 같은 되살리기 확인 칸이 열린다
// (코인과 산 물건은 되살려도 서버 정본을 따른다). 토큰과 네트워크는 메인(main/server-core.ts)에만 있다.
import { useEffect, useRef } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import type {
  ServerBackupResult,
  ServerBackupView,
  ServerBridge,
  ServerStatus,
} from '../../../shared/server-account.ts';
import { Toggle } from './ui.tsx';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });

const sizeText = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

export function ServerBackupBox({
  b,
  view,
  setS,
  flash,
}: {
  b: ServerBridge;
  view: ServerBackupView;
  setS: (s: ServerStatus | undefined) => void;
  flash: (message: string, error?: boolean) => void;
}) {
  // 칸이 보일 때 목록을 한 번 받는다 (목록 보기는 서버에서 "쓴 것"으로 치지 않는다)
  const asked = useRef(false);
  const known = view.list !== null;
  useEffect(() => {
    if (known || asked.current) return;
    asked.current = true;
    void b
      .backupList()
      .then(setS)
      .catch(() => undefined);
  }, [b, known, setS]);

  const done = (r: ServerBackupResult, ok: string) => {
    if (r.status) setS(r.status);
    if (r.ok) flash(ok);
    else flash(r.message || t(`backup.${r.error ?? 'failed'}`), true);
  };
  const busy = view.busy !== null;

  if (view.off)
    return (
      <div className="server-group server-backup">
        <h3 className="server-group-title">{t('backup.title')}</h3>
        <small>{t('backup.off')}</small>
      </div>
    );

  return (
    <div className="server-group server-backup">
      <h3 className="server-group-title">{t('backup.title')}</h3>
      <small>{t('backup.what')}</small>
      <small>{t('backup.keep', { n: view.keep, mb: Math.round(view.maxBytes / 1024 / 1024) })}</small>
      <Toggle
        label={t('backup.consentLabel')}
        hint={t('backup.consent')}
        note={view.agreed ? undefined : t('backup.consentHint')}
        on={view.agreed}
        disabled={busy}
        onChange={(on) =>
          void b
            .backupAgree(on)
            .then(setS)
            .catch(() => undefined)
        }
      />
      <div className="action-row">
        <button
          type="button"
          className="ghost"
          disabled={busy || !view.agreed}
          onClick={() =>
            void b
              .backupUpload()
              .then((r) => done(r, t('backup.uploaded')))
              .catch(() => flash(t('backup.failed'), true))
          }
        >
          {view.busy === 'up' ? t('backup.uploading') : t('backup.upload')}
        </button>
      </div>
      {view.list === null ? (
        <small>{t('backup.loading')}</small>
      ) : view.list.length === 0 ? (
        <small>{t('backup.none')}</small>
      ) : (
        <ul className="server-backup-list">
          {view.list.map((x) => (
            <li key={x.id}>
              <small className="server-backup-item">
                {t('backup.item', { date: day(x.createdAt), size: sizeText(x.size) })}
              </small>
              <div className="action-row item-actions">
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() =>
                    void b
                      .backupDownload(x.id)
                      .then((r) => done(r, t('backup.downloaded')))
                      .catch(() => flash(t('backup.failed'), true))
                  }
                >
                  {view.busy === 'down' ? t('backup.downloading') : t('backup.download')}
                </button>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() =>
                    void b
                      .backupDelete(x.id)
                      .then((r) => done(r, t('backup.deleted')))
                      .catch(() => flash(t('backup.failed'), true))
                  }
                >
                  {t('backup.delete')}
                </button>
              </div>
              {/* 지워질 날 안내는 줄 아래 전체 폭에 (단추 옆 좁은 칸에서 여러 줄로 꺾이지 않게) */}
              {x.soon && (
                <small className="warn server-backup-soon">
                  {t('backup.soon', { date: day(x.expiresAt) })}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      <small>{t('backup.coins')}</small>
    </div>
  );
}
