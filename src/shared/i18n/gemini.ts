import type { Translation } from './types.ts';

// 펫 만들기 창: Gemini 앱(무료)에서 만들기 (2026-10-11)
export const ko = {
  'maker.gemini.summary': 'Gemini 앱(무료)에서 만들기',
  'maker.gemini.lead':
    '하루에 여러 장 만들 수 있는 무료 Gemini 앱에서 그림을 만들어 가져올 수 있어. 구글 계정만 있으면 돼.',
  'maker.gemini.stuckLead':
    '무료 서버는 오늘 끝났지만, Gemini 앱(무료)에서 만들어 오면 바로 이어서 할 수 있어.',
  'maker.gemini.style': '모양',
  'maker.gemini.style.figure': '피규어',
  'maker.gemini.style.illust': '일러스트',
  'maker.gemini.step1': '아래 단추를 누르면 요청문이 복사되고 Gemini가 열려.',
  'maker.gemini.step2': 'Gemini에 고른 사진을 올리고, 요청문을 붙여 넣어 보내.',
  'maker.gemini.step3': '나온 그림을 저장해서 여기에 끌어다 놓거나 붙여 넣어 줘.',
  'maker.gemini.open': '요청문 복사하고 Gemini 열기',
  'maker.gemini.opened': '요청문을 복사했어. 브라우저에 Gemini가 열렸을 거야.',
  'maker.gemini.openFailed':
    '요청문은 복사했는데 브라우저를 못 열었어. 브라우저에서 gemini.google.com을 열고 붙여 넣어 줘.',
  'maker.gemini.copyFailed': '복사하지 못했어. 아래 요청문을 직접 골라 복사해 줘.',
  'maker.gemini.reveal.mac': 'Finder에서 내 사진 보기',
  'maker.gemini.reveal.win': '탐색기에서 내 사진 보기',
  'maker.gemini.reveal.other': '내 사진 파일 보기',
  'maker.gemini.revealFailed': '사진 파일을 보여 주지 못했어. 처음 고른 사진을 Gemini에 올려 줘.',
  'maker.gemini.showPrompt': '요청문 보기',
  'maker.gemini.promptLabel': 'Gemini에 붙여 넣을 요청문',
  'maker.gemini.drop.title': 'Gemini에서 받은 그림을 여기에',
  'maker.gemini.drop.how': (v: { keys: string }) =>
    `끌어다 놓거나, 눌러서 고르거나, 붙여 넣어도 돼 (${v.keys}).`,
  'maker.gemini.corner':
    '오른쪽 아래 반짝이 표시는 바탕이 하야면 알아서 지워. 남으면 다듬기에서 지우개로 지워 줘.',
  'maker.gemini.privacy':
    '사진은 네가 직접 Gemini(구글)에 올려. 이 앱은 사진을 보내지 않아. Gemini가 사진을 다루는 방식은 구글 안내를 따라.',
  'maker.gemini.err.kind': 'PNG, JPEG, WebP 그림만 가져올 수 있어.',
  'maker.gemini.err.big': '그림이 너무 커. 가로세로 4096px, 20MB 안의 그림으로 해 줘.',
  'maker.gemini.err.read': '그림을 읽지 못했어. Gemini에서 다시 저장해서 넣어 줘.',
};

export const en: Translation<typeof ko> = {
  'maker.gemini.summary': 'Make it in the Gemini app (free)',
  'maker.gemini.lead':
    'Make the picture in the free Gemini app and bring it back here. It allows many pictures a day. All you need is a Google account.',
  'maker.gemini.stuckLead':
    'The free server is done for today, but you can make it in the Gemini app (free) and keep going right away.',
  'maker.gemini.style': 'Style',
  'maker.gemini.style.figure': 'Figure',
  'maker.gemini.style.illust': 'Illustration',
  'maker.gemini.step1': 'Press the button below to copy the prompt and open Gemini.',
  'maker.gemini.step2': 'In Gemini, add your photo, paste the prompt and send it.',
  'maker.gemini.step3': 'Save the picture it makes, then drop or paste it here.',
  'maker.gemini.open': 'Copy prompt and open Gemini',
  'maker.gemini.opened': 'Prompt copied. Gemini should be open in your browser.',
  'maker.gemini.openFailed':
    "Prompt copied, but I couldn't open your browser. Open gemini.google.com yourself and paste it there.",
  'maker.gemini.copyFailed': "Couldn't copy. Select the prompt below and copy it yourself.",
  'maker.gemini.reveal.mac': 'Show my photo in Finder',
  'maker.gemini.reveal.win': 'Show my photo in Explorer',
  'maker.gemini.reveal.other': 'Show my photo file',
  'maker.gemini.revealFailed': "Couldn't show the photo file. Add the photo you picked to Gemini.",
  'maker.gemini.showPrompt': 'Show prompt',
  'maker.gemini.promptLabel': 'Prompt to paste into Gemini',
  'maker.gemini.drop.title': 'Bring the Gemini picture here',
  'maker.gemini.drop.how': (v: { keys: string }) => `Drop it, click to pick it, or paste it (${v.keys}).`,
  'maker.gemini.corner':
    "The sparkle mark in the bottom-right corner is removed for you on a white background. If it's still there, erase it while touching up.",
  'maker.gemini.privacy':
    "You add the photo to Gemini (Google) yourself. This app doesn't send it. Google's terms cover how Gemini handles it.",
  'maker.gemini.err.kind': 'Only PNG, JPEG and WebP pictures can be brought back.',
  'maker.gemini.err.big': 'The picture is too big. Use one up to 4096px on each side and 20MB.',
  'maker.gemini.err.read': "Couldn't read the picture. Save it again from Gemini and bring it here.",
};
