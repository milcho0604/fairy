// Gemini 앱(무료)에서 만들기 (2026-10-11). 무료 Hugging Face 서버는 인터넷 연결마다 하루 3번쯤이라 금방 막힌다.
// 요청문을 복사하고 Gemini 를 열어 주면, 사용자가 사진과 요청문을 직접 넣고 받은 그림을 여기로 가져온다.
// 가져온 그림은 올린 사진처럼 배경 지우기, 다듬기, 저장으로 간다 (onImage). 요청문은 shared/gemini.ts
import { type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import {
  checkGeminiImage,
  GEMINI_STYLES,
  type GeminiStyle,
  geminiPrompt,
  markCorner,
} from '../../../shared/gemini.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { AgeStage } from '../../../shared/illustrate.ts';
import './gemini.css';

const bridge = window.jjakkungMaker;
/** 머리말로 볼 앞부분 (JPEG 의 크기 표시는 EXIF 뒤에 있다) */
const HEAD_BYTES = 256 * 1024;
/** 표시 지우기를 볼 때 줄일 크기 (긴 변). 뒤에서 1024 로 다시 줄인다 */
const CHECK_SIDE = 2048;

export function GeminiRoute({
  age,
  wish,
  photo,
  stuck = false,
  onImage,
}: {
  age: AgeStage;
  wish: string;
  /** 고른 사진 (JPEG data URL). 있으면 파일 관리자로 보여 줄 수 있다 */
  photo?: string;
  /** 무료 서버가 오늘 막혔다: 펼쳐 두고 안내 글을 바꾼다 */
  stuck?: boolean;
  /** 가져온 그림 (검사를 마친 것) */
  onImage: (image: Blob) => void;
}) {
  const [open, setOpen] = useState(stuck);
  const [style, setStyle] = useState<GeminiStyle>('figure');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const prompt = geminiPrompt(style, age, wish);

  // 막히면 펼친다 (사용자가 접은 뒤 다시 막히면 또 펼친다)
  useEffect(() => {
    if (stuck) setOpen(true);
  }, [stuck]);

  const bring = async (file: Blob) => {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
      const check = checkGeminiImage(head, file.size);
      if (!check.ok) {
        setError(t(check.why === 'kind' ? 'maker.gemini.err.kind' : 'maker.gemini.err.big'));
        return;
      }
      onImage(await withoutMark(file));
    } catch (err) {
      console.warn('gemini', err);
      setError(t('maker.gemini.err.read'));
    } finally {
      setBusy(false);
    }
  };

  // 펼쳐 둔 동안은 창 어디에 붙여 넣어도 Gemini 그림으로 받는다. 창의 붙여 넣기(새 사진으로 시작)보다 먼저 잡는다.
  // 글만 붙여 넣으면(바라는 점 칸) 건드리지 않는다
  const bringRef = useRef(bring);
  bringRef.current = bring;
  useEffect(() => {
    if (!open) return;
    const paste = (e: globalThis.ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      void bringRef.current(f);
    };
    window.addEventListener('paste', paste, true);
    return () => window.removeEventListener('paste', paste, true);
  }, [open]);

  const openGemini = async () => {
    setError('');
    setStatus('');
    try {
      const r = await bridge.openGemini(style, age, wish || undefined);
      setStatus(
        r.copied
          ? t(r.opened ? 'maker.gemini.opened' : 'maker.gemini.openFailed')
          : t('maker.gemini.copyFailed'),
      );
    } catch {
      setStatus(t('maker.gemini.copyFailed'));
    }
  };

  const reveal = async () => {
    if (!photo) return;
    setError('');
    const ok = await bridge.revealGeminiPhoto(photo).catch(() => false);
    if (!ok) setError(t('maker.gemini.revealFailed'));
  };

  const drop = (e: DragEvent) => {
    // 창 전체의 끌어다 놓기(새 사진으로 시작)까지 가지 않게
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')) ?? e.dataTransfer.files[0];
    if (f) void bring(f);
  };

  const onPaste = (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    void bring(f);
  };

  const platform = bridge.platform === 'darwin' ? 'mac' : bridge.platform === 'win32' ? 'win' : 'other';

  return (
    <details
      className="gemini"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{t('maker.gemini.summary')}</summary>
      <p className="hint">{t(stuck ? 'maker.gemini.stuckLead' : 'maker.gemini.lead')}</p>
      <div className="gemini-row">
        <span className="wish-label" id="maker-gemini-style">
          {t('maker.gemini.style')}
        </span>
        <fieldset className="segmented" aria-labelledby="maker-gemini-style">
          {GEMINI_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={style === s}
              className={style === s ? 'on' : ''}
              onClick={() => setStyle(s)}
            >
              {t(`maker.gemini.style.${s}`)}
            </button>
          ))}
        </fieldset>
      </div>
      <ol className="gemini-steps">
        <li>{t('maker.gemini.step1')}</li>
        <li>{t('maker.gemini.step2')}</li>
        <li>{t('maker.gemini.step3')}</li>
      </ol>
      <div className="gemini-actions">
        <button type="button" className="primary" onClick={openGemini}>
          {t('maker.gemini.open')}
        </button>
        {photo && (
          <button type="button" className="ghost" onClick={reveal}>
            {t(`maker.gemini.reveal.${platform}`)}
          </button>
        )}
      </div>
      {status && (
        <small className="hint" role="status">
          {status}
        </small>
      )}
      <details className="gemini-prompt">
        <summary>{t('maker.gemini.showPrompt')}</summary>
        <textarea
          readOnly
          aria-label={t('maker.gemini.promptLabel')}
          value={prompt}
          rows={5}
          onFocus={(e) => e.currentTarget.select()}
        />
      </details>
      <button
        type="button"
        className={`gemini-drop${over ? ' over' : ''}`}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <span className="big">{t('maker.gemini.drop.title')}</span>
        <span className="hint">{t('maker.gemini.drop.how')}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void bring(f);
          e.target.value = '';
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <small className="hint">{t('maker.gemini.corner')}</small>
      <p className="privacy">{t('maker.gemini.privacy')}</p>
    </details>
  );
}

/**
 * 오른쪽 아래 Gemini 반짝이 표시를 흰색으로 덮는다 (흰 바탕일 때만, shared/gemini.ts markCorner).
 * 덮을 것이 없으면 받은 파일 그대로
 */
async function withoutMark(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, CHECK_SIDE / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * k));
    c.height = Math.max(1, Math.round(bitmap.height * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return file;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    const box = markCorner(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (!box) return file;
    g.fillStyle = '#ffffff';
    g.fillRect(box.x, box.y, box.width, box.height);
    return await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b ?? file), 'image/png'));
  } finally {
    bitmap.close();
  }
}
