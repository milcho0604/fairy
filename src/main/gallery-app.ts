// 펫 갤러리를 앱에 잇는다: 설정 창이 부르는 목록, 데려오기, 친구에게 보낼 펫 파일 저장.
// 갤러리에는 레포 주인이 고른 공식 펫만 있다. 사용자끼리는 .jjpet 파일을 직접 주고받는다
// 받기와 검사는 gallery.ts, 데려오기는 .jjpet 가져오기와 같은 adoptPet (backup.ts).
// 갤러리 주소를 바꾸는 JJ_GALLERY_URL 은 패키지 안 된 앱(개발 실행, 시험)에서만, 내 컴퓨터 주소만 받는다
import { app, type BrowserWindow, net } from 'electron';
import { galleryBase } from '../shared/gallery.ts';
import { t } from '../shared/i18n/index.ts';
import { cleanAuthor, DEFAULT_LICENSE, isPetLicense } from '../shared/pet-share.ts';
import { isStarterId } from '../shared/starter-pets.ts';
import { adoptPet, exportPet } from './backup.ts';
import { createGallery } from './gallery.ts';

export function galleryHandlers(log: (tag: string, ...rest: unknown[]) => void) {
  const base = galleryBase(process.env.JJ_GALLERY_URL, !app.isPackaged);
  if (base.startsWith('http:')) log('gallery', 'dev base', base);
  const gallery = createGallery({ fetch: (url, init) => net.fetch(url, init), base, log });
  let busy = false;

  return {
    list: () => gallery.list(),
    async adopt(id: unknown, asFriend: boolean): Promise<{ ok: boolean; message: string }> {
      // 내장 그림 친구를 갤러리에서 다시 받으면 같은 펫의 복사본이 생긴다. IPC 요청도 막는다.
      if (isStarterId(id)) return { ok: false, message: t('settings.gallery.builtInHint') };
      // 두 번 눌러 같은 펫을 두 번 받지 않게
      if (busy) return { ok: false, message: '' };
      busy = true;
      try {
        const r = await gallery.download(id);
        if (!r.ok)
          return {
            ok: false,
            message: t(r.reason === 'bad' ? 'settings.gallery.badFile' : 'settings.gallery.downloadFailed'),
          };
        return await adoptPet(r.pet, asFriend, log);
      } finally {
        busy = false;
      }
    },
    /** 친구에게 보낼 .jjpet 판 2 를 만든 사람, 사용 허락과 함께 저장한다 (갤러리에 올리지 않는다) */
    async share(meta: unknown, win?: BrowserWindow): Promise<{ ok: boolean; message: string }> {
      const m = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
      const author = cleanAuthor(m.author);
      const license = isPetLicense(m.license) ? m.license : DEFAULT_LICENSE;
      try {
        const path = await exportPet(
          win,
          // 비운 칸도 넘긴다: 데려온 펫의 만든 사람을 지우면 새 작품 (reexportMeta)
          { author: author ?? '', license },
          t('main.gallery.saveTitle'),
        );
        if (!path) return { ok: false, message: '' };
        return { ok: true, message: t('settings.gallery.made') };
      } catch (err) {
        log('gallery', 'share failed', err instanceof Error ? err.message : String(err));
        return { ok: false, message: t('settings.gallery.failed') };
      }
    },
  };
}
