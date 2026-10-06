import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PERSONAS } from '../../../shared/ai/persona.ts';
import { type BetaReport, TARGET } from '../../../shared/beta-stats.ts';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../shared/chatter.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import { PET_NAME_MAX, type Settings } from '../../../shared/settings.ts';
import { MAX_SCALE, MIN_SCALE } from '../../../shared/size.ts';

const bridge = window.jjakkungSettings;

const CHATTER_HINT: Record<ChatterLevel, string> = {
  quiet: '답이 왔다는 알림만 해.',
  normal: `바쁠 때 같은 상태 알림까지, 한 시간에 ${MAX_PER_HOUR.normal}개까지.`,
  chatty: `혼잣말도 하고, 한 시간에 ${MAX_PER_HOUR.chatty}개까지.`,
};

export function SettingsApp() {
  const [snap, setSnap] = useState<SettingsSnapshot>();
  const [name, setName] = useState('');
  const [scale, setScale] = useState(1);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    bridge.get().then((s) => {
      setSnap(s);
      setName(s.settings.petName);
      setScale(s.scale);
    });
    bridge.onChanged((settings) => setSnap((s) => s && { ...s, settings }));
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  if (!snap) return <div className="loading">불러오는 중</div>;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';

  const flash = (message: string) => {
    setSaved(message);
    setTimeout(() => setSaved(''), 2400);
  };

  const update = async (patch: Partial<Settings>, message = '저장했어') => {
    const next = await bridge.set(patch);
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
    return next;
  };

  const saveName = async () => {
    const next = await update({ petName: name }, '이름을 바꿨어');
    setName(next.petName);
  };

  const preview = name.trim() || s.petName;

  return (
    <div className="settings">
      <header>
        <strong>설정</strong>
        <span className="saved" role="status" aria-live="polite">
          {saved}
        </span>
      </header>

      <main>
        <Section title="펫">
          <label className="field">
            <span>이름</span>
            <div className="row">
              <input
                value={name}
                maxLength={PET_NAME_MAX * 2}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <small>
              메뉴에는 "{withParticle(preview, '이랑')} 같이 보기", "{withParticle(preview, '과')} 대화"처럼
              보여. {PET_NAME_MAX}
              자까지.
            </small>
          </label>

          <div className="field">
            <span>모습</span>
            <div className="row">
              <button type="button" className="ghost" onClick={() => bridge.openMaker()}>
                {s.petImage ? '사진 펫 바꾸기' : '사진으로 펫 만들기'}
              </button>
            </div>
            <small>
              {s.petImage
                ? '지금은 사진으로 만든 펫이야. 기본 펫으로 돌아가기도 거기서 해.'
                : '반려동물이나 인형 사진 한 장으로 펫을 바꿀 수 있어.'}
            </small>
          </div>

          <label className="field">
            <span>
              크기 <b>{Math.round(scale * 100)}%</b>
            </span>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.05}
              value={scale}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScale(v);
                bridge.setScale(v);
              }}
            />
            <small>펫 위에서 {mod} + 휠, 트랙패드 핀치로도 바꿀 수 있어.</small>
          </label>

          <Toggle
            label="가끔 돌아다니기"
            hint="가만히 있다가 가끔 걷고 앉아. 끄면 늘 그 자리에 있어."
            on={s.wander}
            onChange={(v) => update({ wander: v })}
          />
        </Section>

        <Section title="말풍선">
          <fieldset className="segmented" aria-label="말풍선 빈도">
            {(['quiet', 'normal', 'chatty'] as const).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={s.chatter === level}
                className={s.chatter === level ? 'on' : ''}
                onClick={() => update({ chatter: level })}
              >
                {LEVEL_LABEL[level]}
              </button>
            ))}
          </fieldset>
          <small className="below">{CHATTER_HINT[s.chatter]}</small>
        </Section>

        <Section title="AI">
          <div className="field">
            <span>성격과 말투</span>
            <fieldset className="segmented wrap" aria-label="성격과 말투">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={s.persona === p.id}
                  className={s.persona === p.id ? 'on' : ''}
                  onClick={() => update({ persona: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </fieldset>
            <small>{PERSONAS.find((p) => p.id === s.persona)?.hint} 다음 질문부터 바뀌어.</small>
          </div>
          <Toggle
            label="내 할 일 같이 보내기"
            hint="질문할 때 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 제목을 AI 에 같이 보내. '오늘 뭐부터 할까?'에 답할 수 있어. 채팅 창 아래에서도 켜고 끌 수 있어."
            on={s.aiKnowsTodos}
            onChange={(v) => update({ aiKnowsTodos: v })}
          />
          <Toggle
            label="내 AI 설정 없이 부르기 (권장)"
            hint="Claude Code 와 Codex 를 부를 때 내 훅, MCP, 스킬을 싣지 않아. 끄면 내 설정을 그대로 쓰는데 답이 느려지고 한도를 더 쓸 수 있어. 바꾸면 새 대화로 시작해."
            on={s.aiIsolation}
            onChange={(v) => update({ aiIsolation: v })}
          />
        </Section>

        <Section title="다른 AI 에서 짝꿍 쓰기 (MCP)">
          <McpSetup exec={snap.mcp.exec} script={snap.mcp.script} onCopied={() => flash('복사했어')} />
        </Section>

        <Section title="시작">
          <Toggle
            label="컴퓨터를 켜면 같이 켜기"
            hint={
              snap.packaged
                ? '로그인하면 짝꿍이 저절로 떠.'
                : '설치한 앱에서만 바꿀 수 있어. 지금은 개발 중 실행이야.'
            }
            on={s.launchAtLogin}
            disabled={!snap.packaged}
            onChange={(v) => update({ launchAtLogin: v })}
          />
        </Section>

        <Section title="단축키">
          <dl className="keys">
            <dt>숨기기, 다시 보이기</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>H</kbd>
            </dd>
            <dt>할 일 한 줄 넣기 (어디서든)</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>N</kbd>
            </dd>
            <dt>크게, 작게, 원래대로 (마우스가 펫 위에 있을 때)</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </dd>
          </dl>
        </Section>

        <Stats onCopied={() => flash('복사했어. 의견과 같이 붙여 넣어 줘')} />

        <p className="version">짝꿍 {snap.version}</p>
      </main>
    </div>
  );
}

/**
 * 베타 기록 (P4-04). 기획서 성공 기준 다섯 가지를 지금 값과 목표로 보여 준다.
 * 메뉴 막대 "의견 보내기"로 열리면 이 칸으로 바로 내려온다.
 */
function Stats({ onCopied }: { onCopied: () => void }) {
  const [report, setReport] = useState<BetaReport>();
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const load = () => bridge.stats().then(setReport);
    const show = () => {
      load();
      setFocus(true);
      setTimeout(() => setFocus(false), 1600);
    };
    load();
    bridge.onFocus(show);
    if (location.hash === '#stats') show();
    // 창을 다시 볼 때 숫자를 새로 읽는다 (1분마다 쌓인다).
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    // 숫자를 읽기 전에는 칸이 없어서, 읽은 뒤에 내려간다.
    if (focus && report) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, report]);

  if (!report) return null;
  const started = report.dayNumber > 0;
  const rows: { label: string; value: string; goal: string; ok: boolean | undefined }[] = [
    {
      label: '쓴 날',
      value: started ? `${report.dayNumber}일째 (켠 날 ${report.daysUsed}일)` : '오늘부터',
      goal: '14일째에도 켜 두기',
      ok: started ? report.dayNumber >= 14 || undefined : undefined,
    },
    {
      label: '하루 끝낸 할 일 (중앙값)',
      value: `${report.doneMedian}개`,
      goal: `${TARGET.doneMedian}개 이상`,
      ok: started ? report.doneMedian >= TARGET.doneMedian : undefined,
    },
    {
      label: '펫을 숨긴 시간',
      value: `${Math.round(report.hiddenRatio * 100)}%`,
      goal: `${TARGET.hiddenRatio * 100}% 미만`,
      ok: started ? report.hiddenRatio < TARGET.hiddenRatio : undefined,
    },
    {
      label: '같이 보기 (최근 7일)',
      value: `${report.look7}번`,
      goal: `${TARGET.look7}번 이상`,
      ok: started ? report.look7 >= TARGET.look7 : undefined,
    },
    {
      label: '멈춤과 갑자기 꺼짐 (최근 7일)',
      value: `${report.crash7}번`,
      goal: `${TARGET.crash7}번`,
      ok: started ? report.crash7 <= TARGET.crash7 : undefined,
    },
  ];

  return (
    <section ref={ref} id="stats" className={focus ? 'focus' : ''}>
      <h2>내 기록 (베타)</h2>
      <div className="card">
        <small>
          짝꿍이 쓸 만한지 보는 숫자야. 이 컴퓨터에만 있고 어디로도 보내지 않아. 의견을 보낼 때 복사해서 같이
          붙여 주면 큰 도움이 돼.
        </small>
        <table className="stats">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  <b>{r.value}</b>
                  <small>
                    목표 {r.goal}
                    {r.ok === true && <i className="met"> 달성</i>}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              if (await bridge.copyStats()) onCopied();
            }}
          >
            기록 복사
          </button>
        </div>
        <small>복사한 글에는 날짜와 숫자만 들어가. 할 일 제목이나 대화 내용은 없어.</small>
      </div>
    </section>
  );
}

/**
 * 펫 MCP 서버 등록 안내 (v1). Claude Code 나 Codex 에서 "짝꿍 할 일에 넣어 줘"가 되게 한다.
 * 짝꿍 실행 파일을 Node 로 돌리므로 따로 설치할 것이 없다.
 */
function McpSetup({ exec, script, onCopied }: { exec: string; script: string; onCopied: () => void }) {
  const q = (p: string) => `"${p.replace(/"/g, '\\"')}"`;
  const claude = `claude mcp add jjakkung -s user -e ELECTRON_RUN_AS_NODE=1 -- ${q(exec)} ${q(script)}`;
  const codex = [
    '[mcp_servers.jjakkung]',
    `command = ${JSON.stringify(exec)}`,
    `args = [${JSON.stringify(script)}]`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }',
  ].join('\n');
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    onCopied();
  };
  return (
    <>
      <small>
        Claude Code, Codex 에 짝꿍을 연결하면 그 안에서 "이거 짝꿍 할 일에 넣어 줘", "내일 3시 회의 일정 잡아
        줘"가 돼. 할 일, 메모, 일정을 넣고 볼 수 있어. 넣은 것은 몇 초 안에 패널에 보여.
      </small>
      <div className="field">
        <span>Claude Code: 터미널에서 한 번 실행</span>
        <pre className="cmd">{claude}</pre>
        <div className="row">
          <button type="button" className="ghost" onClick={() => copy(claude)}>
            명령 복사
          </button>
        </div>
      </div>
      <div className="field">
        <span>Codex: ~/.codex/config.toml 에 붙여 넣기</span>
        <pre className="cmd">{codex}</pre>
        <div className="row">
          <button type="button" className="ghost" onClick={() => copy(codex)}>
            설정 복사
          </button>
        </div>
      </div>
      <small>짝꿍을 다른 폴더로 옮기거나 다시 설치하면 경로가 바뀌니 다시 등록해 줘.</small>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}

function Toggle({ label, hint, on, disabled, onChange }: ToggleProps) {
  return (
    <div className={`toggle ${disabled ? 'disabled' : ''}`}>
      <div className="text">
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={on ? 'on' : ''}
        onClick={() => onChange(!on)}
      >
        <i />
      </button>
    </div>
  );
}
