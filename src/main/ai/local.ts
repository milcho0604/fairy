import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, type UtilityProcess, utilityProcess } from 'electron';
import type { LocalModel } from '../../shared/ai/catalog.ts';
import { cleanLocalAnswer } from '../../shared/ai/local-text.ts';
import { withRules } from '../../shared/ai/persona.ts';
import { HISTORY_TURNS } from '../../shared/ai/text.ts';
import type { AiEvent } from '../../shared/ai/types.ts';
import { t } from '../../shared/i18n/index.ts';
import { hasFinalConsonant } from '../../shared/josa.ts';
import { boostOn } from '../boost.ts';
import { ensureVerified, verifyExisting } from '../download.ts';
import { ensureLlamaBins, llamaBinsMissingBytes, llamaBinsReady, llamaWorkerEnv } from '../llama-bins.ts';
import type { WorkerIn, WorkerOut } from '../llm-worker.ts';
import type { AiRequest, AiRun } from './runner.ts';

/** 안 쓰고 이만큼 지나면 일꾼을 끝내 메모리를 돌려준다 */
const IDLE_MS = 5 * 60_000;
/** 부스트 모드면 30분 데워 둔다 (다음 답에 모델 읽기가 없어 빠르다. 그동안 모델 크기만큼 메모리를 더 쓴다) */
const BOOST_IDLE_MS = 30 * 60_000;
/** 펫 대화는 짧다. 작은 모델이 같은 말을 되풀이해도 여기서 멈춘다 */
const MAX_TOKENS = 220;
/** 첫 글자까지 기다리는 한도 (모델 읽기 포함) */
const FIRST_TOKEN_MS = 60_000;

export const localModelPath = (m: LocalModel) => join(app.getPath('userData'), 'models', 'llm', m.file);
/** 모델과 엔진(처음 쓸 때 같이 받는다, llama-bins.ts)이 다 있는지 */
export const localModelReady = (m: LocalModel) => existsSync(localModelPath(m)) && llamaBinsReady();

/**
 * 모델 파일을 쓸 수 있는지: 있고, 해시가 목록과 맞는지(실행마다 한 번 확인). 깨졌거나 목록의 해시가 바뀌었으면
 * 지우고 false 라서 받기 단추가 다시 뜬다.
 */
async function localModelUsable(m: LocalModel): Promise<boolean> {
  return llamaBinsReady() && (await verifyExisting(localModelPath(m), m.sha256));
}

/** 일꾼이 죽었을 때 받는 쪽에 알리는 표시 */
const CRASHED = '__crashed__';
/** 줄에서 기다리다 멈춘 질문에 일꾼이 보내는 표시 (llm-worker.ts CANCELLED 와 같다. 값을 불러오면 일꾼이 메인에 묶여 들어와 글로 둔다) */
const CANCELLED = '__cancelled__';

/**
 * 모델을 받는다(처음 한 번). 엔진이 없으면 엔진(약 5~11MB)부터. 진행률 0~1 은 둘을 합친 크기로 센다.
 * 둘 다 해시가 맞아야 쓴다
 */
export async function downloadLocalModel(
  m: LocalModel,
  onProgress: (r: number) => void,
  signal?: AbortSignal,
) {
  const engine = llamaBinsMissingBytes();
  const total = engine + m.bytes;
  await ensureLlamaBins((r) => onProgress((r * engine) / total), signal);
  return ensureVerified(
    { path: localModelPath(m), url: m.url, sha256: m.sha256, bytes: m.bytes },
    (r) => onProgress((engine + r * m.bytes) / total),
    signal,
  );
}

let worker: UtilityProcess | undefined;
let idleTimer: NodeJS.Timeout | undefined;
/** 답을 기다리는 질문. 어느 일꾼에 물었는지도 둔다: 끝낸 옛 일꾼의 exit 가 새 일꾼에 물은 질문을 죽이지 않게 */
const listeners = new Map<string, { worker: UtilityProcess; on: (o: WorkerOut) => void }>();
/** 시작했지만 아직 일꾼에 묻지 않은 질문 (모델 해시를 맞추는 중). 이때도 바쁘다 */
const starting = new Set<string>();

function getWorker(log: (tag: string, ...rest: unknown[]) => void): UtilityProcess {
  if (worker) return worker;
  const w = utilityProcess.fork(join(import.meta.dirname, 'llm-worker.js'), [], {
    serviceName: 'jjakkung-llm',
    // 받아 둔 엔진 폴더 (설치판). 개발 실행이면 비어 있어 node_modules 의 것을 쓴다
    env: { ...process.env, ...llamaWorkerEnv() },
  });
  w.on('message', (o: WorkerOut) => {
    const l = listeners.get(o.id);
    if (l?.worker === w) l.on(o);
  });
  w.on('exit', (code) => {
    log('local-ai', '일꾼 끝남', code);
    if (worker === w) worker = undefined;
    // 이 일꾼에 물은 질문에만 알린다 (죽었으면)
    for (const [id, l] of listeners) if (l.worker === w) l.on({ type: 'error', id, message: CRASHED });
  });
  worker = w;
  log('local-ai', '일꾼 시작');
  return w;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(
    () => {
      if (localBusy() || !worker) return;
      // 끝나는 중인 일꾼에 새 질문이 가지 않게 바로 놓는다
      const w = worker;
      worker = undefined;
      w.kill();
    },
    boostOn() ? BOOST_IDLE_MS : IDLE_MS,
  );
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
  // 받침 있는 이름은 "이야", 없으면 "야" (밤이야, 밀크야)
  `넌 내 데스크톱 펫 ${petName}${hasFinalConsonant(petName) ? '이야' : '야'}. 나랑 친구니까 반말로 다정하게, 두세 문장으로 짧게 말해. 모르는 건 모른다고 해. 한자, 중국어, 일본어는 절대 쓰지 마. 한글로만 말해.`;

/** 무료 AI 로 묻는다. runAi 와 같은 모양(사건 콜백, 취소). banmal: 한국어 반말 성격이면 예시와 후처리를 쓴다 */
export function runLocal(
  req: AiRequest,
  model: LocalModel,
  onEvent: (e: AiEvent) => void,
  log: (tag: string, ...rest: unknown[]) => void,
  opts: { banmal: boolean; petName?: string; rules?: string } = { banmal: false },
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

  // 질문을 시작한 때부터 바쁘다: 모델 해시를 맞추는 사이 저장 공간에서 모델을 지우지 못하게 (버그잡이 6차)
  starting.add(id);
  let mine: UtilityProcess | undefined;
  const finished = new Promise<void>((resolve) => {
    // 해시를 읽다 실패해도(파일을 못 읽음) 기다리는 쪽이 멈추지 않게 실패로 끝낸다
    start(resolve).catch((err) => {
      log('local-ai', '시작 실패', err instanceof Error ? err.message : String(err));
      emit({ type: 'error', error: { kind: 'failed', message: t('ai.local.failed') } });
      resolve();
    });
  }).finally(() => starting.delete(id));

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
      mine?.postMessage({ type: 'cancel', id } satisfies WorkerIn);
      emit({ type: 'error', error: { kind: 'timeout', message: t('ai.local.slow') } });
      end();
    }, FIRST_TOKEN_MS);
    const end = () => {
      clearTimeout(firstTimer);
      listeners.delete(id);
      touch();
      resolve();
    };
    const w = getWorker(log);
    mine = w;
    listeners.set(id, {
      worker: w,
      on: (o) => {
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
        else if (o.message !== CANCELLED) {
          log('local-ai', '실패', o.message);
          const message = o.message === CRASHED ? t('ai.local.crashed') : t('ai.local.failed');
          emit({ type: 'error', error: { kind: 'failed', message } });
        }
        end();
      },
    });
    starting.delete(id);
    // 작은 모델은 문맥이 짧아(2048) 규칙은 앞 RULES_LOCAL_MAX 자만
    const shortRules = (opts.rules ?? '').slice(0, RULES_LOCAL_MAX);
    const msg: WorkerIn = {
      type: 'ask',
      id,
      modelPath: localModelPath(model),
      system: opts.banmal
        ? banmalSystem(opts.petName ?? '콩이') + withRules(shortRules)
        : shortPersona(req.persona, opts.rules ?? '', shortRules),
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
    w.postMessage(msg);
  }

  return {
    cancel() {
      if (settled) return;
      mine?.postMessage({ type: 'cancel', id } satisfies WorkerIn);
      emit({ type: 'error', error: { kind: 'cancelled', message: t('ai.error.cancelled') } });
    },
    finished,
  };
}

const RULES_LOCAL_MAX = 1000;

/** 성격 끝에 붙은 규칙을 짧은 것으로 바꾼다 (존댓말, 영어처럼 반말 예시를 안 쓸 때) */
export function shortPersona(persona: string, rules: string, short: string): string {
  const full = withRules(rules);
  if (!full || full === withRules(short) || !persona.endsWith(full)) return persona;
  return persona.slice(0, -full.length) + withRules(short);
}

/** 받을 크기(MB). 엔진을 아직 안 받았으면 엔진도 더한다 */
export const mb = (m: LocalModel) => Math.round((m.bytes + llamaBinsMissingBytes()) / 1_000_000);

/** 답하는 중인지 (모델 파일을 지우기 전에 본다) */
export const localBusy = () => listeners.size > 0 || starting.size > 0;

/** 일꾼을 끝낸다 (앱을 끝낼 때, 모델 파일을 지울 때). 끝나는 중인 일꾼에 새 질문이 가지 않게 바로 놓는다 */
export function stopLocal() {
  const w = worker;
  worker = undefined;
  w?.kill();
}
