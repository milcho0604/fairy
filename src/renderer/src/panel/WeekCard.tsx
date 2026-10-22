import { useEffect, useRef, useState } from 'react';
import { locale, t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import {
  CARD_H,
  CARD_W,
  cardDiary,
  cardRange,
  cardTitles,
  clip,
  hoursMinutes,
} from '../../../shared/week-card.ts';
import { useFaceUrl } from '../PetFace.tsx';
import { Overlay } from './surface.tsx';

// 주간 회고 카드 (shared/week-card.ts): 이번 주 숫자와 펫 얼굴을 귀여운 카드 한 장으로 그려 PNG 로 저장한다.
// 할 일 제목은 "할 일 제목 넣기"를 골랐을 때만 메인에 묻고 넣는다. 카드는 늘 밝은 색 (어디에 올려도 같게)

const bridge = window.jjakkungBond;
const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const INK = '#3b2f2a';
const MUTED = '#8a7a70';
const ACCENT = '#c9783f';

/** 이번 주 칸 안 "카드로 만들기" 단추 */
export function WeekCardButton({ s }: { s: PanelState }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ghost week-card-open"
        onClick={() => {
          setOpen(true);
          bridge.journeyTried('week');
        }}
      >
        {t('bond.week.make')}
      </button>
      {open && <WeekCardDialog s={s} onClose={() => setOpen(false)} />}
    </>
  );
}

export interface CardData {
  name: string;
  today: string;
  done: number;
  focusMin: number;
  streak: number;
  days: { done: number; future: boolean }[];
  diary: string;
  titles: string[];
}

/** 패널 상태에서 카드 값 (제목은 따로) */
export function cardData(s: PanelState, titles: string[]): CardData {
  const { from } = cardRange(s.today);
  const diary = s.diary.find((d) => d.day >= from && d.text.trim())?.text;
  return {
    name: s.petName,
    today: s.today,
    done: s.week?.done ?? 0,
    focusMin: s.week?.focusMin ?? 0,
    streak: s.achieve.streak,
    days: (s.week?.days ?? []).map((d) => ({ done: d.done, future: d.future })),
    diary: cardDiary(diary),
    titles,
  };
}

export function WeekCardDialog({ s, onClose }: { s: PanelState; onClose: () => void }) {
  const [withTitles, setWithTitles] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; ok: boolean }>();
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const face = useFaceUrl();
  const [faceImg, setFaceImg] = useState<HTMLImageElement>();
  useEffect(() => {
    if (!face) return;
    const img = new Image();
    img.onload = () => setFaceImg(img);
    img.src = face;
  }, [face]);
  useEffect(() => {
    if (!withTitles) return;
    void bridge.weekTitles().then(setTitles, () => setTitles([]));
  }, [withTitles]);
  const data = cardData(s, cardTitles(titles, withTitles));
  // biome-ignore lint/correctness/useExhaustiveDependencies: 값이 바뀔 때마다 다시 그린다 (data 는 그릴 때마다 새로 만든다)
  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (c) drawCard(c, data, faceImg);
  }, [JSON.stringify(data), faceImg]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const save = async () => {
    const url = canvas.current?.toDataURL('image/png');
    if (!url) return;
    setBusy(true);
    const r = await bridge.weekSave(url);
    setBusy(false);
    if (r.message) setStatus({ text: r.message, ok: r.ok });
  };

  return (
    <Overlay>
      <div className="week-card-dim">
        <div className="week-card-dialog" role="dialog" aria-modal="true" aria-labelledby="week-card-title">
          <h2 id="week-card-title">{t('bond.week.title')}</h2>
          <canvas
            ref={canvas}
            width={CARD_W}
            height={CARD_H}
            className="week-card-preview"
            role="img"
            aria-label={t('bond.week.alt', { name: s.petName, done: data.done })}
          />
          <label className="week-card-check">
            <input type="checkbox" checked={withTitles} onChange={(e) => setWithTitles(e.target.checked)} />
            <span>{t('bond.week.withTitles')}</span>
          </label>
          <small className="week-card-hint">
            {withTitles ? t('bond.week.titlesOn') : t('bond.week.titlesOff')}
          </small>
          {status && (
            <small className={`week-card-status ${status.ok ? 'ok' : 'error'}`} role="status">
              {status.text}
            </small>
          )}
          <div className="week-card-actions">
            <button type="button" className="ghost" onClick={onClose}>
              {t('bond.week.close')}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              {t('bond.week.save')}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ---- 그리기 ----

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 글을 폭에 맞춰 줄로 나눈다 (글자 단위, 한국어는 띄어쓰기가 적어도 나뉜다). 넘치면 마지막 줄 말줄임 */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let line = '';
  const push = (s: string) => {
    if (ctx.measureText(line + s).width <= width || !line) line += s;
    else {
      lines.push(line.trimEnd());
      line = s.trimStart();
    }
  };
  for (const w of words) {
    if (ctx.measureText(w).width > width) for (const ch of w) push(ch);
    else push(w);
  }
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? '';
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
  ctx.fill();
}

/** 카드 한 장. 바탕 그러데이션과 물방울, 펫 얼굴, 제목, 숫자 세 칸, 요일 막대, 한 줄 일기, (고르면) 끝낸 일 */
export function drawCard(ctx: CanvasRenderingContext2D, d: CardData, face?: HTMLImageElement) {
  const W = CARD_W;
  const H = CARD_H;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#fff3e3');
  bg.addColorStop(1, '#ffe2ea');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // 물방울 무늬
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (const [x, y, r] of [
    [90, 110, 46],
    [980, 180, 64],
    [960, 1220, 52],
    [120, 1260, 34],
    [1010, 640, 22],
    [60, 700, 18],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 140, 160, 0.35)';
  heart(ctx, 900, 330, 18);
  heart(ctx, 170, 420, 12);

  // 큰 흰 카드
  const pad = 56;
  ctx.shadowColor = 'rgba(160, 90, 60, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff';
  round(ctx, pad, pad + 80, W - pad * 2, H - pad * 2 - 80, 56);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 펫 얼굴: 카드 위에 걸친 동그라미
  const cx = W / 2;
  const fy = pad + 80;
  ctx.fillStyle = '#fff7ee';
  ctx.beginPath();
  ctx.arc(cx, fy, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  if (face) ctx.drawImage(face, cx - 104, fy - 112, 208, 208);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText(clip(t('bond.week.cardTitle', { name: d.name }), 18), cx, fy + 196);
  const { from, to } = cardRange(d.today);
  const fmt = (day: string) =>
    new Date(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
    ).toLocaleDateString(locale(), { month: 'long', day: 'numeric' });
  ctx.fillStyle = MUTED;
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText(t('bond.week.range', { from: fmt(from), to: fmt(to) }), cx, fy + 248);

  // 숫자 세 칸
  const hm = hoursMinutes(d.focusMin);
  const tiles: { value: string; label: string; color: string }[] = [
    { value: String(d.done), label: t('bond.week.done'), color: '#ffe7cc' },
    {
      value: hm.h > 0 ? t('bond.week.hm', { h: hm.h, m: hm.m }) : t('bond.week.m', { m: hm.m }),
      label: t('bond.week.focus'),
      color: '#e3f3e6',
    },
    { value: t('bond.week.days', { n: d.streak }), label: t('bond.week.streak'), color: '#e6ecff' },
  ];
  const top = fy + 296;
  const gap = 22;
  const tw = (W - pad * 2 - 64 - gap * 2) / 3;
  tiles.forEach((tile, i) => {
    const x = pad + 32 + i * (tw + gap);
    ctx.fillStyle = tile.color;
    round(ctx, x, top, tw, 170, 32);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `800 ${tile.value.length > 6 ? 40 : 56}px ${FONT}`;
    ctx.fillText(tile.value, x + tw / 2, top + 92);
    ctx.fillStyle = MUTED;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(tile.label, x + tw / 2, top + 140);
  });

  // 요일 막대
  const labels = t('assist.week.days').split(',');
  const by = top + 220;
  // 제목이 없으면 막대를 키워 빈 자리 없이 채운다
  const bh = d.titles.length ? 130 : 270;
  const bw = (W - pad * 2 - 160) / 7;
  const max = Math.max(1, ...d.days.map((x) => x.done));
  d.days.forEach((day, i) => {
    const x = pad + 80 + i * bw + bw * 0.22;
    const w = bw * 0.56;
    const h = day.future ? bh : Math.max(10, (day.done / max) * bh);
    if (day.future) {
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = '#e6d8cc';
      ctx.lineWidth = 3;
      round(ctx, x, by + bh - h, w, h, 14);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = day.done > 0 ? ACCENT : '#efe4da';
      round(ctx, x, by + bh - h, w, h, 14);
      ctx.fill();
    }
    ctx.fillStyle = MUTED;
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(labels[i] ?? '', x + w / 2, by + bh + 38);
  });

  // 한 줄 일기: 말풍선
  let y = by + bh + 80;
  const diary = d.diary || t('bond.week.noDiary', { name: d.name });
  ctx.font = `500 34px ${FONT}`;
  const lines = wrap(ctx, `“${diary}”`, W - pad * 2 - 150, 2);
  const boxH = 70 + lines.length * 46;
  ctx.fillStyle = '#fff6ec';
  round(ctx, pad + 40, y, W - pad * 2 - 80, boxH, 36);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pad + 120, y);
  ctx.lineTo(pad + 140, y - 22);
  ctx.lineTo(pad + 166, y);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(t('bond.week.diary', { name: d.name }), cx, y + 46);
  ctx.fillStyle = INK;
  ctx.font = `500 34px ${FONT}`;
  lines.forEach((l, i) => {
    ctx.fillText(l, cx, y + 96 + i * 46);
  });
  y += boxH + 34;

  // 끝낸 일 (고른 때만)
  if (d.titles.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(t('bond.week.titles'), pad + 64, y + 4);
    ctx.fillStyle = INK;
    ctx.font = `500 30px ${FONT}`;
    const room = Math.max(1, Math.floor((H - pad - 70 - y) / 42));
    d.titles.slice(0, room).forEach((title, i) => {
      const line = wrap(ctx, title, W - pad * 2 - 170, 1)[0] ?? '';
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(pad + 76, y + 40 + i * 42, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(line, pad + 98, y + 50 + i * 42);
    });
    ctx.textAlign = 'center';
  }

  // 바닥 서명
  ctx.fillStyle = 'rgba(138, 122, 112, 0.8)';
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(t('bond.week.footer'), cx, H - pad - 26);
  ctx.restore();
}
