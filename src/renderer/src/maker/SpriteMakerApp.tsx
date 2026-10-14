// 2D 그림 세트 만들기 창 (2026-10-15, #89). 펫 만들기 창의 target 'sprites'.
// 지금 페어리 그림을 기준 그림으로 삼아 동작마다 무료 그림 Space 에 한 번씩 가로 띠를 받고 (메인, sprite-gen.ts),
// 여기서 풀어 shared/sprite-strip.ts 로 자르고 배경을 지우고 검사한다. 된 동작만 모아 그림 세트로 저장한다.
// 무료 횟수가 끝나거나 그만두면 남은 동작은 그대로 두고, 된 동작으로 저장하거나 실패한 동작만 다시 만들 수 있다

import { useEffect, useRef, useState } from 'react';
import { type I18nKey, t } from '../../../shared/i18n/index.ts';
import type { SpriteSource } from '../../../shared/ipc.ts';
import type { SpriteName } from '../../../shared/pet-sprites.ts';
import {
  assembleSprites,
  type FrameIssue,
  keyHex,
  onKey,
  pickKeyColor,
  processStrip,
  type Rgb,
  type Rgba,
  type RowState,
  rowOf,
  rowsToMake,
  SPRITE_ROWS,
  type SpriteRowId,
  STRIP_H,
  STRIP_W,
  setFrames,
  stopsQueue,
} from '../../../shared/sprite-strip.ts';
import { escClosesWindow } from '../panel/keys.ts';

const bridge = window.jjakkungMaker;
/** 기준 그림 긴 변 (Space 에 보내는 크기) */
const REF_SIDE = 512;
/** 미리보기 걷기 한 장 시간 (ms) */
const WALK_MS = 160;

type States = Partial<Record<SpriteRowId, RowState>>;
type Phase = 'ready' | 'running' | 'saving' | 'done';

/** 그림 주소를 RGBA 로 (w, h 를 주면 그 크기로 늘리거나 줄인다) */
async function pixelsOf(url: string, fit?: { w: number; h: number }): Promise<Rgba> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = fit?.w ?? img.naturalWidth;
  const h = fit?.h ?? img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

function pngOf(img: Rgba): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0,
  );
  return c.toDataURL('image/png');
}

/** 기준 그림: 지금 페어리 그림(투명 PNG)을 긴 변 512 로 줄여 배경색 위에 */
async function referenceOf(url: string): Promise<{ own: Rgba; key: Rgb; ref: string }> {
  const probe = await pixelsOf(url);
  const k = Math.min(1, REF_SIDE / Math.max(probe.width, probe.height));
  const own =
    k < 1 ? await pixelsOf(url, { w: Math.round(probe.width * k), h: Math.round(probe.height * k) }) : probe;
  const key = pickKeyColor(own);
  return { own, key, ref: pngOf(onKey(own, key)) };
}

const ROW_LABEL: Record<SpriteRowId, I18nKey> = {
  stand: 'sprites.row.stand',
  walk: 'sprites.row.walk',
  rest: 'sprites.row.rest',
  feel: 'sprites.row.feel',
  talk: 'sprites.row.talk',
};
const ISSUE_LABEL: Record<FrameIssue, I18nKey> = {
  empty: 'sprites.issue.empty',
  clipped: 'sprites.issue.clipped',
  key: 'sprites.issue.key',
  jump: 'sprites.issue.jump',
  count: 'sprites.issue.count',
};

export function SpriteMakerApp() {
  const [src, setSrc] = useState<SpriteSource | undefined>();
  const [states, setStates] = useState<States>({});
  const [strips, setStrips] = useState<Partial<Record<SpriteRowId, string>>>({});
  const [phase, setPhase] = useState<Phase>('ready');
  const [current, setCurrent] = useState<SpriteRowId | undefined>();
  const [error, setError] = useState('');
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [preview, setPreview] = useState<{ name: SpriteName; url: string }[]>([]);
  const ref = useRef<{ own: Rgba; key: Rgb; ref: string } | undefined>(undefined);
  const stopped = useRef(false);

  useEffect(() => {
    document.title = t('sprites.title');
    void bridge.spriteSource().then((s) => setSrc(s));
  }, []);

  // Esc 로 닫는다 (만드는 중에는 하던 일을 잃으니 아닐 때만)
  useEffect(() => {
    if (phase === 'running' || phase === 'saving') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (escClosesWindow(e)) bridge.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  // 그리는 동안 몇 초째인지
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // 된 동작이 바뀌면 미리보기 세트를 다시 맞춘다 (저장할 그림과 같은 것)
  useEffect(() => {
    const frames = setFrames(states, ref.current?.own);
    setPreview(assembleSprites(frames).map((f) => ({ name: f.name, url: pngOf(f.img) })));
  }, [states]);

  async function run(ids: SpriteRowId[]) {
    if (!src?.image || ids.length === 0) return;
    setError('');
    setPhase('running');
    stopped.current = false;
    try {
      ref.current ??= await referenceOf(src.image);
    } catch {
      setError(t('sprites.err.read'));
      setPhase('ready');
      return;
    }
    const base = ref.current;
    for (const id of ids) {
      if (stopped.current) break;
      const row = rowOf(id);
      if (!row) continue;
      setCurrent(id);
      setStarted(Date.now());
      setNow(Date.now());
      setStates((v) => ({ ...v, [id]: { s: 'run' } }));
      const r = await bridge.spriteRow(id, base.ref, keyHex(base.key));
      if (!r.ok) {
        // 그만두면 그 동작은 기다림으로 (실패가 아니라 다시 누르면 만든다)
        setStates((v) => ({
          ...v,
          [id]: r.kind === 'cancelled' ? { s: 'wait' } : { s: 'fail', error: r.error },
        }));
        if (stopsQueue(r.kind)) {
          if (r.kind !== 'cancelled') setError(r.error);
          // 시도하지 않은 동작은 기다림 그대로
          break;
        }
        continue;
      }
      try {
        const strip = await pixelsOf(r.image, { w: STRIP_W, h: STRIP_H });
        const got = processStrip(strip, row, base.key);
        setStrips((v) => ({ ...v, [id]: pngOf({ ...strip }) }));
        setStates((v) => ({
          ...v,
          [id]: got.issues.length === 0 ? { s: 'ok', frames: got.frames } : { s: 'bad', issues: got.issues },
        }));
      } catch {
        setStates((v) => ({ ...v, [id]: { s: 'fail', error: t('sprites.err.read') } }));
      }
    }
    setCurrent(undefined);
    setPhase('ready');
  }

  function stop() {
    stopped.current = true;
    bridge.cancel();
  }

  async function save() {
    const frames = setFrames(states, ref.current?.own);
    if (!frames.some((f) => f.name === 'idle')) return;
    setPhase('saving');
    const map: Record<string, string> = {};
    for (const f of assembleSprites(frames)) map[f.name] = pngOf(f.img);
    const r = await bridge.saveSprites(map);
    if (r.ok) setPhase('done');
    else {
      setError(r.error ?? t('maker.err.saveFailed'));
      setPhase('ready');
    }
  }

  const okRows = SPRITE_ROWS.filter((r) => states[r.id]?.s === 'ok');
  const todo = rowsToMake(states);
  const tried = SPRITE_ROWS.some((r) => states[r.id]);
  const walk = preview.filter((p) => p.name.startsWith('walk-'));
  const running = phase === 'running';
  const doneCount = okRows.length;

  return (
    <div className="maker sprites">
      <header>
        <h1 className="sr-only">{t('sprites.title')}</h1>
        <strong aria-hidden="true">{t('sprites.title')}</strong>
      </header>
      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {src && !src.image && <p className="warn">{t('sprites.noPet')}</p>}
        {src?.image && (
          <section>
            <div className="sprite-top">
              <img className="sprite-own" src={src.image} alt={src.name} />
              <div>
                <p>{t('sprites.intro')}</p>
                <p className="privacy">{t('sprites.privacy')}</p>
                {src.hasSprites && <p className="hint">{t('sprites.replace')}</p>}
              </div>
            </div>

            <ol className="sprite-rows">
              {SPRITE_ROWS.map((r) => {
                const st = states[r.id];
                return (
                  <li key={r.id} className={`sprite-row ${st?.s ?? 'wait'}`} data-row={r.id}>
                    <span className="sprite-row-name">{t(ROW_LABEL[r.id])}</span>
                    <span className="sprite-row-state" role={st?.s === 'run' ? 'status' : undefined}>
                      {st?.s === 'run'
                        ? t('sprites.state.run', { n: Math.max(0, Math.round((now - started) / 1000)) })
                        : st?.s === 'bad'
                          ? `${t('sprites.state.bad')}: ${st.issues.map((i) => t(ISSUE_LABEL[i])).join(', ')}`
                          : st?.s === 'fail'
                            ? t('sprites.state.fail')
                            : st?.s === 'ok'
                              ? t('sprites.state.ok')
                              : t('sprites.state.wait')}
                    </span>
                    {/* 멈추지 않는 실패(바쁨, 시간 초과)는 위 안내 대신 그 동작 아래에 까닭을 */}
                    {st?.s === 'fail' && st.error !== error && (
                      <small className="sprite-row-why">{st.error}</small>
                    )}
                    {strips[r.id] && <img className="sprite-strip" src={strips[r.id]} alt="" />}
                  </li>
                );
              })}
            </ol>

            {running && (
              <div className="sprite-progress">
                <progress
                  max={SPRITE_ROWS.length}
                  value={doneCount}
                  aria-label={t('sprites.progress', {
                    done: doneCount,
                    total: SPRITE_ROWS.length,
                    row: current ? t(ROW_LABEL[current]) : '',
                  })}
                />
                <span>
                  {t('sprites.progress', {
                    done: doneCount,
                    total: SPRITE_ROWS.length,
                    row: current ? t(ROW_LABEL[current]) : '',
                  })}
                </span>
              </div>
            )}

            {preview.length > 0 && (
              <div className="sprite-preview">
                <span className="wish-label">{t('sprites.preview')}</span>
                {walk.length > 0 && <WalkLoop urls={walk.map((w) => w.url)} />}
                <div className="sprite-sheet">
                  {preview.map((p) => (
                    <figure key={p.name}>
                      <img className="sprite-pic" src={p.url} alt={p.name} />
                      <figcaption>{p.name}</figcaption>
                    </figure>
                  ))}
                </div>
                {states.stand?.s !== 'ok' ? <p className="hint">{t('sprites.noIdle')}</p> : null}
                {doneCount < SPRITE_ROWS.length && <p className="hint">{t('sprites.partial')}</p>}
              </div>
            )}

            {phase === 'done' ? (
              <p className="done">{t('sprites.done')}</p>
            ) : (
              <div className="actions">
                {running ? (
                  <button type="button" className="ghost" onClick={stop}>
                    {t('maker.progress.stop')}
                  </button>
                ) : (
                  todo.length > 0 && (
                    <button type="button" className={tried ? 'ghost' : 'primary'} onClick={() => run(todo)}>
                      {tried ? t('sprites.retry') : t('sprites.start')}
                    </button>
                  )
                )}
                {doneCount > 0 && !running && (
                  <button type="button" className="primary" disabled={phase === 'saving'} onClick={save}>
                    {phase === 'saving' ? t('maker.name.saving') : t('sprites.save')}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/** 걷기 장들을 돌려 보여 준다 (펫 화면의 걷기와 같은 순서) */
function WalkLoop({ urls }: { urls: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % urls.length), WALK_MS);
    return () => clearInterval(id);
  }, [urls.length]);
  return <img className="sprite-walk" src={urls[i % urls.length]} alt={t('sprites.row.walk')} />;
}
