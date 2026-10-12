// 채팅의 AI 가 부른 지우기, 고치기, 메모 덧붙이기를 사용자에게 묻고 허락하면 한다 (shared/pet-actions.ts).
// 펫 MCP 서버가 pet-actions-inbox.json 에 남긴 것을 읽어 펫 말풍선으로 한 번에 묻는다.
import { app } from 'electron';
import { cutText } from '../shared/cut-text.ts';
import { t } from '../shared/i18n/index.ts';
import {
  actionTarget,
  applyPetAction,
  PET_ACTIONS_INBOX,
  type PetAction,
  type PetActionStores,
  parsePetActions,
} from '../shared/pet-actions.ts';
import { drainInbox } from './memory-inbox.ts';
import type { SayOptions } from './pet-window.ts';

/** 말풍선에 보일 한 줄 */
function line(a: PetAction, target: string): string {
  const name = target.length > 40 ? `${cutText(target, 39)}…` : target;
  return t(`main.petAction.${a.tool}`, { name });
}

export function createPetConfirm(o: {
  stores: PetActionStores;
  say: (o: SayOptions) => Promise<string | undefined>;
  onChange: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let asking = false;
  const waiting: PetAction[] = [];

  async function ask(): Promise<void> {
    if (asking) return;
    // 그새 지워진 대상은 묻지 않는다
    const list = waiting.splice(0).filter((a) => actionTarget(o.stores, a) !== undefined);
    if (list.length === 0) return;
    asking = true;
    try {
      const lines = list.map((a) => `• ${line(a, actionTarget(o.stores, a) ?? '')}`);
      const action = await o.say({
        kind: 'answer',
        text: [t('main.petAction.ask', { n: list.length }), ...lines].join('\n'),
        ttlMs: 90_000,
        buttons: [
          { id: 'yes', label: t('main.petAction.yes') },
          { id: 'no', label: t('main.petAction.no') },
        ],
      });
      if (action !== 'yes') {
        o.log('pet-action', '안 함', list.length, action ?? '');
        return;
      }
      const now = Date.now();
      const done = list.filter((a) => applyPetAction(o.stores, a, now)).length;
      o.log('pet-action', '허락해서 함', done, list.length);
      if (done > 0) o.onChange();
      void o.say({ kind: 'answer', text: t('main.petAction.done', { n: done }), ttlMs: 6000 });
    } finally {
      asking = false;
      if (waiting.length) void ask();
    }
  }

  /** 편지함을 읽어 묻는다 (질문이 끝날 때, 몇 초마다) */
  function drain(): void {
    try {
      drainInbox(
        app.getPath('userData'),
        (incoming) => {
          for (const a of parsePetActions(incoming))
            if (!waiting.some((w) => JSON.stringify(w) === JSON.stringify(a))) waiting.push(a);
        },
        `${PET_ACTIONS_INBOX}.json`,
      );
    } catch (err) {
      o.log('pet-action', '편지함 실패', err instanceof Error ? err.message : String(err));
    }
    if (waiting.length) void ask();
  }

  return { drain };
}
