// 영역별 사전을 하나로 합친다. 영역을 더하면 ko 와 en 에 같이 넣는다.

import * as access from './access.ts';
import * as achieve from './achieve.ts';
import * as ai from './ai.ts';
import * as assist from './assist.ts';
import * as bond from './bond.ts';
import * as briefing from './briefing.ts';
import * as calendar from './calendar.ts';
import * as chat from './chat.ts';
import * as chatLook from './chat-look.ts';
import * as chips from './chips.ts';
import * as common from './common.ts';
import * as companion from './companion.ts';
import * as day from './day.ts';
import * as diary from './diary.ts';
import * as ease from './ease.ts';
import * as feedback from './feedback.ts';
import * as first from './first.ts';
import * as friends from './friends.ts';
import * as fun from './fun.ts';
import * as gallery from './gallery.ts';
import * as gcal from './gcal.ts';
import * as gemini from './gemini.ts';
import * as home from './home.ts';
import * as idle from './idle.ts';
import * as keep from './keep.ts';
import * as linesMore from './lines-more.ts';
import * as main from './main.ts';
import * as maker from './maker.ts';
import * as noteMore from './note-more.ts';
import * as notice from './notice.ts';
import * as onboarding from './onboarding.ts';
import * as ops from './ops.ts';
import * as panel from './panel.ts';
import * as pet from './pet.ts';
import * as petmeta from './petmeta.ts';
import * as pin from './pin.ts';
import * as play from './play.ts';
import * as polish from './polish.ts';
import * as pout from './pout.ts';
import * as records from './records.ts';
import * as remind from './remind.ts';
import * as routine from './routine.ts';
import * as rows from './rows.ts';
import * as server from './server.ts';
import * as settings from './settings.ts';
import * as shop from './shop.ts';
import * as speech from './speech.ts';
import * as support from './support.ts';
import * as tabs from './tabs.ts';
import * as together from './together.ts';
import * as tray from './tray.ts';
import type { Translation } from './types.ts';
import * as voice from './voice.ts';
import * as voiceIdle from './voice-idle.ts';
import * as voiceMore from './voice-more.ts';
import * as voicePlay from './voice-play.ts';

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
  ...chatLook.ko,
  ...ai.ko,
  ...settings.ko,
  ...maker.ko,
  ...onboarding.ko,
  ...idle.ko,
  ...diary.ko,
  ...play.ko,
  ...pout.ko,
  ...routine.ko,
  ...remind.ko,
  ...assist.ko,
  ...ease.ko,
  ...companion.ko,
  ...feedback.ko,
  ...support.ko,
  ...tabs.ko,
  ...gcal.ko,
  ...gemini.ko,
  ...gallery.ko,
  ...day.ko,
  ...access.ko,
  ...bond.ko,
  ...polish.ko,
  ...petmeta.ko,
  ...first.ko,
  ...fun.ko,
  ...together.ko,
  ...voice.ko,
  ...voiceIdle.ko,
  ...voicePlay.ko,
  ...speech.ko,
  ...calendar.ko,
  ...pin.ko,
  ...notice.ko,
  ...server.ko,
  ...ops.ko,
  ...records.ko,
  ...chips.ko,
  ...friends.ko,
  ...keep.ko,
  ...home.ko,
  ...rows.ko,
  ...linesMore.ko,
  ...voiceMore.ko,
  ...noteMore.ko,
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
  ...chatLook.en,
  ...ai.en,
  ...settings.en,
  ...maker.en,
  ...onboarding.en,
  ...idle.en,
  ...diary.en,
  ...play.en,
  ...pout.en,
  ...routine.en,
  ...remind.en,
  ...assist.en,
  ...ease.en,
  ...companion.en,
  ...feedback.en,
  ...support.en,
  ...tabs.en,
  ...gcal.en,
  ...gemini.en,
  ...gallery.en,
  ...day.en,
  ...access.en,
  ...bond.en,
  ...polish.en,
  ...petmeta.en,
  ...first.en,
  ...fun.en,
  ...together.en,
  ...voice.en,
  ...voiceIdle.en,
  ...voicePlay.en,
  ...speech.en,
  ...calendar.en,
  ...pin.en,
  ...notice.en,
  ...server.en,
  ...ops.en,
  ...records.en,
  ...chips.en,
  ...friends.en,
  ...keep.en,
  ...home.en,
  ...rows.en,
  ...linesMore.en,
  ...voiceMore.en,
  ...noteMore.en,
};
