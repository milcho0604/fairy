import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { claudeArgs, claudeInput, parseClaudeLine } from '../../shared/ai/claude.ts';
import { codexArgs, parseCodexLine } from '../../shared/ai/codex.ts';
import { cursorArgs, cursorParser } from '../../shared/ai/cursor.ts';
import { classifyError, notInstalled, timedOut } from '../../shared/ai/errors.ts';
import { fillArgs, type ProviderSpec } from '../../shared/ai/providers.ts';
import { type Exchange, stripAnsi, textPrompt } from '../../shared/ai/text.ts';
import type { AiEvent, AiStatus, ImageAttachment } from '../../shared/ai/types.ts';
import { codexUsage, lastCodexLimits } from '../../shared/ai/usage.ts';
import { prepareCodexHome } from './codex-home.ts';
import { getShellEnv, resolveBin } from './shell-env.ts';

/** 이 시간 동안 출력이 하나도 없으면 멈춘 것으로 본다. */
export const IDLE_TIMEOUT_S = 60;
/** 취소한 뒤 이 시간 안에 안 끝나면 강제로 끝낸다 (C9, X7 기준 2초). */
const KILL_GRACE_MS = 2000;

export interface AiRequest {
  spec: ProviderSpec;
  /** 이어가기가 없는 AI 에 붙여 보낼 최근 대화 */
  history: readonly Exchange[];
  text: string;
  images: readonly ImageAttachment[];
  /** 이어갈 세션(claude 세션 id, codex thread_id). 없으면 새 대화. */
  sessionId?: string;
  persona: string;
  /** 사용자 설정 없이 격리해서 부를지 (설정, 기본 true) */
  isolate: boolean;
  /** 기록 남기지 않기 (v1). claude, codex 만 */
  ephemeral?: boolean;
}

export interface AiRun {
  cancel(): void;
  finished: Promise<void>;
}

/**
 * CLI 를 부를 작업 폴더. claude 는 작업 폴더마다 세션을 따로 저장해서 이어가기(--resume)도 같은 폴더여야 한다.
 * 비어 있는 전용 폴더라 어느 프로젝트의 CLAUDE.md, AGENTS.md 도 읽히지 않는다.
 */
function workDir(): string {
  const dir = join(app.getPath('userData'), 'ai-workdir');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function runAi(req: AiRequest, onEvent: (e: AiEvent) => void): AiRun {
  let child: ChildProcess | undefined;
  let cancelled = false;
  let settled = false;
  const tempFiles: string[] = [];

  const emit = (e: AiEvent) => {
    // 사용량은 답이 끝난 뒤에 읽히기도 해서(codex) 끝난 뒤에도 보낸다.
    if (settled && e.type !== 'usage') return;
    if (e.type === 'done' || e.type === 'error') settled = true;
    onEvent(e);
  };

  const finished = (async () => {
    const env = await getShellEnv();
    const { spec } = req;
    const cli = resolveBin(spec.bin, env);
    if (!cli) {
      emit({ type: 'error', error: notInstalled(spec) });
      return;
    }
    if (cancelled) return;

    let args: string[];
    let stdin: string | undefined;
    const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: env.path };
    /** 줄 단위 JSON 해석기. 없으면 표준 출력을 그대로 답으로 본다 (text 어댑터). */
    let parse: ((line: string) => AiEvent[]) | undefined;
    let codexHome: string | undefined;
    let sessionId = req.sessionId;

    if (spec.adapter === 'claude') {
      const sessionId = req.sessionId ?? randomUUID();
      args = claudeArgs({ ...req, sessionId, resume: !!req.sessionId });
      stdin = claudeInput(req);
      parse = parseClaudeLine;
    } else if (spec.adapter === 'cursor') {
      args = cursorArgs({ text: req.text, sessionId: req.sessionId, persona: req.persona });
      parse = cursorParser();
    } else if (spec.adapter === 'text') {
      args = fillArgs(spec.args ?? ['{prompt}'], textPrompt(req.persona, req.history, req.text));
      childEnv.NO_COLOR = '1';
    } else {
      // codex 는 이미지를 파일로만 받는다. 끝나면 바로 지운다 (P3-07: 캡처를 디스크에 남기지 않는다).
      for (const img of req.images) {
        const ext = img.mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
        const file = join(tmpdir(), `jjakkung-${randomUUID()}.${ext}`);
        writeFileSync(file, Buffer.from(img.data, 'base64'), { mode: 0o600 });
        tempFiles.push(file);
      }
      args = codexArgs({
        text: req.text,
        imagePaths: tempFiles,
        threadId: req.sessionId,
        persona: req.persona,
        ephemeral: req.ephemeral,
      });
      // 격리하면 짝꿍 전용 폴더(auth.json 만 연결), 아니면 사용자의 codex 설정 폴더 그대로.
      codexHome = req.isolate ? prepareCodexHome(env.codexHome) : env.codexHome;
      if (codexHome) childEnv.CODEX_HOME = codexHome;
      parse = parseCodexLine;
    }

    child = spawn(cli, args, { cwd: workDir(), env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    if (stdin) child.stdin?.end(stdin);
    else child.stdin?.end(); // codex 는 표준 입력을 기다리므로 바로 닫는다

    let idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_S * 1000);
    function onIdle() {
      emit({ type: 'error', error: timedOut(spec, IDLE_TIMEOUT_S) });
      stop();
    }

    let buffer = '';
    let stderr = '';
    let answer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_S * 1000);
      if (!parse) {
        const text = stripAnsi(chunk);
        answer += text;
        if (text) emit({ type: 'delta', text });
        return;
      }
      buffer += chunk;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        for (const e of parse(line)) {
          if (e.type === 'delta') answer += e.text;
          if (e.type === 'session') sessionId = e.id;
          // codex 의 완료에는 글이 없다. 모은 답을 실어 보낸다.
          emit(e.type === 'done' && !e.text ? { type: 'done', text: answer } : e);
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    await new Promise<void>((resolve) => {
      child?.on('error', (err) => {
        emit({ type: 'error', error: classifyError(spec, err.message) });
        resolve();
      });
      child?.on('close', (code) => {
        clearTimeout(idleTimer);
        if (cancelled) emit({ type: 'error', error: { kind: 'cancelled', message: '질문을 멈췄어.' } });
        else if (code !== 0)
          emit({ type: 'error', error: classifyError(spec, stripAnsi(stderr) || `종료 코드 ${code}`) });
        else emit({ type: 'done', text: answer.trim() });
        // codex 사용량은 대화 기록 파일에 남는다. 끝난 뒤 읽는다. 기록을 안 남겼으면 읽을 것도 없다.
        if (codexHome && sessionId && !req.ephemeral) {
          const usage = readCodexUsage(codexHome, sessionId);
          if (usage) emit({ type: 'usage', usage });
        }
        resolve();
      });
    });
  })().finally(() => {
    for (const f of tempFiles) rmSync(f, { force: true });
  });

  function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    const c = child;
    setTimeout(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    }, KILL_GRACE_MS).unref();
  }

  return {
    cancel() {
      cancelled = true;
      stop();
    },
    finished,
  };
}

/**
 * codex 대화 기록(sessions/연/월/일/rollout-...-<thread_id>.jsonl)에서 마지막 사용량을 읽는다. 최근 3일만 본다.
 * threadId 가 없으면 가장 최근 기록에서 읽는다 (채팅 창을 열자마자 보여 줄 때).
 */
export function readCodexUsage(codexHome: string, threadId?: string) {
  const root = join(codexHome, 'sessions');
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.now() - back * 86_400_000);
    const dir = join(
      root,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    );
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const name = threadId
      ? names.find((n) => n.endsWith(`${threadId}.jsonl`))
      : names
          .filter((n) => n.startsWith('rollout-'))
          .sort()
          .at(-1);
    if (!name) continue;
    try {
      return codexUsage(lastCodexLimits(readFileSync(join(dir, name), 'utf8')), Date.now());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 설치, 로그인, 버전 확인 (P3-01). claude auth status 는 JSON, codex 는 종료 코드,
 * cursor-agent status 는 종료 코드가 늘 0 이라 출력 글로 본다. 로그인 확인 방법이 없는 AI 는 모름(undefined).
 */
export async function checkStatus(spec: ProviderSpec, refresh = false): Promise<AiStatus> {
  const provider = spec.id;
  const env = await getShellEnv(refresh);
  const cli = resolveBin(spec.bin, env);
  if (!cli) return { provider, installed: false };
  // cursor-agent status 는 로그인 안 됐으면 브라우저를 열려고 한다. 막는다.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: env.path, NO_OPEN_BROWSER: '1', NO_COLOR: '1' };
  if (spec.adapter === 'codex') {
    const home = prepareCodexHome(env.codexHome);
    if (home) childEnv.CODEX_HOME = home;
  }
  const run = (args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      execFile(cli, args, { env: childEnv, timeout: 15_000, encoding: 'utf8' }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, out: stripAnsi(`${stdout}\n${stderr}`) });
      });
    });
  const [version, login] = await Promise.all([
    spec.custom ? Promise.resolve({ code: 0, out: '' }) : run(['--version']),
    spec.statusArgs ? run(spec.statusArgs) : Promise.resolve(undefined),
  ]);
  let loggedIn: boolean | undefined;
  if (login) {
    loggedIn = login.code === 0 && !spec.notLoggedInPattern?.test(login.out);
    if (spec.adapter === 'claude') {
      const json = login.out.slice(login.out.indexOf('{'), login.out.lastIndexOf('}') + 1);
      try {
        loggedIn = JSON.parse(json).loggedIn === true;
      } catch {
        // JSON 이 아니면 종료 코드로 판단한다
      }
    }
  }
  const firstLine = version.out.trim().split('\n')[0] || undefined;
  return { provider, installed: true, loggedIn, version: firstLine, path: cli };
}
