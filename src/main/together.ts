// 같이 지내는 느낌 (2026-10-11): 같이 타자 치기와 같이 일하는 표정. 판단은 shared/together.ts.
//
// 같이 타자 치기 개인정보: 어떤 키를 눌렀는지 읽지 않는다. 전역 키 후크를 걸지 않고, 운영체제의 "마지막 입력 뒤 지난 초"
// (powerMonitor.getSystemIdleTime)와 커서 자리만 1초에 두 번까지 본다. 입력이 있었는데 커서가 그대로면 키보드로 친다.
// 아무것도 저장하거나 밖으로 보내지 않는다. 펫 화면에는 "지금 입력 중인지" 참, 거짓만 간다.
// 설정이 꺼졌거나 배터리 절약 중, 펫이 숨었거나 집중 중(자는 중)이면 보지도 않는다.
//
// 같이 일하는 표정: Claude Code, Codex 같은 AI 도구가 짝꿍 MCP 서버를 부르면 서버가 데이터 폴더의 mcp-beat 파일 시각만
// 바꾼다(무엇을 불렀는지는 적지 않는다, mcp-server.ts). 그 시각이 새로우면 잠깐 집중한 얼굴로 연필을 든다.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, powerMonitor, screen } from 'electron';
import type { PersonaId } from '../shared/ai/persona.ts';
import { t } from '../shared/i18n/index.ts';
import { IPC } from '../shared/ipc.ts';
import { basePersonaOf, styled } from '../shared/persona-voice.ts';
import {
  MCP_BEAT_FILE,
  NO_TOGETHER,
  type NoteLook,
  nextTyping,
  sameTogether,
  type TogetherLook,
  TYPING,
  TYPING_IDLE,
  type TypingState,
  typingPollMs,
  typingWanted,
  WORK_LOOK_MS,
  WORK_POLL_MS,
} from '../shared/together.ts';
import { saverNow } from './battery.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

/** 같이 타자 치기를 쉬는 동안 다시 볼지 확인하는 간격 (시스템을 부르지 않고 설정과 상태만 본다) */
const GATE_MS = 3000;

export interface TogetherOptions {
  win: () => BrowserWindow | undefined;
  /** 펫이 숨었다 (사용자, 발표, 집 안) */
  hidden: () => boolean;
  /** 집중 타이머 중이라 펫이 잔다 */
  asleep: () => boolean;
  persona: () => PersonaId;
  /** 같이 일하자는 말을 걸어도 되는 때 */
  canTalk: () => boolean;
  say: (o: SayOptions) => Promise<string | undefined>;
  userData: string;
  log: (tag: string, ...rest: unknown[]) => void;
}

export function createTogether(o: TogetherOptions) {
  let look: TogetherLook = NO_TOGETHER;
  let sent: TogetherLook | undefined;
  function push() {
    const w = o.win();
    if (!w || w.isDestroyed()) return;
    if (sent && sameTogether(sent, look)) return;
    sent = look;
    w.webContents.send(IPC.together, look);
  }
  function set(patch: Partial<TogetherLook>) {
    const next = { ...look, ...patch };
    if (!next.note) delete next.note;
    look = next;
    push();
  }

  // ---- 같이 타자 치기 ----
  let typing: TypingState = TYPING_IDLE;
  let lastCursor: { x: number; y: number } | undefined;
  /** 개발용: 가짜 입력 (true 면 키보드를 치는 중, false 면 손 뗌). undefined 면 진짜를 본다 */
  let fake: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 마지막으로 본 것 (개발 점검용. 숫자 하나와 참거짓 하나뿐이다) */
  let lastSample: { idleSec: number; cursorMoved: boolean } | undefined;

  function wanted(): boolean {
    return typingWanted({
      on: settings.get().typeAlong,
      saver: saverNow(),
      hidden: o.hidden(),
      asleep: o.asleep(),
    });
  }

  function tick() {
    timer = undefined;
    if (!wanted()) {
      // 쉬는 동안은 시스템을 부르지 않는다. 치던 중이었으면 바로 그친다
      typing = TYPING_IDLE;
      lastCursor = undefined;
      if (look.typing) set({ typing: false });
      timer = setTimeout(tick, GATE_MS);
      return;
    }
    const now = Date.now();
    const idleSec = fake === undefined ? powerMonitor.getSystemIdleTime() : fake ? 0 : 30;
    const cursor = fake === undefined ? screen.getCursorScreenPoint() : (lastCursor ?? { x: 0, y: 0 });
    const cursorMoved = !!lastCursor && (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y);
    lastCursor = cursor;
    lastSample = { idleSec, cursorMoved };
    const next = nextTyping(typing, { at: now, idleSec, cursorMoved });
    if (next.active !== typing.active) o.log('together', next.active ? '같이 타자 시작' : '같이 타자 그침');
    typing = next;
    if (typing.active !== look.typing) set({ typing: typing.active });
    timer = setTimeout(tick, typing.active || typing.run > 0 ? TYPING.pollMs : typingPollMs(idleSec));
  }
  timer = setTimeout(tick, GATE_MS);
  // 설정을 끄거나 켜면 기다리지 않고 바로 본다
  settings.onChange((next, prev) => {
    if (next.typeAlong === prev.typeAlong) return;
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
  });

  // ---- 같이 일하는 표정 ----
  const beatFile = join(o.userData, MCP_BEAT_FILE);
  const beatAt = (): number | undefined => {
    try {
      return statSync(beatFile).mtimeMs;
    } catch {
      return undefined;
    }
  };
  // 켜기 전에 남은 시각은 지난 일이다
  let seenBeat = beatAt() ?? 0;
  let workUntil = 0;
  let workTimer: ReturnType<typeof setTimeout> | undefined;
  let greeted = false;
  function working(now = Date.now()) {
    workUntil = now + WORK_LOOK_MS;
    clearTimeout(workTimer);
    workTimer = setTimeout(() => set({ working: false }), WORK_LOOK_MS);
    workTimer.unref?.();
    if (!look.working) o.log('together', '같이 일하는 중');
    set({ working: true });
    // 같이 하자는 말은 켤 때마다 한 번 (수다 빈도를 따른다: 상태 알림이라 조용히면 말없이 표정만)
    if (!greeted && o.canTalk()) {
      greeted = true;
      void o.say({
        kind: 'system',
        text: styled(t('together.work', { p: basePersonaOf(o.persona()) }), o.persona()),
        ttlMs: 4000,
      });
    }
  }
  const beatTimer = setInterval(() => {
    const at = beatAt();
    if (at === undefined || at <= seenBeat) return;
    seenBeat = at;
    // 오래전 시각(시계가 돌아간 파일)은 무시한다
    if (Date.now() - at < WORK_LOOK_MS) working();
  }, WORK_POLL_MS);
  beatTimer.unref();

  return {
    get look() {
      return look;
    },
    /** 들고 있는 쪽지 (main/daily-note.ts). 없으면 내려놓는다 */
    setNote(note: NoteLook | undefined) {
      if (look.note !== note) set({ note });
    },
    /** 펫 화면을 다시 불러왔다: 지금 모습을 다시 보낸다 */
    resend() {
      sent = undefined;
      push();
    },
    get typing() {
      return typing.active;
    },
    get lastSample() {
      return lastSample;
    },
    get workingUntil() {
      return workUntil;
    },
    /** 개발용: 가짜 입력. true 치는 중, false 손 뗌, undefined 진짜 입력으로 */
    debugFeed(on: boolean | undefined) {
      fake = on;
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    },
    /** 개발용: MCP 를 부른 것처럼 */
    debugWork: () => working(),
    stop() {
      clearTimeout(timer);
      clearTimeout(workTimer);
      clearInterval(beatTimer);
    },
  };
}

export type Together = ReturnType<typeof createTogether>;
