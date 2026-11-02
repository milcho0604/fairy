import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';

// 창 옵션 중 순수한 것. 맥에서 앱이 뒤에 있을 때(터미널을 쓰다 떠 있는 패널을 누를 때) 첫 클릭이 창 깨우기로만 쓰이고 단추에 안 닿는
// 일이 없게 acceptFirstMouse 를 켠다. 펫 앱은 Dock 이 없어 다른 앱에서 돌아오는 일이 잦다.

/** 패널과 빠른 입력: 투명한 떠 있는 창. 고정 핀으로 다른 앱 위에 떠 있어도 첫 클릭이 그대로 닿는다 */
export function floatingWindowOptions(bounds: Rectangle): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    show: false,
  };
}
