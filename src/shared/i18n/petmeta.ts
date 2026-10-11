import type { Translation } from './types.ts';

// 펫 파일(.jjpet 판 2)에서 데려온 펫의 만든 사람, 사용 허락 (설정 → 펫 → 모습 카드)
export const ko = {
  'settings.pets.by': (v: { author: string; license: string }) => `만든 사람: ${v.author}, ${v.license}`,
  'settings.pets.license': (v: { license: string }) => `사용 허락: ${v.license}`,
  'settings.pets.made': (v: { date: string }) => `만든 날 ${v.date}`,
};

export const en: Translation<typeof ko> = {
  'settings.pets.by': (v: { author: string; license: string }) => `By ${v.author}, ${v.license}`,
  'settings.pets.license': (v: { license: string }) => `License: ${v.license}`,
  'settings.pets.made': (v: { date: string }) => `Made ${v.date}`,
};
