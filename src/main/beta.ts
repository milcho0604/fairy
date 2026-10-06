import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, powerMonitor } from 'electron';
import type { StatStore } from '../shared/beta-stats.ts';

const TICK_MS = 60_000;
/** 정상 종료가 아닌 것으로 보는 이유 (Electron RenderProcessGoneDetails, Details.reason) */
const BAD_EXIT = new Set(['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit']);

/**
 * 베타 기록 모으기 (P4-04).
 * - 1분마다 켠 시간과 숨긴 시간. 화면이 잠겨 있으면 세지 않는다.
 * - 비정상 종료: 켤 때 "실행 중" 표시 파일을 두고 끝낼 때 지운다. 다음에 켤 때 남아 있으면 한 번.
 *   창이 죽거나 응답이 없을 때도 센다. 개발 중 실행은 코드를 고칠 때마다 메인을 갈아 끼워 세지 않는다.
 */
export function watchBetaStats(
  stats: StatStore,
  isHidden: () => boolean,
  log: (tag: string, ...rest: unknown[]) => void,
) {
  const crash = (why: string, at = Date.now()) => {
    stats.countCrash(at);
    log('beta', '비정상 종료나 멈춤', why);
  };

  if (app.isPackaged || process.env.JJ_BETA_CRASH) {
    const flag = join(app.getPath('userData'), 'running.flag');
    if (existsSync(flag)) crash('지난번에 정상으로 안 끝남', statSync(flag).mtimeMs);
    writeFileSync(flag, String(process.pid));
    app.on('will-quit', () => rmSync(flag, { force: true }));
  }

  app.on('render-process-gone', (_e, _wc, d) => {
    if (BAD_EXIT.has(d.reason)) crash(`화면 ${d.reason}`);
  });
  app.on('child-process-gone', (_e, d) => {
    if (BAD_EXIT.has(d.reason)) crash(`${d.type} ${d.reason}`);
  });
  app.on('browser-window-created', (_e, win) => {
    win.on('unresponsive', () => crash('창 응답 없음'));
  });

  const timer = setInterval(() => {
    if (powerMonitor.getSystemIdleState(60) === 'locked') return;
    stats.tick(Date.now(), isHidden());
  }, TICK_MS);
  timer.unref();
  app.on('will-quit', () => clearInterval(timer));
}
