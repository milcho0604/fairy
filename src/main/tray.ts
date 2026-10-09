import { join } from 'node:path';
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import { t } from '../shared/i18n/index.ts';
import { settings } from './settings.ts';

export interface TrayActions {
  toggleHidden(): void;
  isHidden(): boolean;
  openChat(): void;
  /** 같이 보기. 펫 우클릭 메뉴 맨 위와 같은 것 */
  lookTogether(): void;
  openSettings(): void;
  /** 베타 기록 칸을 연 설정 창 (P4-01 의견 보내기) */
  sendFeedback(): void;
  quickAdd(): void;
  /** 패널을 할 일 탭으로 연다 */
  openTodos(): void;
  /** 펫(과 친구) 화면을 다시 불러온다. 펫이 안 보이거나 멈췄을 때 우클릭을 못 하니 여기에도 둔다 */
  reloadPet(): void;
  /** 컴퓨터 상태 줄들 (system-monitor.ts) */
  stats(): MenuItemConstructorOptions[];
  /** 메뉴 막대(윈도우는 알림 영역)에 CPU 와 달리는 펫 보이기 (설정 sysMonitor) */
  sysMonitorOn(): boolean;
  setSysMonitor(on: boolean): void;
}

/** 기본 아이콘. 맥은 흑백 템플릿, 윈도우는 콩이 그림 (펫 얼굴이 오면 index.ts 가 바꾼다) */
export function baseTrayIcon(): Electron.NativeImage {
  const dir = join(app.getAppPath(), 'resources');
  if (process.platform !== 'darwin') return nativeImage.createFromPath(join(dir, 'tray.png'));
  const icon = nativeImage.createFromPath(join(dir, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  return icon;
}

/**
 * 메뉴 막대(맥), 알림 영역(윈도우) 아이콘. 펫 앱은 Dock 아이콘이 없어서, 숨긴 펫을 다시 부르고
 * 끝내는 길이 여기에 있어야 한다 (P4-01 일부를 P1-10 으로 당겨 왔다).
 */
export function createTray(petName: () => string, actions: TrayActions): Tray {
  const tray = new Tray(baseTrayIcon());
  tray.setToolTip(t('tray.tooltip', { name: petName() }));

  const build = () =>
    Menu.buildFromTemplate([
      {
        label: actions.isHidden() ? t('tray.show', { name: petName() }) : t('tray.hide', { name: petName() }),
        accelerator: hideShortcut(),
        click: () => actions.toggleHidden(),
      },
      { label: t('tray.chat', { name: petName() }), click: () => actions.openChat() },
      { label: t('tray.look', { name: petName() }), click: () => actions.lookTogether() },
      { label: t('tray.todos'), click: () => actions.openTodos() },
      { label: t('tray.addTodo'), accelerator: quickAddShortcut(), click: () => actions.quickAdd() },
      { label: t('tray.settings'), click: () => actions.openSettings() },
      { label: t('tray.feedback'), click: () => actions.sendFeedback() },
      { type: 'separator' },
      {
        label: t('tray.stats'),
        submenu: [
          ...actions.stats(),
          { type: 'separator' },
          {
            label: t('tray.stats.show', { mac: process.platform === 'darwin' }),
            type: 'checkbox',
            checked: actions.sysMonitorOn(),
            click: (item) => actions.setSysMonitor(item.checked),
          },
        ],
      },
      { type: 'separator' },
      { label: t('tray.reload', { name: petName() }), click: () => actions.reloadPet() },
      { label: t('tray.quit'), role: 'quit' },
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
