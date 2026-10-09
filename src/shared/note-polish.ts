// 메모 다듬기 (사용자 요청 2026-10-08: AI 가 쓴 글을 사람이 쓴 것처럼). 메모 전체나 고른 부분을 AI 에게 보내
// 뜻은 그대로 두고 문장만 고친 글을 받는다. 바로 덮어쓰지 않고 원래 글과 견줘 본 뒤 바꾼다 (NoteTab.tsx).
import { NOTE_BODY_MAX } from './note-store.ts';

/** 다듬을 글을 감싸는 줄. 글 속 지시문을 AI 가 명령으로 읽지 않게 경계를 둔다 */
export const POLISH_FENCE = '-----';

/** AI 에게 보낼 글: 안내 한 줄과 경계 사이 원문 */
export function polishRequest(ask: string, text: string): string {
  return `${ask}\n${POLISH_FENCE}\n${text}\n${POLISH_FENCE}`;
}

/**
 * 한 번에 다듬을 수 있는 글 길이. AI CLI 는 글을 명령줄 인자로 받기도 해서 윈도우 명령줄 한도(32,767자)에 걸리고,
 * 긴 글은 답이 늦어 무출력 끊김(60초)에 걸린다. 넘으면 보내지 않고 일부를 고르라고 한다
 */
export const POLISH_MAX = 4000;

/** 머리말 한 줄 ("다듬은 글:", "Here's the polished version:") */
const HEAD_LINE =
  /^(다듬은 글|다듬은 메모|수정본|결과|polished( version| text)?|here(’|')s[^\n]*?)\s*[:：]\s*$/i;

const firstLine = (s: string) => s.trimStart().split('\n', 1)[0]?.trim() ?? '';
const lastLine = (s: string) => s.trimEnd().split('\n').pop()?.trim() ?? '';

/**
 * AI 답을 메모에 넣을 글로 다듬는다. 앞뒤 인사나 "다듬은 글:" 같은 머리말, 원문에 없던 코드 칸 감싸기와 경계 줄을 걷는다.
 * 원문 첫 줄(끝 줄)이 같은 줄이면 원문에 있던 것이라 걷지 않는다 ("결과:" 로 시작하는 메모, 구분선으로 끝나는 메모).
 * 빈 답이면 undefined. 길이는 자르지 않는다 (넣을 때 splicePolished 가 본다)
 */
export function cleanPolished(answer: string | undefined, original: string): string | undefined {
  if (!answer) return undefined;
  let s = answer.replace(/\r\n/g, '\n').trim();
  const src = original.replace(/\r\n/g, '\n');
  const isFence = (line: string) => /^-{5,}$/.test(line);
  // 경계 줄을 그대로 따라 쓴 답
  if (isFence(firstLine(s)) && !isFence(firstLine(src))) s = s.replace(/^-+[ \t]*\n/, '');
  if (isFence(lastLine(s)) && !isFence(lastLine(src))) s = s.replace(/\n[ \t]*-+$/, '');
  // 머리말 한 줄
  const head = firstLine(s);
  if (s.includes('\n') && HEAD_LINE.test(head) && head !== firstLine(src)) s = s.slice(s.indexOf('\n') + 1);
  // 원문은 코드 칸이 아닌데 답 전체를 ``` 로 감쌌으면 벗긴다
  s = s.trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(s);
  if (fenced?.[1] !== undefined && !src.trim().startsWith('```')) s = fenced[1];
  s = s.trim();
  return s || undefined;
}

/**
 * 고른 부분만 다듬었으면 그 자리에 끼운다. 고른 것이 없으면(start === end) 전체를 바꾼다.
 * 메모 한도(NOTE_BODY_MAX)를 넘으면 끝을 잘라 버리지 않고 undefined (바꾸지 않고 알린다)
 */
export function splicePolished(
  body: string,
  start: number,
  end: number,
  polished: string,
): string | undefined {
  const next = start >= end ? polished : body.slice(0, start) + polished + body.slice(end);
  return next.length > NOTE_BODY_MAX ? undefined : next;
}

/** 다듬기 답. body, start, end 는 보낼 때 메모 글과 고른 자리 (받는 쪽이 지금 글과 같은지 본다) */
export type PolishReply =
  | { ok: true; text: string; body: string; start: number; end: number }
  | { ok: false; error: 'fail' | 'locked' | 'tooLong' | 'none' };

/** 메모 하나에 걸린 다듬기 */
export interface PolishJob {
  done: Promise<PolishReply>;
  /** 끝났는데 받아 간 창이 없어 들고 있는 때 */
  parkedAt?: number;
}

/** 받은 쪽이 없어 들고 있는 답을 이만큼 지나면 버린다 */
export const POLISH_KEEP_MS = 30 * 60_000;

/**
 * 메모마다 다듬기를 하나만 돌린다 (main/panel.ts). 같은 메모를 다시 누르면 새로 부르지 않고 도는 것에 붙는다.
 * 패널이 닫혀 받을 창이 없으면 답을 들고 있다가, 다시 열어 그 메모로 오면 넘긴다 (메모 화면이 받아 보여 준 뒤 taken 을 불러야 지운다.
 * 답이 갈 때 그 메모 화면이 이미 목록으로 나갔으면 버려지기 때문)
 */
export function createPolishJobs(now: () => number = Date.now) {
  const jobs = new Map<number, PolishJob>();
  const purge = () => {
    for (const [id, job] of jobs)
      if (job.parkedAt !== undefined && now() - job.parkedAt > POLISH_KEEP_MS) jobs.delete(id);
  };
  return {
    state(id: number): 'none' | 'busy' | 'ready' {
      purge();
      const job = jobs.get(id);
      return !job ? 'none' : job.parkedAt === undefined ? 'busy' : 'ready';
    },
    get(id: number): PolishJob | undefined {
      purge();
      return jobs.get(id);
    },
    /** 새로 돌린다. 이미 있으면 그것을 돌려준다 (run 은 부르지 않는다) */
    start(id: number, run: () => Promise<PolishReply>): PolishJob {
      purge();
      const had = jobs.get(id);
      if (had) return had;
      const job: PolishJob = {
        done: run()
          .catch((): PolishReply => ({ ok: false, error: 'fail' }))
          .then((reply) => {
            // 실패는 들고 있지 않는다 (받을 사람이 없으면 알릴 것도 없다)
            if (jobs.get(id) === job) {
              if (reply.ok) job.parkedAt = now();
              else jobs.delete(id);
            }
            return reply;
          }),
      };
      jobs.set(id, job);
      return job;
    },
    /** 메모 화면이 답을 받아 보여 줬다 (끝난 것만 지운다) */
    taken(id: number) {
      if (jobs.get(id)?.parkedAt !== undefined) jobs.delete(id);
    },
  };
}
