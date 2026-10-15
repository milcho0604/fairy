// 서버 계정의 닉네임과 기기 코드 (이슈 #101): 서버 모드를 처음 켤 때 닉네임을 정하고, 칸에서 바꾸고, 기기 코드를 복사한다.
// 기기 코드는 서버가 만든 공개 코드라 보여도 된다 (토큰, 계정 번호가 아니다).
import { useState } from 'react';
import { checkNickname, NICKNAME_MAX } from '../../../shared/account-profile.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { NicknameProblem, ServerBridge, ServerStatus } from '../../../shared/server-account.ts';

const problemText = (p: NicknameProblem) => t(`server.nickname.err.${p}`);

/** 닉네임 입력 칸 하나 (검사 글이 바로 아래에) */
function NicknameInput(o: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  problem: NicknameProblem | null;
}) {
  return (
    <>
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
      {o.problem && (
        <small className="warn" role="alert">
          {problemText(o.problem)}
        </small>
      )}
    </>
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
      <small className="server-ask">{t('server.nickname.ask')}</small>
      <small>{t('server.nickname.why')}</small>
      <NicknameInput
        value={value}
        onChange={(v) => {
          setValue(v);
          setProblem(null);
        }}
        onEnter={start}
        problem={problem}
      />
      <div className="action-row">
        <button type="button" className="ghost" disabled={o.busy} onClick={start}>
          {t('server.nickname.start')}
        </button>
        <button type="button" className="ghost small" disabled={o.busy} onClick={o.onBack}>
          {t('server.nickname.back')}
        </button>
      </div>
    </div>
  );
}

/** 서버 모드 칸 안: 닉네임 줄, 기기 코드와 복사, 정기 지급, 쪽지 */
export function ProfileRows(o: {
  s: ServerStatus;
  b: ServerBridge;
  setS: (s: ServerStatus | undefined) => void;
  flash: (message: string, error?: boolean) => void;
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
    <div className="server-profile">
      {editing ? (
        <>
          {!s.nickname && <small className="server-ask">{t('server.nickname.ask')}</small>}
          <NicknameInput
            value={value}
            onChange={(v) => {
              setValue(v);
              setProblem(null);
            }}
            onEnter={() => void save()}
            problem={problem}
          />
          <div className="action-row">
            <button type="button" className="ghost small" disabled={busy} onClick={() => void save()}>
              {t('server.nickname.save')}
            </button>
            {s.nickname && (
              <button type="button" className="ghost small" onClick={() => setEditing(false)}>
                {t('server.nickname.cancel')}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="action-row server-age-line">
          <small className="server-nick-line">{t('server.nickname.line', { name: s.nickname ?? '' })}</small>
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
        </div>
      )}
      {s.code && (
        <div className="action-row server-age-line">
          <small className="server-code">{t('server.code.line', { code: s.code })}</small>
          <button
            type="button"
            className="ghost small"
            onClick={() => {
              void b.copyCode().then((ok) => ok && o.flash(t('server.code.copied')));
            }}
          >
            {t('server.code.copy')}
          </button>
        </div>
      )}
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
