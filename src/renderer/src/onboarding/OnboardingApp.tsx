import { useEffect, useState } from 'react';
import type { OnboardSnapshot } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import { PET_KINDS, PET_NAME_MAX } from '../../../shared/settings.ts';
import { PetFace } from '../PetFace.tsx';

const bridge = window.jjakkungOnboard;
const PAGES = 3;

/** 첫 실행 안내 (v1): 펫 정하기, 같이 보기 권한, 알아 두면 좋은 것 */
export function OnboardingApp() {
  const [snap, setSnap] = useState<OnboardSnapshot>();
  const [page, setPage] = useState(0);
  const [name, setName] = useState('');

  const refresh = () =>
    bridge.get().then((s) => {
      setSnap(s);
      setName((n) => n || s.settings.petName);
    });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만 건다
  useEffect(() => {
    refresh();
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
    // 시스템 설정에서 권한을 주고 돌아오면 다시 읽는다
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!snap) return <div className="onboard" />;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';
  const petName = name.trim() || s.petName;

  const saveName = async () => {
    const next = await bridge.set({ petName: name });
    setName(next.petName);
    setSnap((v) => v && { ...v, settings: next });
  };

  return (
    <div className="onboard">
      <header>
        <ol className="dots" aria-label={`${PAGES}쪽 중 ${page + 1}쪽`}>
          {Array.from({ length: PAGES }, (_, i) => (
            <li key={String(i)} className={i === page ? 'on' : i < page ? 'done' : ''} />
          ))}
        </ol>
      </header>

      <main>
        {page === 0 && (
          <section>
            <div className="hero">
              <PetFace />
            </div>
            <h1>반가워! 화면 위에서 같이 일할 짝꿍이야.</h1>
            <p className="lead">할 일을 끝내면 코인이 쌓이고, 코인으로 밥과 장난감을 사 줄 수 있어.</p>
            <label className="field">
              <span>이름</span>
              <input
                value={name}
                maxLength={PET_NAME_MAX * 2}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <div className="field">
              <span>모습</span>
              <fieldset className="choice" aria-label="기본 펫 모양">
                {PET_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={s.petKind === k.id && !s.petImage}
                    className={s.petKind === k.id && !s.petImage ? 'on' : ''}
                    onClick={async () => {
                      const next = await bridge.set({ petKind: k.id, petImage: null } as never);
                      setSnap((v) => v && { ...v, settings: next });
                    }}
                  >
                    {k.label}
                  </button>
                ))}
                <button type="button" className={s.petImage ? 'on' : ''} onClick={() => bridge.openMaker()}>
                  사진으로
                </button>
              </fieldset>
              <small>반려동물이나 인형 사진 한 장으로 만들 수도 있어. 나중에 설정에서 바꿔도 돼.</small>
            </div>
          </section>
        )}

        {page === 1 && (
          <section>
            <h1>같이 보기</h1>
            <p className="lead">
              {withParticle(petName, '을')} 우클릭하고 "{withParticle(petName, '이랑')} 같이 보기"를 고르면,
              화면 일부를 찍어 AI 에게 물어볼 수 있어. 찍은 화면은 저장하지 않고 고른 AI 에게만 보내.
            </p>
            {mac ? (
              <div className={`perm ${snap.screen === 'granted' ? 'ok' : ''}`}>
                <strong>
                  {snap.screen === 'granted' ? '화면 기록 권한이 있어' : '화면 기록 권한이 필요해'}
                </strong>
                <small>
                  시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음에서 Jjakkung 을 켜 줘. 켠
                  다음에는 짝꿍을 껐다 켜야 해. 같이 보기를 안 쓸 거면 넘어가도 돼.
                </small>
                {snap.screen !== 'granted' && (
                  <button type="button" className="ghost" onClick={() => bridge.openScreenSettings()}>
                    설정 열기
                  </button>
                )}
              </div>
            ) : (
              <div className="perm ok">
                <strong>윈도우는 따로 권한이 필요 없어</strong>
              </div>
            )}
            <p className="hint">
              AI 는 이 컴퓨터에 설치해 로그인해 둔 Claude Code, Codex, Cursor, Gemini 중 하나를 써. 채팅
              창에서 고를 수 있어.
            </p>
          </section>
        )}

        {page === 2 && (
          <section>
            <h1>알아 두면 좋은 것</h1>
            <dl className="tips">
              <dt>{withParticle(petName, '을')} 누르면</dt>
              <dd>할 일, 메모, 일정, 상점 패널</dd>
              <dt>우클릭</dt>
              <dd>대화, 같이 보기, 밥, 놀기, 숨기기</dd>
              <dt>좌우로 문지르기</dt>
              <dd>쓰다듬기. 하트가 떠</dd>
              <dt>잡아서 휙 놓기</dt>
              <dd>던지기. 떨어져서 통통 튀어</dd>
              <dt>
                <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>N</kbd>
              </dt>
              <dd>어디서든 할 일이나 일정 한 줄 ("내일 3시 회의")</dd>
              <dt>
                <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>H</kbd>
              </dt>
              <dd>잠깐 숨기기, 다시 보이기</dd>
            </dl>
          </section>
        )}
      </main>

      <footer>
        {page > 0 ? (
          <button type="button" className="ghost" onClick={() => setPage(page - 1)}>
            이전
          </button>
        ) : (
          <button type="button" className="link" onClick={() => bridge.finish()}>
            건너뛰기
          </button>
        )}
        {page < PAGES - 1 ? (
          <button type="button" className="primary" onClick={() => setPage(page + 1)}>
            다음
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => bridge.finish()}>
            시작하기
          </button>
        )}
      </footer>
    </div>
  );
}
