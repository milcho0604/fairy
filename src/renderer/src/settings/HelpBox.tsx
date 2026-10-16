import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { bridge } from './ui.tsx';
import './help.css';

type Preview = { text: string; lines: number; hidden: number };

/** 설정 창 어디서든 도움 보내기 창을 여는 이벤트 (단축키가 보낸다, SettingsApp.tsx) */
export const HELP_OPEN_EVENT = 'fairy-help-open';
/** 설정 창에서 도움 보내기 창을 여는 단축키 (Cmd/Ctrl+Shift+H) */
export const isHelpKey = (e: { code: string; shiftKey: boolean; altKey: boolean }, mod: boolean): boolean =>
  mod && e.shiftKey && !e.altKey && e.code === 'KeyH';

/**
 * 도움 보내기 (정보 탭, 이슈 #126). 단추나 단축키로 진단 묶음(앱 판, 운영체제, 켜진 기능, 서버 연결 상태, 최근 기록)을
 * 메인이 만들고 가려서 미리 보기 창에 그대로 보여 준다. 복사와 저장은 보이는 그 글만 내보낸다. 어디로도 자동으로 보내지 않는다.
 * 아래 "GitHub에 문제 알리기"는 판과 운영체제만 채운 새 이슈 화면을 연다 (기록은 주소에 넣지 않는다).
 */
export function HelpBox({ shortcut }: { shortcut: string }) {
  const [open, setOpen] = useState(false);
  // undefined: 만드는 중, null: 못 만듦
  const [preview, setPreview] = useState<Preview | null | undefined>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setPreview(undefined);
    setNote(undefined);
    setPreview((await bridge.diagnostics().catch(() => undefined)) ?? null);
  };
  const show = () => {
    setOpen(true);
    void load();
  };
  const close = () => {
    setOpen(false);
    setNote(undefined);
    openerRef.current?.focus();
  };

  // 단축키가 보낸 이벤트 (정보 탭이 숨은 채로도 이 칸은 그려져 있다)
  useEffect(() => {
    const on = () => show();
    window.addEventListener(HELP_OPEN_EVENT, on);
    return () => window.removeEventListener(HELP_OPEN_EVENT, on);
  });
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <div className="help-box">
      <div className="action-row">
        <button id="help-open" ref={openerRef} type="button" className="ghost" onClick={show}>
          {t('help.open')}
        </button>
        <small className="grow">{t('help.shortcut', { keys: shortcut })}</small>
      </div>
      <small>{t('help.intro')}</small>
      <div className="feedback-issue">
        <button type="button" className="link" onClick={() => bridge.reportIssue()}>
          {t('feedback.issue')}
        </button>
        <small>{t('feedback.issueHint')}</small>
      </div>

      {open && (
        <div className="help-backdrop">
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onKeyDown={(e) => {
              // 창 전체를 닫는 Esc 보다 먼저 이 창만 닫는다 (한글 조합 중 Esc 는 조합만 끝낸다)
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            <h2 id="help-title">{t('help.title')}</h2>
            <small>{t('help.noUpload')}</small>
            <small>{t('help.hidden')}</small>
            {preview === undefined && <small role="status">{t('help.loading')}</small>}
            {preview === null && (
              <small className="warn" role="alert">
                {t('help.failed')}
              </small>
            )}
            {preview && (
              <>
                <label className="feedback-preview">
                  <small>{t('feedback.previewLabel')}</small>
                  <textarea id="help-preview" readOnly spellCheck={false} value={preview.text} />
                </label>
                <small>{t('feedback.summary', { n: preview.lines, hidden: preview.hidden })}</small>
              </>
            )}
            <div className="action-row">
              {preview && (
                <>
                  <button
                    id="help-copy"
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
                    id="help-save"
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
                </>
              )}
              <button id="help-close" ref={closeRef} type="button" className="ghost" onClick={close}>
                {t('help.close')}
              </button>
            </div>
            {note && (
              <small className={note.error ? 'warn' : 'feedback-ok'} role="status">
                {note.text}
              </small>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
