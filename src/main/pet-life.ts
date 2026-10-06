import { powerMonitor } from 'electron';
import { type Activity, type LifeState, type PetLife, SULK_LINES } from '../shared/pet-life.ts';
import { REST, REST_LINES, RestCoach } from '../shared/rest.ts';
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
      void o.say({ kind: 'answer', text: `잘 쉬었어? 코인 ${REST.coins}개.`, ttlMs: 5000 });
      o.onChange();
    } else if (event === 'suggest' && !o.petHidden()) {
      const line = REST_LINES[Math.floor(Math.random() * REST_LINES.length)] ?? REST_LINES[0];
      void o
        .say({
          kind: 'system',
          text: line ?? '',
          buttons: [
            { id: 'go', label: '다녀올게' },
            { id: 'walk', label: '같이 산책' },
            { id: 'later', label: '나중에' },
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
        text: coins > 0 ? `화해! 이제 안 삐졌어. 보너스 코인 ${coins}개.` : '화해! 이제 안 삐졌어.',
        ttlMs: 6000,
      });
    } else if (r.affectionStep) {
      o.log('life', '친밀도', r.affectionStep);
      void o.say({
        kind: 'system',
        text: `친밀도 ${r.affectionStep} 넘었어. 우리 꽤 친해졌다!`,
        ttlMs: 6000,
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
