import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, type UtilityProcess, utilityProcess } from 'electron';
import type { LocalModel } from '../../shared/ai/catalog.ts';
import { cleanLocalAnswer } from '../../shared/ai/local-text.ts';
import { HISTORY_TURNS } from '../../shared/ai/text.ts';
import type { AiEvent } from '../../shared/ai/types.ts';
import { t } from '../../shared/i18n/index.ts';
import { ensureVerified, isVerified, markVerified, sha256Of } from '../download.ts';
import type { WorkerIn, WorkerOut } from '../llm-worker.ts';
import type { AiRequest, AiRun } from './runner.ts';

/** 안 쓰고 이만큼 지나면 일꾼을 끝내 메모리를 돌려준다 */
const IDLE_MS = 5 * 60_000;
/** 펫 대화는 짧다. 작은 모델이 같은 말을 되풀이해도 여기서 멈춘다 */
const MAX_TOKENS = 220;
/** 첫 글자까지 기다리는 한도 (모델 읽기 포함) */
const FIRST_TOKEN_MS = 60_000;

export const localModelPath = (m: LocalModel) => join(app.getPath('userData'), 'models', 'llm', m.file);
export const localModelReady = (m: LocalModel) => existsSync(localModelPath(m));

/**
 * 모델 파일을 쓸 수 있는지: 있고, 해시가 목록과 맞는지(실행마다 한 번 확인). 깨졌거나 목록의 해시가 바뀌었으면
 * 지우고 false 라서 받기 단추가 다시 뜬다.
 */
async function localModelUsable(m: LocalModel): Promise<boolean> {
  const path = localModelPath(m);
  if (!existsSync(path)) return false;
  if (isVerified(path)) return true;
  if ((await sha256Of(path)) === m.sha256) {
    markVerified(path);
    return true;
  }
  rmSync(path, { force: true });
  return false;
}

/** 일꾼이 죽었을 때 받는 쪽에 알리는 표시 */
const CRASHED = '__crashed__';

/** 모델을 받는다(처음 한 번). 진행률 0~1. 해시가 맞아야 쓴다 */
export function downloadLocalModel(m: LocalModel, onProgress: (r: number) => void, signal?: AbortSignal) {
  return ensureVerified(
    { path: localModelPath(m), url: m.url, sha256: m.sha256, bytes: m.bytes },
    onProgress,
    signal,
  );
}

let worker: UtilityProcess | undefined;
let idleTimer: NodeJS.Timeout | undefined;
const listeners = new Map<string, (o: WorkerOut) => void>();

function getWorker(log: (tag: string, ...rest: unknown[]) => void): UtilityProcess {
  if (worker) return worker;
  const w = utilityProcess.fork(join(import.meta.dirname, 'llm-worker.js'), [], {
    serviceName: 'jjakkung-llm',
  });
  w.on('message', (o: WorkerOut) => listeners.get(o.id)?.(o));
  w.on('exit', (code) => {
    log('local-ai', '일꾼 끝남', code);
    if (worker === w) worker = undefined;
    // 답을 기다리던 쪽에 알린다 (죽었으면)
    for (const [id, l] of listeners) l({ type: 'error', id, message: CRASHED });
  });
  worker = w;
  log('local-ai', '일꾼 시작');
  return w;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (listeners.size > 0 || !worker) return;
    // 끝나는 중인 일꾼에 새 질문이 가지 않게 바로 놓는다
    const w = worker;
    worker = undefined;
    w.kill();
  }, IDLE_MS);
  idleTimer.unref();
}

/**
 * 작은 모델은 "반말로" 지시만으로는 존댓말로 답한다. 반말 예시 대화를 앞 대화로 넣으면 훨씬 잘 따른다
 * (2026-10-06 비교 시험 변형 a, b). 한자 금지 한 줄도 같이 준다.
 */
const BANMAL_EXAMPLES = [
  { question: '배고파', answer: '헉, 배고프구나! 간단하게 뭐라도 먹고 오자.' },
  {
    question: '오늘 할 일 너무 많아',
    answer: '많구나. 제일 급한 거 하나만 먼저 끝내 보자. 내가 옆에서 응원할게!',
  },
  { question: '고마워', answer: '에헤헤, 나도 고마워! 언제든 불러.' },
];
/**
 * 작은 모델에는 긴 성격 지시보다 짧은 지시가 낫다. 앱의 긴 지시(목록, 화면 캡처, 이모지 규칙)를 그대로 주면
 * "했어."처럼 앞뒤 없는 답이 잦았다(2026-10-06 같은 질문 8번 비교)
 */
const banmalSystem = (petName: string) =>
  `넌 내 데스크톱 펫 ${petName}야. 나랑 친구니까 반말로 다정하게, 두세 문장으로 짧게 말해. 모르는 건 모른다고 해. 한자, 중국어, 일본어는 절대 쓰지 마. 한글로만 말해.`;

/** 무료 AI 로 묻는다. runAi 와 같은 모양(사건 콜백, 취소). banmal: 한국어 반말 성격이면 예시와 후처리를 쓴다 */
export function runLocal(
  req: AiRequest,
  model: LocalModel,
  onEvent: (e: AiEvent) => void,
  log: (tag: string, ...rest: unknown[]) => void,
  opts: { banmal: boolean; petName?: string } = { banmal: false },
): AiRun {
  const id = randomUUID();
  let settled = false;
  let raw = '';
  let shown = '';
  const emit = (e: AiEvent) => {
    if (settled) return;
    if (e.type === 'done' || e.type === 'error') settled = true;
    onEvent(e);
  };

  const finished = new Promise<void>((resolve) => void start(resolve));

  async function start(resolve: () => void) {
    if (!(await localModelUsable(model))) {
      emit({
        type: 'error',
        error: { kind: 'needs-model', message: t('ai.local.needsModel', { mb: mb(model) }) },
      });
      resolve();
      return;
    }
    if (settled) {
      resolve(); // 확인하는 동안 취소됨
      return;
    }
    const firstTimer = setTimeout(() => {
      worker?.postMessage({ type: 'cancel', id } satisfies WorkerIn);
      emit({ type: 'error', error: { kind: 'timeout', message: t('ai.local.slow') } });
      end();
    }, FIRST_TOKEN_MS);
    const end = () => {
      clearTimeout(firstTimer);
      listeners.delete(id);
      touch();
      resolve();
    };
    listeners.set(id, (o) => {
      if (o.type === 'delta') {
        clearTimeout(firstTimer);
        raw += o.text;
        // 다듬은 글에서 새로 늘어난 만큼만 내보낸다 (다듬기가 앞 글을 바꾸면 끝에서 한 번에 맞춘다)
        const clean = cleanLocalAnswer(raw, { partial: true });
        if (clean.startsWith(shown) && clean.length > shown.length) {
          emit({ type: 'delta', text: clean.slice(shown.length) });
          shown = clean;
        }
        return;
      }
      if (o.type === 'done')
        emit({ type: 'done', text: cleanLocalAnswer(o.text || raw, { banmal: opts.banmal }) });
      else {
        log('local-ai', '실패', o.message);
        const message = o.message === CRASHED ? t('ai.local.crashed') : t('ai.local.failed');
        emit({ type: 'error', error: { kind: 'failed', message } });
      }
      end();
    });
    const msg: WorkerIn = {
      type: 'ask',
      id,
      modelPath: localModelPath(model),
      system: opts.banmal ? banmalSystem(opts.petName ?? '콩이') : req.persona,
      history: [...(opts.banmal ? BANMAL_EXAMPLES : []), ...req.history.slice(-HISTORY_TURNS)].flatMap(
        (h) => [
          { role: 'user' as const, text: h.question },
          { role: 'assistant' as const, text: h.answer },
        ],
      ),
      text: req.text,
      noThink: !!model.noThink,
      maxTokens: MAX_TOKENS,
    };
    getWorker(log).postMessage(msg);
  }

  return {
    cancel() {
      if (settled) return;
      worker?.postMessage({ type: 'cancel', id } satisfies WorkerIn);
      emit({ type: 'error', error: { kind: 'cancelled', message: t('ai.error.cancelled') } });
    },
    finished,
  };
}

export const mb = (m: LocalModel) => Math.round(m.bytes / 1_000_000);

/** 앱을 끝낼 때 */
export function stopLocal() {
  worker?.kill();
}
