// 설정 창 여러 탭이 같이 쓰는 것: 메인 다리, 칸(Section), 켜고 끄기(Toggle), 탭이 받는 값
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import type { Settings } from '../../../shared/settings.ts';

export const bridge = window.jjakkungSettings;

/** 탭마다 넘기는 것: 지금 설정, 바꾸기, 상태줄 안내 */
export interface TabProps {
  snap: SettingsSnapshot;
  setSnap: Dispatch<SetStateAction<SettingsSnapshot | undefined>>;
  /** 설정을 바꾸고 상태줄에 안내 (기본 "저장했어") */
  update: (patch: Partial<Settings>, message?: string) => Promise<Settings>;
  /** 상태줄 안내. error 면 빨간 글씨 */
  flash: (message: string, error?: boolean) => void;
}

export const isMac = (snap: SettingsSnapshot) => snap.platform === 'darwin';

export function Section({
  title,
  children,
  id,
  lede,
}: {
  title: string;
  children: ReactNode;
  id?: string;
  /** 제목 아래 한 줄 설명 (큰 창의 페어리, 비서 구역에서 이 묶음이 무엇을 하는지) */
  lede?: string;
}) {
  return (
    <section id={id}>
      <h2>{title}</h2>
      {lede && <p className="section-lede">{lede}</p>}
      <div className="card">{children}</div>
    </section>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  /** 지금 상태 한 줄 (부스트가 배터리라 쉬는 중 등) */
  note?: string | undefined;
  onChange: (on: boolean) => void;
}

export function Toggle({ label, hint, on, disabled, note, onChange }: ToggleProps) {
  return (
    <div className={`toggle ${disabled ? 'disabled' : ''}`}>
      <div className="text">
        <span>{label}</span>
        {note && <small className="toggle-note">{note}</small>}
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
