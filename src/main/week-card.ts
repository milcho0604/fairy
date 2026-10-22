// 주간 회고 카드 저장 (2026-10-11). 패널이 그린 PNG 를 저장 창으로 받아 쓴다. 할 일 제목은 사용자가 "할 일 제목 넣기"를
// 골랐을 때만 패널이 따로 묻는다 (weekTitles). 카드 값 고르기는 shared/week-card.ts.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import { BOND } from '../shared/bond-ipc.ts';
import { t } from '../shared/i18n/index.ts';
import { localDay } from '../shared/todo-store.ts';
import { cardFileName, cardRange, isPngDataUrl } from '../shared/week-card.ts';

export interface WeekCardOptions {
  doneTitlesSince: (from: number) => string[];
  /** 지금 보이는 패널 면 (작은 패널, 큰 창이 열려 있으면 큰 창) */
  surface: () => BrowserWindow | undefined;
  /** 저장 창이 떠 있는 동안 패널을 닫지 않는다 (panel.ts hold) */
  hold: <T>(work: () => Promise<T>) => Promise<T>;
  /** 저장했다 (여정 "주간 돌아보기") */
  onSaved: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

export function createWeekCard(o: WeekCardOptions) {
  const fromPanel = (sender: Electron.WebContents) => {
    const w = o.surface();
    return !!w && !w.isDestroyed() && w.webContents === sender;
  };

  ipcMain.handle(BOND.weekTitles, (e) => {
    if (!fromPanel(e.sender)) return [];
    const { from } = cardRange(localDay(Date.now()));
    const start = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
    return o.doneTitlesSince(start.getTime());
  });

  ipcMain.handle(BOND.weekSave, async (e, png: unknown) => {
    if (!fromPanel(e.sender) || !isPngDataUrl(png)) return { ok: false, message: t('bond.week.saveFailed') };
    return o.hold(() => save(png));
  });

  async function save(png: string): Promise<{ ok: boolean; message: string }> {
    const name = cardFileName(t('bond.week.filePrefix'), localDay(Date.now()));
    const r = await dialog.showSaveDialog({
      title: t('bond.week.saveTitle'),
      defaultPath: join(app.getPath('pictures'), name),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, message: '' };
    const file = /\.png$/i.test(r.filePath) ? r.filePath : `${r.filePath}.png`;
    try {
      writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
      o.log('week-card', '저장');
      o.onSaved();
      return { ok: true, message: t('bond.week.saved') };
    } catch (err) {
      o.log('week-card', '저장 실패', err instanceof Error ? err.message : String(err));
      return { ok: false, message: t('bond.week.saveFailed') };
    }
  }

  return { save };
}
