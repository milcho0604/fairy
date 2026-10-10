import { useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import './feedback.css';

const bridge = window.jjakkungSettings;

type Preview = { text: string; lines: number; hidden: number };

/**
 * 의견 보내기에 진단 기록 붙이기 (베타 기록 칸 안). 켜야만 기록을 읽는다.
 * 메인이 가린 글을 그대로 보여 주고, "이대로 복사"와 "파일로 저장"은 보이는 그 글만 내보낸다.
 * 아래 "GitHub에 문제 알리기"는 판과 운영체제만 채운 새 이슈 화면을 연다 (기록은 주소에 넣지 않는다).
 */
export function FeedbackBox() {
  const [on, setOn] = useState(false);
  // undefined: 읽는 중, null: 못 읽음
  const [preview, setPreview] = useState<Preview | null | undefined>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();

  const load = async () => {
    setPreview(undefined);
    setNote(undefined);
    setPreview((await bridge.diagnostics().catch(() => undefined)) ?? null);
  };

  const toggle = (next: boolean) => {
    setOn(next);
    setNote(undefined);
    if (next) void load();
  };

  return (
    <div className="feedback-box">
      <div className="toggle">
        <div className="text">
          <span>{t('feedback.include')}</span>
          <small>{t('feedback.hint')}</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('feedback.include')}
          className={on ? 'on' : ''}
          onClick={() => toggle(!on)}
        >
          <i />
        </button>
      </div>

      {on && preview === undefined && <small>{t('feedback.loading')}</small>}
      {on && preview === null && <small className="warn">{t('feedback.readFailed')}</small>}
      {on && preview && (
        <>
          <label className="feedback-preview">
            <small>{t('feedback.previewLabel')}</small>
            <textarea readOnly spellCheck={false} value={preview.text} />
          </label>
          <small>{t('feedback.summary', { n: preview.lines, hidden: preview.hidden })}</small>
          <div className="action-row">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const ok = await bridge.copyDiagnostics().catch(() => false);
                setNote(
                  ok ? { text: t('feedback.copied') } : { text: t('settings.copyFailed'), error: true },
                );
              }}
            >
              {t('feedback.copy')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge
                  .saveDiagnostics()
                  .catch(() => ({ ok: false, message: t('feedback.saveFailed') }));
                // 그만두면 빈 글: 아무것도 띄우지 않는다
                setNote(r.message ? { text: r.message, error: !r.ok } : undefined);
              }}
            >
              {t('feedback.save')}
            </button>
            <button type="button" className="ghost" onClick={() => void load()}>
              {t('feedback.refresh')}
            </button>
          </div>
        </>
      )}
      {note && (
        <small className={note.error ? 'warn' : 'feedback-ok'} role="status">
          {note.text}
        </small>
      )}

      <div className="feedback-issue">
        <button type="button" className="link" onClick={() => bridge.reportIssue()}>
          {t('feedback.issue')}
        </button>
        <small>{t('feedback.issueHint')}</small>
      </div>
    </div>
  );
}
