import { join } from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import { withParticle } from '../shared/josa.ts';
import { settings } from './settings.ts';

export interface TrayActions {
  toggleHidden(): void;
  isHidden(): boolean;
  openChat(): void;
  openSettings(): void;
  /** 베타 기록 칸을 연 설정 창 (P4-01 의견 보내기) */
  sendFeedback(): void;
  quickAdd(): void;
}

/**
 * 메뉴 막대(맥), 알림 영역(윈도우) 아이콘. 펫 앱은 Dock 아이콘이 없어서, 숨긴 펫을 다시 부르고
 * 끝내는 길이 여기에 있어야 한다 (P4-01 일부를 P1-10 으로 당겨 왔다).
 */
export function createTray(petName: () => string, actions: TrayActions): Tray {
  const dir = join(app.getAppPath(), 'resources');
  const icon =
    process.platform === 'darwin'
      ? nativeImage.createFromPath(join(dir, 'trayTemplate.png'))
      : nativeImage.createFromPath(join(dir, 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip(`짝꿍 (${petName()})`);

  const build = () =>
    Menu.buildFromTemplate([
      {
        label: actions.isHidden()
          ? `${withParticle(petName(), '을')} 다시 보이기`
          : `${withParticle(petName(), '을')} 잠깐 숨기기`,
        accelerator: hideShortcut(),
        click: () => actions.toggleHidden(),
      },
      { label: `${withParticle(petName(), '과')} 대화`, click: () => actions.openChat() },
      { label: '할 일 추가', accelerator: quickAddShortcut(), click: () => actions.quickAdd() },
      { label: '설정', click: () => actions.openSettings() },
      { label: '의견 보내기', click: () => actions.sendFeedback() },
      { type: 'separator' },
      { label: '끝내기', role: 'quit' },
    ]);
  // 메뉴를 열 때마다 글자(숨기기/보이기)를 새로 만든다.
  tray.on('click', () => tray.popUpContextMenu(build()));
  tray.on('right-click', () => tray.popUpContextMenu(build()));
  return tray;
}

/** 펫 숨기기와 보이기. 기본은 다른 앱과 겹치지 않게 네 키 조합. 설정에서 바꾼다 (v2) */
export const hideShortcut = () => settings.get().shortcuts.hide;
/** 어디서든 할 일 한 줄 넣기 (P2-04). 설정에서 바꾼다 (v2) */
export const quickAddShortcut = () => settings.get().shortcuts.quickAdd;
