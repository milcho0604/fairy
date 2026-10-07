import type { Translation } from './types.ts';

// 짝꿍 일기. 펫이 쓰는 일기체.
type N = { n: number };

export const ko = {
  'diary.title': (v: { name: string }) => `${v.name}의 일기`,
  'diary.today': '오늘 (쓰는 중)',
  'diary.empty': '아직 쓴 일기가 없어. 하루를 같이 보내면 생겨.',
  'diary.done.many': (v: N) => `오늘 할 일을 ${v.n}개나 끝냈다. 정말 대단하다.`,
  'diary.done.some': (v: N) => `오늘 할 일을 ${v.n}개 끝냈다.`,
  'diary.done.none': '오늘은 할 일 없이 느긋하게 보냈다.',
  'diary.focus': (v: N) => `${v.n}분 동안 같이 집중했다. 나는 옆에서 꾸벅꾸벅 졸았다.`,
  'diary.walk': (v: N) => `같이 ${v.n}분 산책했다. 바깥 공기가 좋았다.`,
  'diary.fed': (v: N) => `밥을 ${v.n}번 먹었다. 배가 든든하다.`,
  'diary.look': (v: N) => `같이 화면을 ${v.n}번 들여다봤다.`,
  'diary.end.1': '내일도 같이 해야지.',
  'diary.end.2': '오늘도 고마운 하루였다.',
  'diary.end.3': '푹 자고 내일 또 놀아야지.',
  'diary.end.4': '좋은 하루였다.',
  'diary.ai.prompt': (v: { text: string }) =>
    `아래는 데스크톱 펫이 쓴 짧은 일기야. 펫 말투로 한두 문장 일기로 다듬어 줘. 숫자는 그대로 두고, 없는 일을 지어내지 마. 다듬은 일기만 답해.\n\n${v.text}`,
};

export const en: Translation<typeof ko> = {
  'diary.title': (v: { name: string }) => `${v.name}'s diary`,
  'diary.today': 'Today (still writing)',
  'diary.empty': 'No diary yet. Spend a day together and one will appear.',
  'diary.done.many': (v: N) => `Finished ${v.n} to-dos today. That's amazing.`,
  'diary.done.some': (v: N) => (v.n === 1 ? 'Finished one to-do today.' : `Finished ${v.n} to-dos today.`),
  'diary.done.none': 'A slow, easy day with no to-dos.',
  'diary.focus': (v: N) => `We focused for ${v.n} minutes. I dozed off right beside you.`,
  'diary.walk': (v: N) => `Went on a ${v.n} minute walk together. The fresh air felt nice.`,
  'diary.fed': (v: N) => (v.n === 1 ? 'Had one tasty meal.' : `Had ${v.n} meals. So full.`),
  'diary.look': (v: N) =>
    v.n === 1 ? 'We looked at the screen together once.' : `We looked at the screen together ${v.n} times.`,
  'diary.end.1': "Let's do it again tomorrow.",
  'diary.end.2': 'Thankful for today.',
  'diary.end.3': 'Time for a good long sleep.',
  'diary.end.4': 'It was a good day.',
  'diary.ai.prompt': (v: { text: string }) =>
    `Below is a short diary written by a desktop pet. Rewrite it as a one or two sentence diary in the pet's voice. Keep every number, and don't make anything up. Reply with the diary only.\n\n${v.text}`,
};
