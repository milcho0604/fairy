import { useEffect, useRef, useState } from 'react';
import { type I18nKey, t } from '../../shared/i18n/index.ts';
import {
  downloadLeftSec,
  guessLeftSec,
  guessPhase,
  guessRatio,
  leftUnit,
  type Phase,
  ratioPhase,
} from './make-progress.ts';
import './make-progress.css';

/** 무엇을 기다리는지: 대사를 고른다 */
export type ProgressTask = 'download' | 'cutout' | 'figure' | 'relief' | 'remake' | 'illust';

export interface ProgressStage {
  label: string;
  state: 'done' | 'now' | 'next';
}

/** 화면 주사율로 다시 그리지 않는다. 이 간격으로만 값을 바꾸고 그 사이는 CSS 전환(transform)이 잇는다 */
const TICK_MS = 500;

/** 기다리는 동안 펫이 하는 말: 일마다, 구간마다 하나 */
const SAY: Record<ProgressTask, Record<Phase, I18nKey>> = {
  download: {
    start: 'maker.say.download.start',
    middle: 'maker.say.download.middle',
    almost: 'maker.say.download.almost',
    long: 'maker.say.download.long',
  },
  cutout: {
    start: 'maker.say.cutout.start',
    middle: 'maker.say.cutout.middle',
    almost: 'maker.say.cutout.almost',
    long: 'maker.say.cutout.long',
  },
  figure: {
    start: 'maker.say.figure.start',
    middle: 'maker.say.figure.middle',
    almost: 'maker.say.figure.almost',
    long: 'maker.say.figure.long',
  },
  relief: {
    start: 'maker.say.relief.start',
    middle: 'maker.say.relief.middle',
    almost: 'maker.say.relief.almost',
    long: 'maker.say.relief.long',
  },
  illust: {
    start: 'maker.say.illust.start',
    middle: 'maker.say.illust.middle',
    almost: 'maker.say.illust.almost',
    long: 'maker.say.illust.long',
  },
  remake: {
    start: 'maker.say.remake.start',
    middle: 'maker.say.remake.middle',
    almost: 'maker.say.remake.almost',
    long: 'maker.say.remake.long',
  },
};

const leftText = (sec: number) => {
  const { unit, n } = leftUnit(sec);
  if (unit === 'soon') return t('maker.progress.soon');
  return unit === 'min' ? t('maker.progress.leftMin', { n }) : t('maker.progress.leftSec', { n });
};

/**
 * 펫 만들기 진행 표시 (펫 만들기 창, 설정의 몸 다시 만들기). 펫 그림이 아래에서부터 물들어 차오르고,
 * 막대와 남은 시간, 펫의 한마디가 보인다. 진짜 진행률(ratio)이 있으면 그 값을, 없으면 예상 시간으로 어림한다.
 * 어림은 97% 를 넘지 않고, 100% 는 done 일 때만
 */
export function MakeProgress({
  task,
  title,
  startedAt,
  ratio,
  expectedMs = 30_000,
  totalMb,
  image,
  silhouette = false,
  stages,
  done = false,
  onStop,
  compact = false,
}: {
  task: ProgressTask;
  /** 지금 하는 일 (읽어 주는 글) */
  title: string;
  /** 시작한 때 (performance.now) */
  startedAt: number;
  /** 진짜 진행률 0~1 (모델 받기). 없으면 예상 시간으로 */
  ratio?: number;
  expectedMs?: number;
  /** 받기: 받은 양을 MB 로 보인다 */
  totalMb?: number;
  /** 차오르는 그림 (data URL). 없으면 그림 없이 막대만 */
  image?: string;
  /** 배경을 지운 그림이면 그 모양대로(실루엣), 아니면 사진 네모가 흑백에서 물든다 */
  silhouette?: boolean;
  /** 단계 점 (사진 고르기 뒤 받기, 지우기, 다듬기) */
  stages?: ProgressStage[];
  /** 끝났다: 100% 를 잠깐 보여 준다 */
  done?: boolean;
  /** 그만두기 (없으면 단추를 안 보인다) */
  onStop?: () => void;
  /** 설정 창 한 줄 모양 (작은 그림, 대사는 글로) */
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => performance.now());
  const stopRef = useRef<HTMLButtonElement>(null);
  // 누른 단추(입체 만들기 등)가 진행 표시로 바뀌며 사라지면 키보드 자리가 문서 맨 앞으로 간다. 그때만 그만두기로
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body) stopRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (done) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [done]);

  const elapsed = Math.max(0, now - startedAt);
  const real = ratio !== undefined;
  const r = done ? 1 : real ? Math.min(1, Math.max(0, ratio)) : guessRatio(elapsed, expectedMs);
  const phase: Phase = real ? ratioPhase(r) : guessPhase(elapsed, expectedMs);
  const left = done ? undefined : real ? downloadLeftSec(r, elapsed) : guessLeftSec(elapsed, expectedMs);
  // 다 받고 해시를 맞춰 보는 중 (178MB 면 1초 안팎)
  const checking = real && !done && r >= 0.99;
  const note = done
    ? t('maker.progress.done')
    : checking
      ? t('maker.progress.checking')
      : left !== undefined
        ? leftText(left)
        : real
          ? ''
          : phase === 'long'
            ? t('maker.progress.long')
            : t('maker.progress.almost');
  // 읽어 주는 글은 구간이 바뀔 때만 바뀐다 (남은 초를 계속 읽으면 시끄럽다)
  const live = done
    ? t('maker.progress.done')
    : checking
      ? `${title} ${t('maker.progress.checking')}`
      : !real && (phase === 'almost' || phase === 'long')
        ? `${title} ${phase === 'long' ? t('maker.progress.long') : t('maker.progress.almost')}`
        : title;
  const say = done ? t('maker.say.done') : t(SAY[task][phase]);
  const pct = Math.round(r * 100);
  const sec = Math.floor(elapsed / 1000);
  const hidden = 1 - r;

  return (
    <div className={`mp${compact ? ' compact' : ''}${done ? ' is-done' : ''}`}>
      {image && (
        <div className="mp-stage" aria-hidden="true">
          {!compact && (
            <span className="mp-say" key={say}>
              {say}
            </span>
          )}
          <div className={`mp-figure${silhouette ? ' cut' : ' photo'}`}>
            {silhouette ? (
              <div
                className="mp-ghost"
                style={{ maskImage: `url("${image}")`, WebkitMaskImage: `url("${image}")` }}
              />
            ) : (
              <img className="mp-ghost" src={image} alt="" />
            )}
            <div className="mp-fill" style={{ transform: `translateY(${hidden * 100}%)` }}>
              <img src={image} alt="" style={{ transform: `translateY(${-hidden * 100}%)` }} />
            </div>
          </div>
        </div>
      )}
      <div className="mp-body">
        <p className="mp-title" role="status" aria-live="polite">
          <span className="mp-sr">{live}</span>
          <span aria-hidden="true">{title}</span>
        </p>
        {compact && <p className="mp-say-line">{say}</p>}
        <div
          className="mp-bar"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={real ? `${pct}%${note ? `, ${note}` : ''}` : note}
        >
          <i style={{ transform: `scaleX(${r})` }} />
        </div>
        <div className="mp-meta" aria-hidden="true">
          {real && <span className="mp-num">{pct}%</span>}
          {real && totalMb !== undefined && (
            <span className="mp-num">
              {t('maker.progress.mb', { got: Math.round(r * totalMb), total: totalMb })}
            </span>
          )}
          <span className="mp-note">{note}</span>
          {/* 처음 몇 초는 숫자가 0, 1 로 바쁘게 바뀌어서 3초부터 */}
          {!done && sec >= 3 && (
            <span className="mp-num mp-sec">{t('maker.progress.elapsed', { n: sec })}</span>
          )}
        </div>
        {stages && stages.length > 1 && (
          <ol className="mp-stages" aria-label={t('maker.progress.stages')}>
            {stages.map((s) => (
              <li
                key={s.label}
                className={`is-${s.state}`}
                aria-current={s.state === 'now' ? 'step' : undefined}
              >
                <i aria-hidden="true" />
                {s.label}
                {s.state === 'done' && <span className="mp-sr">, {t('maker.progress.stageDone')}</span>}
              </li>
            ))}
          </ol>
        )}
        {onStop && !done && (
          <div className="mp-actions">
            <button ref={stopRef} type="button" className="ghost mp-stop" onClick={onStop}>
              {t('maker.progress.stop')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
