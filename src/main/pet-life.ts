import { powerMonitor } from 'electron';
import { type Energy, type EnergyLook, EnergyWatch, energyTalkKeys } from '../shared/energy.ts';
import { type I18nKey, t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import { voiced } from '../shared/persona-voice.ts';
import {
  type Activity,
  type LifeState,
  type PetLife,
  SULK_LINES,
  sulkLine,
  UNLOCKS,
} from '../shared/pet-life.ts';
import { isQuietNow } from '../shared/quiet-hours.ts';
import { REST, RestCoach, restLine } from '../shared/rest.ts';
import { bodyClock, restDaysOf } from '../shared/routine.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

const TICK_MS = 60_000;
/** 개운한 기지개(2.6초)를 다 켠 뒤에 말한다. 말풍선이 뜨면 하던 몸짓을 멈추기 때문 */
const AFTER_STRETCH_MS = 2800;

export interface PetLifeOptions {
  life: PetLife;
  todos: TodoStore;
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  petHidden: () => boolean;
  react: (kind?: ReactKind) => void;
  /** 집중 타이머 중 (펫이 잔다. 지친 혼잣말을 하지 않는다) */
  focusing: () => boolean;
  /** 삐짐이나 기분, 기운 모습이 바뀌었다 (펫 표정, 패널) */
  onChange: () => void;
  /** 산책 (휴식 권유에서 "같이 산책") */
  stroll: (minutes: number) => Promise<boolean>;
  /** 같이 한 일 (매운맛 토라짐을 달랜다, main/pout.ts). dayMadeUp 은 날 단위 삐짐이 이번에 풀렸는지 */
  onActivity?: (kind: Activity, dayMadeUp: boolean) => void;
  /** 휴식 권유를 넘겼다: 나중에, 그냥 닫음, 시간 끝 (매운맛 토라짐) */
  onRestIgnored?: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 펫의 하루 (v1): 삐짐 대사(하루 한 번), 화해 장면과 보너스, 친밀도 단계 축하.
 * 날이 바뀌는 것은 1분마다 본다.
 */
/** 단계마다 열린 행동 알림의 말 열쇠 (놓친 알림이 언어를 따라가게 열쇠로도 남긴다) */
function unlockMsg(step: number): { key: I18nKey; vars?: { step: number } } {
  const u = UNLOCKS.find((x) => x.step === step)?.unlock;
  if (u === 'wave') return { key: 'pet.unlock.wave' };
  if (u === 'dance') return { key: 'pet.unlock.dance' };
  if (u === 'flower') return { key: 'pet.unlock.flower' };
  return { key: 'pet.life.affection', vars: { step } };
}

function unlockLine(step: number): string {
  const m = unlockMsg(step);
  return voiced(m.key, m.vars);
}

export function createPetLife(o: PetLifeOptions) {
  let current: LifeState = read();

  function read(): LifeState {
    const s = settings.get();
    return o.life.state(Date.now(), restDaysOf(s), s.spicy);
  }

  function refresh() {
    const next = read();
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) o.onChange();
    // 삐진 날은 그날 처음 한 번 말한다. 조용히, 숨은 동안은 모습만 (기획서).
    if (current.sulk > 0 && !current.sulkSaidToday && !o.petHidden() && settings.get().chatter !== 'quiet') {
      // 삐진 말을 모두 안 쓰기로 했으면 말하지 않는다 (빈 말풍선 없이)
      const line = sulkLine(current.sulk);
      if (line)
        void o.say({ kind: 'system', text: line, ttlMs: 8000 }).then((action) => {
          if (action !== undefined) {
            o.life.markSulkSaid(Date.now());
            current = read();
          }
        });
    }
  }

  // ---- 휴식 권유 (v1) ----
  const coach = new RestCoach();
  // ---- 기운: 하루 리듬과 연속 작업 피로 (shared/energy.ts). 휴식 권유와 같은 틱에 센다 ----
  const watch = new EnergyWatch();
  /** 몸 시계: 만나는 시간(설정)이 9시가 되게 옮긴 지금 분. 만나는 시간을 껐으면 시각 그대로 (shared/routine.ts) */
  const bodyMinute = (at: Date) =>
    bodyClock(settings.get().routine, localDay(at.getTime()), at.getHours() * 60 + at.getMinutes());
  let energy: Energy = watch.tick(new Date(), 0, 0, bodyMinute(new Date())).energy;
  function restTick() {
    const now = Date.now();
    const idleSec = powerMonitor.getSystemIdleTime();
    const event = coach.tick(
      now,
      idleSec,
      isQuietNow(settings.get().quietHours, now) ? 'quiet' : settings.get().chatter,
    );
    const e = watch.tick(new Date(now), coach.streakMin, idleSec, bodyMinute(new Date(now)));
    energy = e.energy;
    const rhythmOn = settings.get().dayRhythm;
    if (e.changed && rhythmOn) {
      o.log(
        'life',
        '기운',
        energy.stage,
        energy.worn ? '녹초' : '',
        Math.round(energy.level * 100),
        coach.streakMin,
      );
      o.onChange();
    }
    if (event === 'rested') {
      o.todos.reward(REST.coins, 'rest', now);
      o.log('life', '휴식 보상');
      // 권유대로 쉬고 왔다: 반짝이며 기지개를 켜고 말한다 (하루 리듬을 끄면 예전처럼 통통 뛰며 바로)
      o.react(rhythmOn ? 'fresh' : 'happy');
      const rested = () =>
        void o.say({ kind: 'answer', text: voiced('pet.life.rested', { coins: REST.coins }), ttlMs: 5000 });
      if (rhythmOn) setTimeout(rested, AFTER_STRETCH_MS).unref();
      else rested();
      o.onChange();
      return;
    }
    if (rhythmOn && e.fresh) refreshed();
    if (event === 'suggest' && !o.petHidden()) {
      const line = restLine();
      void o
        .say({
          kind: 'system',
          text: line ?? '',
          buttons: [
            { id: 'go', label: t('pet.life.restGo') },
            { id: 'walk', label: t('pet.life.restWalk') },
            { id: 'later', label: t('pet.life.later') },
          ],
          ttlMs: 20_000,
        })
        .then((a) => {
          if (a === 'go' || a === 'walk') coach.accept(Date.now());
          else if (a === 'later' || a === 'dismiss' || a === 'timeout') o.onRestIgnored?.();
          if (a === 'walk') void o.stroll(5);
        });
    }
  }

  /**
   * 지쳤다가(90분 넘게 쉬지 않음) 5분 넘게 쉬고 돌아왔다 (하루 리듬 켬): 반짝 기지개를 켠 뒤 한마디.
   * 말은 system 이라 수다 빈도를 따른다 (조용히면 모습만). 숨거나 집중 중이면 하지 않는다.
   * 지친 동안의 혼잣말은 수다쟁이 혼잣말(idle-talk, talkKeys)이 한다
   */
  function refreshed() {
    if (o.petHidden() || o.focusing()) return;
    o.log('life', '기운 회복');
    o.react('fresh');
    setTimeout(
      () => void o.say({ kind: 'system', text: voiced('pet.energy.fresh'), ttlMs: 5000 }),
      AFTER_STRETCH_MS,
    ).unref();
  }

  function activity(kind: Activity) {
    const r = o.life.activity(kind, Date.now());
    o.onActivity?.(kind, !!r.madeUp);
    if (r.madeUp) {
      const { level, coins } = r.madeUp;
      if (coins > 0) o.todos.reward(coins, 'makeup', Date.now());
      o.log('life', '화해', level, coins);
      o.react();
      void o.say({
        kind: 'answer',
        text: coins > 0 ? voiced('pet.life.madeUpCoins', { coins }) : voiced('pet.life.madeUp'),
        ttlMs: 6000,
      });
    } else if (r.affectionStep) {
      o.log('life', '친밀도', r.affectionStep);
      void o.say({
        kind: 'system',
        // 단계마다 열린 행동을 알려 준다 (단계 표에 없으면 그냥 축하)
        text: unlockLine(r.affectionStep),
        ttlMs: 6000,
        hold: { missedMsgs: [unlockMsg(r.affectionStep)] },
      });
    }
    current = read();
    o.onChange();
  }

  const timer = setInterval(() => {
    refresh();
    restTick();
  }, TICK_MS);
  timer.unref();
  setTimeout(refresh, 5000).unref();

  return {
    get state() {
      return current;
    },
    /** 펫 화면에 보낼 기운 모습. 하루 리듬을 끄면 undefined (예전 모습) */
    get energy(): EnergyLook | undefined {
      return settings.get().dayRhythm ? { stage: energy.stage, worn: energy.worn } : undefined;
    },
    /** 수다쟁이 혼잣말에 더할 기운 대사 (idle-talk IdleFacts.more). 하루 리듬을 끄면 없다 */
    talkKeys() {
      return settings.get().dayRhythm ? energyTalkKeys(energy) : [];
    },
    activity,
    refresh,
    /** 개발용 (메인 디버거의 __jj): 1분 틱을 바로 한 번 돌린다. Date.now 와 쉰 시간을 바꿔 두고 부른다 */
    debugTick: restTick,
  };
}
