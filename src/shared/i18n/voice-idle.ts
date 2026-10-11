import { withParticle } from '../josa.ts';
import * as companion from './companion.ts';
import * as idle from './idle.ts';
import type { Translation } from './types.ts';

// 존댓말 비서의 혼잣말 (2026-10-11, shared/persona-voice.ts). 혼잣말(idle.*)은 반말이라 존댓말 비서로 고르면
// 인사와 브리핑만 존댓말이고 혼잣말은 반말이었다. 같은 뜻을 존댓말로. 츤데레, 차분한 선생님은 반말이라 원래 말을 같이 쓴다.
// 영어는 반말, 존댓말 구분이 없어 원래 말 그대로 (키 모양만 맞춘다)
type N = { name: string; open?: number; eventMin?: number; workedH?: number };
/** 기억하는 혼잣말 값 (i18n/companion.ts) */
type M = {
  name: string;
  yesterday?: number;
  streak?: number;
  week?: number;
  focusMin?: number;
  days?: number;
  hour?: number;
};

export const ko = {
  'voice.polite.idle.any.1': (v: N) => `${withParticle(v.name, '은')} 여기서 조용히 응원하고 있어요.`,
  'voice.polite.idle.any.2': (v: N) => `${withParticle(v.name, '이')} 보기엔 지금 잘하고 계세요.`,
  'voice.polite.idle.any.3': () => '물 드신 지 좀 됐죠? 한 모금 드시고 오세요.',
  'voice.polite.idle.any.4': (v: N) => `심심하시면 ${withParticle(v.name, '을')} 쓰다듬어 주셔도 돼요.`,
  'voice.polite.idle.any.5': () => '어깨 힘을 빼 보세요. 그것만으로 반은 하신 거예요.',
  'voice.polite.idle.morning.1': (v: N) => `좋은 아침이에요! ${v.name}도 방금 일어났어요.`,
  'voice.polite.idle.morning.2': () => '아침엔 쉬운 일 하나부터 끝내 봐요.',
  'voice.polite.idle.monday.1': (v: N) =>
    `월요일이에요. ${withParticle(v.name, '이')} 옆에 꼭 붙어 있을게요.`,
  'voice.polite.idle.lunch.1': () => '슬슬 배고프지 않으세요? 점심 맛있게 드세요.',
  'voice.polite.idle.lunch.2': (v: N) => `식사는 하고 하세요. ${v.name}도 배고파요.`,
  'voice.polite.idle.afternoon.1': () => '오후엔 원래 졸려요. 기지개 한 번 켜 보세요.',
  'voice.polite.idle.afternoon.2': (v: N) => `${withParticle(v.name, '은')} 지금 하품을 참고 있어요.`,
  'voice.polite.idle.friday.1': () => '금요일 오후예요! 조금만 더 힘내세요.',
  'voice.polite.idle.evening.1': () => '오늘 하루 길었죠? 수고 많으셨어요.',
  'voice.polite.idle.evening.2': (v: N) => `저녁이네요. ${withParticle(v.name, '은')} 슬슬 졸려요.`,
  'voice.polite.idle.late.1': () => '벌써 이렇게 늦었어요. 오늘은 여기까지 하실래요?',
  'voice.polite.idle.late.2': (v: N) => `${withParticle(v.name, '은')} 눈이 감겨요. 얼른 주무세요.`,
  'voice.polite.idle.praise.1': (v: N) => `벌써 하나 끝내셨네요. ${withParticle(v.name, '이')} 다 봤어요.`,
  'voice.polite.idle.praise.3': (v: N) =>
    `오늘 세 개 넘게 끝내셨어요! ${withParticle(v.name, '은')} 뿌듯해요.`,
  'voice.polite.idle.praise.5': () => '오늘 정말 날아다니시네요. 대단해요!',
  'voice.polite.idle.any.6': (v: N) => `${withParticle(v.name, '은')} 오늘도 든든한 편이 되어 드릴게요.`,
  'voice.polite.idle.any.7': () => '잠깐 창밖을 보고 오세요. 눈이 쉬어요.',
  'voice.polite.idle.any.8': (v: N) => `${withParticle(v.name, '이')} 몰래 지켜보고 있어요. 쉿.`,
  'voice.polite.idle.any.9': () => '허리를 쭉 펴 보실래요? 하나, 둘.',
  'voice.polite.idle.any.10': (v: N) => `${withParticle(v.name, '은')} 옆자리가 제일 좋아요.`,
  'voice.polite.idle.any.11': () => '천천히 하셔도 돼요. 다 잘될 거예요.',
  'voice.polite.idle.any.12': (v: N) => `흥얼흥얼. ${withParticle(v.name, '이')} 노래 부르고 있어요.`,
  'voice.polite.idle.any.13': () => '숨을 한 번 크게 쉬어 보세요. 들이쉬고, 내쉬고.',
  'voice.polite.idle.any.14': (v: N) => `${withParticle(v.name, '이')} 여기 있으니까 걱정 마세요.`,
  'voice.polite.idle.any.15': () => '오늘 웃으신 적 있어요? 없으면 지금 한 번 웃어 보세요!',
  'voice.polite.idle.any.16': (v: N) => `${withParticle(v.name, '은')} 일하시는 모습을 보는 게 좋아요.`,
  'voice.polite.idle.morning.3': (v: N) =>
    `${withParticle(v.name, '이')} 아침 기지개를 켰어요. 같이 쭉 펴 봐요!`,
  'voice.polite.idle.morning.4': () => '따뜻한 거 한 잔 드시고 시작해요.',
  'voice.polite.idle.monday.2': () => '한 주가 시작됐어요! 천천히 시동 걸어요.',
  'voice.polite.idle.lunch.3': (v: N) => `${withParticle(v.name, '은')} 오늘 점심 메뉴가 궁금해요.`,
  'voice.polite.idle.afternoon.3': () => '간식 시간 아닌가요? 뭐 하나 드세요.',
  'voice.polite.idle.afternoon.4': (v: N) => `졸음 쫓는 춤, ${withParticle(v.name, '이')} 춰 드릴까요?`,
  'voice.polite.idle.friday.2': (v: N) => `금요일이에요! ${withParticle(v.name, '은')} 벌써 신나요.`,
  'voice.polite.idle.evening.3': () => '저녁은 드셨어요? 꼭 챙겨 드세요.',
  'voice.polite.idle.late.3': (v: N) => `${withParticle(v.name, '이')} 먼저 잘 수는 없죠. 같이 마무리해요.`,
  'voice.polite.idle.weekend.1': (v: N) => `주말에도 일하세요? ${withParticle(v.name, '이')} 옆에 있을게요.`,
  'voice.polite.idle.weekend.2': () => '주말엔 조금만 하시고 푹 쉬세요.',
  'voice.polite.idle.done.1': (v: N) => `방금 하나 끝내셨죠? ${withParticle(v.name, '이')} 박수 쳐 드릴게요!`,
  'voice.polite.idle.done.2': () => '체크 표시 하는 순간이 제일 좋죠. 잘하셨어요!',
  'voice.polite.idle.done.3': (v: N) => `${withParticle(v.name, '은')} 다 봤어요. 방금 그거 멋졌어요.`,
  'voice.polite.idle.done.4': () => '하나 끝! 이 기세로 가 봐요.',
  'voice.polite.idle.back.1': (v: N) => `오셨네요! ${withParticle(v.name, '이')} 기다리고 있었어요.`,
  'voice.polite.idle.back.2': () => '어서 오세요. 보고 싶었어요.',
  'voice.polite.idle.back.3': (v: N) => `${withParticle(v.name, '은')} 안 계신 동안 낮잠 잤어요.`,
  'voice.polite.idle.todo.left.1': (v: N) => `오늘 할 일이 ${v.open ?? 0}개 남았어요. 하나씩 해 봐요.`,
  'voice.polite.idle.todo.left.2': (v: N) =>
    `남은 할 일은 ${v.open ?? 0}개예요. ${withParticle(v.name, '이')} 응원할게요.`,
  'voice.polite.idle.todo.left.3': () => '제일 쉬운 할 일부터 끝내 보실래요?',
  'voice.polite.idle.todo.clear.1': (v: N) =>
    `오늘 할 일을 다 끝내셨어요! ${withParticle(v.name, '이')} 자랑하고 다닐 거예요.`,
  'voice.polite.idle.todo.clear.2': () => '오늘 목록이 텅 비었어요. 이제 마음 편히 쉬세요!',
  'voice.polite.idle.event.soon.1': (v: N) =>
    `${v.eventMin ?? 0}분 뒤에 일정이 있어요. 미리 물 한 잔 드실래요?`,
  'voice.polite.idle.event.soon.2': (v: N) =>
    `일정까지 ${v.eventMin ?? 0}분 남았어요. ${withParticle(v.name, '이')} 시계 보고 있을게요.`,
  'voice.polite.idle.event.soon.3': () => '곧 일정이네요. 그 전에 하나 끝내실 수 있을까요?',
  'voice.polite.idle.event.free.1': () => '오늘은 남은 일정이 없어요. 쭉 집중하기 좋은 날이에요!',
  'voice.polite.idle.event.free.2': (v: N) =>
    `남은 일정이 없어요! ${withParticle(v.name, '이랑')} 느긋하게 해요.`,
  'voice.polite.idle.work.1': (v: N) => `벌써 ${v.workedH ?? 1}시간 넘게 안 쉬셨어요. 대단하세요!`,
  'voice.polite.idle.work.2': (v: N) =>
    `오래 하셨어요. ${withParticle(v.name, '이')} 어깨 주물러 드리고 싶어요.`,
  'voice.polite.idle.work.3': () => '집중력이 최고예요. 그래도 눈은 가끔 쉬어 주세요.',
  'voice.polite.idle.mouse.1': () => '마우스가 정말 바쁘네요!',
  'voice.polite.idle.mouse.2': (v: N) => `커서를 따라가다 ${withParticle(v.name, '이')} 어지러워졌어요.`,
  'voice.polite.idle.mouse.3': () => '손목 괜찮으세요? 살살 돌려 주세요.',
  'voice.polite.idle.hungry.1': (v: N) => `${v.name} 배에서 꼬르륵 소리가 나요.`,
  'voice.polite.idle.hungry.2': () => '밥을 주시면 더 힘낼 수 있을 것 같아요.',
  'voice.polite.idle.hungry.3': (v: N) =>
    `혹시 간식 있으세요? ${withParticle(v.name, '이')} 그냥 여쭤보는 거예요.`,
  'voice.polite.idle.play.1': (v: N) => `${withParticle(v.name, '은')} 심심해요. 놀아 주실래요?`,
  'voice.polite.idle.play.2': () => '잠깐 놀기 한 판 어떠세요? 오른쪽 클릭 메뉴에 있어요.',
  'voice.polite.idle.play.3': (v: N) => `쓰다듬어 주시면 ${withParticle(v.name, '이')} 금방 신날 거예요.`,
  'voice.polite.idle.friend.new': (v: N) => `${withParticle(v.name, '은')} 더 친해지고 싶어요.`,
  'voice.polite.idle.friend.1': (v: N) => `우리 꽤 친해졌죠? ${withParticle(v.name, '은')} 그렇게 생각해요.`,
  'voice.polite.idle.friend.2': (v: N) => `${withParticle(v.name, '은')} 함께 있을 때가 제일 편해요.`,
  'voice.polite.idle.friend.3': (v: N) => `${withParticle(v.name, '이')} 세상에서 제일 좋아하는 분이세요.`,
  'voice.polite.idle.energy.lively.1': (v: N) => `오늘 ${withParticle(v.name, '은')} 기운이 넘쳐요!`,
  'voice.polite.idle.energy.lively.2': () => '몸이 근질근질해요. 폴짝 뛰고 싶어요!',
  'voice.polite.idle.energy.tired.1': (v: N) => `${withParticle(v.name, '은')} 조금 나른해졌어요. 하암.`,
  'voice.polite.idle.energy.tired.2': () => '눈이 살짝 무거워요. 그래도 옆에 있을게요.',
  'voice.polite.idle.energy.sleepy.1': (v: N) =>
    `하암... ${withParticle(v.name, '은')} 눈꺼풀이 자꾸 내려와요.`,
  'voice.polite.idle.energy.sleepy.2': () => '꾸벅... 앗, 안 졸았어요! 진짜예요.',
  'voice.polite.idle.energy.worn.1': (v: N) =>
    `${withParticle(v.name, '은')} 기운이 다 빠졌어요. 흐물흐물...`,
  'voice.polite.idle.energy.worn.2': (v: N) => `배터리 10%... ${v.name}도 충전이 필요해요.`,
  // 기억, 새벽, 철, 특별한 날 (원래 말은 i18n/companion.ts)
  'voice.polite.idle.memory.yesterday.1': (v: M) =>
    `어제 ${v.yesterday ?? 0}개 끝내신 거 ${withParticle(v.name, '이')} 기억해요. 오늘도 해 봐요!`,
  'voice.polite.idle.memory.yesterday.2': (v: M) =>
    `어제도 ${v.yesterday ?? 0}개나 끝내셨어요. 오늘은 쉬운 것부터 해요.`,
  'voice.polite.idle.streak.1': (v: M) =>
    `${v.streak ?? 0}일째 하나씩 끝내고 계세요. ${withParticle(v.name, '이')} 세고 있었어요!`,
  'voice.polite.idle.streak.2': (v: M) => `연속 ${v.streak ?? 0}일이에요! 오늘도 하나만 끝내시면 이어져요.`,
  'voice.polite.idle.week.1': (v: M) => `이번 주에 ${v.week ?? 0}개를 끝내셨어요. 정말 알찬 한 주예요!`,
  'voice.polite.idle.week.2': (v: M) =>
    `이번 주에 끝낸 일이 ${v.week ?? 0}개예요. ${withParticle(v.name, '이')} 다 봤어요.`,
  'voice.polite.idle.focus.1': (v: M) => `오늘 벌써 ${v.focusMin ?? 0}분 집중하셨어요. 멋져요!`,
  'voice.polite.idle.focus.2': (v: M) =>
    `집중 ${v.focusMin ?? 0}분째예요! ${withParticle(v.name, '은')} 조용히 박수 치고 있어요.`,
  'voice.polite.idle.together.1': (v: M) =>
    `우리 같이 지낸 지 ${v.days ?? 0}일째예요. ${withParticle(v.name, '은')} 매일이 좋아요.`,
  'voice.polite.idle.night.1': (v: M) =>
    `벌써 새벽 ${v.hour ?? 1}시예요. ${withParticle(v.name, '은')} 눈이 반쯤 감겼어요.`,
  'voice.polite.idle.night.2': (v: M) => `새벽 ${v.hour ?? 1}시예요... 이거 끝나면 꼭 주무시기로 약속해요!`,
  'voice.polite.idle.season.spring.1': () => '봄이에요! 창문을 열면 꽃 냄새가 날 것 같아요.',
  'voice.polite.idle.season.spring.2': (v: M) =>
    `${withParticle(v.name, '은')} 봄바람 맞으면서 산책하고 싶어요.`,
  'voice.polite.idle.season.summer.1': () => '덥죠? 시원한 물 한 잔 드시고 하세요.',
  'voice.polite.idle.season.summer.2': (v: M) =>
    `${withParticle(v.name, '은')} 털이 많아서 여름엔 녹아내려요...`,
  'voice.polite.idle.season.autumn.1': () => '가을이라 그런지 집중이 잘 되는 것 같아요.',
  'voice.polite.idle.season.autumn.2': (v: M) =>
    `${withParticle(v.name, '은')} 낙엽 밟는 소리가 좋아요. 바스락!`,
  'voice.polite.idle.season.winter.1': () => '손 시리지 않으세요? 따뜻한 거 하나 챙기세요.',
  'voice.polite.idle.season.winter.2': (v: M) =>
    `${withParticle(v.name, '은')} 이불 속에 쏙 들어가고 싶은 날씨예요.`,
  'voice.polite.idle.special.newyear': (v: M) =>
    `새해 복 많이 받으세요! 올해도 ${withParticle(v.name, '이')} 옆에 있을게요.`,
  'voice.polite.idle.special.christmas': (v: M) =>
    `메리 크리스마스! ${withParticle(v.name, '은')} 선물로 쓰다듬기를 받고 싶어요.`,
  'voice.polite.idle.special.yearend': () => '올해 마지막 날이에요. 한 해 동안 정말 수고 많으셨어요.',
};

const enIdle: Record<string, unknown> = { ...idle.en, ...companion.en };
const enOf = (key: string) => enIdle[key.replace('voice.polite.', '')];

export const en = Object.fromEntries(
  Object.keys(ko).map((key) => [key, enOf(key)]),
) as unknown as Translation<typeof ko>;
