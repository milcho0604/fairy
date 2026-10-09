import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RUNNER_COUNTS, RUNNER_FAST_MS, RUNNER_REST_MS, runnerIndex } from '../shared/menu-runner.ts';
import type { CpuTimes } from '../shared/system-load.ts';
import { MONITOR_AWAY_SEC, MONITOR_SAMPLE_MS } from '../shared/system-stats.ts';
import { createMonitorCore, type MonitorHost } from './monitor-core.ts';

/** 가짜 시계와 CPU. busy 는 지금 사용률(%), 시간이 흐르면 그만큼 누적 시간이 쌓인다 */
function fakeHost() {
  let now = 1_000_000;
  let idle = 0;
  let total = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: string[] = [];
  const st = { busy: 0, idleSec: 0 };
  const host: MonitorHost = {
    readCpu: (): CpuTimes => ({ idle, total }),
    idleSec: () => st.idleSec,
    showCpu: (pct) => calls.push(`cpu ${pct}`),
    clearCpu: () => calls.push('clear'),
    showFrame: (i) => calls.push(`frame ${i}`),
    showBase: () => calls.push('base'),
    now: () => now,
    later: (fn, ms) => {
      seq++;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    cancel: (h) => timers.delete(h as number),
  };
  /** ms 만큼 시간을 흘리며 때가 된 타이머를 부른다 */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      const dt = next[1].at - now;
      total += dt;
      idle += dt * (1 - st.busy / 100);
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    const dt = end - now;
    total += dt;
    idle += dt * (1 - st.busy / 100);
    now = end;
  };
  return { host, calls, st, advance, pending: () => timers.size };
}

test('꺼져 있으면 메뉴를 열어도 메뉴 막대 글자를 쓰지 않는다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  // 앱이 켜진 뒤 한참 한가하다가
  f.advance(60 * 60 * 1000);
  f.st.busy = 80;
  core.hover();
  f.advance(300);
  const cpu = core.menuCpu();
  assert.deepEqual(f.calls, [], '꺼져 있는데 글자나 그림을 건드렸다');
  // 앱 시작부터의 평균(거의 0)이 아니라 마우스가 올라온 뒤 짧은 구간
  assert.ok(cpu !== undefined && Math.abs(cpu - 80) < 1, `메뉴 CPU ${cpu}`);
  assert.equal(f.pending(), 0, '꺼져 있는데 타이머가 남았다');
});

test('마우스 없이 열었거나 오래된 구간이면 재는 중으로 보이고 다음엔 보인다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  assert.equal(core.menuCpu(), undefined);
  f.st.busy = 50;
  f.advance(500);
  assert.ok(Math.abs((core.menuCpu() ?? -1) - 50) < 1);
  core.hover();
  f.advance(60_000);
  assert.equal(core.menuCpu(), undefined, '1분 전 구간을 썼다');
  assert.equal(f.calls.length, 0, f.calls.join());
});

test('켜면 2초마다 글자를 고치고 펫이 움직인다, 끄면 글자와 타이머를 걷는다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  f.st.busy = 30;
  core.setEnabled(true);
  assert.deepEqual(f.calls, ['frame 0'], '켜자마자 0% 를 쓰면 안 된다');
  f.advance(MONITOR_SAMPLE_MS);
  assert.ok(f.calls.includes('cpu 30'));
  assert.ok(f.calls.some((c) => c.startsWith('frame ') && c !== 'frame 0'));
  // 값이 같으면 다시 쓰지 않는다
  const n = f.calls.filter((c) => c.startsWith('cpu')).length;
  f.advance(MONITOR_SAMPLE_MS * 3);
  assert.equal(f.calls.filter((c) => c.startsWith('cpu')).length, n);
  core.setEnabled(false);
  assert.deepEqual(f.calls.slice(-2), ['clear', 'base']);
  assert.equal(f.pending(), 0);
  f.calls.length = 0;
  f.advance(10_000);
  assert.equal(f.calls.length, 0, f.calls.join());
});

test('그림 바꾸기는 초당 5번을 넘지 않는다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  f.st.busy = 100;
  core.setEnabled(true);
  f.advance(10_000);
  const frames = f.calls.filter((c) => c.startsWith('frame')).length;
  // 초당 5장 (10초에 50장, 켤 때 한 장)
  assert.ok(frames <= 51, `10초에 ${frames}장`);
});

test('잠금, 잠자기에는 다 멈추고 풀리면 새 기준으로 다시 돈다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  core.setEnabled(true);
  f.advance(MONITOR_SAMPLE_MS);
  core.setPaused('locked', true);
  assert.equal(f.pending(), 0);
  f.calls.length = 0;
  f.st.busy = 90;
  f.advance(60_000);
  assert.equal(f.calls.length, 0, f.calls.join());
  f.st.busy = 10;
  core.setPaused('locked', false);
  f.advance(MONITOR_SAMPLE_MS);
  // 잠긴 동안의 90% 가 섞이지 않는다
  assert.ok(f.calls.includes('cpu 10'), f.calls.join());
  assert.ok(!f.calls.some((c) => c === 'cpu 90' || c === 'cpu 89'), f.calls.join());
  core.setPaused('asleep', true);
  assert.equal(f.pending(), 0);
});

test('배터리, 발표 중에는 펫만 서고 글자는 계속', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  core.setPaused('battery', true);
  core.setEnabled(true);
  f.st.busy = 40;
  f.advance(MONITOR_SAMPLE_MS * 3);
  assert.deepEqual(
    f.calls.filter((c) => c.startsWith('frame')),
    ['frame 0'],
  );
  assert.ok(f.calls.includes('cpu 40'));
  core.setPaused('battery', false);
  f.advance(2000);
  assert.ok(f.calls.filter((c) => c.startsWith('frame')).length > 1);
  core.setPaused('presentation', true);
  const before = f.calls.filter((c) => c.startsWith('frame')).length;
  f.advance(5000);
  assert.equal(f.calls.filter((c) => c.startsWith('frame')).length, before);
});

test('자리를 비우면(화면 꺼짐) 글자와 펫을 세우고 돌아오면 다시', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  core.setEnabled(true);
  f.advance(MONITOR_SAMPLE_MS);
  f.st.idleSec = MONITOR_AWAY_SEC;
  f.advance(MONITOR_SAMPLE_MS);
  f.calls.length = 0;
  f.st.busy = 70;
  f.advance(60_000);
  assert.equal(f.calls.length, 0, f.calls.join());
  f.st.idleSec = 0;
  f.st.busy = 20;
  f.advance(MONITOR_SAMPLE_MS * 2);
  assert.ok(f.calls.includes('cpu 20'), f.calls.join());
  assert.ok(!f.calls.includes('cpu 70'));
  assert.ok(f.calls.some((c) => c.startsWith('frame')));
});

test('끄고 다시 켜도 타이머가 겹치지 않는다, dispose 뒤에는 남지 않는다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  for (let i = 0; i < 5; i++) {
    core.setEnabled(true);
    core.setEnabled(false);
  }
  core.setEnabled(true);
  core.setEnabled(true);
  assert.ok(f.pending() <= 2);
  core.dispose();
  assert.equal(f.pending(), 0);
});

/** 상태의 장 번호들 (한 줄 번호) */
const indices = (state: keyof typeof RUNNER_COUNTS) =>
  new Set(Array.from({ length: RUNNER_COUNTS[state] }, (_, f) => runnerIndex(state, f)));
const shown = (calls: string[]) => calls.filter((c) => c.startsWith('frame ')).map((c) => Number(c.slice(6)));

test('한가하면 앉아서 1.5초에 한 장 이하, 바쁘면 달리기 장, 다시 한가하면 앉는다', () => {
  const f = fakeHost();
  const core = createMonitorCore(f.host);
  f.st.busy = 1;
  core.setEnabled(true);
  f.advance(30_000);
  const rest = shown(f.calls);
  assert.ok(rest.length <= 30_000 / RUNNER_REST_MS + 1, `30초에 ${rest.length}장`);
  assert.ok(rest.length >= 10, '쉬는 동안 꼬리도 안 흔든다');
  assert.ok(
    rest.every((i) => indices('rest').has(i)),
    rest.join(),
  );
  f.st.busy = 50;
  // 다음 표본(2초)까지는 아직 앉아 있다
  f.advance(MONITOR_SAMPLE_MS);
  f.calls.length = 0;
  f.advance(10_000);
  const run = shown(f.calls);
  assert.ok(run.length > 0 && run.every((i) => indices('run').has(i)), run.join());
  // 한 바퀴의 장을 다 돈다
  assert.equal(new Set(run).size, RUNNER_COUNTS.run);
  f.calls.length = 0;
  f.st.busy = 90;
  f.advance(6000);
  assert.ok(
    shown(f.calls).some((i) => indices('sprint').has(i)),
    '바쁜데 땀을 안 흘린다',
  );
  f.calls.length = 0;
  f.st.busy = 0;
  f.advance(6000);
  const back = shown(f.calls);
  assert.ok(back.length > 0 && indices('rest').has(back.at(-1) as number), back.join());
});

test('상태가 오락가락해도 그림 바꾸기 사이는 0.2초 이상, 같은 장은 다시 쓰지 않는다', () => {
  const f = fakeHost();
  const at: number[] = [];
  const raw = f.host.showFrame;
  f.host.showFrame = (i) => {
    at.push(f.host.now());
    raw(i);
  };
  const core = createMonitorCore(f.host);
  core.setEnabled(true);
  // 2초마다 바뀌는 사용률 (경계 근처 포함)
  const load = [0, 100, 2, 40, 34, 31, 80, 72, 69, 6, 4, 2, 100, 0, 50, 5, 3, 76, 30, 29];
  for (const busy of load) {
    f.st.busy = busy;
    f.advance(MONITOR_SAMPLE_MS);
  }
  for (let i = 1; i < at.length; i++)
    assert.ok((at[i] as number) - (at[i - 1] as number) >= RUNNER_FAST_MS, `${i}: ${at[i - 1]} -> ${at[i]}`);
  const list = shown(f.calls);
  for (let i = 1; i < list.length; i++) assert.notEqual(list[i], list[i - 1], `${i} 번째에 같은 장`);
});
