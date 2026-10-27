// 무료 AI(로컬 모델) 일꾼 (v2). 메인과 따로 도는 utilityProcess 라 오래 안 쓰면 통째로 끝내서
// 모델 메모리(약 1GB)를 다 돌려준다. 메인과는 메시지로만 이야기한다.
import { getLlama, type Llama, LlamaChatSession, type LlamaContext, type LlamaModel } from 'node-llama-cpp';
import { pointToDownloadedLlama } from './llama-hook.ts';
import { guardGlobalFetch } from './net-fetch-core.ts';

export type WorkerIn =
  | {
      type: 'ask';
      id: string;
      modelPath: string;
      system: string;
      history: { role: 'user' | 'assistant'; text: string }[];
      text: string;
      noThink: boolean;
      maxTokens: number;
    }
  | { type: 'cancel'; id: string };

export type WorkerOut =
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; text: string }
  | { type: 'error'; id: string; message: string };

const port = process.parentPort;

let llama: Llama | undefined;
let loaded: { path: string; model: LlamaModel; context: LlamaContext } | undefined;

/** 줄에서 기다리다 멈춘 질문에 보내는 실패 표시. 메인은 이걸 받아야 듣기를 끝내고 바쁨을 놓는다 */
export const CANCELLED = '__cancelled__';

type Ask = Extract<WorkerIn, { type: 'ask' }>;

async function load(path: string) {
  if (loaded?.path === path) return loaded;
  await loaded?.context.dispose();
  await loaded?.model.dispose();
  // 미리 빌드된 엔진만 쓴다. 안 맞으면 소스 빌드로 넘어가는데, 사용자 컴퓨터엔 컴파일러가 없다
  llama ??= await getLlama({ build: 'never' });
  const model = await llama.loadModel({ modelPath: path });
  const context = await model.createContext({ contextSize: 2048 });
  loaded = { path, model, context };
  return loaded;
}

/**
 * 질문 줄과 멈춤을 맡는다. 답 만들기(answer)는 바꿔 끼울 수 있어 모델 없이 시험한다.
 * 질문은 한 번에 하나씩 줄을 세운다. 멈춘 질문이 문맥(시퀀스 1개)을 놓기 전에 다음 질문이 오면 실패해서.
 */
export function createAskQueue(
  post: (o: WorkerOut) => void,
  answer: (m: Ask, signal: AbortSignal, onDelta: (text: string) => void) => Promise<string>,
) {
  const running = new Map<string, AbortController>();
  let queue: Promise<void> = Promise.resolve();
  /** 줄에서 기다리다 멈춘 질문 */
  const cancelledEarly = new Set<string>();

  async function ask(m: Ask) {
    // 줄에서 멈췄어도 꼭 끝을 알린다. 안 그러면 메인이 계속 듣고 있어 바쁨이 안 풀린다(모델 못 지움, 메모리 안 놓음)
    if (cancelledEarly.delete(m.id)) {
      post({ type: 'error', id: m.id, message: CANCELLED });
      return;
    }
    const abort = new AbortController();
    running.set(m.id, abort);
    try {
      const text = await answer(m, abort.signal, (chunk) => post({ type: 'delta', id: m.id, text: chunk }));
      post({ type: 'done', id: m.id, text });
    } catch (err) {
      post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.delete(m.id);
    }
  }

  return (m: WorkerIn) => {
    if (m.type === 'cancel') {
      const r = running.get(m.id);
      if (r) r.abort();
      else cancelledEarly.add(m.id);
      return;
    }
    queue = queue.then(() => ask(m));
  };
}

async function answerWithModel(m: Ask, signal: AbortSignal, onDelta: (text: string) => void) {
  const { context } = await load(m.modelPath);
  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence });
  session.setChatHistory([
    { type: 'system', text: m.system },
    ...m.history.map((h) =>
      h.role === 'user'
        ? { type: 'user' as const, text: h.text }
        : { type: 'model' as const, response: [h.text] },
    ),
  ]);
  try {
    return await session.prompt(m.text, {
      maxTokens: m.maxTokens,
      // 작은 모델 비교 시험(2026-10-06). presencePenalty 1.5 는 짧은 반말 답을 엉뚱하게 만들어 0.5
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: { penalty: 1.05, presencePenalty: 0.5 },
      ...(m.noThink ? { budgets: { thoughtTokens: 0 } } : {}),
      signal,
      stopOnAbortSignal: true,
      onTextChunk: onDelta,
    });
  } finally {
    session.dispose({ disposeSequence: true });
  }
}

// 일꾼으로 떴을 때만 듣는다 (시험에서 불러올 땐 parentPort 가 없다)
if (port) {
  // 설치판은 엔진을 userData 에 받아 둔다. 엔진이 그 폴더를 찾게 한다 (getLlama 전에)
  pointToDownloadedLlama();
  const handle = createAskQueue((o) => port.postMessage(o), answerWithModel);
  // 일꾼은 바깥 요청을 하지 않지만(모델은 메인이 받아 경로로 준다), 의존 패키지가 전역 fetch 를 불러도 Node 의 Brotli 풀개에
  // 닿지 않게 크로미움 net.fetch 로 돌린다. net 을 못 얻으면 요청을 아예 거절한다 (net-fetch-core.ts)
  void blockNodeFetch().then(() => port.on('message', (e: { data: WorkerIn }) => handle(e.data)));
}

async function blockNodeFetch(): Promise<void> {
  try {
    const { net } = await import('electron');
    guardGlobalFetch(globalThis as { fetch: typeof fetch }, (input, init) =>
      net.fetch(input as string, init),
    );
  } catch {
    guardGlobalFetch(globalThis as { fetch: typeof fetch }, () =>
      Promise.reject(new TypeError('fetch failed')),
    );
  }
}
