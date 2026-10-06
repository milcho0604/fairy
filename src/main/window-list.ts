import { createRequire } from 'node:module';
import { screen } from 'electron';
import type { Rect } from '../shared/geometry.ts';

/**
 * 화면에 보이는 다른 앱의 보통 창 위치 (앞에 있는 창부터). 창 위에 올라앉기(v1)에 쓴다.
 * 맥은 CoreGraphics(CGWindowListCopyWindowInfo), 윈도우는 user32(EnumWindows). koffi 로 부른다.
 * 위치만 읽고 창 제목은 읽지 않는다 (맥에서 제목은 화면 기록 권한이 필요하다).
 * 못 쓰면 undefined (리눅스, koffi 로드 실패).
 */
export type WindowLister = () => Rect[];

let lister: WindowLister | undefined | null;

export function windowLister(log: (tag: string, ...rest: unknown[]) => void): WindowLister | undefined {
  if (lister !== undefined) return lister ?? undefined;
  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi');
    if (process.platform === 'darwin') lister = macLister(koffi);
    else if (process.platform === 'win32') lister = winLister(koffi);
    else lister = null;
  } catch (err) {
    log('windows', '창 목록을 못 씀', err instanceof Error ? err.message : String(err));
    lister = null;
  }
  return lister ?? undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: koffi 는 타입 정의가 느슨하다
type Koffi = any;

function macLister(koffi: Koffi): WindowLister {
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  koffi.struct('JJCGRect', { x: 'double', y: 'double', w: 'double', h: 'double' });
  const copyList = cg.func('void* CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeTo)');
  const rectOf = cg.func('bool CGRectMakeWithDictionaryRepresentation(void* dict, _Out_ JJCGRect* rect)');
  const count = cf.func('long CFArrayGetCount(void* arr)');
  const at = cf.func('void* CFArrayGetValueAtIndex(void* arr, long i)');
  const get = cf.func('void* CFDictionaryGetValue(void* dict, void* key)');
  const str = cf.func('void* CFStringCreateWithCString(void* alloc, const char* s, uint32_t enc)');
  const num = cf.func('bool CFNumberGetValue(void* num, long type, _Out_ int* out)');
  const release = cf.func('void CFRelease(void* obj)');
  const UTF8 = 0x08000100;
  const K = {
    bounds: str(null, 'kCGWindowBounds', UTF8),
    layer: str(null, 'kCGWindowLayer', UTF8),
    pid: str(null, 'kCGWindowOwnerPID', UTF8),
    alpha: str(null, 'kCGWindowAlpha', UTF8),
  };
  const ON_SCREEN_ONLY = 1;
  const EXCLUDE_DESKTOP = 16;
  const INT = 9;
  return () => {
    const arr = copyList(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0);
    if (!arr) return [];
    const out: Rect[] = [];
    try {
      const n = count(arr);
      for (let i = 0; i < n; i++) {
        const d = at(arr, i);
        const layer = [0];
        const pid = [0];
        num(get(d, K.layer), INT, layer);
        num(get(d, K.pid), INT, pid);
        // 0층(보통 창)만, 짝꿍 자신은 빼고
        if (layer[0] !== 0 || pid[0] === process.pid) continue;
        const r = { x: 0, y: 0, w: 0, h: 0 };
        if (!rectOf(get(d, K.bounds), r)) continue;
        out.push({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) });
      }
    } finally {
      release(arr);
    }
    return out;
  };
}

function winLister(koffi: Koffi): WindowLister {
  const user32 = koffi.load('user32.dll');
  const dwm = koffi.load('dwmapi.dll');
  koffi.struct('JJRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const EnumProc = koffi.proto('bool __stdcall JJEnumProc(void* hwnd, intptr_t lparam)');
  const enumWindows = user32.func('bool __stdcall EnumWindows(JJEnumProc* cb, intptr_t lparam)');
  const visible = user32.func('bool __stdcall IsWindowVisible(void* hwnd)');
  const iconic = user32.func('bool __stdcall IsIconic(void* hwnd)');
  const owner = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)');
  const exStyle = user32.func('long __stdcall GetWindowLongW(void* hwnd, int index)');
  const attr = dwm.func(
    'long __stdcall DwmGetWindowAttribute(void* hwnd, uint32_t a, _Out_ void* out, uint32_t size)',
  );
  const GWL_EXSTYLE = -20;
  const WS_EX_TOOLWINDOW = 0x80;
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const DWMWA_CLOAKED = 14;
  return () => {
    const out: Rect[] = [];
    const cb = koffi.register((hwnd: unknown) => {
      if (!visible(hwnd) || iconic(hwnd)) return true;
      if (exStyle(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) return true;
      const pid = [0];
      owner(hwnd, pid);
      if (pid[0] === process.pid) return true;
      const cloaked = Buffer.alloc(4);
      if (attr(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked.readUInt32LE(0) !== 0) return true;
      const buf = Buffer.alloc(16);
      if (attr(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, buf, 16) !== 0) return true;
      const r = { x: buf.readInt32LE(0), y: buf.readInt32LE(4), width: 0, height: 0 };
      r.width = buf.readInt32LE(8) - r.x;
      r.height = buf.readInt32LE(12) - r.y;
      if (r.width <= 0 || r.height <= 0) return true;
      // 창 좌표는 실제 픽셀이라 Electron 좌표(DIP)로 바꾼다
      out.push(screen.screenToDipRect(null, r));
      return true;
    }, koffi.pointer(EnumProc));
    try {
      enumWindows(cb, 0);
    } finally {
      koffi.unregister(cb);
    }
    return out;
  };
}
