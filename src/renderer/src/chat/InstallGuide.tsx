import { useEffect, useId, useRef, useState } from 'react';
import {
  type GuideMode,
  type GuideSubject,
  guideOs,
  installGuide,
  NODE_DOWNLOAD,
  whereCommand,
} from '../../../shared/ai/install-guide.ts';
import { t } from '../../../shared/i18n/index.ts';

/** 안내 제목: 못 찾음은 "설치하고 로그인하기", 로그인 안 됨은 "로그인하기", 직접 추가한 AI 는 "연결하기" */
export function guideTitle(subject: GuideSubject, mode: GuideMode): string {
  if (subject.custom && mode === 'install') return t('ai.guide.custom.title', { label: subject.label });
  return mode === 'login'
    ? t('ai.guide.loginTitle', { label: subject.label })
    : t('ai.guide.title', { label: subject.label });
}

interface StepsProps {
  subject: GuideSubject;
  mode: GuideMode;
  platform: string;
  /** 주소는 메인이 http, https 인지 다시 보고 기본 브라우저로 연다 (CHAT.openLink) */
  onLink: (url: string) => void;
}

/**
 * 설치, 로그인 단계 (#29). 대화 말풍선 아래에 펼치는 안내와 AI 관리, 머리 안내 줄에서 여는 시트가 같이 쓴다.
 * 명령과 주소는 shared/ai/install-guide.ts (공식 문서에서 확인한 값만)
 */
export function GuideSteps({ subject, mode, platform, onLink }: StepsProps) {
  const os = guideOs(platform);
  if (subject.custom) return <CustomSteps subject={subject} mode={mode} platform={platform} />;
  const guide = installGuide(subject.id, platform);
  if (!guide) return null;

  const loginLine = guide.pick ? t('ai.guide.login.pick', { pick: guide.pick }) : t('ai.guide.login.browser');

  if (mode === 'login') {
    return (
      <>
        <ol className="guide-steps">
          <li>
            <p>{t(`ai.guide.login.step1.${os}`)}</p>
            <CommandList commands={[{ command: guide.login }]} />
            <p className="note">{loginLine}</p>
          </li>
          <li>
            <p>{t('ai.guide.login.step2')}</p>
          </li>
        </ol>
        <section className="guide-still">
          <h3>{t('ai.guide.login.stillTitle')}</h3>
          <ul>
            {guide.status && <li>{t('ai.guide.login.still.status', { cmd: guide.status })}</li>}
            <li>{t('ai.guide.login.still.account')}</li>
          </ul>
        </section>
        <button type="button" className="ghost" onClick={() => onLink(guide.docs)}>
          {t('ai.guide.loginDocs')}
        </button>
      </>
    );
  }

  return (
    <>
      <ol className="guide-steps">
        <li>
          <p>{t(`ai.guide.step1.${os}`)}</p>
          <CommandList commands={guide.install} />
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
          <CommandList commands={[{ command: guide.login }]} />
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
    </>
  );
}

/** 맥, 리눅스 /usr/..., 윈도우 C:\... 처럼 적은 명령이 전체 경로인지 */
const isAbsolutePath = (bin: string) => bin.startsWith('/') || /^[a-z]:[\\/]/i.test(bin);

/** 직접 추가한 AI: 설치 명령은 모르니 실행되는지 보고, 짝꿍만 못 찾으면 전체 경로로 다시 추가하게 한다 */
function CustomSteps({ subject, mode, platform }: Omit<StepsProps, 'onLink'>) {
  const bin = subject.bin ?? '';
  const os = guideOs(platform);
  if (mode === 'login') {
    return (
      <ol className="guide-steps">
        <li>
          <p>{t('ai.guide.custom.login', { label: subject.label })}</p>
        </li>
        <li>
          <p>{t('ai.guide.login.step2')}</p>
        </li>
      </ol>
    );
  }
  const absolute = isAbsolutePath(bin);
  return (
    <>
      <ol className="guide-steps">
        <li>
          <p>{t('ai.guide.custom.step1', { bin })}</p>
        </li>
        <li>
          {absolute ? (
            <p>{t('ai.guide.custom.abs', { bin })}</p>
          ) : (
            <>
              <p>{t('ai.guide.custom.step2')}</p>
              <CommandList commands={[{ command: whereCommand(bin, platform) }]} />
            </>
          )}
        </li>
        <li>
          <p>{t('ai.guide.step3')}</p>
        </li>
      </ol>
      {!absolute && (
        <section className="guide-still">
          <h3>{t('ai.guide.stillTitle')}</h3>
          <ul>
            <li>{t(`ai.guide.still.${os}`)}</li>
          </ul>
        </section>
      )}
    </>
  );
}

interface SheetProps {
  subject: GuideSubject;
  mode: GuideMode;
  platform: string;
  checking: boolean;
  /** 지금 상태 한 줄 (다시 확인하면 바뀐다: 못 찾음, 로그인 필요, 준비됨) */
  statusLine?: string;
  onRecheck: () => void;
  onLink: (url: string) => void;
  onClose: () => void;
}

/** AI 관리와 머리 안내 줄에서 여는 시트. 대화 안에서는 InlineGuide 로 펼친다 */
export function InstallGuide({
  subject,
  mode,
  platform,
  checking,
  statusLine,
  onRecheck,
  onLink,
  onClose,
}: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Esc 로 닫기는 채팅 창의 키 처리가 한다 (AI 관리 위에 떴을 때 이것만 닫히게)
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const title = guideTitle(subject, mode);
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
      <GuideSteps subject={subject} mode={mode} platform={platform} onLink={onLink} />
    </div>
  );
}

interface InlineProps {
  subject: GuideSubject;
  mode: GuideMode;
  platform: string;
  checking: boolean;
  statusLine?: string;
  onRecheck: () => void;
  onLink: (url: string) => void;
}

/**
 * 대화 안 안내 (사용자 요청 2026-10-12 "대화창에서"). 못 찾음, 로그인 안 됨 말풍선은 짧게 두고
 * 아래 단추로 단계를 그 자리에 펼친다. 다시 확인도 펼친 곳에서 바로 누른다
 */
export function InlineGuide({
  subject,
  mode,
  platform,
  checking,
  statusLine,
  onRecheck,
  onLink,
}: InlineProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const show = mode === 'login' ? t('ai.guide.showLogin') : t('ai.guide.show');
  const hide = mode === 'login' ? t('ai.guide.hideLogin') : t('ai.guide.hide');
  return (
    <div className="inline-guide-wrap">
      <div className="retry action-row">
        <button
          type="button"
          className="ghost"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? hide : show}
        </button>
      </div>
      {open && (
        <section id={id} className="install-guide inline-guide" aria-label={guideTitle(subject, mode)}>
          <strong className="inline-guide-title">{guideTitle(subject, mode)}</strong>
          {statusLine && (
            <p className="guide-status" role="status">
              {statusLine}
            </p>
          )}
          <GuideSteps subject={subject} mode={mode} platform={platform} onLink={onLink} />
          <button type="button" className="ghost" disabled={checking} onClick={onRecheck}>
            {checking ? t('chat.checking') : t('chat.recheck')}
          </button>
        </section>
      )}
    </div>
  );
}

function CommandList({ commands }: { commands: { via?: string; command: string }[] }) {
  return (
    <ul className="commands">
      {commands.map((c) => (
        <li key={c.command}>
          {c.via && <span className="via">{c.via}</span>}
          <Command text={c.command} />
        </li>
      ))}
    </ul>
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
