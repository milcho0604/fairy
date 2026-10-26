// 2D 그림 세트 만들기 창 (2026-10-15, #89). 펫 만들기 창의 target 'sprites'.
// 지금 페어리 그림을 기준 그림으로 삼아 동작마다 무료 그림 Space 에 한 번씩 가로 띠를 받고 (메인, sprite-gen.ts),
// 여기서 풀어 shared/sprite-strip.ts 로 자르고 배경을 지우고 검사한다. 된 동작만 모아 그림 세트로 저장한다.
// 무료 횟수가 끝나거나 그만두면 남은 동작은 그대로 두고, 된 동작으로 저장하거나 실패한 동작만 다시 만들 수 있다.
// 2026-10-15: 그리는 곳으로 내 컴퓨터(준비가 끝났을 때, local-draw.ts)를 고를 수 있고, 무료 횟수가 끝나면 남은 동작을
// 내 컴퓨터에서 이어 그리자고 권한다. 마음에 안 드는 동작은 하나씩 Gemini 앱에서 받아 온 그림으로 바꾼다 (fitStrip 뒤 같은 검사)

import { type DragEvent, useEffect, useRef, useState } from 'react';
import { checkGeminiImage } from '../../../shared/gemini.ts';
import { type I18nKey, t } from '../../../shared/i18n/index.ts';
import type { SpriteSource } from '../../../shared/ipc.ts';
import type { IllustEngine } from '../../../shared/local-draw.ts';
import type { SpriteName } from '../../../shared/pet-sprites.ts';
import {
  assembleSprites,
  type FitWhy,
  type FrameIssue,
  fitStrip,
  isQuotaKind,
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
import { useLanguageUpdates } from '../use-language.ts';
import './gemini.css';

const bridge = window.jjakkungMaker;
/** 기준 그림 긴 변 (Space 에 보내는 크기) */
const REF_SIDE = 512;
/** 미리보기 걷기 한 장 시간 (ms) */
const WALK_MS = 160;
/** 받은 그림의 머리말로 볼 앞부분 (JPEG 의 크기 표시는 EXIF 뒤에 있다, GeminiRoute 와 같다) */
const HEAD_BYTES = 256 * 1024;
/** Gemini 그림을 풀 때 긴 변 상한 (4096 그림을 그대로 다루면 느리다. 띠는 어차피 1024 로 줄인다) */
const GEMINI_SIDE = 2048;

type States = Partial<Record<SpriteRowId, RowState>>;
type Phase = 'ready' | 'running' | 'saving' | 'done';
/** 동작 그림을 어디서 받았는지 (된 동작 옆에 작게 보인다) */
type From = IllustEngine | 'gemini';

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

const FIT_ERROR: Record<FitWhy, I18nKey> = {
  key: 'sprites.gemini.err.key',
  shape: 'sprites.gemini.err.shape',
  empty: 'sprites.gemini.err.empty',
};

export function SpriteMakerApp() {
  const language = useLanguageUpdates();
  const [src, setSrc] = useState<SpriteSource | undefined>();
  const [states, setStates] = useState<States>({});
  const [strips, setStrips] = useState<Partial<Record<SpriteRowId, string>>>({});
  const [from, setFrom] = useState<Partial<Record<SpriteRowId, From>>>({});
  const [phase, setPhase] = useState<Phase>('ready');
  const [current, setCurrent] = useState<SpriteRowId | undefined>();
  const [error, setError] = useState('');
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [preview, setPreview] = useState<{ name: SpriteName; url: string }[]>([]);
  const [engine, setEngine] = useState<IllustEngine>('cloud');
  /** 무료 서버 횟수가 끝났다 (남은 동작을 내 컴퓨터, Gemini 로 이어 가자고 권한다) */
  const [cloudStuck, setCloudStuck] = useState(false);
  /** Gemini 로 받아 올 동작 (펼친 칸) */
  const [gem, setGem] = useState<SpriteRowId | undefined>();
  const [gemStatus, setGemStatus] = useState('');
  const [gemError, setGemError] = useState('');
  const [gemBusy, setGemBusy] = useState(false);
  const [gemOver, setGemOver] = useState(false);
  const [refUrl, setRefUrl] = useState('');
  const ref = useRef<{ own: Rgba; key: Rgb; ref: string } | undefined>(undefined);
  const stopped = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.documentElement.lang !== language) return;
    document.title = t('sprites.title');
  }, [language]);

  useEffect(() => {
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

  /** 기준 그림은 한 번만 만든다 (서버, 내 컴퓨터, Gemini 가 같은 그림과 배경색을 쓴다) */
  async function base(): Promise<{ own: Rgba; key: Rgb; ref: string } | undefined> {
    if (!src?.image) return undefined;
    try {
      ref.current ??= await referenceOf(src.image);
      setRefUrl(ref.current.ref);
      return ref.current;
    } catch {
      return undefined;
    }
  }

  async function run(ids: SpriteRowId[], eng: IllustEngine = engine) {
    if (!src?.image || ids.length === 0) return;
    setError('');
    setPhase('running');
    stopped.current = false;
    if (eng === 'cloud') setCloudStuck(false);
    const b = await base();
    if (!b) {
      setError(t('sprites.err.read'));
      setPhase('ready');
      return;
    }
    for (const id of ids) {
      if (stopped.current) break;
      const row = rowOf(id);
      if (!row) continue;
      setCurrent(id);
      setStarted(Date.now());
      setNow(Date.now());
      setStates((v) => ({ ...v, [id]: { s: 'run' } }));
      const r = await bridge.spriteRow(id, b.ref, keyHex(b.key), eng);
      if (!r.ok) {
        // 그만두면 그 동작은 기다림으로 (실패가 아니라 다시 누르면 만든다)
        setStates((v) => ({
          ...v,
          [id]: r.kind === 'cancelled' ? { s: 'wait' } : { s: 'fail', error: r.error },
        }));
        // 내 컴퓨터 준비가 깨졌으면(지워짐 등) 그리는 곳을 서버로 돌리고 준비 안내를 보인다
        const fresh = r.localDraw;
        if (fresh) setSrc((v) => v && { ...v, localDraw: fresh });
        if (eng === 'local' && (r.kind === 'notReady' || fresh?.ready === false)) setEngine('cloud');
        if (stopsQueue(r.kind, eng)) {
          if (eng === 'cloud' && isQuotaKind(r.kind)) setCloudStuck(true);
          if (r.kind !== 'cancelled')
            setError(eng === 'local' && r.kind === 'notReady' ? t('sprites.engine.broken') : r.error);
          // 시도하지 않은 동작은 기다림 그대로
          break;
        }
        continue;
      }
      try {
        const strip = await pixelsOf(r.image, { w: STRIP_W, h: STRIP_H });
        const got = processStrip(strip, row, b.key);
        setStrips((v) => ({ ...v, [id]: pngOf({ ...strip }) }));
        setStates((v) => ({
          ...v,
          [id]: got.issues.length === 0 ? { s: 'ok', frames: got.frames } : { s: 'bad', issues: got.issues },
        }));
        setFrom((v) => ({ ...v, [id]: eng }));
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

  // ----- 동작 하나만 Gemini 로 -----

  async function openGemPanel(id: SpriteRowId) {
    setGem(id);
    setGemStatus('');
    setGemError('');
    if (!(await base())) setGemError(t('sprites.err.read'));
  }

  async function openGemini() {
    const b = await base();
    if (!gem || !b) return;
    setGemError('');
    try {
      const r = await bridge.spriteGemini(gem, keyHex(b.key));
      setGemStatus(
        r.copied
          ? t(r.opened ? 'maker.gemini.opened' : 'maker.gemini.openFailed')
          : t('maker.gemini.copyFailed'),
      );
    } catch {
      setGemStatus(t('maker.gemini.copyFailed'));
    }
  }

  async function revealRef() {
    const b = await base();
    if (!b) return;
    setGemError('');
    const ok = await bridge.revealSpriteRef(b.ref).catch(() => false);
    if (!ok) setGemError(t('sprites.gemini.revealFailed'));
  }

  /**
   * 받은 그림 하나로 그 동작만 바꾼다: 머리말 검사(형식, 크기) → 풀기 → fitStrip(비율, 배경색, Gemini 표시) →
   * processStrip(서버 띠와 같은 자르기와 검사). 검사에 걸리면 이미 된 동작은 그대로 둔다
   */
  async function bring(id: SpriteRowId, file: Blob) {
    const row = rowOf(id);
    if (!row || gemBusy) return;
    setGemError('');
    setGemStatus('');
    setGemBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
      const check = checkGeminiImage(head, file.size);
      if (!check.ok) {
        setGemError(t(check.why === 'kind' ? 'maker.gemini.err.kind' : 'maker.gemini.err.big'));
        return;
      }
      const b = await base();
      if (!b) throw new Error('no reference');
      const probe = new Image();
      probe.src = url;
      await probe.decode();
      const w0 = probe.naturalWidth;
      const h0 = probe.naturalHeight;
      const k = Math.min(1, GEMINI_SIDE / Math.max(w0, h0));
      const img = await pixelsOf(url, {
        w: Math.max(1, Math.round(w0 * k)),
        h: Math.max(1, Math.round(h0 * k)),
      });
      const fit = fitStrip(img, b.key);
      if (!fit.ok) {
        setGemError(t(FIT_ERROR[fit.why], { color: keyHex(b.key) }));
        return;
      }
      const got = processStrip(fit.img, row, b.key);
      const fitted = w0 !== STRIP_W || h0 !== STRIP_H ? t('sprites.gemini.fitted', { w: w0, h: h0 }) : '';
      const wasOk = states[id]?.s === 'ok';
      if (got.issues.length > 0) {
        // 된 동작을 못 쓰는 그림으로 바꾸지 않는다. 아직 안 된 동작이면 걸린 까닭을 그 동작에 보인다
        if (!wasOk) {
          setStates((v) => ({ ...v, [id]: { s: 'bad', issues: got.issues } }));
          setStrips((v) => ({ ...v, [id]: pngOf(fit.img) }));
          setFrom((v) => ({ ...v, [id]: 'gemini' }));
        }
        setGemError(
          `${t(wasOk ? 'sprites.gemini.bad' : 'sprites.gemini.badNew')} (${got.issues.map((i) => t(ISSUE_LABEL[i])).join(', ')})${fitted ? ` ${fitted}` : ''}`,
        );
        return;
      }
      setStates((v) => ({ ...v, [id]: { s: 'ok', frames: got.frames } }));
      setStrips((v) => ({ ...v, [id]: pngOf(fit.img) }));
      setFrom((v) => ({ ...v, [id]: 'gemini' }));
      setGemStatus(`${t('sprites.gemini.done', { row: t(ROW_LABEL[id]) })}${fitted ? ` ${fitted}` : ''}`);
    } catch (err) {
      console.warn('sprite gemini', err);
      setGemError(t('sprites.err.read'));
    } finally {
      URL.revokeObjectURL(url);
      setGemBusy(false);
    }
  }

  // Gemini 칸을 펼친 동안은 창 어디에 끌어 놓아도 그 동작의 그림으로 받는다. 안 펼쳤으면 끌어 놓기는 아무 일도 하지 않는다
  const bringRef = useRef(bring);
  bringRef.current = bring;
  useEffect(() => {
    const over = (e: globalThis.DragEvent) => e.preventDefault();
    const drop = (e: globalThis.DragEvent) => {
      e.preventDefault();
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f && gem && phase !== 'running') void bringRef.current(gem, f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [gem, phase]);

  const dropOnZone = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGemOver(false);
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')) ?? e.dataTransfer.files[0];
    if (f && gem) void bring(gem, f);
  };

  const okRows = SPRITE_ROWS.filter((r) => states[r.id]?.s === 'ok');
  const todo = rowsToMake(states);
  const tried = SPRITE_ROWS.some((r) => states[r.id]);
  const walk = preview.filter((p) => p.name.startsWith('walk-'));
  const running = phase === 'running';
  const doneCount = okRows.length;
  const local = src?.localDraw;
  const localReady = !!local?.supported && !!local.ready;
  const eng: IllustEngine = localReady && engine === 'local' ? 'local' : 'cloud';
  const platform = bridge.platform === 'darwin' ? 'mac' : bridge.platform === 'win32' ? 'win' : 'other';

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
                <p className="privacy">
                  {t(eng === 'local' ? 'sprites.engine.localPrivacy' : 'sprites.privacy')}
                </p>
                {src.hasSprites && <p className="hint">{t('sprites.replace')}</p>}
              </div>
            </div>

            {/* 그리는 곳: 내 컴퓨터 준비가 끝났을 때만 고른다. 되는 컴퓨터인데 준비 전이면 준비하는 곳만 알려 준다 */}
            {localReady && (
              <div className="sprite-engine">
                <span className="wish-label" id="sprite-engine-label">
                  {t('sprites.engine.label')}
                </span>
                <fieldset
                  className="segmented engine"
                  aria-labelledby="sprite-engine-label"
                  disabled={running}
                >
                  {(['cloud', 'local'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={eng === k}
                      className={eng === k ? 'on' : ''}
                      onClick={() => setEngine(k)}
                    >
                      {t(`maker.engine.${k}`)}
                    </button>
                  ))}
                </fieldset>
                {eng === 'local' && local?.minutes && (
                  <small className="hint">{t('sprites.engine.localTime', local.minutes)}</small>
                )}
              </div>
            )}
            {local?.supported && !local.ready && !cloudStuck && (
              <small className="hint sprite-engine-setup">{t('sprites.engine.needSetup')}</small>
            )}

            <ol className="sprite-rows">
              {SPRITE_ROWS.map((r) => {
                const st = states[r.id];
                const f = from[r.id];
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
                      {(st?.s === 'ok' || st?.s === 'bad') && f && f !== 'cloud' && (
                        <span className="sprite-row-from"> ({t(`sprites.from.${f}`)})</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`ghost sprite-row-gemini${gem === r.id ? ' on' : ''}`}
                      disabled={running || phase === 'saving' || phase === 'done'}
                      aria-label={t('sprites.gemini.buttonLabel', { row: t(ROW_LABEL[r.id]) })}
                      aria-expanded={gem === r.id}
                      onClick={() => (gem === r.id ? setGem(undefined) : void openGemPanel(r.id))}
                    >
                      {t('sprites.gemini.button')}
                    </button>
                    {/* 멈추지 않는 실패(바쁨, 시간 초과)는 위 안내 대신 그 동작 아래에 까닭을 */}
                    {st?.s === 'fail' && st.error !== error && (
                      <small className="sprite-row-why">{st.error}</small>
                    )}
                    {strips[r.id] && <img className="sprite-strip" src={strips[r.id]} alt="" />}
                  </li>
                );
              })}
            </ol>

            {gem && !running && phase !== 'done' && (
              <div className="gemini sprite-gemini" data-row={gem}>
                <strong className="sprite-gemini-title">
                  {t('sprites.gemini.title', { row: t(ROW_LABEL[gem]) })}
                </strong>
                <ol className="gemini-steps">
                  <li>{t('sprites.gemini.step1')}</li>
                  <li>{t('sprites.gemini.step2')}</li>
                  <li>{t('sprites.gemini.step3')}</li>
                </ol>
                {refUrl && (
                  <img className="sprite-gemini-ref" src={refUrl} alt={t('sprites.gemini.reveal.other')} />
                )}
                <div className="gemini-actions">
                  <button type="button" className="primary" onClick={openGemini}>
                    {t('sprites.gemini.open')}
                  </button>
                  <button type="button" className="ghost" onClick={revealRef}>
                    {t(`sprites.gemini.reveal.${platform}`)}
                  </button>
                </div>
                {gemStatus && (
                  <small className="hint" role="status">
                    {gemStatus}
                  </small>
                )}
                <button
                  type="button"
                  className={`gemini-drop${gemOver ? ' over' : ''}`}
                  disabled={gemBusy}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setGemOver(true);
                  }}
                  onDragLeave={() => setGemOver(false)}
                  onDrop={dropOnZone}
                >
                  <span className="big">
                    {gemBusy ? t('sprites.gemini.working') : t('sprites.gemini.drop')}
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && gem) void bring(gem, f);
                    e.target.value = '';
                  }}
                />
                {gemError && (
                  <p className="error" role="alert">
                    {gemError}
                  </p>
                )}
                <p className="privacy">{t('sprites.gemini.privacy')}</p>
                <div className="gemini-actions">
                  <button type="button" className="ghost" onClick={() => setGem(undefined)}>
                    {t('sprites.gemini.close')}
                  </button>
                </div>
              </div>
            )}

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

            {/* 무료 횟수가 끝났다: 남은 동작을 내 컴퓨터에서 이어 그리거나(준비됐을 때) 하나씩 Gemini 로 */}
            {cloudStuck && !running && todo.length > 0 && phase !== 'done' && (
              <div className="sprite-stuck" role="note">
                {localReady && (
                  <>
                    <p>{t('sprites.stuck.local')}</p>
                    {local?.minutes && (
                      <small className="hint">{t('sprites.engine.localTime', local.minutes)}</small>
                    )}
                    <div className="actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          setEngine('local');
                          void run(todo, 'local');
                        }}
                      >
                        {t('sprites.stuck.localGo')}
                      </button>
                    </div>
                  </>
                )}
                {local?.supported && !local.ready && <p className="hint">{t('sprites.engine.needSetup')}</p>}
                <p className="hint">{t('sprites.stuck.gemini')}</p>
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
                    <button
                      type="button"
                      className={tried ? 'ghost' : 'primary'}
                      onClick={() => run(todo, eng)}
                    >
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
