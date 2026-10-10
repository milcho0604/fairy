import { useEffect, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PetLookView, SettingsSnapshot } from '../../../shared/ipc.ts';
import { DEFAULT_BLUEPRINTS } from '../../../shared/pet3d/defaults.ts';
import { PET_KINDS, type PetKind } from '../../../shared/settings.ts';
import { isCurrentStarter, type PetChoice, starterOf } from '../../../shared/starter-pets.ts';
import { CANVAS_SIZE, drawPet } from '../draw.ts';
import { Pet3D } from '../pet3d.ts';

/**
 * 펫 고르기 (6단계): 기본 펫 다섯 마리(입체로 보기면 실제 3D 그림), 그림으로 들어 있는 밀크와 초코, 보관한 사진 펫.
 * 고르면 지금 사진 펫은 보관함으로 간다. 보관한 펫은 두 번 눌러 지운다
 */
export function PetPicker({
  snap,
  onPick,
  onRemove,
}: {
  snap: SettingsSnapshot;
  onPick: (choice: PetChoice) => void;
  onRemove: (id: string) => void;
}) {
  const s = snap.settings;
  const [thumbs, setThumbs] = useState<Partial<Record<PetKind, string>>>({});
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    setThumbs(kindThumbs(s.pet3d));
  }, [s.pet3d]);
  // 만든 펫도 펫 화면과 같은 모습으로: 입체로 보기면 figure 는 3D, relief 는 2.5D, 아니면 사진
  const [, setDrawn] = useState(0);
  useEffect(() => {
    if (!s.pet3d) return;
    let alive = true;
    void drawLooks([...(snap.current ? [snap.current] : []), ...snap.library], () => alive).then(
      (n) => alive && n > 0 && setDrawn((v) => v + 1),
    );
    return () => {
      alive = false;
    };
  }, [s.pet3d, snap.current, snap.library]);
  const look = (v: PetLookView) => (s.pet3d && lookThumbs.get(v.key)) || v.thumb;
  return (
    <div className="pet-grid">
      {/* 밀크, 초코 복사본이면 아래 그 캐릭터 칸이 지금 펫 카드를 맡는다 (같은 펫이 두 번 보이지 않게) */}
      {s.petImage && snap.current && !starterOf(s.petImage) && (
        <div className="pet-card on" aria-current="true">
          <img src={look(snap.current)} alt="" />
          <span className="pet-name">{s.petName}</span>
          <small>
            {t('settings.pets.now')}
            {snap.current.age && (
              <span className="pet-age">{t(`settings.pets.age.${snap.current.age}`)}</span>
            )}
          </small>
        </div>
      )}
      {PET_KINDS.map((k) => {
        const on = !s.petImage && s.petKind === k.id;
        return (
          <button
            key={k.id}
            type="button"
            className={`pet-card${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => !on && onPick({ kind: k.id })}
          >
            {thumbs[k.id] ? <img src={thumbs[k.id]} alt="" /> : <i />}
            <span className="pet-name">{k.label}</span>
          </button>
        );
      })}
      {/* 밀크, 초코: 고르면 사진 펫이 된다 (지금 펫 카드에도 보인다) */}
      {snap.starters.map((p) => {
        const on = isCurrentStarter(s.petImage, p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={`pet-card starter${on ? ' on' : ''}`}
            aria-pressed={on}
            {...(on ? { 'aria-current': true } : {})}
            aria-label={t('settings.pets.starter', { name: on ? s.petName : p.name, desc: p.desc })}
            title={p.desc}
            onClick={() => !on && onPick({ starter: p.id })}
          >
            <img src={on && snap.current ? look(snap.current) : p.thumb} alt="" />
            <span className="pet-name">{on ? s.petName : p.name}</span>
            {on && <small>{t('settings.pets.now')}</small>}
          </button>
        );
      })}
      {snap.library.map((p) => (
        <div key={p.id} className="pet-card saved">
          <button type="button" className="pick" onClick={() => onPick({ id: p.id })}>
            {p.thumb ? <img src={look(p)} alt="" /> : <i />}
            <span className="pet-name">{p.name}</span>
            {(p.look !== 'photo' || p.age) && (
              <small>
                {p.look !== 'photo' &&
                  (p.look === 'figure' ? t('settings.pets.figure') : t('settings.pets.relief'))}
                {/* AI 일러스트 나이 단계 (아기, 청소년, 어른) */}
                {p.age && <span className="pet-age">{t(`settings.pets.age.${p.age}`)}</span>}
              </small>
            )}
          </button>
          <button
            type="button"
            className={`remove${confirm === p.id ? ' sure' : ''}`}
            aria-label={t('settings.pets.remove', { name: p.name })}
            title={t('settings.pets.remove', { name: p.name })}
            onClick={() => {
              if (confirm === p.id) onRemove(p.id);
              else setConfirm(p.id);
            }}
            onBlur={() => setConfirm('')}
          >
            {confirm === p.id ? t('settings.pets.removeSure') : '×'}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 기본 펫 미리보기 그림. 입체로 보기면 3D 를 한 번씩 그려 사진으로 만든다 (렌더러는 하나만) */
let thumbPet: Pet3D | undefined;
const THUMB_SIDE = 96;
function thumbCanvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = THUMB_SIDE * dpr;
  c.height = THUMB_SIDE * dpr;
  const ctx = c.getContext('2d');
  return ctx ? { c, ctx } : undefined;
}
/** 펫 하나를 쉬는 모습으로 그려 PNG data URL 로 */
function shot(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: PetKind, model3d?: Pet3D): string {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const scale = c.width / CANVAS_SIZE;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPet(ctx, { mood: 'idle', elapsed: 0, blink: -1, kind, viewSize: THUMB_SIDE, model3d });
  return c.toDataURL('image/png');
}
function kindThumbs(use3d: boolean): Partial<Record<PetKind, string>> {
  const tc = thumbCanvas();
  if (!tc) return {};
  if (use3d) thumbPet ??= Pet3D.create(() => {});
  const out: Partial<Record<PetKind, string>> = {};
  for (const k of PET_KINDS) {
    if (use3d && thumbPet) thumbPet.setBlueprint(DEFAULT_BLUEPRINTS[k.id]);
    out[k.id] = shot(tc.c, tc.ctx, k.id, use3d ? thumbPet : undefined);
  }
  thumbPet?.clear();
  return out;
}

/**
 * 만든 펫 입체 썸네일 (key 마다 한 번, 창이 열려 있는 동안 기억). 그리지 못하면 빈 글이라 사진이 보인다.
 * 보관함이 12마리여도 창이 멈추지 않게 한 마리 그릴 때마다 한 번 쉰다. 렌더러는 기본 펫과 같은 thumbPet 하나
 */
const lookThumbs = new Map<string, string>();
async function drawLooks(views: PetLookView[], alive: () => boolean): Promise<number> {
  const todo = views.filter((v) => v.look !== 'photo' && !lookThumbs.has(v.key));
  if (!todo.length) return 0;
  const tc = thumbCanvas();
  thumbPet ??= Pet3D.create(() => {});
  let n = 0;
  for (const v of todo) {
    await new Promise((r) => setTimeout(r, 0));
    if (!alive()) break;
    if (lookThumbs.has(v.key)) continue;
    let url = '';
    try {
      if (tc && thumbPet?.ok) {
        if (v.look === 'figure' && v.model) thumbPet.setBlueprint(v.model);
        else if (v.look === 'relief' && v.depth && v.thumb) {
          const [photo, depth] = await Promise.all([loadImage(v.thumb), loadImage(v.depth)]);
          if (!alive()) break;
          thumbPet.setRelief(photo, depth);
        } else throw new Error('no look');
        // drawPet 을 거치지 않는다: 입체를 못 그리면 drawPet 은 기본 펫(콩이)을 그려 다른 펫처럼 보인다
        const { c, ctx } = tc;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        const scale = c.width / CANVAS_SIZE;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const top = thumbPet.draw(
          ctx,
          { mood: 'idle', elapsed: 0, blink: -1, viewSize: THUMB_SIDE },
          0,
          1,
          1,
          undefined,
        );
        url = top === undefined ? '' : c.toDataURL('image/png');
      }
    } catch {
      url = '';
    }
    lookThumbs.set(v.key, url);
    n++;
  }
  thumbPet?.clear();
  return n;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
