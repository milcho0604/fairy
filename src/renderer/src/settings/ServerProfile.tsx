// 서버 계정의 닉네임과 기기 코드 (이슈 #101): 서버 모드를 처음 켤 때 닉네임을 정하고, 칸에서 바꾸고, 기기 코드를 복사한다.
// 기기 코드는 서버가 만든 공개 코드라 보여도 된다 (토큰, 계정 번호가 아니다).
import { type ReactNode, useState } from 'react';
import { checkNickname, NICKNAME_MAX } from '../../../shared/account-profile.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { NicknameProblem, ServerBridge, ServerStatus } from '../../../shared/server-account.ts';

const problemText = (p: NicknameProblem) => t(`server.nickname.err.${p}`);

/** 닉네임 입력 칸 하나 (검사 글은 따로: 줄 칸에서는 줄 아래 전체 폭에) */
function NicknameInput(o: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <input
      className="plain-input server-nickname"
      aria-label={t('server.nickname.placeholder')}
      placeholder={t('server.nickname.placeholder')}
      maxLength={NICKNAME_MAX * 2}
      value={o.value}
      onChange={(e) => o.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) o.onEnter();
      }}
    />
  );
}

const ProblemLine = ({ p }: { p: NicknameProblem | null }) =>
  p ? (
    <small className="warn server-row-full" role="alert">
      {problemText(p)}
    </small>
  ) : null;

/**
 * 이름, 값, 작은 단추 한 줄. 여러 줄이 .server-rows 격자 하나를 나눠 써서 이름, 값, 단추가 줄마다 같은 세로선에 선다
 */
export function Row(o: { label: string; children: ReactNode; action?: ReactNode; valueClass?: string }) {
  return (
    <div className="server-row">
      <span className="server-row-label">{o.label}</span>
      <span className={`server-row-value${o.valueClass ? ` ${o.valueClass}` : ''}`}>{o.children}</span>
      <span className="server-row-action">{o.action}</span>
    </div>
  );
}

/** 나이 답 다음: 닉네임 정하기 (만 14세 이상만, 서버 모드를 처음 켤 때) */
export function NicknameStep(o: { onStart: (nickname: string) => void; onBack: () => void; busy: boolean }) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<NicknameProblem | null>(null);
  const start = () => {
    const c = checkNickname(value);
    if (!c.ok) return setProblem(c.error);
    o.onStart(c.value);
  };
  return (
    <div className="server-box server-nickname-step">
      <div className="server-group">
        <h3 className="server-group-title">{t('server.nickname.ask')}</h3>
        <small>{t('server.nickname.why')}</small>
        <NicknameInput
          value={value}
          onChange={(v) => {
            setValue(v);
            setProblem(null);
          }}
          onEnter={start}
        />
        <ProblemLine p={problem} />
        <div className="action-row">
          <button type="button" className="ghost" disabled={o.busy} onClick={start}>
            {t('server.nickname.start')}
          </button>
          <button type="button" className="ghost" disabled={o.busy} onClick={o.onBack}>
            {t('server.nickname.back')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "내 정보" 묶음: 닉네임, 기기 코드(복사), 그리고 children 으로 받는 나이 줄. 줄마다 이름, 값, 작은 단추.
 * 아래에 기기 코드 안내, 정기 지급, 대기, 쪽지 한 줄씩
 */
export function ProfileRows(o: {
  s: ServerStatus;
  b: ServerBridge;
  setS: (s: ServerStatus | undefined) => void;
  flash: (message: string, error?: boolean) => void;
  children?: ReactNode;
  /** 줄 아래 전체 폭 (나이 고르기 단추) */
  after?: ReactNode;
}) {
  const { s, b } = o;
  const [editing, setEditing] = useState(!s.nickname);
  const [value, setValue] = useState(s.nickname ?? '');
  const [problem, setProblem] = useState<NicknameProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const c = checkNickname(value);
    if (!c.ok) return setProblem(c.error);
    setBusy(true);
    try {
      const r = await b.setNickname(c.value);
      o.setS(r.status);
      if (!r.ok) setProblem(r.problem ?? 'server');
      else {
        setEditing(false);
        o.flash(t('server.nickname.saved'));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="server-group server-profile">
      <h3 className="server-group-title">{t('server.group.me')}</h3>
      {editing && !s.nickname && <small>{t('server.nickname.ask')}</small>}
      <div className="server-rows">
        {editing ? (
          <Row
            label={t('server.nickname.label')}
            action={
              <>
                <button type="button" className="ghost small" disabled={busy} onClick={() => void save()}>
                  {t('server.nickname.save')}
                </button>
                {s.nickname && (
                  <button type="button" className="ghost small" onClick={() => setEditing(false)}>
                    {t('server.nickname.cancel')}
                  </button>
                )}
              </>
            }
          >
            <NicknameInput
              value={value}
              onChange={(v) => {
                setValue(v);
                setProblem(null);
              }}
              onEnter={() => void save()}
            />
          </Row>
        ) : (
          <Row
            label={t('server.nickname.label')}
            action={
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  setValue(s.nickname ?? '');
                  setEditing(true);
                }}
              >
                {t('server.nickname.change')}
              </button>
            }
            valueClass="server-nick-line"
          >
            {s.nickname ?? ''}
          </Row>
        )}
        <ProblemLine p={problem} />
        {s.code && (
          <Row
            label={t('server.code.label')}
            action={
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  void b.copyCode().then((ok) => ok && o.flash(t('server.code.copied')));
                }}
              >
                {t('server.code.copy')}
              </button>
            }
            valueClass="server-code"
          >
            {s.code}
          </Row>
        )}
        {o.children}
      </div>
      {o.after}
      {s.code && <small>{t('server.code.why')}</small>}
      {s.subscription && (
        <small>
          {t('ticket.subscription', { n: s.subscription.monthly, day: s.subscription.nextFill ?? '-' })}
        </small>
      )}
      {s.aiWaitlisted && <small className="warn">{t('ticket.waitlisted')}</small>}
      {s.inbox > 0 && <small className="server-inbox">{t('server.inbox', { n: s.inbox })}</small>}
    </div>
  );
}
