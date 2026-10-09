// Hugging Face 무료 Space 로 펫 그림 다시 그리기 (AI 일러스트, 2026-10-09). Electron 없이 돌아 시험에서 가짜 fetch 로 부른다.
//
// @gradio/client 를 쓰지 않고 Gradio 의 HTTP 큐 규약을 직접 쓴다. 이 저장소는 작업 사본들이 node_modules 를 같이 써서
// 패키지를 더하면 다른 사본까지 바뀌고, 메인 번들은 의존성을 밖에 두어 설치 없이는 못 돈다. 규약은 짧다:
//   1. POST {root}/gradio_api/upload (multipart, 칸 이름 files) → ["/tmp/gradio/.../pet.jpg"]
//   2. POST {root}/gradio_api/call/{endpoint} {"data":[...]} → {"event_id":"..."}
//   3. GET  {root}/gradio_api/call/{endpoint}/{event_id} (SSE) → event: complete / error, data: JSON
//   4. 결과 파일 url (없으면 {root}/gradio_api/file={path}) 을 받는다
// 옛 Gradio(4.x)는 /gradio_api 없이 같은 길이라 처음 올리기가 404 면 한 번 바꿔 본다.
// 토큰(선택)은 그 Space 주소로만 Authorization 머리에 실어 보낸다. 기록에는 남기지 않는다.

/** Space 하나: 이름, 그림 그리는 길 하나(다른 길은 절대 고르지 않는다), 넣을 값 순서 */
export interface IllustSpace {
  id: string;
  endpoint: string;
  inputs(image: FileRef, prompt: string): unknown[];
}

/** 올린 파일을 가리키는 Gradio FileData */
export interface FileRef {
  path: string;
  orig_name: string;
  meta: { _type: 'gradio.FileData' };
}

/**
 * 시도할 Space 순서. 2026-10-09 실제로 돌려 봄: FLUX.1 Kontext 는 토큰 없이 된다 (/infer, 1분쯤, 784x1328 webp).
 * Qwen-Image-Edit 는 토큰 없이는 "GPU duration (240s) is larger than the maximum allowed" 로 막혔다 (토큰이 있으면 될 수 있다).
 * 같은 Space 의 /lambda 는 받은 그림을 그대로 돌려주는 길이라 쓰지 않는다
 */
export const SPACES: IllustSpace[] = [
  {
    id: 'black-forest-labs/FLUX.1-Kontext-Dev',
    endpoint: 'infer',
    // input_image, prompt, seed, randomize_seed, guidance_scale, steps
    inputs: (image, prompt) => [image, prompt, 0, true, 2.5, 28],
  },
  {
    id: 'Qwen/Qwen-Image-Edit',
    endpoint: 'infer',
    // image, prompt, seed, randomize_seed, true_guidance_scale, num_inference_steps, rewrite_prompt
    inputs: (image, prompt) => [image, prompt, 0, true, 4, 50, false],
  },
];

/** Space 주소: 이름의 글자와 숫자 아닌 것을 - 로 (black-forest-labs/FLUX.1-Kontext-Dev → black-forest-labs-flux-1-kontext-dev) */
export function spaceRoot(id: string): string {
  return `https://${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.hf.space`;
}

/**
 * 실패 종류. quota 하루 무료 사용량 끝, limit 토큰 없이는 못 쓰는 크기, auth 토큰이 틀림, busy 바쁘거나 잠듦,
 * runtime 그 Space 의 오류, network 연결 안 됨, bad 이상한 답, same 그림을 안 그리고 그대로 돌려줌,
 * timeout 너무 오래, cancelled 그만둠
 */
export type IllustErrorKind =
  | 'quota'
  | 'limit'
  | 'auth'
  | 'busy'
  | 'runtime'
  | 'network'
  | 'bad'
  | 'same'
  | 'timeout'
  | 'cancelled';

export class IllustError extends Error {
  readonly kind: IllustErrorKind;
  constructor(kind: IllustErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * 오류 글과 HTTP 상태로 종류를 고른다. 실제 무료 사용량 끝 글: "...your ZeroGPU runs limit. Authenticate with a
 * Hugging Face token for more quota" (토큰 없이 하루 3번쯤, 2026-10-09). 쿼터 글은 다른 Space 에서도 같으니 바로 멈춘다
 */
export function classify(message: string, status?: number, withToken = false): IllustErrorKind {
  const m = message.toLowerCase();
  // 토큰을 안 보냈는데 401, 403 이면 토큰 탓이 아니다 (Space 가 막혔거나 잠긴 것). 다음 Space 로
  if (status === 401 || status === 403) return withToken ? 'auth' : 'busy';
  if (/larger than the maximum allowed/.test(m)) return 'limit';
  if (/quota|runs limit|exceeded your|zerogpu.*limit/.test(m)) return 'quota';
  if (withToken && /invalid (user )?token|unauthori[sz]ed|invalid credentials/.test(m)) return 'auth';
  // 글 없는 429 는 대개 잠깐의 속도 제한이다. 오늘 사용량 끝은 위 글로 안다
  if (
    status === 429 ||
    /rate.?limit|too many requests/.test(m) ||
    (status !== undefined && status >= 500) ||
    /queue is full|too busy|is sleeping|building|starting|paused|no gpu/.test(m)
  )
    return 'busy';
  return 'runtime';
}

/**
 * 실패 여러 개를 화면에 보일 하나로: 쿼터, 토큰, 이상한 답이 먼저. 그다음 잠깐 안 됨(busy, runtime)이 크기 제한보다 먼저:
 * 토큰 없이는 둘째 Space 가 늘 크기 제한이라, 첫 Space 가 잠깐 막혔는데 "토큰이 있어야 해" 로 보이면 안 된다
 */
export function worst(kinds: IllustErrorKind[]): IllustErrorKind {
  for (const k of ['quota', 'auth', 'same', 'bad'] as const) if (kinds.includes(k)) return k;
  if (kinds.some((k) => k === 'busy' || k === 'runtime')) return 'busy';
  if (kinds.includes('limit')) return 'limit';
  return kinds.length > 0 && kinds.every((k) => k === 'network') ? 'network' : 'busy';
}

/** 받을 그림 상한 (webp 784x1328 이 수백 KB) */
export const MAX_RESULT_BYTES = 16 * 1024 * 1024;

export type ImageKind = 'png' | 'webp' | 'jpeg';

/** 머리말로 그림 형식을 본다 */
export function imageKind(b: Uint8Array): ImageKind | undefined {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const s = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  return undefined;
}

/**
 * 결과 data 에서 그림 파일 주소를 찾는다. 첫 값이 파일 경로 글, {url, path} FileData, {image: FileData} 같은 dict,
 * 또는 그 목록(갤러리)일 수 있다. url 은 그 Space 주소 아래일 때만 믿고 (토큰을 다른 곳에 보내지 않게),
 * 아니면 path 로 주소를 만든다. 못 찾으면 undefined
 */
export function resultUrl(data: unknown, root: string, prefix = '/gradio_api'): string | undefined {
  const first = Array.isArray(data) ? data[0] : data;
  const file = (v: unknown, depth = 0): string | undefined => {
    if (depth > 3 || v == null) return undefined;
    if (typeof v === 'string') return v.startsWith('/') || /^https?:/.test(v) ? fromPath(v) : undefined;
    if (Array.isArray(v)) return file(v[0], depth + 1);
    if (typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    if (typeof o.url === 'string' && o.url.startsWith(`${root}/`)) return o.url;
    if (typeof o.path === 'string') return fromPath(o.path);
    for (const key of ['image', 'value', 'file', 'output']) {
      const hit = file(o[key], depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  const fromPath = (p: string): string | undefined => {
    if (/^https?:/.test(p)) return p.startsWith(`${root}/`) ? p : undefined;
    return `${root}${prefix}/file=${p}`;
  };
  return file(first);
}

/** SSE 글 덩어리를 빈 줄로 나눈 사건들과 남은 글로 */
export function parseSse(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks
    .map((block) => {
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      return { event, data: data.join('\n') };
    })
    .filter((e) => e.event !== 'message' || e.data !== '');
  return { events, rest };
}

/** multipart 몸통 (files 칸 하나). FormData 가 Electron net.fetch 에서 그대로 가는지 몰라 직접 만든다 */
export function multipart(bytes: Uint8Array, name: string, mime: string, boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface IllustOptions {
  fetch: FetchLike;
  /** 무료 Hugging Face 토큰 (선택). 없으면 익명 (하루 몇 번) */
  token?: string;
  /** 전체 상한. 기본 4분 */
  timeoutMs?: number;
  signal?: AbortSignal;
  spaces?: IllustSpace[];
  /** 기록 (토큰과 그림은 넣지 않는다) */
  log?: (tag: string, ...rest: unknown[]) => void;
}

export interface IllustResult {
  bytes: Uint8Array;
  kind: ImageKind;
  space: string;
}

export const ILLUST_TIMEOUT_MS = 4 * 60_000;

/**
 * 사진(JPEG, PNG)을 Space 에 차례로 보내 처음 성공한 그림을 돌려준다. 쿼터, 토큰 오류, 시간 초과, 그만두기는
 * 다음 Space 로 넘어가지 않고 바로 실패. 그 밖의 실패는 다음 Space 로. 받은 그림이 보낸 것과 바이트까지 같으면 실패(same)
 */
export async function illustrate(
  photo: Uint8Array,
  mime: 'image/jpeg' | 'image/png',
  prompt: string,
  opt: IllustOptions,
): Promise<IllustResult> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, opt.timeoutMs ?? ILLUST_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  if (opt.signal?.aborted) ac.abort();
  opt.signal?.addEventListener('abort', onAbort);
  const stopped = () => (timedOut ? new IllustError('timeout') : new IllustError('cancelled'));
  const kinds: IllustErrorKind[] = [];
  try {
    for (const space of opt.spaces ?? SPACES) {
      if (ac.signal.aborted) throw stopped();
      const started = Date.now();
      try {
        const r = await runSpace(space, photo, mime, prompt, opt, ac.signal);
        if (sameBytes(r.bytes, photo)) throw new IllustError('same', 'echoed input');
        opt.log?.('illust', space.id, 'ok', `${Math.round((Date.now() - started) / 1000)}s`, r.kind);
        return { ...r, space: space.id };
      } catch (err) {
        if (ac.signal.aborted) throw stopped();
        const e = err instanceof IllustError ? err : new IllustError('network', errText(err));
        opt.log?.('illust', space.id, e.kind, e.message.slice(0, 200));
        if (e.kind === 'quota' || e.kind === 'auth') throw e;
        kinds.push(e.kind);
      }
    }
    throw new IllustError(worst(kinds));
  } finally {
    clearTimeout(timer);
    opt.signal?.removeEventListener('abort', onAbort);
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function runSpace(
  space: IllustSpace,
  photo: Uint8Array,
  mime: string,
  prompt: string,
  opt: IllustOptions,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; kind: ImageKind }> {
  const root = spaceRoot(space.id);
  const auth: Record<string, string> = opt.token ? { authorization: `Bearer ${opt.token}` } : {};
  const call = async (url: string, init: RequestInit = {}) => {
    try {
      // 넘겨주기(redirect)는 따라가지 않는다: Space 가 다른 주소(내 컴퓨터, 집 안 망)로 보내지 못하게
      return await opt.fetch(url, {
        ...init,
        headers: { ...auth, ...(init.headers ?? {}) },
        redirect: 'error',
        signal,
      });
    } catch (err) {
      throw new IllustError('network', errText(err));
    }
  };
  const fail = async (res: Response) => {
    const body = await smallText(res, signal).catch(() => '');
    return new IllustError(classify(body, res.status, !!opt.token), `${res.status} ${body.slice(0, 200)}`);
  };
  const json = (res: Response) =>
    smallText(res, signal).then(
      (s) => JSON.parse(s) as unknown,
      () => null,
    );

  // 1. 사진 올리기 (새 Gradio 는 /gradio_api 아래, 옛것은 바로 아래)
  const name = mime === 'image/png' ? 'pet.png' : 'pet.jpg';
  const boundary = `----jj${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const body = multipart(photo, name, mime, boundary);
  let prefix = '/gradio_api';
  const upload = () =>
    call(`${root}${prefix}/upload`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: body as BodyInit,
    });
  let res = await upload();
  if (res.status === 404) {
    prefix = '';
    res = await upload();
  }
  if (!res.ok) throw await fail(res);
  const paths = await json(res).catch(() => null);
  const path = Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : undefined;
  if (!path) throw new IllustError('bad', 'upload answer');
  const image: FileRef = { path, orig_name: name, meta: { _type: 'gradio.FileData' } };

  // 2. 부르기
  const api = `${root}${prefix}/call/${space.endpoint}`;
  res = await call(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: space.inputs(image, prompt) }),
  });
  if (!res.ok) throw await fail(res);
  const joined = (await json(res).catch(() => null)) as { event_id?: unknown } | null;
  const id = typeof joined?.event_id === 'string' ? joined.event_id : undefined;
  if (!id || !/^[\w-]{1,128}$/.test(id)) throw new IllustError('bad', 'no event id');

  // 3. 결과 기다리기 (SSE)
  res = await call(`${api}/${id}`, { headers: { accept: 'text/event-stream' } });
  if (!res.ok) throw await fail(res);
  const data = await waitComplete(res, signal);

  // 4. 그림 받기 (그 Space 주소 아래만)
  const url = resultUrl(data, root, prefix);
  if (!url) throw new IllustError('bad', 'no image in answer');
  res = await call(url);
  if (!res.ok) throw await fail(res);
  const bytes = await readCapped(res, MAX_RESULT_BYTES, signal);
  const kind = imageKind(bytes);
  if (!kind) throw new IllustError('bad', 'not an image');
  return { bytes, kind };
}

/** 몸통을 끝까지 읽는다. 그만두면 바로 멈춘다 (가짜 응답처럼 fetch 의 signal 을 모르는 몸통도) */
async function readAll(
  res: Response,
  signal: AbortSignal,
  onChunk: (chunk: Uint8Array) => boolean | undefined,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new IllustError('bad', 'no body');
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new IllustError('cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  aborted.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) return;
      if (value && onChunk(value) === false) return;
    }
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    reader.cancel().catch(() => {});
  }
}

/** 그림 말고 짧은 답(오류 글, 올리기, 부르기)은 64KB 까지만 읽는다 */
async function smallText(res: Response, signal: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await readCapped(res, 64 * 1024, signal));
}

async function readCapped(res: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let size = 0;
  await readAll(res, signal, (c) => {
    size += c.length;
    if (size > max) throw new IllustError('bad', 'answer too big');
    parts.push(c);
    return undefined;
  });
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** complete 사건의 data(JSON)를 돌려준다. error 사건이면 그 글로 종류를 고른다. 끝까지 안 오면 runtime */
async function waitComplete(res: Response, signal: AbortSignal): Promise<unknown> {
  const dec = new TextDecoder();
  let buffer = '';
  let result: { data: unknown } | undefined;
  await readAll(res, signal, (chunk) => {
    buffer += dec.decode(chunk, { stream: true });
    if (buffer.length > 1024 * 1024) throw new IllustError('bad', 'stream too long');
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    for (const e of events) {
      if (e.event === 'complete') {
        try {
          result = { data: JSON.parse(e.data) };
        } catch {
          throw new IllustError('bad', 'complete data');
        }
        return false;
      }
      if (e.event === 'error') {
        let msg = e.data;
        try {
          const v: unknown = JSON.parse(e.data);
          msg = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
        } catch {
          // 글 그대로
        }
        throw new IllustError(classify(msg), msg || 'error event');
      }
    }
    return undefined;
  });
  if (!result) throw new IllustError('runtime', 'stream ended');
  return result.data;
}
