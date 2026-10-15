import { app, net, shell } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { fresh } from '../shared/clock.ts';
import { t } from '../shared/i18n/index.ts';
import type { UpdateStatus } from '../shared/ipc.ts';
import {
  canAutoInstall,
  confirmedForce,
  decideUpdate,
  manualInstallUrl,
  nagDelayMs,
  notifyPlan,
  RELEASE_REPO,
  RELEASES_API,
  readSavedLock,
  type SavedLock,
  type UpdateDecision,
} from '../shared/update-policy.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';
import { readJson, removeJson, writeJson } from './store.ts';

export { RELEASES_API };

const DAY_MS = 86_400_000;
/**
 * 시험용 릴리스 주소 (JJ_RELEASES_API). 설치판이 아닌 개발 실행에서, 이 컴퓨터 주소일 때만 받는다.
 * 비공개 레포는 토큰 없이 404 라, 가짜 릴리스 서버로 알림과 강제 업데이트를 시험한다.
 */
function releasesApi(): string {
  const test = process.env.JJ_RELEASES_API;
  if (!test || app.isPackaged) return RELEASES_API;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(test) ? test : RELEASES_API;
}
/** 강제 업데이트로 잠그기 전에 한 번 더 받아 보는 간격 */
const CONFIRM_MS = 10_000;
/** 릴리스 확인 응답을 기다리는 한도 (캘린더와 같다) */
const FETCH_TIMEOUT_MS = 20_000;
/** 잠금을 남겨 두는 파일 (사용자 데이터 폴더의 update-lock.json). 켤 때 첫 확인을 기다리지 않고 바로 잠근다 */
const LOCK_FILE = 'update-lock';

type Say = (s: SayOptions) => Promise<string | undefined>;
type Log = (tag: string, ...rest: unknown[]) => void;
type Lock = SavedLock;
/**
 * 강제 업데이트 안내를 공지 창으로 띄운다 (main/notices.ts askForce). 누른 단추(restart, get)를 돌려주고,
 * 창을 못 띄웠으면 undefined. signal 이 끊기면(잠금 풀림) 창을 닫는다. 없으면 예전처럼 펫 말풍선
 */
export type AskForce = (o: {
  version: string;
  min: string;
  ready: boolean;
  signal: AbortSignal;
}) => Promise<string | undefined>;

/**
 * 새 버전 알림 (v1), 강제 업데이트, 자동 설치. 켜고 1분 뒤, 그 뒤 하루에 한 번 GitHub Releases 를 본다.
 * - 새 버전: 펫이 말풍선으로 알린다. 설치판은 미리 받아 두고 "다시 켜서 업데이트". 윈도우와 맥 모두
 *   누를 때만 설치한다 (끝낼 때 저절로 설치하지 않는다). 받지 못했거나 개발 실행이면 "받으러 가기"(릴리스 페이지).
 * - 강제(릴리스 본문의 min-version 이나 공지 파일 minVersion 중 높은 쪽보다 낮음): 건너뛰기 없이, 시간 끝 없이 알리고
 *   AI 대화를 잠근다. 안내는 닫을 수 없는 공지 창(askForce, main/notices.ts), 없으면 펫 말풍선.
 *   두 번 따로 받은 응답이 같아야 잠그고, 확인이 실패하면 풀린다. 오프라인이면 잠그지 않는다.
 *   잠금은 저장해 두고 다음에 켤 때 바로 잠근다. 다음 확인이 강제가 아니라고 답하면 지우고, 확인이 실패하면
 *   이번 실행만 풀고 저장은 남긴다 (실패는 강제가 아니라는 답이 아니다).
 * - 설정 "새 버전 알림"을 꺼도 확인은 한다. 강제가 아닌 새 버전 말풍선만 생략한다 (notifyPlan).
 * 사용자 정보는 보내지 않는다(앱 이름과 버전만). 토큰도 없다.
 */
export function watchUpdates(o: { say: Say; log: Log; askForce?: AskForce }) {
  let lock: Lock | undefined;
  /**
   * 공지 파일(notices.json)의 최소 버전. 공지 쪽이 두 번 받아 같을 때만 넣는다 (main/notices.ts).
   * 릴리스 본문 값과 높은 쪽을 쓰되 최신 릴리스 이하일 때만 (update-policy.ts pickMinVersion)
   */
  let noticeMin: string | undefined;
  /** 마지막 확인에서 본 새 버전 (공지 창의 업데이트 권장과 업데이트 단추가 쓴다) */
  let newer: { version: string; url: string } | undefined;
  let nagging = false;
  /** 안내가 밀려 기다리는 중이면 기다림을 끝낸다 */
  let wake: (() => void) | undefined;
  const auto = canAutoInstall(process.platform, app.isPackaged);
  /**
   * 맥(Squirrel.Mac)은 한 번 넘겨받은 업데이트를 끝낼 때 반드시 설치해서 "건너뛰기"를 되돌릴 수 없다.
   * 그래서 맥은 받아 두기만 하고, "다시 켜서 업데이트"를 누를 때 넘겨서 서명을 확인받고 설치한다.
   */
  /*
   * 윈도우도 끝낼 때 저절로 설치하지 않는다 (2026-10-11 보안 점검). 윈도우 설치 파일은 서명이 없어서
   * (코드 서명 인증서는 유료, docs/release.md "윈도우 서명") electron-updater 가 받은 파일의 게시자를 확인할 수 없다.
   * 사용자가 "다시 켜서 업데이트"를 누른 때만 설치한다. 받은 파일은 latest.yml 의 sha512 로 확인한다.
   */
  const installOnQuit = false;
  /** "다시 켜서 업데이트"를 누른 릴리스 페이지. 설치가 거절되면(맥 서명 확인 실패 등) 여기로 보낸다 */
  let restarting: string | undefined;
  let updater: AppUpdater | undefined;
  /** 받아 둔(끝낼 때 설치될) 버전 */
  let downloaded: string | undefined;
  /** 받기에 실패한 때. 한 시간 안에는 다시 받지 않는다 (잠긴 동안 1분마다 받으러 가지 않게) */
  let downloadFailedAt = 0;

  async function fetchDecision(): Promise<UpdateDecision | { kind: 'failed'; status?: number; bad?: true }> {
    try {
      const res = await net.fetch(releasesApi(), {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `fairy/${app.getVersion()}` },
        // GitHub 은 max-age=60 을 붙여 보낸다. 캐시를 쓰면 10초 뒤 두 번째 확인이 첫 응답을 그대로 받아 이중 확인이 무의미해진다
        cache: 'no-store',
        // 걸린 연결에 매달리지 않는다. 매달리면 같은 주소의 다음 확인도 HTTP 캐시 잠금에 20초씩 묶였다 (2026-10-07 실제 앱 점검)
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        o.log('update', '확인 못 함', res.status);
        return { kind: 'failed', status: res.status };
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        // 시간 초과로 끊긴 것은 아래에서 연결 문제로. 받은 글이 JSON 이 아니면 연결 문제가 아니다
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
        o.log('update', '응답을 읽지 못함');
        return { kind: 'failed', bad: true };
      }
      return decideUpdate(json, app.getVersion(), noticeMin);
    } catch (err) {
      o.log('update', '확인 실패', err instanceof Error ? err.message : String(err));
      return { kind: 'failed' };
    }
  }

  /** 윈도우 자동 설치. 쓰는 운영체제에서만 불러온다. 실패는 기록만 하고 "받으러 가기"로 돌아간다 */
  async function getUpdater(): Promise<AppUpdater | undefined> {
    if (!auto) return undefined;
    if (updater) return updater;
    try {
      const mod = (await import('electron-updater')) as unknown as {
        default?: { autoUpdater: AppUpdater };
        autoUpdater?: AppUpdater;
      };
      const u = mod.default?.autoUpdater ?? mod.autoUpdater;
      if (!u) return undefined;
      u.setFeedURL({ provider: 'github', owner: RELEASE_REPO.owner, repo: RELEASE_REPO.repo });
      u.autoDownload = false;
      u.autoInstallOnAppQuit = installOnQuit;
      u.logger = null;
      // 오류 창은 띄우지 않는다. 기록만. 다시 켜기를 누른 뒤의 오류면 받은 것을 버리고 받으러 가기로 돌린다
      u.on('error', (err) => {
        o.log('update', '자동 설치 오류', err instanceof Error ? err.message : String(err));
        const url = restarting;
        if (!url) return;
        restarting = undefined;
        downloaded = undefined;
        downloadFailedAt = Date.now();
        // 손으로 설치하게 홈페이지 설치 안내를 연다 (맥은 처음 열 때 경고 넘기는 법이 거기 있다)
        void getManually(url);
        // 잠겨 있으면 안내를 다시 띄운다 (이번엔 받으러 가기 단추)
        if (lock) void nag();
        else
          void o
            .say({ kind: 'answer', text: t('main.update.installFailed'), ttlMs: 30_000 })
            .catch(() => undefined);
      });
      updater = u;
      return u;
    } catch (err) {
      o.log('update', '자동 설치 못 씀', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** 받는 중인 것. 자동 확인 중에 직접 확인하거나 강제 안내가 겹쳐도 checkForUpdates, downloadUpdate 를 겹쳐 돌리지 않는다 */
  let downloading: Promise<string | undefined> | undefined;

  /** 새 버전을 받아 둔다. 받았으면 그 버전. 받는 중이면 그 결과를 같이 기다린다 */
  function download(): Promise<string | undefined> {
    if (!downloading)
      downloading = downloadOnce().finally(() => {
        downloading = undefined;
      });
    return downloading;
  }

  async function downloadOnce(): Promise<string | undefined> {
    if (downloaded) return downloaded;
    // 실패한 시각이 지금보다 뒤면(시계가 뒤로 감) 기다리지 않는다
    if (fresh(downloadFailedAt, Date.now(), 3_600_000)) return undefined;
    const u = await getUpdater();
    if (!u) return undefined;
    try {
      const r = await u.checkForUpdates();
      if (!r?.isUpdateAvailable) {
        downloadFailedAt = Date.now();
        return undefined;
      }
      await u.downloadUpdate();
      downloaded = r.updateInfo.version;
      o.log('update', '받아 둠', downloaded);
      return downloaded;
    } catch (err) {
      o.log('update', '받기 실패', err instanceof Error ? err.message : String(err));
      downloadFailedAt = Date.now();
      return undefined;
    }
  }

  /** 손으로 받으러 간다. 맥과 윈도우는 홈페이지 설치 안내, 리눅스는 릴리스 페이지 (manualInstallUrl) */
  function getManually(releaseUrl: string): Promise<void> {
    return shell.openExternal(manualInstallUrl(process.platform, releaseUrl));
  }

  function restartAndInstall(url: string) {
    restarting = url;
    // 조용히 설치하고 다시 켠다 (윈도우 nsis oneClick. 맥은 이때 Squirrel 이 서명을 확인하고 끝낸 뒤 바꿔 끼운다)
    updater?.quitAndInstall(true, true);
  }

  /** 받아 둔 업데이트를 끝낼 때 설치할지. 지금은 모든 운영체제에서 끈다 (installOnQuit) */
  function setInstallOnQuit(on: boolean) {
    if (updater) updater.autoInstallOnAppQuit = on && installOnQuit;
  }

  /** 떠 있는 강제 안내를 거둘 때 끊는다 */
  let nagAbort: AbortController | undefined;

  /** 저장해 둔 잠금이 있는지 (없으면 지우러 가지 않는다) */
  let saved = false;

  /** 확인한 잠금을 남긴다. 다음에 켤 때 바로 잠근다 */
  function remember(l: Lock) {
    try {
      writeJson(LOCK_FILE, { ...l, savedAt: Date.now() });
      saved = true;
    } catch (err) {
      o.log('update', '잠금 저장 못 함', err instanceof Error ? err.message : String(err));
    }
  }

  /** 강제가 아니라는 답을 받았다. 남긴 잠금을 지운다 */
  function forget() {
    if (!saved) return;
    try {
      removeJson(LOCK_FILE);
      saved = false;
    } catch (err) {
      o.log('update', '잠금 지우기 못 함', err instanceof Error ? err.message : String(err));
    }
  }

  function setLock(next: Lock | undefined) {
    const was = lock;
    lock = next;
    if (!was && next) o.log('update', '강제 업데이트로 잠금', next.minVersion);
    if (was && !next) {
      o.log('update', '잠금 풂');
      // 시간 끝 없는 안내가 남지 않게 닫고, 다시 띄우려 기다리던 것도 깨운다
      nagAbort?.abort();
      wake?.();
    }
    if (next) void nag();
  }

  /** 잠긴 동안 업데이트 안내를 계속 띄운다. 눌러 닫으면 바로, 다른 말에 밀리면 10초 뒤 다시 */
  async function nag() {
    if (nagging) return;
    nagging = true;
    try {
      while (lock) {
        const ready = await download();
        // 받는 동안 확인이 잠금을 풀었을 수 있다
        const l = lock;
        if (!l) break;
        // 전에 이 버전을 건너뛰었어도 강제면 끝낼 때 설치한다 (installOnQuit 이 켜진 운영체제만)
        if (ready) setInstallOnQuit(true);
        nagAbort = new AbortController();
        // 공지 창이 있으면 닫기 없는 창으로 (업데이트 단추만), 없으면 시간 끝 없는 말풍선으로
        const answer = o.askForce
          ? await o.askForce({
              version: l.version,
              min: l.minVersion,
              ready: !!ready,
              signal: nagAbort.signal,
            })
          : await o.say({
              kind: 'answer',
              signal: nagAbort.signal,
              text: t('main.update.forced', { version: l.version, min: l.minVersion }),
              buttons: ready
                ? [{ id: 'restart', label: t('main.update.restart') }]
                : [{ id: 'get', label: t('main.update.get') }],
              // 0 이면 시간이 지나도 닫히지 않는다
              ttlMs: 0,
            });
        if (!lock) break;
        if (answer === 'restart') {
          restartAndInstall(lock.url);
          break;
        }
        if (answer === 'get') await getManually(lock.url);
        // 눌러 닫으면 곧바로 다시 (닫을 수 없는 안내). 다른 말에 밀렸거나 못 띄웠으면 그 말을 읽을 틈만 주고 다시 (nagDelayMs)
        o.log('update', '강제 안내 닫힘', answer ?? '못 띄움');
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, nagDelayMs(answer)).unref?.();
        });
        wake = undefined;
      }
    } finally {
      nagging = false;
    }
  }

  /** 알리는 중인 버전. 같은 버전을 두 번(자동 확인과 직접 확인) 겹쳐 알리지 않는다 */
  let notifying: string | undefined;

  async function notify(version: string, url: string) {
    if (notifying === version) return;
    notifying = version;
    try {
      await notifyOnce(version, url);
    } finally {
      if (notifying === version) notifying = undefined;
    }
  }

  async function notifyOnce(version: string, url: string) {
    const ready = await download();
    if (ready) {
      setInstallOnQuit(true);
      const answer = await o.say({
        kind: 'answer',
        text: t(installOnQuit ? 'main.update.ready' : 'main.update.readyRestart', { version: ready }),
        buttons: [
          { id: 'restart', label: t('main.update.restart') },
          { id: 'skip', label: t('main.update.skip') },
        ],
        ttlMs: 30_000,
      });
      if (answer === 'restart') restartAndInstall(url);
      if (answer === 'skip') {
        settings.set({ skipVersion: version });
        setInstallOnQuit(false);
      }
      return;
    }
    const answer = await o.say({
      kind: 'answer',
      text: t('main.update.bubble', { version }),
      buttons: [
        { id: 'get', label: t('main.update.get') },
        { id: 'skip', label: t('main.update.skip') },
      ],
      ttlMs: 30_000,
    });
    if (answer === 'get') await getManually(url);
    if (answer === 'skip') settings.set({ skipVersion: version });
  }

  /** 확인을 겹쳐 돌리지 않는다 (켜고 1분 뒤 확인과 공지 파일의 최소 버전이 바뀌어 다시 보는 것이 겹칠 수 있다) */
  let queue: Promise<unknown> = Promise.resolve();
  function check(manual = false): Promise<UpdateStatus> {
    const run = queue.then(() => checkOnce(manual));
    queue = run.catch(() => undefined);
    return run;
  }

  async function checkOnce(manual: boolean): Promise<UpdateStatus> {
    // 설정을 꺼도 확인은 한다: 강제 업데이트 잠금과 풀기는 꺼짐과 상관없다. 꺼지면 아래에서 새 버전 말풍선만 생략
    const first = await fetchDecision();
    if (first.kind === 'failed') {
      // 확인을 못 하면 잠그지 않는다 (잠겨 있었으면 푼다)
      newer = undefined;
      setLock(undefined);
      // 404 는 레포가 비공개이거나 릴리스가 아직 없을 때다: 최신이라고 하지 않고 확인할 수 없다고만 (중립)
      if (first.status === 404) return { text: t('main.update.unavailable'), tone: 'info' };
      if (first.bad) return { text: t('main.update.badResponse'), tone: 'error' };
      const text = first.status
        ? t('main.update.failedStatus', { status: first.status })
        : t('main.update.offline');
      return { text, tone: 'error' };
    }
    if (first.kind === 'none') {
      newer = undefined;
      setLock(undefined);
      forget();
      return { text: t('main.update.latest'), tone: 'ok' };
    }
    newer = { version: first.version, url: first.url };
    // 더 새 버전이 나왔으면 받아 둔 것과 실패 기록을 잊고 새로 받는다
    if (downloaded && downloaded !== first.version) {
      downloaded = undefined;
      downloadFailedAt = 0;
    }
    /** 두 번째 확인이 실패했다. 강제가 아니라는 답이 아니라서, 이번만 풀고 저장한 잠금은 남긴다 */
    let unconfirmed = false;
    if (first.kind === 'force') {
      await wait(manual ? 0 : CONFIRM_MS);
      const second = await fetchDecision();
      if (second.kind !== 'failed' && confirmedForce(first, second)) {
        const next = { version: first.version, url: first.url, minVersion: first.minVersion };
        setLock(next);
        remember(next);
        return { text: t('main.update.forcedFound', { min: first.minVersion }), tone: 'info' };
      }
      o.log('update', '강제 표시가 두 번째 확인과 달라 잠그지 않음');
      unconfirmed = second.kind === 'failed';
    }
    setLock(undefined);
    if (!unconfirmed) forget();
    const { updateCheck, skipVersion } = settings.get();
    const plan = notifyPlan({ manual, updateCheck, skipVersion, version: first.version });
    if (plan === 'off') return { text: t('main.update.off'), tone: 'info' };
    if (plan === 'skipped') return { text: t('main.update.skipped'), tone: 'info' };
    o.log('update', '새 버전', first.version);
    void notify(first.version, first.url);
    return { text: t('main.update.found', { version: first.version }), tone: 'ok' };
  }

  // 지난번에 확인한 잠금이 아직 맞으면 첫 확인(1분 뒤)을 기다리지 않고 바로 잠근다. 업데이트했으면 지운다
  const raw = readJson(LOCK_FILE);
  if (raw !== undefined) {
    saved = true;
    const restored = readSavedLock(raw, app.getVersion());
    if (restored) {
      o.log('update', '저장한 잠금으로 시작', restored.minVersion);
      setLock(restored);
    } else forget();
  }

  setTimeout(() => void check(), 60_000).unref();
  setInterval(() => void check(), DAY_MS).unref();
  return {
    check,
    /** 강제 업데이트로 핵심 기능(AI 대화)이 잠겼는지 */
    locked: () => !!lock,
    /** 마지막 확인에서 새 버전을 찾았는지 (공지 창의 업데이트 권장은 받을 것이 있을 때만 띄운다) */
    newerAvailable: () => !!newer,
    /**
     * 공지 파일의 최소 버전을 넣는다 (두 번 받아 같은 값, 못 받았으면 undefined). 바뀌었으면 바로 다시 확인해
     * 잠그거나 푼다. 다시 확인도 지금처럼 두 번 받아 같아야 잠그고, 오프라인이면 잠그지 않는다
     */
    setNoticeMin(min: string | undefined) {
      if (min === noticeMin) return;
      o.log('update', '공지 파일 최소 버전', min ?? '없음');
      noticeMin = min;
      void check();
    },
    /**
     * 공지 창의 업데이트 단추 (권장 공지). 받아 둘 수 있으면 받아 두고 다시 켜서 설치, 안 되면 설치 안내를 연다.
     * 새 버전을 아직 모르면 아무것도 하지 않는다
     */
    async install() {
      const n = newer;
      if (!n) return;
      const ready = await download();
      if (ready) restartAndInstall(n.url);
      else await getManually(n.url);
    },
    /** 잠긴 기능을 쓰려 했다. 펫이 까닭을 말하고 업데이트 단추를 다시 띄운다 */
    remind() {
      if (!lock) return;
      // 안내가 떠 있으면 그대로 두고, 밀려서 기다리는 중이면 바로 다시 띄운다
      if (nagging) wake?.();
      else void nag();
    },
  };
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms).unref?.());
}
