// 펫 성장 단계와 철마다 옷 (2026-10-11). 함께한 날과 친밀도로 단계를 정하고 가장 자란 단계를 grow.json 에 둔다
// (되돌아가지 않게). 자라면 한 번 축하한다. 오늘 옷은 날짜로 (설정 "철마다 옷"을 끄면 없다). 판단은 shared/wear.ts.
import { ipcMain } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';
import { BOND, type GrowInfo } from '../shared/bond-ipc.ts';
import { dayNumber } from '../shared/companion.ts';
import { t } from '../shared/i18n/index.ts';
import type { ReactKind } from '../shared/ipc.ts';
import { localDay } from '../shared/todo-store.ts';
import {
  type GrowStage,
  grownStage,
  isGrowStage,
  nextGrow,
  outfitFor,
  stageFor,
  type WearLook,
} from '../shared/wear.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';

const FILE = 'grow';
const CHECK_MS = 10 * 60_000;

export interface WearOptions {
  stats: Pick<StatStore, 'firstDay'>;
  affection: () => number;
  petName: () => string;
  say: (o: SayOptions) => Promise<string | undefined>;
  react: (kind?: ReactKind) => void;
  /** 단계나 옷이 바뀌었다 (펫 화면에 다시 알린다) */
  onChange: () => void;
  /** 설정 창에서 온 요청인지 */
  fromSettings: (sender: Electron.WebContents) => boolean;
  log: (tag: string, ...rest: unknown[]) => void;
}

export function createWear(o: WearOptions) {
  const raw = readJson(FILE) as { stage?: unknown } | undefined;
  let saved: GrowStage | undefined = isGrowStage(raw?.stage) ? raw.stage : undefined;
  // 이 판에서 처음 켰고 이미 쓰던 사람: 지금 모습(어른)에서 시작한다 (갑자기 작아지지 않게)
  if (!saved && raw === undefined && settings.get().onboarded) saved = 'adult';
  const save = () => {
    try {
      writeJson(FILE, { stage: saved });
    } catch (err) {
      o.log('wear', '저장 실패', err instanceof Error ? err.message : String(err));
    }
  };

  const days = (now: number) => {
    const first = o.stats.firstDay();
    return first ? Math.max(1, dayNumber(first, localDay(now))) : 1;
  };

  /** 지금 단계 (계산한 것과 저장한 것 중 더 자란 것). 자랐으면 저장 */
  function stage(now = Date.now()): GrowStage {
    const next = grownStage(saved, stageFor(days(now), o.affection()));
    if (next !== saved) {
      const grew = saved !== undefined;
      saved = next;
      save();
      if (grew) {
        o.log('wear', '자람', next);
        o.react('cheer');
        void o.say({
          kind: 'system',
          text: t(next === 'adult' ? 'bond.grow.adult' : 'bond.grow.kid', { name: o.petName() }),
          ttlMs: 8000,
          hold: {
            missedMsgs: [
              { key: next === 'adult' ? 'bond.grow.adult' : 'bond.grow.kid', vars: { name: o.petName() } },
            ],
          },
        });
      }
    }
    return next;
  }

  /** 펫 화면에 보낼 모습 (PetStatus.wear) */
  function look(now = Date.now()): WearLook {
    const s = settings.get();
    return { stage: stage(now), ...(s.seasonWear ? { outfit: outfitFor(localDay(now)) } : {}) };
  }

  function info(now = Date.now()): GrowInfo {
    const st = stage(now);
    const d = days(now);
    const a = o.affection();
    const next = nextGrow(st, d, a);
    return {
      stage: st,
      days: d,
      affection: a,
      ...(next ? { next } : {}),
      outfit: outfitFor(localDay(now)),
      photo: !!settings.get().petImage,
    };
  }

  ipcMain.handle(BOND.growGet, (e) => (o.fromSettings(e.sender) ? info() : undefined));
  // 날이 바뀌면 옷이, 친밀도가 오르면 단계가 바뀐다. 같은 모습이면 부르는 쪽(sendStatus)이 거른다
  const timer = setInterval(() => o.onChange(), CHECK_MS);
  timer.unref();
  settings.onChange((next, prev) => {
    if (next.seasonWear !== prev.seasonWear) o.onChange();
  });

  return {
    look,
    info,
    /** 친구 펫의 모습: 같은 옷, 성장은 어른 그대로 */
    friendLook: (now = Date.now()): WearLook => ({
      stage: 'adult',
      ...(settings.get().seasonWear ? { outfit: outfitFor(localDay(now)) } : {}),
    }),
    stop: () => clearInterval(timer),
  };
}

export type Wear = ReturnType<typeof createWear>;
