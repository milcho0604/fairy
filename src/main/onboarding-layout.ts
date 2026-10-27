import type { Lang } from '../shared/i18n/index.ts';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 언어별로 시작 안내 본문이 스크롤 없이 들어가는 창 높이. 작은 작업 영역에서는 그 안에 맞춘다. */
export function onboardingHeight(workAreaHeight: number, lang: Lang): number {
  return Math.min(lang === 'en' ? 664 : 580, workAreaHeight);
}

/** 언어가 바뀌어 창 높이를 조정할 때 가운데를 유지하고 작업 영역 밖으로 나가지 않게 한다. */
export function onboardingBounds(bounds: Bounds, area: WorkArea, lang: Lang): Bounds {
  const width = Math.min(bounds.width, area.width);
  const height = onboardingHeight(area.height, lang);
  const x = Math.min(Math.max(bounds.x + (bounds.width - width) / 2, area.x), area.x + area.width - width);
  const y = Math.min(
    Math.max(bounds.y + (bounds.height - height) / 2, area.y),
    area.y + area.height - height,
  );
  return { x, y, width, height };
}
