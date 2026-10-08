// 영역별 사전을 하나로 합친다. 영역을 더하면 ko 와 en 에 같이 넣는다.

import * as achieve from './achieve.ts';
import * as ai from './ai.ts';
import * as briefing from './briefing.ts';
import * as chat from './chat.ts';
import * as common from './common.ts';
import * as diary from './diary.ts';
import * as idle from './idle.ts';
import * as main from './main.ts';
import * as maker from './maker.ts';
import * as onboarding from './onboarding.ts';
import * as panel from './panel.ts';
import * as pet from './pet.ts';
import * as play from './play.ts';
import * as settings from './settings.ts';
import * as shop from './shop.ts';
import * as tray from './tray.ts';
import type { Translation } from './types.ts';

export const ko = {
  ...common.ko,
  ...pet.ko,
  ...tray.ko,
  ...main.ko,
  ...panel.ko,
  ...shop.ko,
  ...achieve.ko,
  ...briefing.ko,
  ...chat.ko,
  ...ai.ko,
  ...settings.ko,
  ...maker.ko,
  ...onboarding.ko,
  ...idle.ko,
  ...diary.ko,
  ...play.ko,
};

export const en: Translation<typeof ko> = {
  ...common.en,
  ...pet.en,
  ...tray.en,
  ...main.en,
  ...panel.en,
  ...shop.en,
  ...achieve.en,
  ...briefing.en,
  ...chat.en,
  ...ai.en,
  ...settings.en,
  ...maker.en,
  ...onboarding.en,
  ...idle.en,
  ...diary.en,
  ...play.en,
};
