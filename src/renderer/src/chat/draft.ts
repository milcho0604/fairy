import { useEffect, useRef } from 'react';
import type { OutgoingImage } from '../../../shared/ipc.ts';

// 쓰던 글과 붙인 그림을 메인에 맡긴다 (이슈 #145). 창을 닫았다 열면 snapshot 이 돌려준다.
// 메인 메모리에만 두고 디스크에는 쓰지 않는다. 기록 안 남김 중에는 메인이 맡지 않는다.

const bridge = window.jjakkungChat;
const TEXT_MS = 250;
const IMAGES_MS = 300;

/**
 * 입력칸 글과 붙인 그림을 멈추면 메인에 보낸다. 비우면 바로 보낸다. 창이 닫힐 때도 보낸다.
 * ready 가 되기 전(메인이 들고 있던 것을 아직 받아 오지 않았다)에는 보내지 않는다: 빈 값이 옛 글을 지우지 않게.
 */
export function useChatDraftSync(text: string, images: OutgoingImage[], ready: boolean): void {
  const latest = useRef({ text, images });
  latest.current = { text, images };
  const dirty = useRef({ text: false, images: false });
  const textTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const imagesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 처음 받아 온 값은 다시 보내지 않는다 */
  const first = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: text 가 바뀔 때만
  useEffect(() => {
    if (!ready) return;
    dirty.current.text = true;
    clearTimeout(textTimer.current);
    const send = () => {
      dirty.current.text = false;
      bridge.draftText(latest.current.text);
    };
    if (!text) send();
    else textTimer.current = setTimeout(send, TEXT_MS);
  }, [text, ready]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: images 가 바뀔 때만
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current.images = true;
    clearTimeout(imagesTimer.current);
    const send = () => {
      dirty.current.images = false;
      bridge.draftImages(latest.current.images);
    };
    if (images.length === 0) send();
    else imagesTimer.current = setTimeout(send, IMAGES_MS);
  }, [images, ready]);

  useEffect(() => {
    const flush = () => {
      if (dirty.current.text) {
        dirty.current.text = false;
        bridge.draftText(latest.current.text);
      }
      if (dirty.current.images) {
        dirty.current.images = false;
        bridge.draftImages(latest.current.images);
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);
}
