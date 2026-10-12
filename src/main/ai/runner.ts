import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { aiChildEnv } from '../../shared/ai/child-env.ts';
import { claudeArgs, claudeInput, parseClaudeLine } from '../../shared/ai/claude.ts';
import { codexArgs, parseCodexLine } from '../../shared/ai/codex.ts';
import { cursorArgs, cursorParser } from '../../shared/ai/cursor.ts';
import { classifyError, notInstalled, timedOut } from '../../shared/ai/errors.ts';
import { fillArgs, type ProviderSpec } from '../../shared/ai/providers.ts';
import { type Exchange, stripAnsi, textPrompt } from '../../shared/ai/text.ts';
import type { AiEvent, AiStatus, ImageAttachment, McpLaunch } from '../../shared/ai/types.ts';
import { codexUsage, lastCodexLimits } from '../../shared/ai/usage.ts';
import { aiTempImageName, isAiTempImage } from '../../shared/capture.ts';
import { t } from '../../shared/i18n/index.ts';
import { aiWorkDir } from '../ai-history.ts';
import { finishCodexHome, prepareCodexHome } from './codex-home.ts';
import { getShellEnv, launchOf, resolveBin } from './shell-env.ts';

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
  /** 내 MCP 도구 (v2). 격리를 끈 claude 만 */
  mcpServers?: readonly string[];
  /** 고른 모델 (v2, 목록에서 검사한 이름). claude, codex 만 */
  model?: string;
  /** 짝꿍 도구 쓰기: 펫 MCP 서버. claude, codex 만 */
  jjServer?: McpLaunch;
  /** 웹 검색 도구 하나만 켠다 (말로 만들기에서 캐릭터 모습 찾기). claude 만 */
  webSearch?: boolean;
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
  const dir = aiWorkDir(app.getPath('userData'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 돌고 있는 AI 실행 (앱을 끌 때 모두 멈춘다) */
const live = new Set<AiRun>();

/** 앱을 끌 때: 생각만 하고 출력이 없는 CLI 도 프로세스 묶음째 끝낸다 */
export function stopAllAi(): void {
  for (const r of live) r.cancel();
}

/** NUL 글자는 프로세스 인자에 못 넣는다(spawn 이 던진다). 미리 뺀다 */
const noNul = (s: string) => s.replace(/\0/g, '');

/** 지난 실행이 죽으면서 남긴 캡처 임시 파일을 처음 부를 때 한 번 지운다 */
let swept = false;
function sweepTempImages(): void {
  if (swept) return;
  swept = true;
  try {
    for (const name of readdirSync(tmpdir()))
      if (isAiTempImage(name)) rmSync(join(tmpdir(), name), { force: true });
  } catch {
    // 임시 폴더를 못 읽으면 넘어간다
  }
}

export function runAi(reqIn: AiRequest, onEvent: (e: AiEvent) => void): AiRun {
  sweepTempImages();
  // 그림을 실은 질문은 claude, codex 가 세션 기록에 그림째 남긴다. 늘 기록 없이 부른다 (2026-10-11 보안 점검).
  // 이어가기도 하지 않는다: 이어 간 세션 파일에 그림이 덧붙기 때문이다 (부르는 쪽이 최근 대화를 글로 붙인다)
  const noSave = !!reqIn.ephemeral || reqIn.images.length > 0;
  const req: AiRequest = {
    ...reqIn,
    ephemeral: noSave,
    sessionId: noSave ? undefined : reqIn.sessionId,
    text: noNul(reqIn.text),
    persona: noNul(reqIn.persona),
    history: reqIn.history.map((h) => ({ question: noNul(h.question), answer: noNul(h.answer) })),
  };
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
    try {
      await runChild();
    } catch (err) {
      // spawn 이 바로 던지는 경우(잘못된 인자 등). 이벤트 없이 끝나면 채팅이 "답 기다림"에 멈춘다
      emit({
        type: 'error',
        error: classifyError(req.spec, err instanceof Error ? err.message : String(err)),
      });
    }
  })().finally(() => {
    removeTemp();
    live.delete(run);
  });

  async function runChild() {
    const env = await getShellEnv();
    const { spec } = req;
    const cli = resolveBin(spec.bin, env);
    // 윈도우 .cmd 는 안의 JS 를 node 로 띄운다 (shell 없이)
    const launch = cli ? launchOf(cli, env) : undefined;
    if (!launch) {
      emit({ type: 'error', error: notInstalled(spec) });
      return;
    }
    if (cancelled) return;

    let args: string[];
    let stdin: string | undefined;
    // 짝꿍 환경 변수를 통째로 넘기지 않는다: 고른 것만 (shared/ai/child-env.ts)
    const childEnv = aiChildEnv(process.env, { PATH: env.path });
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
        const file = join(tmpdir(), aiTempImageName(randomUUID(), img.mediaType));
        writeFileSync(file, Buffer.from(img.data, 'base64'), { mode: 0o600 });
        tempFiles.push(file);
      }
      args = codexArgs({
        text: req.text,
        imagePaths: tempFiles,
        threadId: req.sessionId,
        persona: req.persona,
        ephemeral: req.ephemeral,
        model: req.model,
        jjServer: req.jjServer,
      });
      // 격리하면 짝꿍 전용 폴더(auth.json 만 연결), 아니면 사용자의 codex 설정 폴더 그대로.
      codexHome = req.isolate ? prepareCodexHome(env.codexHome) : env.codexHome;
      if (codexHome) childEnv.CODEX_HOME = codexHome;
      parse = parseCodexLine;
    }

    // 맥, 리눅스는 새 프로세스 묶음으로 띄운다. 감싼 스크립트가 띄운 손자 프로세스까지 한 번에 끝내려고
    child = spawn(launch.file, [...launch.pre, ...args], {
      cwd: workDir(),
      env: { ...childEnv, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
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
    let ansiTail = '';
    child.stdout?.on('data', (chunk: string) => {
      if (cancelled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_S * 1000);
      if (!parse) {
        // 색 코드가 조각 경계에서 잘리면 다음 조각과 붙여서 지운다
        let raw = ansiTail + chunk;
        const esc = raw.lastIndexOf('\u001b');
        ansiTail = esc >= 0 && !/[A-Za-z]/.test(raw.slice(esc + 2)) ? raw.slice(esc) : '';
        if (ansiTail) raw = raw.slice(0, esc);
        const text = stripAnsi(raw);
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
        if (cancelled)
          emit({ type: 'error', error: { kind: 'cancelled', message: t('ai.error.cancelled') } });
        else if (code !== 0)
          emit({
            type: 'error',
            error: classifyError(spec, stripAnsi(stderr) || t('ai.error.exitCode', { code: String(code) })),
          });
        else emit({ type: 'done', text: answer.trim() });
        // 격리한 codex 가 토큰을 새로 받았으면 사용자 쪽 로그인 파일에 되돌려 쓴다 (윈도우 복사본)
        if (codexHome && req.isolate) finishCodexHome(env.codexHome);
        // codex 사용량은 대화 기록 파일에 남는다. 끝난 뒤 읽는다. 기록을 안 남겼으면 읽을 것도 없다.
        if (codexHome && sessionId && !req.ephemeral) {
          const usage = readCodexUsage(codexHome, sessionId);
          if (usage) emit({ type: 'usage', usage });
        }
        resolve();
      });
    });
  }

  /** 프로세스 묶음째 신호를 보낸다 (스크립트가 띄운 손자까지). 윈도우는 그 프로세스만 */
  function signal(sig: NodeJS.Signals) {
    const pid = child?.pid;
    if (!pid) return;
    try {
      if (process.platform === 'win32') child?.kill(sig);
      else process.kill(-pid, sig);
    } catch {
      // 이미 끝났다
    }
  }

  function stop() {
    if (!child) return;
    // 감싼 스크립트가 먼저 끝나도 손자가 남을 수 있어 exitCode 와 상관없이 묶음에 보낸다
    signal('SIGTERM');
    setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
  }

  /** 캡처 임시 파일을 지운다. 끝날 때(finished)뿐 아니라 취소할 때도 바로: 앱을 끌 때는 취소만 하고 프로세스가 끝나
   * close 를 기다리지 않아서, 화면 캡처가 임시 폴더에 그대로 남았다 */
  const removeTemp = () => {
    for (const f of tempFiles.splice(0)) rmSync(f, { force: true });
  };

  const run: AiRun = {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      stop();
      removeTemp();
      // 손자가 파이프를 쥐고 있으면 close 가 늦다. 멈춤은 바로 알린다
      emit({ type: 'error', error: { kind: 'cancelled', message: t('ai.error.cancelled') } });
    },
    finished,
  };
  live.add(run);
  return run;
}

/**
 * codex 대화 기록(sessions/연/월/일/rollout-...-<thread_id>.jsonl)에서 마지막 사용량을 읽는다. 최근 3일만 본다.
 * threadId 가 없으면 가장 최근 기록에서 읽는다 (채팅 창을 열자마자 보여 줄 때).
 */
export function readCodexUsage(codexHome: string, threadId?: string) {
  const root = join(codexHome, 'sessions');
  for (let back = 0; back < 3; back++) {
    // 날짜로 뺀다 (서머타임이 시작하는 23시간 날에 24시간을 빼면 하루를 건너뛰었다)
    const d = new Date();
    d.setDate(d.getDate() - back);
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
export function checkStatus(spec: ProviderSpec, refresh = false): Promise<AiStatus> {
  // 채팅 창을 열 때마다 AI 마다 명령 두 개(버전, 로그인)를 띄우지 않게 잠깐 기억한다. 새로고침이면 다시 본다
  const key = JSON.stringify([spec.id, spec.bin, spec.statusArgs]);
  const hit = statusCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const status = checkStatusNow(spec, refresh);
  statusCache.set(key, { at: Date.now(), status });
  // 실패하거나 설치 안 됨은 기억하지 않는다 (설치하고 바로 다시 열면 보이게)
  void status.then(
    (s) => !s.installed && statusCache.delete(key),
    () => statusCache.delete(key),
  );
  return status;
}

const STATUS_TTL_MS = 3 * 60_000;
const statusCache = new Map<string, { at: number; status: Promise<AiStatus> }>();

async function checkStatusNow(spec: ProviderSpec, refresh: boolean): Promise<AiStatus> {
  const provider = spec.id;
  // 무료 AI 는 앱 안에 있다. 설치, 로그인 확인이 없다
  if (spec.adapter === 'local') return { provider, installed: true };
  const env = await getShellEnv(refresh);
  const cli = resolveBin(spec.bin, env);
  const launch = cli ? launchOf(cli, env) : undefined;
  if (!launch) return { provider, installed: false };
  // cursor-agent status 는 로그인 안 됐으면 브라우저를 열려고 한다. 막는다.
  const childEnv = aiChildEnv(process.env, { PATH: env.path, NO_OPEN_BROWSER: '1', NO_COLOR: '1' });
  if (spec.adapter === 'codex') {
    const home = prepareCodexHome(env.codexHome);
    if (home) childEnv.CODEX_HOME = home;
  }
  const run = (args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const opts = { env: { ...childEnv, ...launch.env }, timeout: 15_000, encoding: 'utf8' as const };
      execFile(launch.file, [...launch.pre, ...args], opts, (err, stdout, stderr) => {
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
