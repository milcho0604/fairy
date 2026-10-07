import { app, net, shell } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { t } from '../shared/i18n/index.ts';
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
/** 잠긴 동안 말풍선이 다른 말에 밀렸으면 다시 띄우는 간격 */
const NAG_AGAIN_MS = 60_000;

type Say = (s: SayOptions) => Promise<string | undefined>;
type Log = (tag: string, ...rest: unknown[]) => void;
type Lock = { version: string; url: string; minVersion: string };

/**
 * 새 버전 알림 (v1), 강제 업데이트, 윈도우 자동 설치. 켜고 1분 뒤, 그 뒤 하루에 한 번 GitHub Releases 를 본다.
 * - 새 버전: 펫이 말풍선으로 알린다. 맥은 "받으러 가기"(릴리스 페이지), 윈도우 설치판은 미리 받아 두고
 *   "다시 켜서 업데이트" (안 누르면 끝낼 때 설치).
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
  let updater: AppUpdater | undefined;
  /** 받아 둔(끝낼 때 설치될) 버전 */
  let downloaded: string | undefined;
  /** 받기에 실패한 때. 한 시간 안에는 다시 받지 않는다 (잠긴 동안 1분마다 받으러 가지 않게) */
  let downloadFailedAt = 0;

  async function fetchDecision(): Promise<UpdateDecision | { kind: 'failed'; status?: number }> {
    try {
      const res = await net.fetch(releasesApi(), {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `jjakkung/${app.getVersion()}` },
      });
      if (!res.ok) {
        o.log('update', '확인 못 함', res.status);
        return { kind: 'failed', status: res.status };
      }
      return decideUpdate(await res.json(), app.getVersion());
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
      u.autoInstallOnAppQuit = true;
      u.logger = null;
      // 오류 창은 띄우지 않는다. 기록만
      u.on('error', (err) =>
        o.log('update', '자동 설치 오류', err instanceof Error ? err.message : String(err)),
      );
      updater = u;
      return u;
    } catch (err) {
      o.log('update', '자동 설치 못 씀', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** 새 버전을 받아 둔다. 받았으면 그 버전 */
  async function download(): Promise<string | undefined> {
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

  function restartAndInstall() {
    // 조용히 설치하고 다시 켠다 (nsis oneClick)
    updater?.quitAndInstall(true, true);
  }

  function setLock(next: Lock | undefined) {
    const was = lock;
    lock = next;
    if (!was && next) o.log('update', '강제 업데이트로 잠금', next.minVersion);
    if (was && !next) o.log('update', '잠금 풂');
    if (next) void nag();
  }

  /** 잠긴 동안 업데이트 안내를 계속 띄운다. 눌러 닫으면 바로, 다른 말에 밀리면 1분 뒤 다시 */
  async function nag() {
    if (nagging) return;
    nagging = true;
    try {
      while (lock) {
        const ready = await download();
        // 전에 이 버전을 건너뛰었어도 강제면 끝낼 때 설치한다
        if (ready && updater) updater.autoInstallOnAppQuit = true;
        const answer = await o.say({
          kind: 'answer',
          text: t('main.update.forced', { version: lock.version, min: lock.minVersion }),
          buttons: ready
            ? [{ id: 'restart', label: t('main.update.restart') }]
            : [{ id: 'get', label: t('main.update.get') }],
          // 0 이면 시간이 지나도 닫히지 않는다
          ttlMs: 0,
        });
        if (!lock) break;
        if (answer === 'restart') {
          restartAndInstall();
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

  async function notify(version: string, url: string) {
    const ready = await download();
    if (ready) {
      if (updater) updater.autoInstallOnAppQuit = true;
      const answer = await o.say({
        kind: 'answer',
        text: t('main.update.ready', { version: ready }),
        buttons: [
          { id: 'restart', label: t('main.update.restart') },
          { id: 'skip', label: t('main.update.skip') },
        ],
        ttlMs: 30_000,
      });
      if (answer === 'restart') restartAndInstall();
      if (answer === 'skip') {
        settings.set({ skipVersion: version });
        if (updater) updater.autoInstallOnAppQuit = false;
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

  async function check(manual = false): Promise<string> {
    if (!manual && !settings.get().updateCheck) return t('main.update.off');
    const first = await fetchDecision();
    if (first.kind === 'failed') {
      // 확인을 못 하면 잠그지 않는다 (잠겨 있었으면 푼다)
      setLock(undefined);
      if (first.status === 404) return t('main.update.none');
      return first.status
        ? t('main.update.failedStatus', { status: first.status })
        : t('main.update.offline');
    }
    if (first.kind === 'none') {
      setLock(undefined);
      return t('main.update.latest');
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
        return t('main.update.forcedFound', { min: first.minVersion });
      }
      o.log('update', '강제 표시가 두 번째 확인과 달라 잠그지 않음');
    }
    setLock(undefined);
    if (!manual && settings.get().skipVersion === first.version) return t('main.update.skipped');
    o.log('update', '새 버전', first.version);
    void notify(first.version, first.url);
    return t('main.update.found', { version: first.version });
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
