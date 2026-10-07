import { powerMonitor } from 'electron';
import { t } from '../shared/i18n/index.ts';
import { type Activity, type LifeState, type PetLife, SULK_LINES, UNLOCKS } from '../shared/pet-life.ts';
import { REST, RestCoach, restLines } from '../shared/rest.ts';
import type { TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

const TICK_MS = 60_000;

export interface PetLifeOptions {
  life: PetLife;
  todos: TodoStore;
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  petHidden: () => boolean;
  react: () => void;
  /** 삐짐이나 기분이 바뀌었다 (펫 표정, 패널) */
  onChange: () => void;
  /** 산책 (휴식 권유에서 "같이 산책") */
  stroll: (minutes: number) => Promise<boolean>;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 펫의 하루 (v1): 삐짐 대사(하루 한 번), 화해 장면과 보너스, 친밀도 단계 축하.
 * 날이 바뀌는 것은 1분마다 본다.
 */
function unlockLine(step: number): string {
  const u = UNLOCKS.find((x) => x.step === step)?.unlock;
  if (u === 'wave') return t('pet.unlock.wave');
  if (u === 'dance') return t('pet.unlock.dance');
  if (u === 'flower') return t('pet.unlock.flower');
  return t('pet.life.affection', { step });
}

export function createPetLife(o: PetLifeOptions) {
  let current: LifeState = read();

  function read(): LifeState {
    const s = settings.get();
    return o.life.state(Date.now(), s.restDays, s.spicy);
  }

  function refresh() {
    const next = read();
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) o.onChange();
    // 삐진 날은 그날 처음 한 번 말한다. 조용히, 숨은 동안은 모습만 (기획서).
    if (current.sulk > 0 && !current.sulkSaidToday && !o.petHidden() && settings.get().chatter !== 'quiet') {
      const line = SULK_LINES[current.sulk] ?? SULK_LINES[1];
      void o.say({ kind: 'system', text: line ?? '', ttlMs: 8000 }).then((action) => {
        if (action !== undefined) {
          o.life.markSulkSaid(Date.now());
          current = read();
        }
      });
    }
  }

  // ---- 휴식 권유 (v1) ----
  const coach = new RestCoach();
  function restTick() {
    const now = Date.now();
    const event = coach.tick(now, powerMonitor.getSystemIdleTime(), settings.get().chatter);
    if (event === 'rested') {
      o.todos.reward(REST.coins, 'rest', now);
      o.log('life', '휴식 보상');
      o.react();
      void o.say({ kind: 'answer', text: t('pet.life.rested', { coins: REST.coins }), ttlMs: 5000 });
      o.onChange();
    } else if (event === 'suggest' && !o.petHidden()) {
      const lines = restLines();
      const line = lines[Math.floor(Math.random() * lines.length)] ?? lines[0];
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
          if (a === 'walk') void o.stroll(5);
        });
    }
  }

  function activity(kind: Activity) {
    const r = o.life.activity(kind, Date.now());
    if (r.madeUp) {
      const { level, coins } = r.madeUp;
      if (coins > 0) o.todos.reward(coins, 'makeup', Date.now());
      o.log('life', '화해', level, coins);
      o.react();
      void o.say({
        kind: 'answer',
        text: coins > 0 ? t('pet.life.madeUpCoins', { coins }) : t('pet.life.madeUp'),
        ttlMs: 6000,
      });
    } else if (r.affectionStep) {
      o.log('life', '친밀도', r.affectionStep);
      void o.say({
        kind: 'system',
        // 단계마다 열린 행동을 알려 준다 (단계 표에 없으면 그냥 축하)
        text: unlockLine(r.affectionStep),
        ttlMs: 6000,
        hold: {},
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
    activity,
    refresh,
  };
}
