// 패널에서 같이 쓰는 작은 그림들.

export function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 6.2l2.4 2.4 4.6-4.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

export function CoinIcon() {
  return (
    <svg className="coin" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3.6" className="inner" />
    </svg>
  );
}

export function RepeatIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 7V6a2.5 2.5 0 0 1 2.5-2.5h7M10.5 1.5l2 2-2 2M13 9v1a2.5 2.5 0 0 1-2.5 2.5h-7M5.5 14.5l-2-2 2-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.3 10.3l3.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 할 일 단계 (체크리스트) */
export function StepsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 4l1.3 1.3L5.6 3M2 10l1.3 1.3L5.6 9M8 4.3h6M8 10.3h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14a1.6 1.6 0 0 0 3 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 톱니바퀴 (패널 머리의 설정 단추) */
export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 고정(핀). 고정하면 몸통을 채운다 (.pin.on) */
/** 진행 중 표시(▶). 켜면 속을 채운다 */
export function PlayIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 3.2v9.6L12.6 8z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 크게 보기: 모서리 두 곳이 바깥으로 */
export function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 작게 보기: 모서리 두 곳이 안쪽으로 (크게 보기의 짝) */
export function ShrinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13 6H10V3M10 6L14.5 1.5M3 10h3v3M6 10L1.5 14.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        className="pin-body"
        d="M6.4 2.2v3.6L4.2 9.2h7.6L9.6 5.8V2.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 2.2h5.6M8 9.2v4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 줄 메뉴 단추 (점 셋) */
export function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.2" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.8" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** 끌어서 순서를 바꾸는 손잡이 (점 여섯) */
export function GripIcon() {
  return (
    <svg viewBox="0 0 8 14" aria-hidden="true">
      <circle cx="2" cy="3" r="1" fill="currentColor" />
      <circle cx="6" cy="3" r="1" fill="currentColor" />
      <circle cx="2" cy="7" r="1" fill="currentColor" />
      <circle cx="6" cy="7" r="1" fill="currentColor" />
      <circle cx="2" cy="11" r="1" fill="currentColor" />
      <circle cx="6" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}

/** 쪽지함 봉투. dot 이 true 면 안 읽은 쪽지가 있다는 점 (색만이 아니라 숫자와 이름도 따로 준다) */
export function MailIcon({ dot = false }: { dot?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 4l6 4.6L14 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      {dot && <circle className="mail-dot" cx="13" cy="3.2" r="2.6" />}
    </svg>
  );
}
