import { app, net, shell } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { t } from '../shared/i18n/index.ts';
import type { UpdateStatus } from '../shared/ipc.ts';
import {
  canAutoInstall,
  confirmedForce,
  decideUpdate,
  RELEASE_REPO,
  RELEASES_API,
  type UpdateDecision,
} from '../shared/update-policy.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

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
/** 잠긴 동안 말풍선이 다른 말에 밀렸으면 다시 띄우는 간격 */
const NAG_AGAIN_MS = 60_000;

type Say = (s: SayOptions) => Promise<string | undefined>;
type Log = (tag: string, ...rest: unknown[]) => void;
type Lock = { version: string; url: string; minVersion: string };

/**
 * 새 버전 알림 (v1), 강제 업데이트, 자동 설치. 켜고 1분 뒤, 그 뒤 하루에 한 번 GitHub Releases 를 본다.
 * - 새 버전: 펫이 말풍선으로 알린다. 설치판은 미리 받아 두고 "다시 켜서 업데이트". 윈도우와 맥 모두
 *   누를 때만 설치한다 (끝낼 때 저절로 설치하지 않는다). 받지 못했거나 개발 실행이면 "받으러 가기"(릴리스 페이지).
 * - 강제(릴리스 본문의 min-version 보다 낮음): 건너뛰기 없이, 시간 끝 없이 알리고 AI 대화를 잠근다.
 *   두 번 따로 받은 응답이 같아야 잠그고, 확인이 실패하면 풀린다. 오프라인이면 잠그지 않는다.
 * 사용자 정보는 보내지 않는다(앱 이름과 버전만). 토큰도 없다.
 */
export function watchUpdates(o: { say: Say; log: Log }) {
  let lock: Lock | undefined;
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
      return decideUpdate(json, app.getVersion());
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
        void shell.openExternal(url);
        // 잠겨 있으면 안내를 다시 띄운다 (이번엔 받으러 가기 단추)
        if (lock) void nag();
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
    if (Date.now() - downloadFailedAt < 3_600_000) return undefined;
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

  /** 잠긴 동안 업데이트 안내를 계속 띄운다. 눌러 닫으면 바로, 다른 말에 밀리면 1분 뒤 다시 */
  async function nag() {
    if (nagging) return;
    nagging = true;
    try {
      while (lock) {
        const ready = await download();
        // 전에 이 버전을 건너뛰었어도 강제면 끝낼 때 설치한다 (installOnQuit 이 켜진 운영체제만)
        if (ready) setInstallOnQuit(true);
        nagAbort = new AbortController();
        const answer = await o.say({
          kind: 'answer',
          signal: nagAbort.signal,
          text: t('main.update.forced', { version: lock.version, min: lock.minVersion }),
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
        if (answer === 'get') await shell.openExternal(lock.url);
        // 눌러 닫으면 곧바로 다시 (닫을 수 없는 안내). 다른 말에 밀렸거나 못 띄웠으면 조금 뒤에
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, answer === 'dismiss' ? 500 : NAG_AGAIN_MS).unref?.();
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
    if (answer === 'get') await shell.openExternal(url);
    if (answer === 'skip') settings.set({ skipVersion: version });
  }

  async function check(manual = false): Promise<UpdateStatus> {
    if (!manual && !settings.get().updateCheck) return { text: t('main.update.off'), tone: 'info' };
    const first = await fetchDecision();
    if (first.kind === 'failed') {
      // 확인을 못 하면 잠그지 않는다 (잠겨 있었으면 푼다)
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
      setLock(undefined);
      return { text: t('main.update.latest'), tone: 'ok' };
    }
    // 더 새 버전이 나왔으면 받아 둔 것과 실패 기록을 잊고 새로 받는다
    if (downloaded && downloaded !== first.version) {
      downloaded = undefined;
      downloadFailedAt = 0;
    }
    if (first.kind === 'force') {
      await wait(manual ? 0 : CONFIRM_MS);
      const second = await fetchDecision();
      if (second.kind !== 'failed' && confirmedForce(first, second)) {
        setLock({ version: first.version, url: first.url, minVersion: first.minVersion });
        return { text: t('main.update.forcedFound', { min: first.minVersion }), tone: 'info' };
      }
      o.log('update', '강제 표시가 두 번째 확인과 달라 잠그지 않음');
    }
    setLock(undefined);
    if (!manual && settings.get().skipVersion === first.version)
      return { text: t('main.update.skipped'), tone: 'info' };
    o.log('update', '새 버전', first.version);
    void notify(first.version, first.url);
    return { text: t('main.update.found', { version: first.version }), tone: 'ok' };
  }

  setTimeout(() => void check(), 60_000).unref();
  setInterval(() => void check(), DAY_MS).unref();
  return {
    check,
    /** 강제 업데이트로 핵심 기능(AI 대화)이 잠겼는지 */
    locked: () => !!lock,
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
