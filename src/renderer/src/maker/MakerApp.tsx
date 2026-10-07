import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { DEPTH_URL, type MakerInfo, MODEL_URL, type PetLook } from '../../../shared/ipc.ts';
import { contentBox, keptRatio, stroke } from '../../../shared/mask.ts';
import type { Blueprint } from '../../../shared/pet3d/blueprint.ts';
import { PET_NAME_MAX, POSE_KINDS } from '../../../shared/settings.ts';
import { CANVAS_SIZE } from '../draw.ts';
import { Pet3D } from '../pet3d.ts';
import { openDepth, predictDepth } from './depth.ts';
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
  // 입체로 만들기 (6단계): AI 가 사진을 보고 설계도를 만든다
  // 2.5D (6단계): 사진을 볼 AI 가 없어도 이 창 안에서 깊이를 재서 사진을 입체 판으로
  const [look, setLook] = useState<'photo' | 'figure' | 'relief'>('photo');
  const [model, setModel] = useState<Blueprint>();
  const [depth, setDepth] = useState('');
  const [shaping, setShaping] = useState(false);

  useEffect(() => {
    bridge.info().then((i) => {
      setInfo(i);
      setName(i.target === 'food' ? '' : i.petName);
      // AI 확인(CLI 상태)은 몇 초 걸릴 수 있어 따로 받는다. 그동안 사진 고르기는 막지 않는다
      void bridge.visionAi().then((visionAi) => setInfo((v) => v && { ...v, visionAi }));
    });
    bridge.onProgress(setProgress);
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  const isFood = info?.target === 'food';
  const isPose = !!info && info.target !== 'main' && !isFood;
  const poseLabel = POSE_KINDS.find((p) => p.id === info?.target)?.label ?? '';
  const [animated, setAnimated] = useState(false);
  /** 입체로 만들기는 펫 본 그림(움직이지 않는 사진)에만 */
  const can3d = info?.target === 'main' && !animated;

  const start = useCallback(
    async (file: Blob) => {
      if (!info) return;
      setError('');
      try {
        // 움직이는 그림(gif, webp 여러 장)은 배경을 지우지 않고 그대로 쓴다 (v1).
        if (await isAnimated(file)) {
          if (file.size > ANIMATED_MAX) throw new Error(t('maker.err.animatedTooBig'));
          setAnimated(true);
          // 앞 사진으로 만든 입체 모습은 버린다 (움직이는 그림은 입체로 만들지 않는다)
          setLook('photo');
          setModel(undefined);
          setDepth('');
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
        if (!res.ok) throw new Error(t('maker.err.modelRead'));
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
      setError(t('maker.err.allErased'));
      return;
    }
    setError('');
    setPreview(url);
    setModel(undefined);
    setDepth('');
    setStep('name');
  };

  // 만드는 사이 사진을 다시 다듬었으면 옛 결과는 버린다
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const shape = async () => {
    const from = preview;
    setShaping(true);
    setError('');
    const r = await bridge.shape3d(from);
    setShaping(false);
    if (previewRef.current !== from) return;
    if (r.ok) setModel(r.model);
    else setError(r.error);
  };

  const makeRelief = async () => {
    if (!info) return;
    const from = preview;
    setShaping(true);
    setError('');
    setProgress(0);
    try {
      const r = await bridge.ensureDepth();
      if (!r.ok) throw new Error(r.error);
      setInfo((v) => v && { ...v, depth: { ...v.depth, ready: true } });
      const res = await fetch(DEPTH_URL);
      if (!res.ok) throw new Error(t('maker.err.modelRead'));
      await openDepth(await res.arrayBuffer());
      const d = await predictDepth(await loadImage(from), info.depth);
      if (previewRef.current === from) setDepth(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setShaping(false);
    }
  };

  const chosen: PetLook | undefined =
    look === 'figure' && model ? { model } : look === 'relief' && depth ? { depth } : undefined;

  const canSave = step === 'name' && !shaping && (look === 'photo' || !!chosen);

  const save = async () => {
    // Enter 로도 오니 단추와 같은 조건을 본다 (만드는 중 Enter 가 평면으로 저장했다)
    if (!canSave) return;
    setStep('saving');
    const r = await bridge.save(preview, name, chosen);
    if (!r.ok) {
      setError(r.error ?? t('maker.err.saveFailed'));
      setStep('name');
      return;
    }
    setStep('done');
    setTimeout(() => bridge.close(), 1400);
  };

  const steps: [Step[], string][] = [
    [['pick', 'model', 'working'], t('maker.step.photo')],
    [['edit'], t('maker.step.edit')],
    [['name', 'saving', 'done'], isPose ? t('maker.step.confirm') : t('maker.step.name')],
  ];
  const title = isFood
    ? t('maker.title.food')
    : isPose
      ? t('maker.title.pose', { pose: poseLabel })
      : t('maker.title.pet');

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
              <span className="big">{t('maker.pick.title')}</span>
              <span>{t('maker.pick.how')}</span>
              <span className="hint">
                {isFood
                  ? t('maker.pick.food', { cost: info?.foodCost ?? 50 })
                  : isPose
                    ? t('maker.pick.pose', { pose: poseLabel })
                    : t('maker.pick.pet')}
              </span>
              <span className="hint">{t('maker.pick.animated')}</span>
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
            <p className="privacy">{t('maker.pick.privacy')}</p>
            {!isFood && (isPose ? info?.hasPose : info?.hasPhotoPet) && (
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  await bridge.resetToDefault();
                  setInfo((v) => v && { ...v, hasPhotoPet: isPose ? v.hasPhotoPet : false, hasPose: false });
                }}
              >
                {isPose ? t('maker.pick.removePose') : t('maker.pick.resetPet')}
              </button>
            )}
          </section>
        )}

        {step === 'model' && (
          <section className="busy">
            <p>{t('maker.model.downloading', { mb: info?.modelMB ?? 0 })}</p>
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
            <p>{t('maker.working.title')}</p>
            <p className="hint">{t('maker.working.hint')}</p>
          </section>
        )}

        {step === 'edit' && work && (
          <Editor
            work={work}
            note={t('maker.edit.took', { backend, sec: (elapsed / 1000).toFixed(1) })}
            onBack={() => setStep('pick')}
            onNext={toName}
          />
        )}

        {(step === 'name' || step === 'saving' || step === 'done') && (
          <section className="name">
            <div className="stage">
              {look === 'figure' && model ? (
                <Spin3D model={model} />
              ) : look === 'relief' && depth ? (
                <Spin3D photo={preview} depth={depth} />
              ) : (
                <img className={shaping ? 'shaping' : 'bounce'} src={preview} alt={t('maker.name.alt')} />
              )}
            </div>
            {animated && step === 'name' && <p className="hint">{t('maker.name.animatedNote')}</p>}
            {can3d && step === 'name' && (
              <div className="look3d">
                <fieldset className="segmented" aria-label={t('maker.3d.look')}>
                  {(info?.visionAi
                    ? (['photo', 'figure', 'relief'] as const)
                    : (['photo', 'relief'] as const)
                  ).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={look === k}
                      className={look === k ? 'on' : ''}
                      disabled={shaping}
                      onClick={() => setLook(k)}
                    >
                      {k === 'photo'
                        ? t('maker.3d.photo')
                        : k === 'figure'
                          ? t('maker.3d.figure')
                          : t('maker.3d.relief')}
                    </button>
                  ))}
                </fieldset>
                {look === 'relief' && (
                  <>
                    <p className="hint">
                      {shaping
                        ? info?.depth.ready
                          ? t('maker.relief.working')
                          : t('maker.relief.downloading', {
                              mb: info?.depth.mb ?? 27,
                              pct: Math.round(progress * 100),
                            })
                        : depth
                          ? t('maker.relief.ready')
                          : t('maker.relief.hint', { mb: info?.depth.mb ?? 27 })}
                    </p>
                    {!shaping && !depth && (
                      <button type="button" className="ghost" onClick={makeRelief}>
                        {t('maker.relief.make')}
                      </button>
                    )}
                  </>
                )}
                {look === 'figure' && (
                  <>
                    <p className="hint">
                      {shaping ? t('maker.3d.working') : model ? t('maker.3d.ready') : t('maker.3d.hint')}
                    </p>
                    {!shaping && (
                      <button type="button" className="ghost" onClick={shape}>
                        {model ? t('maker.3d.again') : t('maker.3d.make')}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {step === 'done' ? (
              <p className="done">
                {isFood
                  ? t('maker.done.food', { name: name.trim() })
                  : isPose
                    ? t('maker.done.pose', { pose: poseLabel })
                    : t('maker.done.pet', { name: name.trim() || info?.petName || t('common.appName') })}
              </p>
            ) : (
              <>
                <label hidden={isPose}>
                  {isFood ? t('maker.name.foodLabel') : t('maker.name.label')}
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
                  <button
                    type="button"
                    className="ghost"
                    disabled={shaping}
                    onClick={() => setStep(animated ? 'pick' : 'edit')}
                  >
                    {animated ? t('maker.name.otherImage') : t('maker.name.reedit')}
                  </button>
                  <button type="button" className="primary" disabled={!canSave} onClick={save}>
                    {step === 'saving'
                      ? t('maker.name.saving')
                      : isFood
                        ? t('maker.name.makeFood', { cost: info?.foodCost ?? 50 })
                        : isPose
                          ? t('maker.name.usePose')
                          : t('maker.name.choosePet')}
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

let previewPet: Pet3D | undefined;

/** 입체 펫을 빙글 돌려 보여 준다. AI 설계도(model) 또는 사진과 깊이 그림(2.5D) */
function Spin3D({ model, photo, depth }: { model?: Blueprint; photo?: string; depth?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    // 미리보기마다 새로 만들면 컨텍스트가 새서 창에 하나만 두고 다시 쓴다
    previewPet ??= Pet3D.create(() => {});
    const pet = previewPet;
    if (!canvas || !ctx || !pet) return;
    let alive = true;
    if (model) pet.setBlueprint(model);
    else if (photo && depth)
      void Promise.all([loadImage(photo), loadImage(depth)]).then(([p, d]) => {
        if (alive) pet.setRelief(p, d);
      });
    const side = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    const k = (side * dpr) / CANVAS_SIZE;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const ms = now - t0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      // 천천히 한 바퀴, 가끔 눈 깜빡
      pet.spin = Math.sin(ms / 2600) * 1.1;
      const blink = ms % 3800 < 180 ? (ms % 3800) / 180 : -1;
      pet.draw(ctx, { mood: 'idle', elapsed: ms, blink }, 0, 1, 1, undefined);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      pet.clear();
    };
  }, [model, photo, depth]);
  return (
    <canvas
      ref={ref}
      className="spin3d"
      style={{ width: 220, height: 220 }}
      aria-label={t('maker.name.alt')}
    />
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
        <fieldset className="segmented" aria-label={t('maker.edit.brush')}>
          <button
            type="button"
            aria-pressed={mode === 'erase'}
            className={mode === 'erase' ? 'on' : ''}
            onClick={() => setMode('erase')}
          >
            {t('maker.edit.eraser')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'restore'}
            className={mode === 'restore' ? 'on' : ''}
            onClick={() => setMode('restore')}
          >
            {t('maker.edit.restore')}
          </button>
        </fieldset>
        <label className="size">
          {t('maker.edit.size')}
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
          {t('maker.edit.undo')}
        </button>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={work.w}
          height={work.h}
          className={mode}
          style={{ '--brush': `${size}px` } as React.CSSProperties}
          aria-label={t('maker.edit.canvas')}
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
        {t('maker.edit.hint')} {note}
      </p>
      {(kept < 0.02 || kept > 0.97) && (
        <p className="warn">
          {kept < 0.02 ? t('maker.edit.almostAllErased') : t('maker.edit.barelyErased')}{' '}
          {t('maker.edit.tryAgain')}
        </p>
      )}
      <div className="actions">
        <button type="button" className="ghost" onClick={onBack}>
          {t('maker.edit.otherPhoto')}
        </button>
        <button type="button" className="primary" onClick={onNext}>
          {t('maker.edit.next')}
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
    r.onerror = () => reject(new Error(t('maker.err.imageRead')));
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
  if (!g) throw new Error(t('maker.err.photoRead'));
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

/** data URL 그림을 연다 */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
