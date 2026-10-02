import { type ReactNode, useEffect, useState } from 'react';
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

  const update = async (patch: Partial<Settings>, message = '저장했어') => {
    const next = await bridge.set(patch);
    setSnap((v) => v && { ...v, settings: next });
    setSaved(message);
    setTimeout(() => setSaved(''), 1600);
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
          <Toggle
            label="내 AI 설정 없이 부르기 (권장)"
            hint="Claude Code 와 Codex 를 부를 때 내 훅, MCP, 스킬을 싣지 않아. 끄면 내 설정을 그대로 쓰는데 답이 느려지고 한도를 더 쓸 수 있어. 바꾸면 새 대화로 시작해."
            on={s.aiIsolation}
            onChange={(v) => update({ aiIsolation: v })}
          />
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
            <dt>크게, 작게, 원래대로 (마우스가 펫 위에 있을 때)</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </dd>
          </dl>
        </Section>

        <p className="version">짝꿍 {snap.version}</p>
      </main>
    </div>
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
