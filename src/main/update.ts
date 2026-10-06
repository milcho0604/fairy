import { app, net, shell } from 'electron';
import { isNewer, readRelease } from '../shared/version.ts';
import type { SayOptions } from './pet-window.ts';
import { settings } from './settings.ts';

/** 릴리스를 올리는 곳 (D8 이 정해지면 공개 배포용 레포로 바꾼다). 비공개면 404 라 조용히 넘어간다 */
export const RELEASES_API = 'https://api.github.com/repos/milcho0604/jjakkung/releases/latest';
const DAY_MS = 86_400_000;

/**
 * 새 버전 알림 (v1 "자동 실행과 업데이트"). 켜고 1분 뒤, 그 뒤 하루에 한 번 GitHub Releases 를 본다.
 * 새 버전이면 펫이 말풍선으로 알리고 "받으러 가기"를 누르면 릴리스 페이지를 연다.
 * 서명 전(D4)이라 스스로 설치하지 않는다. 사용자 정보는 보내지 않는다(앱 이름과 버전만).
 */
export function watchUpdates(o: {
  say: (s: SayOptions) => Promise<string | undefined>;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  async function check(manual = false): Promise<string> {
    if (!manual && !settings.get().updateCheck) return '꺼져 있어';
    try {
      const res = await net.fetch(RELEASES_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `jjakkung/${app.getVersion()}` },
      });
      if (!res.ok) {
        o.log('update', '확인 못 함', res.status);
        return res.status === 404 ? '아직 받을 수 있는 버전이 없어' : `확인하지 못했어 (${res.status})`;
      }
      const latest = readRelease(await res.json());
      if (!latest || !isNewer(latest.version, app.getVersion())) return '최신 버전이야';
      if (!manual && settings.get().skipVersion === latest.version) return '건너뛴 버전이야';
      o.log('update', '새 버전', latest.version);
      const answer = await o.say({
        kind: 'answer',
        text: `새 버전 ${latest.version} 이 나왔어.`,
        buttons: [
          { id: 'get', label: '받으러 가기' },
          { id: 'skip', label: '이 버전은 건너뛰기' },
        ],
        ttlMs: 30_000,
      });
      if (answer === 'get') await shell.openExternal(latest.url);
      if (answer === 'skip') settings.set({ skipVersion: latest.version });
      return `새 버전 ${latest.version}`;
    } catch (err) {
      o.log('update', '확인 실패', err instanceof Error ? err.message : String(err));
      return '확인하지 못했어 (인터넷 연결을 봐 줘)';
    }
  }

  setTimeout(() => void check(), 60_000).unref();
  setInterval(() => void check(), DAY_MS).unref();
  return { check };
}
