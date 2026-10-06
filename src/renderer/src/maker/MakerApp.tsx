import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type MakerInfo, MODEL_URL } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import { contentBox, keptRatio, stroke } from '../../../shared/mask.ts';
import { PET_NAME_MAX, POSE_KINDS } from '../../../shared/settings.ts';
import { backend, openModel, predictMask } from './removeBg.ts';

const bridge = window.jjakkungMaker;
/** 다듬는 동안의 사진 크기 (긴 변). 모델 입력(1024)과 같게. */
const WORK_SIDE = 1024;
/** 펫으로 저장할 그림 크기 (긴 변) */
const OUT_SIDE = 512;
const UNDO_LIMIT = 20;

type Step = 'pick' | 'model' | 'working' | 'edit' | 'name' | 'saving' | 'done';

interface Work {
  photo: HTMLCanvasElement;
  mask: Uint8ClampedArray;
  w: number;
  h: number;
}

export function MakerApp() {
  const [info, setInfo] = useState<MakerInfo>();
  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [work, setWork] = useState<Work>();
  const [name, setName] = useState('');
  const [preview, setPreview] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bridge.info().then((i) => {
      setInfo(i);
      setName(i.target === 'food' ? '' : i.petName);
    });
    bridge.onProgress(setProgress);
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  const isFood = info?.target === 'food';
  const isPose = !!info && info.target !== 'main' && !isFood;
  const poseLabel = POSE_KINDS.find((p) => p.id === info?.target)?.label ?? '';
  const [animated, setAnimated] = useState(false);

  const start = useCallback(
    async (file: Blob) => {
      if (!info) return;
      setError('');
      try {
        // 움직이는 그림(gif, webp 여러 장)은 배경을 지우지 않고 그대로 쓴다 (v1).
        if (await isAnimated(file)) {
          if (file.size > ANIMATED_MAX) throw new Error('움직이는 그림은 8MB 까지 돼.');
          setAnimated(true);
          setPreview(await toDataUrl(file));
          setStep('name');
          return;
        }
        setAnimated(false);
        const photo = await loadPhoto(file);
        if (!info.modelReady) setStep('model');
        const r = await bridge.ensureModel();
        if (!r.ok) throw new Error(r.error);
        setInfo((v) => v && { ...v, modelReady: true });
        setStep('working');
        const res = await fetch(MODEL_URL);
        if (!res.ok) throw new Error('모델 파일을 못 읽었어. 창을 닫았다가 다시 열어 줘.');
        await openModel(await res.arrayBuffer());
        const t0 = performance.now();
        const mask = await predictMask(photo, info);
        setElapsed(Math.round(performance.now() - t0));
        setWork({ photo, mask, w: photo.width, h: photo.height });
        setStep('edit');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStep('pick');
      }
    },
    [info],
  );

  // 창 어디에 끌어다 놓거나 붙여 넣어도 시작한다.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f && step === 'pick') start(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [start, step]);

  const onPaste = (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (f && step === 'pick') start(f);
  };

  const toName = () => {
    if (!work) return;
    const url = cutout(work);
    if (!url) {
      setError('다 지워졌어. 복원 붓으로 펫을 조금 되살려 줘.');
      return;
    }
    setError('');
    setPreview(url);
    setStep('name');
  };

  const save = async () => {
    setStep('saving');
    const r = await bridge.save(preview, name);
    if (!r.ok) {
      setError(r.error ?? '저장하지 못했어');
      setStep('name');
      return;
    }
    setStep('done');
    setTimeout(() => bridge.close(), 1400);
  };

  const steps: [Step[], string][] = [
    [['pick', 'model', 'working'], '사진'],
    [['edit'], '다듬기'],
    [['name', 'saving', 'done'], isPose ? '확인' : '이름'],
  ];
  const title = isFood ? '커스텀 먹이 만들기' : isPose ? `${poseLabel} 포즈 만들기` : '사진으로 펫 만들기';

  return (
    <div className="maker" onPaste={onPaste}>
      <header>
        <strong>{title}</strong>
        <ol className="steps">
          {steps.map(([group, label], i) => (
            <li key={label} className={group.includes(step) ? 'on' : ''}>
              <span>{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {step === 'pick' && (
          <section className="pick">
            <button type="button" className="drop" onClick={() => fileRef.current?.click()}>
              <span className="big">사진을 골라 줘</span>
              <span>여기를 누르거나, 사진을 끌어다 놓거나, 붙여 넣어도 돼.</span>
              <span className="hint">
                {isFood
                  ? `과일, 과자처럼 먹이가 될 사진이야. 만들면 코인 ${info?.foodCost ?? 50}개를 써.`
                  : isPose
                    ? `${poseLabel} 보일 사진이야. 같은 펫의 다른 표정 사진이면 좋아.`
                    : '반려동물, 좋아하는 인형이나 캐릭터처럼 하나가 또렷한 사진이 잘 돼.'}
              </span>
              <span className="hint">
                움직이는 GIF, WebP 는 배경을 지우지 않고 그대로 써. 배경이 투명한 것이 좋아.
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) start(f);
                e.target.value = '';
              }}
            />
            <p className="privacy">
              사진은 이 컴퓨터 안에서만 다뤄. 배경 지우기도 여기서 해서 밖으로 보내지 않아.
            </p>
            {!isFood && (isPose ? info?.hasPose : info?.hasPhotoPet) && (
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  await bridge.resetToDefault();
                  setInfo((v) => v && { ...v, hasPhotoPet: isPose ? v.hasPhotoPet : false, hasPose: false });
                }}
              >
                {isPose ? '이 포즈 지우기' : '기본 펫으로 돌아가기'}
              </button>
            )}
          </section>
        )}

        {step === 'model' && (
          <section className="busy">
            <p>처음 한 번만 배경 지우는 도구를 받고 있어 ({info?.modelMB}MB).</p>
            <div
              className="bar"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="hint">{Math.round(progress * 100)}%</p>
          </section>
        )}

        {step === 'working' && (
          <section className="busy">
            <p>배경을 지우는 중이야.</p>
            <p className="hint">그래픽 카드가 없으면 10초쯤 걸릴 수 있어.</p>
          </section>
        )}

        {step === 'edit' && work && (
          <Editor
            work={work}
            note={`${backend}로 ${(elapsed / 1000).toFixed(1)}초 걸렸어.`}
            onBack={() => setStep('pick')}
            onNext={toName}
          />
        )}

        {(step === 'name' || step === 'saving' || step === 'done') && (
          <section className="name">
            <div className="stage">
              <img className="bounce" src={preview} alt="새 펫" />
            </div>
            {animated && step === 'name' && <p className="hint">움직이는 그림이라 배경은 그대로야.</p>}
            {step === 'done' ? (
              <p className="done">
                {isFood
                  ? `${withParticle(name.trim(), '을')} 상점 먹이에 넣었어!`
                  : isPose
                    ? `${poseLabel} 이 모습으로 보일게!`
                    : `${withParticle(name.trim() || info?.petName || '짝꿍', '이')} 화면에 나타났어!`}
              </p>
            ) : (
              <>
                <label hidden={isPose}>
                  {isFood ? '먹이 이름' : '이름'}
                  <input
                    value={name}
                    maxLength={PET_NAME_MAX * 2}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                    }}
                  />
                </label>
                <div className="actions">
                  <button type="button" className="ghost" onClick={() => setStep(animated ? 'pick' : 'edit')}>
                    {animated ? '다른 그림' : '다시 다듬기'}
                  </button>
                  <button type="button" className="primary" disabled={step === 'saving'} onClick={save}>
                    {step === 'saving'
                      ? '저장 중'
                      : isFood
                        ? `코인 ${info?.foodCost ?? 50}개로 만들기`
                        : isPose
                          ? '이 포즈로 할게'
                          : '이 펫으로 할게'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/** 지우개와 복원 붓으로 마스크를 다듬는다. 지운 곳은 흐리게 보여서 되살릴 곳을 찾기 쉽다. */
function Editor({
  work,
  note,
  onBack,
  onNext,
}: {
  work: Work;
  note: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [size, setSize] = useState(24);
  const [, setVersion] = useState(0);
  const undo = useRef<Uint8ClampedArray[]>([]);
  const last = useRef<{ x: number; y: number }>(undefined);
  const raf = useRef(0);
  const pixels = useRef<ImageData>(undefined);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    if (!pixels.current) {
      const pg = work.photo.getContext('2d', { willReadFrequently: true });
      pixels.current = pg?.getImageData(0, 0, work.w, work.h);
    }
    const src = pixels.current;
    if (!src) return;
    const out = g.createImageData(work.w, work.h);
    for (let i = 0; i < work.mask.length; i++) {
      const a = work.mask[i] ?? 0;
      out.data[i * 4] = src.data[i * 4] ?? 0;
      out.data[i * 4 + 1] = src.data[i * 4 + 1] ?? 0;
      out.data[i * 4 + 2] = src.data[i * 4 + 2] ?? 0;
      // 지운 곳도 20% 로 남겨 보인다 (저장할 때는 마스크 그대로)
      out.data[i * 4 + 3] = Math.max(a, 50);
      if (a < 128) {
        out.data[i * 4] = Math.round((out.data[i * 4] ?? 0) * 0.6 + 255 * 0.4);
        out.data[i * 4 + 1] = Math.round((out.data[i * 4 + 1] ?? 0) * 0.6);
        out.data[i * 4 + 2] = Math.round((out.data[i * 4 + 2] ?? 0) * 0.6);
      }
    }
    g.putImageData(out, 0, 0);
  }, [work]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toWork = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * work.w, y: ((e.clientY - r.top) / r.height) * work.h };
  };
  const brushPx = (e: React.PointerEvent<HTMLCanvasElement>) =>
    (size * work.w) / e.currentTarget.getBoundingClientRect().width;

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWork(e);
    stroke(work.mask, work.w, work.h, last.current ?? p, p, brushPx(e), mode === 'erase' ? 0 : 255);
    last.current = p;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  };

  const kept = keptRatio(work.mask);

  return (
    <section className="edit">
      <div className="tools">
        <fieldset className="segmented" aria-label="붓">
          <button
            type="button"
            aria-pressed={mode === 'erase'}
            className={mode === 'erase' ? 'on' : ''}
            onClick={() => setMode('erase')}
          >
            지우개
          </button>
          <button
            type="button"
            aria-pressed={mode === 'restore'}
            className={mode === 'restore' ? 'on' : ''}
            onClick={() => setMode('restore')}
          >
            복원 붓
          </button>
        </fieldset>
        <label className="size">
          굵기
          <input
            type="range"
            min={6}
            max={80}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={undo.current.length === 0}
          onClick={() => {
            const prev = undo.current.pop();
            if (prev) work.mask.set(prev);
            draw();
            setVersion((v) => v + 1);
          }}
        >
          되돌리기
        </button>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={work.w}
          height={work.h}
          className={mode}
          style={{ '--brush': `${size}px` } as React.CSSProperties}
          aria-label="펫 다듬기. 지운 곳은 흐린 붉은빛으로 보여."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            undo.current.push(work.mask.slice());
            if (undo.current.length > UNDO_LIMIT) undo.current.shift();
            last.current = undefined;
            paint(e);
            setVersion((v) => v + 1);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) paint(e);
          }}
          onPointerUp={() => {
            last.current = undefined;
          }}
        />
      </div>
      <p className="hint">
        흐린 붉은빛이 지워질 곳이야. 남길 곳이 지워졌으면 복원 붓으로, 배경이 남았으면 지우개로 칠해. {note}
      </p>
      {(kept < 0.02 || kept > 0.97) && (
        <p className="warn">
          {kept < 0.02 ? '거의 다 지워졌어.' : '배경이 거의 안 지워졌어.'} 다듬거나 다른 사진을 골라 봐.
        </p>
      )}
      <div className="actions">
        <button type="button" className="ghost" onClick={onBack}>
          다른 사진
        </button>
        <button type="button" className="primary" onClick={onNext}>
          다 됐어
        </button>
      </div>
    </section>
  );
}

const ANIMATED_MAX = 8 * 1024 * 1024;

/** 여러 장짜리 gif, webp 인지 (ImageDecoder 로 프레임 수를 본다) */
async function isAnimated(file: Blob): Promise<boolean> {
  if (!/^image\/(gif|webp)$/.test(file.type) || !('ImageDecoder' in window)) return false;
  try {
    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const n = decoder.tracks.selectedTrack?.frameCount ?? 1;
    decoder.close();
    return n > 1;
  } catch {
    return false;
  }
}

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('그림을 읽지 못했어'));
    r.readAsDataURL(file);
  });
}

/** 파일을 작업 크기(긴 변 1024 이하) 캔버스로 */
async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, WORK_SIDE / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('사진을 읽지 못했어');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c;
}

/** 마스크를 입혀 남긴 부분만 잘라 긴 변 512 PNG 로. 다 지웠으면 빈 문자열. */
function cutout(work: Work): string {
  const box = contentBox(work.mask, work.w, work.h);
  if (!box) return '';
  const pg = work.photo.getContext('2d', { willReadFrequently: true });
  const src = pg?.getImageData(0, 0, work.w, work.h);
  if (!src) return '';
  const full = document.createElement('canvas');
  full.width = work.w;
  full.height = work.h;
  const fg = full.getContext('2d');
  if (!fg) return '';
  const img = fg.createImageData(work.w, work.h);
  img.data.set(src.data);
  for (let i = 0; i < work.mask.length; i++) img.data[i * 4 + 3] = work.mask[i] ?? 0;
  fg.putImageData(img, 0, 0);
  const k = Math.min(1, OUT_SIDE / Math.max(box.width, box.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * k));
  out.height = Math.max(1, Math.round(box.height * k));
  const og = out.getContext('2d');
  if (!og) return '';
  og.imageSmoothingQuality = 'high';
  og.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
