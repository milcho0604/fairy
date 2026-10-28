import type { WebContents } from 'electron';
import { CrashGuard } from '../shared/crash-guard.ts';

/**
 * 화면(렌더러)이 죽은 창을 되살린다. 창은 그대로 남아 빈 화면만 보이기 때문이다.
 * 죽는 순간 저절로 다시 불러오되, 짧은 시간에 여러 번 죽으면 원인이 그대로라 멈추고 기록만 한다 (crash-guard.ts).
 * 돌려주는 함수는 이미 떠 있는 창을 다시 열 때 부른다: 세던 것을 지우고, 죽어 있으면 다시 불러온다
 * (again 을 주면 reload 대신 그것으로, 예: 칸을 바꿔 읽기).
 */
export function reviveOnCrash(
  wc: WebContents,
  tag: string,
  log: (tag: string, ...rest: unknown[]) => void,
): (again?: () => void) => void {
  const guard = new CrashGuard();
  wc.on('render-process-gone', (_e, d) => {
    if (wc.isDestroyed() || d.reason === 'clean-exit') return;
    const next = guard.crashed(Date.now());
    log(tag, 'render-process-gone', d.reason, d.exitCode, next);
    if (next === 'reload') wc.reload();
  });
  return (again) => {
    if (wc.isDestroyed()) return;
    guard.reset();
    if (!wc.isCrashed()) return;
    if (again) again();
    else wc.reload();
  };
}
