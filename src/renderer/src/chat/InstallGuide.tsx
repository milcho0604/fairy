import { useEffect, useRef, useState } from 'react';
import { guideOs, installGuide, NODE_DOWNLOAD } from '../../../shared/ai/install-guide.ts';
import { t } from '../../../shared/i18n/index.ts';

interface Props {
  /** 안내할 AI (claude, codex, cursor, gemini) */
  provider: string;
  label: string;
  platform: string;
  checking: boolean;
  /** 지금 상태 한 줄 (다시 확인하면 바뀐다: 못 찾음, 로그인 필요, 준비됨) */
  statusLine?: string;
  onRecheck: () => void;
  /** 주소는 메인이 http, https 인지 다시 보고 기본 브라우저로 연다 (CHAT.openLink) */
  onLink: (url: string) => void;
  onClose: () => void;
}

/**
 * 설치 방법 (#29). 못 찾음 말풍선은 짧게 두고, "설치 방법 보기"를 누르면 이 시트에서
 * 이 운영체제의 설치 명령, 로그인, 깔았는데도 못 찾을 때를 차례로 보여 준다. 명령과 주소는 shared/ai/install-guide.ts
 */
export function InstallGuide({
  provider,
  label,
  platform,
  checking,
  statusLine,
  onRecheck,
  onLink,
  onClose,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Esc 로 닫기는 채팅 창의 키 처리가 한다 (AI 관리 위에 떴을 때 이것만 닫히게)
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const guide = installGuide(provider, platform);
  if (!guide) return null;
  const os = guideOs(platform);
  const title = t('ai.guide.title', { label });

  return (
    <div ref={sheetRef} className="sheet install-guide" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-head">
        <strong>{title}</strong>
        <button type="button" className="ghost" disabled={checking} onClick={onRecheck}>
          {checking ? t('chat.checking') : t('chat.recheck')}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          {t('chat.close')}
        </button>
      </div>

      {statusLine && (
        <p className="guide-status" role="status">
          {statusLine}
        </p>
      )}
      <ol className="guide-steps">
        <li>
          <p>{t(`ai.guide.step1.${os}`)}</p>
          <ul className="commands">
            {guide.install.map((c) => (
              <li key={c.command}>
                {c.via && <span className="via">{c.via}</span>}
                <Command text={c.command} />
              </li>
            ))}
          </ul>
          {guide.needsNode && (
            <p className="note action-row">
              <span className="grow">{t('ai.guide.node', { version: guide.needsNode })}</span>
              <button type="button" className="ghost small" onClick={() => onLink(NODE_DOWNLOAD)}>
                {t('ai.guide.nodeLink')}
              </button>
            </p>
          )}
        </li>
        <li>
          <p>
            {guide.pick
              ? t('ai.guide.step2Pick', { cmd: guide.login, pick: guide.pick })
              : t('ai.guide.step2', { cmd: guide.login })}
          </p>
          <ul className="commands">
            <li>
              <Command text={guide.login} />
            </li>
          </ul>
        </li>
        <li>
          <p>{t('ai.guide.step3')}</p>
        </li>
      </ol>

      <section className="guide-still">
        <h3>{t('ai.guide.stillTitle')}</h3>
        <ul>
          <li>{t('ai.guide.still.check', { cmd: guide.check })}</li>
          {guide.binDir && <li>{t('ai.guide.still.path', { dir: guide.binDir })}</li>}
          <li>{t(`ai.guide.still.${os}`)}</li>
        </ul>
      </section>

      <button type="button" className="ghost" onClick={() => onLink(guide.docs)}>
        {t('ai.guide.docs')}
      </button>
    </div>
  );
}

/** 명령 한 줄과 복사 단추 */
function Command({ text }: { text: string }) {
  const [done, setDone] = useState<string>();
  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(undefined), 1600);
  };
  return (
    <span className="command-row action-row">
      <code className="grow">{text}</code>
      <button
        type="button"
        className="ghost small"
        aria-label={t('ai.guide.copyLabel', { cmd: text })}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            flash(t('chat.copied'));
          } catch {
            flash(t('chat.copyFailed'));
          }
        }}
      >
        {done ?? t('chat.copy')}
      </button>
    </span>
  );
}
