// 큰 창(home)을 언제 어떻게 열고 닫는지의 정함. 창 객체에 기대지 않는 순수 함수라 단위 시험이 된다 (큰 창 설계 #159, #161).
import type { HomeChatRect } from './ipc.ts';

/** 패널 보기: 펫 클릭과 패널 단축키, 메뉴 막대 "패널"이 여는 것. 작은 패널 또는 큰 창 */
export type PanelView = 'compact' | 'window';

const PANEL_VIEWS: readonly PanelView[] = ['compact', 'window'];

export const isPanelView = (v: unknown): v is PanelView => PANEL_VIEWS.includes(v as PanelView);

/** 숨겨 둔 큰 창을 이만큼 지나면 없앤다 (렌더러 메모리를 돌려준다) */
export const HOME_KEEP_MS = 10 * 60_000;

/** 큰 창의 기본 크기와 가장 작은 크기 */
export const HOME_SIZE = { width: 1100, height: 720 } as const;
export const HOME_MIN = { width: 760, height: 520 } as const;

/** 큰 창 모습: 없음, 숨겨 둠(우리가 hide), 보임 */
export interface HomeLook {
  /** 창이 살아 있다 (숨겨 둔 것 포함) */
  alive: boolean;
  /** 우리가 숨겨 두었다 (다시 누르면 바로 뜬다) */
  hidden: boolean;
}

/** 큰 창이 "열려 있다": 살아 있고 숨겨 두지 않았다 */
export const homeOpen = (h: HomeLook): boolean => h.alive && !h.hidden;

/**
 * 펫 클릭, 패널 단축키, 메뉴 막대 "패널"이 여는 것.
 * 큰 창이 열려 있으면 패널 보기와 상관없이 큰 창(패널과 큰 창은 동시에 열지 않는다), 아니면 패널 보기가 정한다
 */
export function panelTarget(view: PanelView, home: HomeLook): 'panel' | 'home' {
  return homeOpen(home) || view === 'window' ? 'home' : 'panel';
}

/**
 * 앱을 다시 열었다(맥 Dock 아이콘 누르기, Spotlight): 큰 창이 열려 있거나 내려가 있으면 그 창을 되살리고(home),
 * 아니면 숨은 펫을 부른다(pet). 우리가 숨겨 둔 큰 창은 Dock 아이콘이 없으니 펫을 부르는 길이다
 */
export function reopenTarget(why: string, home: HomeLook): 'home' | 'pet' {
  return why === 'activate' && homeOpen(home) ? 'home' : 'pet';
}

export interface HomeSeen {
  alive: boolean;
  /** 우리가 숨겨 두었다 */
  hidden: boolean;
  /** 맥 Dock 으로 내려가 있다 (최소화) */
  minimized: boolean;
  /** 키보드 포커스가 큰 창에 있다 (펫 창은 포커스를 받지 않아 펫을 눌러도 그대로다) */
  focused: boolean;
}

/**
 * 큰 창을 다시 눌렀을 때: 없으면 만들고, 숨겨 뒀거나 내려가 있으면 띄우고, 뒤에 있으면 앞으로, 맨 앞이면 숨긴다
 * (숨기면 스크롤과 글이 남고 다시 열 때 바로 뜬다)
 */
export function homeClickAction(h: HomeSeen): 'create' | 'show' | 'raise' | 'hide' {
  if (!h.alive) return 'create';
  if (h.hidden || h.minimized) return 'show';
  return h.focused ? 'hide' : 'raise';
}

/**
 * 작은 패널에서 "크게 보기"로 넘길 때 (이슈 #164): 없으면 만들고, 열려 있으면 앞으로,
 * 숨겨 둔 창이 있으면 새로 만든다(숨겨 둔 창은 쓰던 글을 만들 때 한 번 읽어 와서 패널에서 고친 것이 안 보인다)
 */
export function promoteAction(h: HomeLook): 'create' | 'recreate' | 'show' {
  if (!h.alive) return 'create';
  return h.hidden ? 'recreate' : 'show';
}

/** 숨겨 둔 지 이만큼 지나 없앨 때가 됐나 */
export function homeExpired(
  hiddenAt: number | undefined,
  now: number,
  keepMs: number = HOME_KEEP_MS,
): boolean {
  return hiddenAt !== undefined && now - hiddenAt >= keepMs;
}

/** 채팅 view 가 받은 키 가운데 큰 창이 맡는 것: Cmd/Ctrl 하나 + W(닫기), 쉼표(설정), 1~9(구역). 나머지(복사, 붙이기 등)는 채팅이 그대로 쓴다 */
export function isHomeChord(
  input: { type: string; code: string; meta: boolean; control: boolean; alt: boolean; shift: boolean },
  mac: boolean,
): boolean {
  if (input.type !== 'keyDown' || input.alt || input.shift) return false;
  if (mac ? !input.meta || input.control : !input.control || input.meta) return false;
  return input.code === 'KeyW' || input.code === 'Comma' || /^Digit[1-9]$/.test(input.code);
}

/** 채팅 자리 값을 믿을 수 있는 모양으로. 아니면 undefined (null 은 "채팅 구역이 아님"이라 따로 본다) */
export function parseChatRect(raw: unknown): HomeChatRect | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const x = n(r.x);
  const y = n(r.y);
  const width = n(r.width);
  const height = n(r.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width < 1 || height < 1 || x < 0 || y < 0 || width > 20000 || height > 20000) return undefined;
  return { x, y, width, height };
}
