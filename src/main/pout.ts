import { powerMonitor } from 'electron';
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import type { Activity } from '../shared/pet-life.ts';
import {
  forgive,
  grabbed,
  initPout,
  isPraise,
  POUT,
  type PoutChange,
  type PoutContext,
  type PoutReason,
  type PoutState,
  pickLine,
  pout,
  poutStage,
  remember,
  soothe,
  tickPout,
} from '../shared/pout.ts';
import { localDay } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

const TICK_MS = 30_000;
/** 못 한 말은 이만큼 기다렸다 다시 해 본다 (걷는 중, 다른 말풍선이 떠 있음) */
const RETRY_MS = 5000;
/** 못 한 말은 이만큼 지나면 버린다 (삐진 모습은 그대로) */
const PENDING_MS = 3 * 60_000;
/** 덜 풀렸을 때 말("...흥, 조금 풀렸어")은 이만큼에 한 번 (쓰다듬기는 2초마다 올 수 있다) */
const SOFTER_GAP_MS = 45_000;
/** 달랠 때 말은 반응 말("냠냠, 고마워!") 뒤에 */
const SOOTHE_DELAY_MS = 2200;

const LOOSE = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
const lines = (prefix: string, n: number, vars?: Record<string, string | number>) =>
  Array.from({ length: n }, (_, i) => LOOSE(`${prefix}.${i + 1}`, vars));

export interface PoutOptions {
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  petName: () => string;
  /** 방해하면 안 되는 때: 집중, 숨김(발표, 집 안 포함), 노는 중 */
  calm: () => boolean;
  /** 사용자가 숨겨 뒀다 (숨김 까닭 user) */
  userHidden: () => boolean;
  /** 지금 말풍선을 띄워도 된다 (보이고, 다른 말풍선이 없고, 들려 있지 않다) */
  canTalk: () => boolean;
  hungry: () => boolean;
  /** 마감 지난 안 끝낸 할 일 수 */
  overdue: () => number;
  /** 삐짐 단계가 바뀌었다 (펫 표정, 패널) */
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 매운맛 토라짐 (shared/pout.ts 규칙). 30초마다 시간을 세고, 같이 한 일(pet-life 활동), 대화의 칭찬,
 * 쓰다듬다 끌기, 휴식 권유 넘기기, 친구 펫 꺼내기를 받아 삐지고 풀린다. 잃는 것은 없다 (모습과 말만).
 */
export function createPout(o: PoutOptions) {
  let state: PoutState = initPout(localDay(Date.now()), Date.now());
  let lastTick = Date.now();
  let recent: string[] = [];
  let softerAt = 0;
  let pending: { text: string; until: number } | undefined;
  let retry: NodeJS.Timeout | undefined;

  function ctx(): PoutContext {
    return {
      spicy: settings.get().spicy,
      calm: o.calm(),
      present: powerMonitor.getSystemIdleTime() < POUT.presentIdleSec,
      hungry: o.hungry(),
      overdue: o.overdue(),
      userHidden: o.userHidden(),
    };
  }

  function line(pool: string[]): string {
    const text = pickLine(pool, recent, Math.random);
    recent = remember(recent, text);
    return text;
  }

  function reasonLines(reason: PoutReason, friend?: string): string[] {
    if (reason === 'todoLate') return lines('pout.todoLate', 4, { n: Math.max(1, o.overdue()) });
    if (reason === 'friend') {
      const all = lines('pout.friend', 4, { friend: friend ?? '' });
      // 이름을 모르면 이름이 들어가는 줄(1, 4)은 뺀다
      return friend ? all : all.slice(1, 3);
    }
    return lines(`pout.${reason}`, 4);
  }

  /** 삐진 말은 system 말풍선 (수다 빈도를 따른다. 조용히면 모습만). 지금 못 하면 잠깐 뒤에 다시 */
  function talk(text: string) {
    pending = { text, until: Date.now() + PENDING_MS };
    flush();
  }
  function flush() {
    clearTimeout(retry);
    if (!pending) return;
    if (Date.now() > pending.until || poutStage(state.points) === 0) {
      pending = undefined;
      return;
    }
    if (o.calm() || !o.canTalk()) {
      retry = setTimeout(flush, RETRY_MS);
      retry.unref();
      return;
    }
    const { text } = pending;
    pending = undefined;
    void o.say({ kind: 'system', text, ttlMs: 7000 });
  }

  function apply(c: PoutChange, friend?: string) {
    state = c.state;
    if (c.from === c.to && !c.pouted) return;
    if (c.pouted) {
      o.log('pout', '삐짐', c.pouted, `${c.from}->${c.to}`, state.points);
      // 세 단계(등 돌리기)로 처음 넘어가면 그 말, 아니면 까닭 말
      talk(line(c.to === 3 && c.from < 3 ? lines('pout.stage3', 4) : reasonLines(c.pouted, friend)));
    } else o.log('pout', '단계', `${c.from}->${c.to}`, state.points);
    o.onChange();
  }

  function tick() {
    const now = Date.now();
    const minutes = (now - lastTick) / 60_000;
    lastTick = now;
    apply(tickPout(state, ctx(), now, localDay(now), minutes));
  }

  const SOOTHE_OF: Record<Activity, Parameters<typeof soothe>[1]> = {
    todo: 'todo',
    click: 'click',
    chat: 'chat',
    feed: 'feed',
    pet: 'pet',
    play: 'play',
  };

  function soothed(kind: Parameters<typeof soothe>[1]) {
    const now = Date.now();
    const r = soothe(state, kind, now);
    state = r.state;
    if (r.result === 'none') return;
    o.log('pout', '달램', kind, r.result, `${r.from}->${r.to}`);
    pending = undefined;
    if (r.result === 'madeUp') {
      // 풀리는 연출: 하트가 피어오르고 통통, 한마디
      setTimeout(() => {
        o.react('love');
        o.react('happy');
        void o.say({ kind: 'answer', text: line(lines('pout.madeUp', 6)), ttlMs: 5000 });
      }, SOOTHE_DELAY_MS).unref();
    } else if (now - softerAt >= SOFTER_GAP_MS) {
      softerAt = now;
      setTimeout(
        () => void o.say({ kind: 'answer', text: line(lines('pout.softer', 6)), ttlMs: 4000 }),
        SOOTHE_DELAY_MS,
      ).unref();
    }
    if (r.from !== r.to) o.onChange();
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref();

  return {
    /** 지금 토라짐 단계 0~3 (매운맛이 아니면 늘 0) */
    get stage(): number {
      return poutStage(state.points);
    },
    /** 패널에 보일 까닭 (삐지지 않았으면 undefined) */
    get why(): string | undefined {
      if (poutStage(state.points) === 0 || !state.reason) return undefined;
      return LOOSE(`pout.why.${state.reason}`);
    },
    /** 펫 우클릭 메뉴 맨 위 한 줄 (대답이 짧아진다). 안 삐졌으면 undefined */
    menuNote(): string | undefined {
      const stage = poutStage(state.points);
      return stage > 0 ? LOOSE(`pout.menu.${stage}`, { name: o.petName() }) : undefined;
    },
    /**
     * 같이 한 일 (pet-life 활동). 날 단위 삐짐이 같이 풀렸으면(dayMadeUp) 그 화해 장면이 있으니 말 없이 다 푼다
     */
    activity(kind: Activity, dayMadeUp: boolean) {
      if (dayMadeUp && state.points > 0) {
        state = forgive(state, Date.now());
        pending = undefined;
        o.log('pout', '날 화해와 같이 풀림');
        o.onChange();
        return;
      }
      soothed(SOOTHE_OF[kind]);
    },
    /** 대화 창에 쓴 말. 칭찬이나 사과면 달래진다 */
    said(text: string) {
      if (isPraise(text)) soothed('praise');
    },
    /** 들어 옮기기 시작 (쓰다듬은 직후면 삐진다) */
    grabbed() {
      apply(grabbed(state, ctx(), Date.now()));
    },
    /** 휴식 권유를 넘겼다 */
    restIgnored() {
      apply(pout(state, 'restIgnored', ctx(), Date.now()));
    },
    /** 친구 펫을 꺼냈다 */
    friendAdded(name: string) {
      apply(pout(state, 'friend', ctx(), Date.now()), name);
    },
    tick,
    /** 개발용 (__jj): 점수와 까닭을 바로 정한다 (그림 찍기, 시험) */
    debugSet(points: number, reason: PoutReason = 'lonely') {
      const from = poutStage(state.points);
      state = {
        ...state,
        points: Math.max(0, Math.min(POUT.maxPoints, points)),
        reason,
        decayAt: Date.now(),
      };
      if (from !== poutStage(state.points)) o.onChange();
    },
    /** 개발용 (__jj): 간격과 쉬는 시간을 비우고 진짜 길로 삐지게 한다 (말풍선 찍기) */
    debugPout(reason: PoutReason, friend?: string) {
      state = { ...state, lastAt: 0, last: {}, madeUpAt: 0, today: 0 };
      apply(pout(state, reason, ctx(), Date.now()), friend);
    },
    debugState: () => state,
  };
}
