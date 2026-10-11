import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 성격마다 다른 정해진 말 (2026-10-11, shared/persona-voice.ts): 인사, 칭찬, 쉬자는 말을 고른 성격 말투로.
// 키는 voice.<성격>.<원래 키>, 값의 모양(인자)은 원래 키와 같다. 다정한 친구는 원래 말을 쓴다.
// 인사 뒤에 붙는 브리핑, 헤어질 때 말, 미리 알림도 같은 성격으로 (한 말풍선 안에서 말투가 섞이지 않게, 2026-10-11).
// 존댓말 비서는 말풍선에 나오는 정해진 말을 모두 존댓말로. 츤데레, 차분한 선생님은 반말이라 정보만 전하는 말
// (일정, 마감, 미리 알림)은 원래 말을 같이 쓰고, 감정이 실린 말만 그 성격으로 바꾼다

type Cheer = { name: string; n: number };
type Anniv = { name: string; n: number };
type I = { i: number };
type N = { n: number };
type Title = { title: string };
type At = { title: string; time: string };
type Focus = { minutes: number; coins: number; breakMin: number };
/** 여러 말 중 하나는 날짜로 고른 i 로 (routine.ts 와 같다) */
const one = (list: readonly string[], i: number) => list[Number(i) % list.length] ?? list[0] ?? '';
const days = (n: number) => (n === 7 ? '딱 일주일' : `${n}일`);
const daysEn = (n: number) => (n === 7 ? 'One week' : `${n} days`);
const s = (n: number) => (n === 1 ? '' : 's');

export const ko = {
  // 존댓말 비서
  'voice.polite.briefing.hi.morning': '좋은 아침이에요!',
  'voice.polite.briefing.hi.day': '안녕하세요!',
  'voice.polite.briefing.hi.evening': '오셨어요?',
  'voice.polite.routine.hi.first': '오늘이 만나는 첫날이에요. 앞으로 이 시간마다 기다릴게요.',
  'voice.polite.routine.bye.rest': '푹 쉬세요!',
  'voice.polite.companion.cheer.clear': () => '오늘 할 일을 모두 끝내셨어요. 축하드려요!',
  'voice.polite.companion.cheer.streak': (v: Cheer) => `오늘 첫 완료예요. ${v.n}일 연속이에요.`,
  'voice.polite.companion.cheer.count': (v: Cheer) => `오늘 벌써 ${v.n}개째예요. 대단하세요!`,
  'voice.polite.pet.fed': '잘 먹겠습니다. 감사해요!',
  'voice.polite.pet.fedWith': (v: { food: string }) => `${v.food}, 잘 먹겠습니다. 감사해요!`,
  'voice.polite.routine.bye.doneMany': (v: { n: number }) =>
    `오늘 할 일 ${v.n}개를 끝내셨어요. 수고 많으셨어요!`,
  'voice.polite.pet.rest.1': '오래 앉아 계셨어요. 물 한 잔 드시고 오실래요?',
  'voice.polite.pet.rest.2': '어깨를 한 번 펴 보시는 건 어떠세요?',
  'voice.polite.pet.rest.3': '잠깐 창밖을 보고 오세요. 눈도 쉬어야 해요.',
  // 츤데레
  'voice.tsundere.briefing.hi.morning': '흥, 일찍 왔네.',
  'voice.tsundere.briefing.hi.day': '...왔어?',
  'voice.tsundere.briefing.hi.evening': '늦었잖아. 기다린 건 아니고.',
  'voice.tsundere.routine.hi.first': '오늘부터 이 시간에 만나는 거지? 늦으면 삐질 거야.',
  'voice.tsundere.routine.bye.rest': '푹 쉬어. 내일 늦지 말고.',
  'voice.tsundere.companion.cheer.clear': () => '다 끝냈어? ...좀 하네. 인정.',
  'voice.tsundere.companion.cheer.streak': (v: Cheer) => `오늘 첫 끝내기. ${v.n}일 연속이라니, 제법이잖아.`,
  'voice.tsundere.companion.cheer.count': (v: Cheer) => `벌써 ${v.n}개? 놀란 거 아니거든.`,
  'voice.tsundere.pet.fed': '...맛있네. 고맙다는 건 아니고.',
  'voice.tsundere.pet.fedWith': (v: { food: string }) => `${v.food}? 흥, 맛있잖아.`,
  'voice.tsundere.routine.bye.doneMany': (v: { n: number }) => `${v.n}개나 끝냈어? 오늘은 칭찬해 줄게.`,
  'voice.tsundere.pet.rest.1': '계속 앉아만 있을 거야? 물이라도 마시고 와.',
  'voice.tsundere.pet.rest.2': '어깨 굳은 거 다 보여. 좀 펴.',
  'voice.tsundere.pet.rest.3': '화면만 보지 말고 창밖 좀 봐. 걱정돼서 그러는 거 아니야.',
  // 차분한 선생님
  'voice.calm.briefing.hi.morning': '좋은 아침. 오늘도 천천히 시작하자.',
  'voice.calm.briefing.hi.day': '안녕. 잘 왔어.',
  'voice.calm.briefing.hi.evening': '왔구나. 하루 정리하기 좋은 때야.',
  'voice.calm.routine.hi.first': '오늘부터 이 시간에 만나자. 정해진 시간이 습관을 만들어.',
  'voice.calm.routine.bye.rest': '푹 쉬어. 쉬어야 내일 또 잘할 수 있어.',
  'voice.calm.companion.cheer.clear': () => '오늘 할 일을 다 마쳤어. 계획한 대로 해 낸 거야.',
  'voice.calm.companion.cheer.streak': (v: Cheer) =>
    `오늘 첫 끝내기. ${v.n}일째 이어 가고 있어, 꾸준함이 힘이야.`,
  'voice.calm.companion.cheer.count': (v: Cheer) => `벌써 ${v.n}개째야. 흐름이 좋을 때 잠깐 쉬어도 돼.`,
  'voice.calm.pet.fed': '잘 먹을게. 고마워.',
  'voice.calm.pet.fedWith': (v: { food: string }) => `${v.food}, 잘 먹을게. 고마워.`,
  'voice.calm.routine.bye.doneMany': (v: { n: number }) => `오늘 ${v.n}개를 끝냈어. 충분히 잘했어.`,
  'voice.calm.pet.rest.1': '오래 앉아 있었어. 물을 마시면 집중도 다시 돌아와.',
  'voice.calm.pet.rest.2': '어깨를 쭉 펴 보자. 굳은 몸이 풀리면 머리도 맑아져.',
  'voice.calm.pet.rest.3': '먼 곳을 잠깐 보자. 가까운 화면만 보면 눈이 지쳐.',
  // ---- 존댓말 비서: 브리핑, 만나는 시간, 회고, 미리 알림, 펫 생활 ----
  'voice.polite.briefing.oneEvent': '오늘 일정은 {time} {title} 하나예요.',
  'voice.polite.briefing.events': '오늘 일정이 {n}개 있어요. 첫 일정은 {time} {title}입니다.',
  'voice.polite.briefing.allDay': '오늘은 종일 {list} 일정이 있어요.',
  'voice.polite.briefing.todos': '할 일은 {list} 있어요.',
  'voice.polite.briefing.nothing': '오늘은 일정도 마감도 없어요. 하고 싶은 일을 적어 보세요.',
  'voice.polite.briefing.next': "먼저 '{title}'부터 해 보시는 건 어떠세요?",
  'voice.polite.briefing.review.none': '오늘은 끝낸 할 일이 없네요. 그래도 수고 많으셨어요.',
  'voice.polite.briefing.review.one': '오늘 "{title}" 끝내셨어요. 수고하셨어요!',
  'voice.polite.briefing.review.many': '오늘 할 일 {n}개를 끝내셨어요. 수고하셨어요!',
  'voice.polite.briefing.review.left': (v: N) => `오늘 마감 ${v.n}개가 남았어요. 내일로 넘길까요?`,
  'voice.polite.briefing.due.left': (v: { n: number; list: string }) =>
    `오늘 마감인 할 일이 ${v.n}개 남았어요. ${v.list}`,
  'voice.polite.routine.hi.early': (v: I) =>
    one(
      ['일찍 오셨네요! 오늘도 반가워요.', '벌써 오셨어요? 부지런하세요!', '일찍 오셨네요. 같이 시작해요.'],
      v.i,
    ),
  'voice.polite.routine.hi.onTime': (v: I) =>
    one(
      [
        '딱 맞춰 오셨네요! 오늘도 반가워요.',
        '시간을 딱 맞추셨어요. 반가워요!',
        '딱 이 시간이에요. 오셨군요!',
      ],
      v.i,
    ),
  'voice.polite.routine.hi.late': (v: I) =>
    one(
      [
        '기다렸어요! 오늘도 만나서 반가워요.',
        '오셨네요! 계속 기다리고 있었어요.',
        '드디어 오셨네요. 기다렸어요.',
      ],
      v.i,
    ),
  'voice.polite.routine.streak': (v: N) => `${v.n}일째 만나고 있어요!`,
  'voice.polite.routine.coins': (v: N) => `만난 기념으로 코인 ${v.n}개를 드려요!`,
  'voice.polite.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days}일 연속 만난 기념으로 코인 ${v.n}개를 드려요!`,
  'voice.polite.routine.cue': '시작할 시간이에요! 오늘도 같이 힘내요.',
  'voice.polite.routine.bye.head': (v: I) =>
    one(['오늘 수고하셨어요!', '오늘도 고생 많으셨어요!', '오늘 하루도 끝났어요!'], v.i),
  'voice.polite.routine.bye.doneOne': '"{title}" 끝내느라 수고하셨어요!',
  'voice.polite.routine.bye.tomorrowFirst': '내일은 {time} {title}부터예요.',
  'voice.polite.routine.bye.tomorrowAllDay': '내일은 종일 {list} 일정이 있어요.',
  'voice.polite.routine.bye.tomorrowAllDayMore': (v: { title: string; n: number }) =>
    `내일은 종일 ${v.title} 외 ${v.n}개 일정이 있어요.`,
  'voice.polite.routine.bye.tomorrowMeet': '내일 {time}에 또 만나요!',
  'voice.polite.routine.bye.nextMeet': '푹 쉬시고 {weekday}에 만나요!',
  'voice.polite.routine.rest': (v: I) =>
    one(
      [
        '오늘은 쉬는 날이네요! 푹 쉬세요.',
        '쉬는 날인데 오셨네요? 오늘은 느긋하게 해요.',
        '오늘은 쉬는 날이에요! 무리하지 마세요.',
        '쉬는 날이에요! 오늘은 천천히 쉬어 가요.',
      ],
      v.i,
    ),
  'voice.polite.companion.anniv.day': (v: Anniv) =>
    `오늘이 우리 만난 지 ${v.n}일째 되는 날이에요! 앞으로도 잘 부탁드려요.`,
  'voice.polite.companion.anniv.late': (v: Anniv) =>
    `우리 만난 지 ${v.n}일이 살짝 지났어요! 늦었지만 축하드려요. 감사해요.`,
  'voice.polite.companion.anniv.year': (v: Anniv) =>
    `우리 만난 지 벌써 ${v.n}년이에요! 함께한 날이 모두 좋았어요.`,
  'voice.polite.assist.overdue.moved': (v: N) => `지난 마감 ${v.n}개를 오늘로 옮겼어요`,
  'voice.polite.assist.week.friday': (v: N) => `이번 주엔 할 일 ${v.n}개를 끝내셨어요. 주말 푹 쉬세요!`,
  'voice.polite.panel.review.moved': (v: N) => `마감 ${v.n}개를 내일로 넘겼어요.`,
  'voice.polite.panel.focus.done': (v: Focus) =>
    `${v.minutes}분 집중을 마치셨어요!${v.coins > 0 ? ` 코인 ${v.coins}개 드려요.` : ''} ${v.breakMin}분 쉬세요.`,
  'voice.polite.panel.focus.breakDone': '쉬는 시간이 끝났어요. 한 번 더 집중하실래요?',
  'voice.polite.panel.focus.todoAsk': "'{title}' 끝내셨어요?",
  'voice.polite.pet.energy.fresh': '푹 쉬고 왔더니 개운해요! 다시 힘내 볼게요.',
  'voice.polite.pet.life.rested': (v: { coins: number }) => `잘 쉬셨어요? 코인 ${v.coins}개 드려요.`,
  'voice.polite.pet.life.madeUpCoins': (v: { coins: number }) =>
    `화해해요! 이제 안 삐졌어요. 보너스 코인 ${v.coins}개 드려요.`,
  'voice.polite.pet.life.madeUp': '화해해요! 이제 안 삐졌어요.',
  'voice.polite.pet.life.affection': (v: { step: number }) =>
    `친밀도 ${v.step}을 넘었어요. 우리 꽤 친해졌네요!`,
  'voice.polite.pet.unlock.wave': '친밀도 100이에요! 이제 자리 비우셨다 돌아오시면 손 흔들어 드릴게요.',
  'voice.polite.pet.unlock.dance': '친밀도 300이에요! 할 일을 끝내시면 빙글 춤을 춰 드릴게요.',
  'voice.polite.pet.unlock.flower': '친밀도 600이에요! 친해진 기념으로 머리에 꽃을 꽂았어요.',
  'voice.polite.pet.noCoins': '코인이 모자라요. 할 일을 하나 끝내시면 생겨요.',
  'voice.polite.pet.full': '배가 불러서 더는 못 먹겠어요. 나중에 주세요.',
  'voice.polite.pet.play.walkStart': '산책 가요!',
  'voice.polite.pet.play.walkEnd': '산책 즐거웠어요!',
  'voice.polite.pet.seek.start': (v: { seconds: number }) =>
    `숨바꼭질해요! ${v.seconds}초 안에 저를 찾아 눌러 주세요.`,
  'voice.polite.pet.seek.foundCoins': (v: { coins: number }) => `찾으셨네요! 코인 ${v.coins}개 드려요.`,
  'voice.polite.pet.seek.found': '찾으셨네요! 재밌었어요.',
  'voice.polite.pet.seek.lost': '못 찾으셨죠! 다음엔 찾아보세요.',
  'voice.polite.pet.home.goIn': '집에서 좀 쉴게요. 집을 누르시면 나올게요!',
  'voice.polite.pet.home.backShort': '벌써 부르셨어요? 좀 더 자고 싶었는데요.',
  'voice.polite.pet.home.backOk': '잘 쉬었어요! 다시 같이 해요.',
  'voice.polite.pet.home.backLong': '푹 잤어요! 개운해요.',
  'voice.polite.remind.say.eventNow': (v: At) => `지금 ${v.title} 시작이에요! (${v.time})`,
  'voice.polite.remind.say.eventSoon': (v: At & N) => `${v.n}분 뒤 ${v.title}! 준비되셨어요? (${v.time})`,
  'voice.polite.remind.say.eventLater': (v: At & { dur: string }) =>
    `${v.dur} 뒤에 ${withParticle(v.title, '이')} 있어요 (${v.time})`,
  'voice.polite.remind.say.eventTomorrow': (v: At) =>
    `내일 ${v.time}에 ${withParticle(v.title, '이')} 있어요! 준비되셨어요?`,
  'voice.polite.remind.say.eventDays': (v: At & N & { date: string }) =>
    `${v.title}까지 ${days(v.n)} 남았어요 (${v.date} ${v.time})`,
  'voice.polite.remind.say.allDayToday': (v: Title & { range: string }) =>
    `오늘은 종일 ${v.title}! 잊지 마세요${v.range}`,
  'voice.polite.remind.say.allDayTomorrow': (v: Title & { range: string }) =>
    `내일은 종일 ${v.title}! 준비되셨어요?${v.range}`,
  'voice.polite.remind.say.allDayDays': (v: Title & N & { date: string }) =>
    `${v.title}까지 ${days(v.n)} 남았어요 (${v.date})`,
  'voice.polite.remind.say.todoNow': (v: At) => `지금 "${v.title}" 마감이에요! (${v.time})`,
  'voice.polite.remind.say.todoSoon': (v: At & N) =>
    `"${v.title}" 마감까지 ${v.n}분! 거의 다 왔어요 (${v.time})`,
  'voice.polite.remind.say.todoLater': (v: At & { dur: string }) =>
    `"${v.title}" 마감까지 ${v.dur} 남았어요 (${v.time})`,
  'voice.polite.remind.say.todoToday': (v: Title) => `오늘 마감: "${v.title}"! 하실 수 있어요`,
  'voice.polite.remind.say.todoTomorrow': (v: Title) => `내일 마감: "${v.title}". 미리 해 두실래요?`,
  'voice.polite.remind.say.todoTomorrowAt': (v: At) => `내일 ${v.time}까지 "${v.title}"! 미리 해 두실래요?`,
  'voice.polite.remind.say.todoDays': (v: Title & N & { date: string }) =>
    `"${v.title}" 마감까지 ${days(v.n)} 남았어요 (${v.date})`,

  // ---- 츤데레: 감정이 실린 말 ----
  'voice.tsundere.briefing.nothing': '오늘은 일정도 마감도 없네. 할 거 있으면 적어 둬.',
  'voice.tsundere.briefing.next': "'{title}'부터 해. 내 말 들어.",
  'voice.tsundere.briefing.review.none': '오늘은 끝낸 게 없네. 뭐, 그런 날도 있지.',
  'voice.tsundere.briefing.review.one': '"{title}" 끝냈네. ...잘했어.',
  'voice.tsundere.briefing.review.many': '{n}개나 끝냈어? ...좀 하네.',
  'voice.tsundere.briefing.review.left': (v: N) => `마감 ${v.n}개 남았잖아. 내일로 넘길 거야?`,
  'voice.tsundere.routine.hi.early': (v: I) =>
    one(['벌써 왔어? ...부지런하긴.', '일찍 왔네. 기다린 건 아니야.', '흥, 오늘은 일찍이네. 시작하자.'], v.i),
  'voice.tsundere.routine.hi.onTime': (v: I) =>
    one(['딱 맞춰 왔네. 당연한 거지만.', '시간은 지켰네. 흥.', '딱 이 시간이야. ...왔구나.'], v.i),
  'voice.tsundere.routine.hi.late': (v: I) =>
    one(
      ['늦었잖아. 기다린 거 아니거든.', '이제 왔어? 흥, 됐어.', '드디어 왔네. 딱히 기다린 건 아니고.'],
      v.i,
    ),
  'voice.tsundere.routine.streak': (v: N) => `${v.n}일째 만나는 중. 세고 있던 건 아니야.`,
  'voice.tsundere.routine.coins': (v: N) => `만난 기념 코인 ${v.n}개. 그냥 주는 거야.`,
  'voice.tsundere.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days}일 연속이니까 코인 ${v.n}개. 특별히 주는 거야.`,
  'voice.tsundere.routine.cue': '시작할 시간이야. 꾸물대지 말고.',
  'voice.tsundere.routine.bye.head': (v: I) =>
    one(['오늘은 이만. ...수고했어.', '끝이야? 흥, 꽤 했네.', '오늘 하루 끝. 잘한 걸로 쳐 줄게.'], v.i),
  'voice.tsundere.routine.bye.doneOne': '"{title}" 끝냈네. ...인정.',
  'voice.tsundere.routine.bye.tomorrowMeet': '내일 {time}. 늦지 마.',
  'voice.tsundere.routine.bye.nextMeet': '{weekday}에 봐. 늦지 말고.',
  'voice.tsundere.routine.rest': (v: I) =>
    one(
      [
        '쉬는 날이잖아. 푹 쉬어.',
        '쉬는 날인데 왔어? ...심심했구나.',
        '오늘은 쉬는 날. 무리하면 화낼 거야.',
        '쉬는 날이니까 오늘은 봐줄게.',
      ],
      v.i,
    ),
  'voice.tsundere.companion.anniv.day': (v: Anniv) => `오늘로 만난 지 ${v.n}일째야. 세고 있던 건 아니거든.`,
  'voice.tsundere.companion.anniv.late': (v: Anniv) =>
    `만난 지 ${v.n}일, 조금 지났네. ...그래도 축하는 해 줄게.`,
  'voice.tsundere.companion.anniv.year': (v: Anniv) => `벌써 ${v.n}년이야? ...나쁘지 않은 시간이었어.`,
  'voice.tsundere.assist.week.friday': (v: N) => `이번 주 ${v.n}개 끝냈네. 주말엔 좀 쉬어.`,
  'voice.tsundere.panel.focus.done': (v: Focus) =>
    `${v.minutes}분 집중 끝.${v.coins > 0 ? ` 코인 ${v.coins}개.` : ''} ${v.breakMin}분 쉬어. 명령이야.`,
  'voice.tsundere.panel.focus.breakDone': '쉬는 시간 끝. 한 번 더 할 거지?',
  'voice.tsundere.pet.energy.fresh': '쉬고 오니까 좀 낫네. 다시 하자.',
  'voice.tsundere.pet.life.rested': (v: { coins: number }) => `쉬고 왔어? 코인 ${v.coins}개. ...잘했어.`,
  'voice.tsundere.pet.life.madeUpCoins': (v: { coins: number }) =>
    `...이번만 봐준다. 코인 ${v.coins}개도 줄게.`,
  'voice.tsundere.pet.life.madeUp': '...이번만 봐준다. 흥.',
  'voice.tsundere.pet.noCoins': '코인 없잖아. 할 일 하나 끝내고 와.',
  'voice.tsundere.pet.full': '배불러. 더는 안 먹어. ...나중에 줘.',

  // ---- 차분한 선생님: 감정이 실린 말 ----
  'voice.calm.briefing.nothing': '오늘은 일정도 마감도 없어. 하고 싶은 것을 하나 적어 보자.',
  'voice.calm.briefing.next': "먼저 '{title}'부터 차분히 해 보자.",
  'voice.calm.briefing.review.none': '오늘 끝낸 일은 없어. 그래도 하루를 잘 보낸 것만으로 충분해.',
  'voice.calm.briefing.review.one': '오늘 "{title}" 끝냈어. 잘 마무리했어.',
  'voice.calm.briefing.review.many': '오늘 {n}개를 끝냈어. 차근차근 잘 해 냈어.',
  'voice.calm.briefing.review.left': (v: N) => `오늘 마감 ${v.n}개가 남았어. 내일로 넘겨도 괜찮아. 넘길까?`,
  'voice.calm.routine.hi.early': (v: I) =>
    one(
      ['일찍 왔구나. 여유 있게 시작하자.', '이른 시작이네. 좋은 습관이야.', '일찍 왔네. 천천히 준비하자.'],
      v.i,
    ),
  'voice.calm.routine.hi.onTime': (v: I) =>
    one(
      ['제시간에 왔구나. 반가워.', '시간을 잘 지켰어. 시작하자.', '딱 맞춰 왔네. 오늘도 차분하게 하자.'],
      v.i,
    ),
  'voice.calm.routine.hi.late': (v: I) =>
    one(
      [
        '왔구나. 늦어도 괜찮아, 지금부터 하면 돼.',
        '기다리고 있었어. 천천히 시작하자.',
        '왔네. 서두르지 않아도 돼.',
      ],
      v.i,
    ),
  'voice.calm.routine.streak': (v: N) => `${v.n}일째 만나고 있어. 꾸준함이 쌓이는 중이야.`,
  'voice.calm.routine.coins': (v: N) => `만난 기념으로 코인 ${v.n}개를 줄게.`,
  'voice.calm.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days}일 연속으로 만났어. 코인 ${v.n}개를 줄게.`,
  'voice.calm.routine.cue': '시작할 시간이야. 하나씩 차근차근 해 보자.',
  'voice.calm.routine.bye.head': (v: I) =>
    one(['오늘도 수고했어.', '오늘 하루 잘 보냈어.', '오늘은 여기까지 하자.'], v.i),
  'voice.calm.routine.bye.doneOne': '"{title}" 끝낸 거, 잘했어.',
  'voice.calm.routine.bye.tomorrowMeet': '내일 {time}에 다시 만나자.',
  'voice.calm.routine.bye.nextMeet': '푹 쉬고 {weekday}에 만나자.',
  'voice.calm.routine.rest': (v: I) =>
    one(
      [
        '오늘은 쉬는 날이야. 몸도 마음도 쉬게 해 줘.',
        '쉬는 날에도 왔구나. 오늘은 느긋하게 하자.',
        '쉬는 날이야. 잘 쉬는 것도 실력이야.',
        '오늘은 쉬어 가는 날. 천천히 보내자.',
      ],
      v.i,
    ),
  'voice.calm.companion.anniv.day': (v: Anniv) => `오늘로 만난 지 ${v.n}일째야. 하루하루 잘 쌓아 왔어.`,
  'voice.calm.companion.anniv.late': (v: Anniv) => `만난 지 ${v.n}일이 조금 지났어. 늦었지만 고마워.`,
  'voice.calm.companion.anniv.year': (v: Anniv) => `만난 지 ${v.n}년이 됐어. 함께한 날들이 고마워.`,
  'voice.calm.assist.week.friday': (v: N) => `이번 주 ${v.n}개를 끝냈어. 주말엔 푹 쉬자.`,
  'voice.calm.panel.focus.done': (v: Focus) =>
    `${v.minutes}분 집중을 마쳤어.${v.coins > 0 ? ` 코인 ${v.coins}개.` : ''} ${v.breakMin}분 쉬자.`,
  'voice.calm.panel.focus.breakDone': '쉬는 시간이 끝났어. 한 번 더 집중해 볼까?',
  'voice.calm.pet.energy.fresh': '쉬고 나니 개운하네. 다시 천천히 해 보자.',
  'voice.calm.pet.life.rested': (v: { coins: number }) => `잘 쉬었어. 코인 ${v.coins}개를 줄게.`,
  'voice.calm.pet.life.madeUpCoins': (v: { coins: number }) =>
    `이제 괜찮아. 다시 같이 하자. 코인 ${v.coins}개를 줄게.`,
  'voice.calm.pet.life.madeUp': '이제 괜찮아. 다시 같이 하자.',
};

export const en: Translation<typeof ko> = {
  'voice.polite.briefing.hi.morning': 'Good morning!',
  'voice.polite.briefing.hi.day': 'Hello!',
  'voice.polite.briefing.hi.evening': 'Welcome back.',
  'voice.polite.routine.hi.first':
    "Today is our first meeting day. I'll be waiting at this time from now on.",
  'voice.polite.routine.bye.rest': 'Please rest well!',
  'voice.polite.companion.cheer.clear': () => "You've finished everything for today. Congratulations!",
  'voice.polite.companion.cheer.streak': (v: Cheer) => `Your first one today. That's ${v.n} days in a row.`,
  'voice.polite.companion.cheer.count': (v: Cheer) => `Already ${v.n} today. Impressive!`,
  'voice.polite.pet.fed': 'Thank you for the meal!',
  'voice.polite.pet.fedWith': (v: { food: string }) => `${v.food}, thank you so much!`,
  'voice.polite.routine.bye.doneMany': (v: { n: number }) => `You finished ${v.n} to-dos today. Great work!`,
  'voice.polite.pet.rest.1': "You've been sitting a while. Would you like some water?",
  'voice.polite.pet.rest.2': 'How about stretching your shoulders for a moment?',
  'voice.polite.pet.rest.3': 'Please look out the window for a bit. Your eyes need rest too.',
  'voice.tsundere.briefing.hi.morning': "Hmph, you're early.",
  'voice.tsundere.briefing.hi.day': '...You came?',
  'voice.tsundere.briefing.hi.evening': "You're late. Not that I was waiting.",
  'voice.tsundere.routine.hi.first': "So we meet at this time from now on? Be late and I'll sulk.",
  'voice.tsundere.routine.bye.rest': "Rest up. Don't be late tomorrow.",
  'voice.tsundere.companion.cheer.clear': () => 'All done? ...Not bad. I admit it.',
  'voice.tsundere.companion.cheer.streak': (v: Cheer) =>
    `First one today. ${v.n} days in a row? Pretty good.`,
  'voice.tsundere.companion.cheer.count': (v: Cheer) => `Already ${v.n}? I'm not impressed or anything.`,
  'voice.tsundere.pet.fed': "...Tasty. Not that I'm thanking you.",
  'voice.tsundere.pet.fedWith': (v: { food: string }) => `${v.food}? Hmph, it's good.`,
  'voice.tsundere.routine.bye.doneMany': (v: { n: number }) => `${v.n} done? Fine, I'll praise you today.`,
  'voice.tsundere.pet.rest.1': 'Are you just going to sit there? Go drink some water.',
  'voice.tsundere.pet.rest.2': 'I can see your stiff shoulders. Stretch.',
  'voice.tsundere.pet.rest.3': "Look out the window, not just the screen. Not because I'm worried.",
  'voice.calm.briefing.hi.morning': "Good morning. Let's start slowly today.",
  'voice.calm.briefing.hi.day': 'Hello. Glad you are here.',
  'voice.calm.briefing.hi.evening': "You're here. A good time to wrap up the day.",
  'voice.calm.routine.hi.first': "Let's meet at this time from today. A set time builds a habit.",
  'voice.calm.routine.bye.rest': 'Rest well. Rest is what makes tomorrow go well.',
  'voice.calm.companion.cheer.clear': () => 'Everything for today is done. You did what you planned.',
  'voice.calm.companion.cheer.streak': (v: Cheer) =>
    `First one today. ${v.n} days in a row; steadiness is strength.`,
  'voice.calm.companion.cheer.count': (v: Cheer) => `${v.n} already. A short break while it flows is fine.`,
  'voice.calm.pet.fed': 'Thank you. I will enjoy this.',
  'voice.calm.pet.fedWith': (v: { food: string }) => `${v.food}. Thank you, I will enjoy it.`,
  'voice.calm.routine.bye.doneMany': (v: { n: number }) => `${v.n} done today. That's plenty.`,
  'voice.calm.pet.rest.1': "You've been sitting a while. Water helps focus come back.",
  'voice.calm.pet.rest.2': "Let's stretch your shoulders. A loose body clears the mind.",
  'voice.calm.pet.rest.3': 'Look at something far away. Close screens tire the eyes.',
  'voice.polite.briefing.oneEvent': 'You have one event today: {title} at {time}.',
  'voice.polite.briefing.events': 'You have {n} events today. The first is {title} at {time}.',
  'voice.polite.briefing.allDay': 'You have an all-day event today: {list}.',
  'voice.polite.briefing.todos': 'For to-dos, you have {list}.',
  'voice.polite.briefing.nothing':
    'No events or deadlines today. Perhaps note down something you would like to do.',
  'voice.polite.briefing.next': "Might I suggest starting with '{title}'?",
  'voice.polite.briefing.review.none': 'No to-dos finished today. Thank you for your hard work all the same.',
  'voice.polite.briefing.review.one': 'You finished "{title}" today. Thank you for your hard work.',
  'voice.polite.briefing.review.many': 'You finished {n} to-dos today. Thank you for your hard work.',
  'voice.polite.briefing.review.left': (v: N) =>
    v.n === 1
      ? 'One to-do due today is still open. Shall I move it to tomorrow?'
      : `${v.n} to-dos due today are still open. Shall I move them to tomorrow?`,
  'voice.polite.briefing.due.left': (v: { n: number; list: string }) =>
    v.n === 1 ? `You have one to-do due today: ${v.list}` : `You have ${v.n} to-dos due today: ${v.list}`,
  'voice.polite.routine.hi.early': (v: I) =>
    one(
      ["You're early. Lovely to see you.", 'Here already? How diligent.', "You're early. Shall we begin?"],
      v.i,
    ),
  'voice.polite.routine.hi.onTime': (v: I) =>
    one(
      ['Right on time. Lovely to see you.', 'Perfectly on time. Hello.', "It's time, and here you are."],
      v.i,
    ),
  'voice.polite.routine.hi.late': (v: I) =>
    one(
      [
        'I was waiting for you. Lovely to see you.',
        "Welcome. I've been waiting.",
        'There you are. I was waiting.',
      ],
      v.i,
    ),
  'voice.polite.routine.streak': (v: N) => `This is day ${v.n} in a row.`,
  'voice.polite.routine.coins': (v: N) => `Here are ${v.n} coins for coming by.`,
  'voice.polite.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days} days in a row, so here are ${v.n} coins.`,
  'voice.polite.routine.cue': "It's time to begin. Let's do our best today.",
  'voice.polite.routine.bye.head': (v: I) =>
    one(['Thank you for your hard work today.', 'You worked hard today.', "That's all for today."], v.i),
  'voice.polite.routine.bye.doneOne': 'Well done finishing "{title}".',
  'voice.polite.routine.bye.tomorrowFirst': 'Tomorrow begins with {title} at {time}.',
  'voice.polite.routine.bye.tomorrowAllDay': 'You have an all-day event tomorrow: {list}.',
  'voice.polite.routine.bye.tomorrowAllDayMore': (v: { title: string; n: number }) =>
    `You have all-day events tomorrow: ${v.title} and ${v.n} more.`,
  'voice.polite.routine.bye.tomorrowMeet': 'See you tomorrow at {time}.',
  'voice.polite.routine.bye.nextMeet': 'Please rest well. See you on {weekday}.',
  'voice.polite.routine.rest': (v: I) =>
    one(
      [
        "It's your day off. Please rest well.",
        "A day off, and you're here? Let's take it easy today.",
        "It's a day off. Please don't overdo it.",
        "It's a day off. Let's take things slowly.",
      ],
      v.i,
    ),
  'voice.polite.companion.anniv.day': (v: Anniv) =>
    `Today marks day ${v.n} together. I look forward to every day with you.`,
  'voice.polite.companion.anniv.late': (v: Anniv) =>
    `We just passed ${v.n} days together. A little late, but thank you.`,
  'voice.polite.companion.anniv.year': (v: Anniv) =>
    `It has been ${v.n} year${s(v.n)} together. Every day has been a pleasure.`,
  'voice.polite.assist.overdue.moved': (v: N) =>
    v.n === 1 ? 'I moved 1 overdue to-do to today' : `I moved ${v.n} overdue to-dos to today`,
  'voice.polite.assist.week.friday': (v: N) =>
    `You finished ${v.n} to-do${s(v.n)} this week. Please enjoy a restful weekend.`,
  'voice.polite.panel.review.moved': (v: N) =>
    v.n === 1 ? 'I moved 1 due date to tomorrow.' : `I moved ${v.n} due dates to tomorrow.`,
  'voice.polite.panel.focus.done': (v: Focus) =>
    `${v.minutes} minutes of focus, well done.${v.coins > 0 ? ` Here are ${v.coins} coin${s(v.coins)}.` : ''} Please take ${v.breakMin}.`,
  'voice.polite.panel.focus.breakDone': 'Your break is over. Would you like another round?',
  'voice.polite.panel.focus.todoAsk': "Did you finish '{title}'?",
  'voice.polite.pet.energy.fresh': 'That break was refreshing. Shall we continue?',
  'voice.polite.pet.life.rested': (v: { coins: number }) => `Did you rest well? Here are ${v.coins} coins.`,
  'voice.polite.pet.life.madeUpCoins': (v: { coins: number }) =>
    `Let's make up. I'm not sulking anymore. Here are ${v.coins} bonus coins.`,
  'voice.polite.pet.life.madeUp': "Let's make up. I'm not sulking anymore.",
  'voice.polite.pet.life.affection': (v: { step: number }) =>
    `Our bond passed ${v.step}. We have grown quite close.`,
  'voice.polite.pet.unlock.wave': "Bond 100. From now on, I'll wave when you come back.",
  'voice.polite.pet.unlock.dance': "Bond 300. I'll do a little spin dance when you finish a to-do.",
  'voice.polite.pet.unlock.flower': 'Bond 600. I put a flower in my hair to celebrate.',
  'voice.polite.pet.noCoins': "There aren't enough coins. Finishing a to-do will earn some.",
  'voice.polite.pet.full': "I'm quite full, thank you. Perhaps later.",
  'voice.polite.pet.play.walkStart': 'Shall we go for a walk?',
  'voice.polite.pet.play.walkEnd': 'Thank you, that was a lovely walk.',
  'voice.polite.pet.seek.start': (v: { seconds: number }) =>
    `Let's play hide-and-seek. Please find me and click me within ${v.seconds} seconds.`,
  'voice.polite.pet.seek.foundCoins': (v: { coins: number }) => `You found me. Here are ${v.coins} coins.`,
  'voice.polite.pet.seek.found': 'You found me. That was fun.',
  'voice.polite.pet.seek.lost': 'You missed me this time. Please try again next time.',
  'voice.polite.pet.home.goIn': "I'll rest at home for a while. Click the house and I'll come out.",
  'voice.polite.pet.home.backShort': 'Already? I was hoping to sleep a little longer.',
  'voice.polite.pet.home.backOk': "I'm rested. Shall we continue together?",
  'voice.polite.pet.home.backLong': 'I slept well. I feel refreshed.',
  'voice.polite.remind.say.eventNow': (v: At) => `${v.title} is starting now. (${v.time})`,
  'voice.polite.remind.say.eventSoon': (v: At & N) => `${v.title} in ${v.n} min. Are you ready? (${v.time})`,
  'voice.polite.remind.say.eventLater': (v: At & { dur: string }) => `${v.title} in ${v.dur}. (${v.time})`,
  'voice.polite.remind.say.eventTomorrow': (v: At) => `You have ${v.title} tomorrow at ${v.time}.`,
  'voice.polite.remind.say.eventDays': (v: At & N & { date: string }) =>
    `${daysEn(v.n)} until ${v.title}. (${v.date}, ${v.time})`,
  'voice.polite.remind.say.allDayToday': (v: Title & { range: string }) =>
    `All day today: ${v.title}. Please don't forget${v.range}`,
  'voice.polite.remind.say.allDayTomorrow': (v: Title & { range: string }) =>
    `All day tomorrow: ${v.title}. Are you ready?${v.range}`,
  'voice.polite.remind.say.allDayDays': (v: Title & N & { date: string }) =>
    `${daysEn(v.n)} until ${v.title}. (${v.date})`,
  'voice.polite.remind.say.todoNow': (v: At) => `"${v.title}" is due now. (${v.time})`,
  'voice.polite.remind.say.todoSoon': (v: At & N) =>
    `"${v.title}" is due in ${v.n} min. Almost there. (${v.time})`,
  'voice.polite.remind.say.todoLater': (v: At & { dur: string }) =>
    `"${v.title}" is due in ${v.dur}. (${v.time})`,
  'voice.polite.remind.say.todoToday': (v: Title) => `"${v.title}" is due today. You can do it.`,
  'voice.polite.remind.say.todoTomorrow': (v: Title) =>
    `"${v.title}" is due tomorrow. Would you like a head start?`,
  'voice.polite.remind.say.todoTomorrowAt': (v: At) =>
    `"${v.title}" is due tomorrow at ${v.time}. Would you like a head start?`,
  'voice.polite.remind.say.todoDays': (v: Title & N & { date: string }) =>
    `${daysEn(v.n)} left for "${v.title}". (${v.date})`,

  'voice.tsundere.briefing.nothing': "No events, no deadlines. Write something down if you've got plans.",
  'voice.tsundere.briefing.next': "Start with '{title}'. Just listen to me.",
  'voice.tsundere.briefing.review.none': 'Nothing finished today. Whatever, those days happen.',
  'voice.tsundere.briefing.review.one': 'You finished "{title}". ...Good job.',
  'voice.tsundere.briefing.review.many': '{n} done? ...Not bad.',
  'voice.tsundere.briefing.review.left': (v: N) =>
    `${v.n} still due today. Pushing ${v.n === 1 ? 'it' : 'them'} to tomorrow?`,
  'voice.tsundere.routine.hi.early': (v: I) =>
    one(
      [
        'Here already? ...Diligent, huh.',
        "You're early. Not that I was waiting.",
        "Hmph, early today. Let's start.",
      ],
      v.i,
    ),
  'voice.tsundere.routine.hi.onTime': (v: I) =>
    one(
      ['Right on time. As you should be.', 'At least you kept the time. Hmph.', "It's time. ...You came."],
      v.i,
    ),
  'voice.tsundere.routine.hi.late': (v: I) =>
    one(
      [
        "You're late. Not that I was waiting.",
        'Now you show up? Hmph, fine.',
        'Finally. Not like I was waiting.',
      ],
      v.i,
    ),
  'voice.tsundere.routine.streak': (v: N) => `Day ${v.n} in a row. Not that I'm counting.`,
  'voice.tsundere.routine.coins': (v: N) => `${v.n} coins for showing up. Just because.`,
  'voice.tsundere.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days} days in a row, so ${v.n} coins. Special, just this once.`,
  'voice.tsundere.routine.cue': "Time to start. Don't dawdle.",
  'voice.tsundere.routine.bye.head': (v: I) =>
    one(
      ["That's it for today. ...Good work.", 'Done? Hmph, you did okay.', "Day's over. I'll call it a win."],
      v.i,
    ),
  'voice.tsundere.routine.bye.doneOne': 'You finished "{title}". ...I admit it.',
  'voice.tsundere.routine.bye.tomorrowMeet': "Tomorrow at {time}. Don't be late.",
  'voice.tsundere.routine.bye.nextMeet': "See you {weekday}. Don't be late.",
  'voice.tsundere.routine.rest': (v: I) =>
    one(
      [
        "It's your day off. Go rest.",
        'Day off and you came anyway? ...Bored, huh.',
        "Day off. Overdo it and I'll get mad.",
        "It's a day off, so I'll go easy on you.",
      ],
      v.i,
    ),
  'voice.tsundere.companion.anniv.day': (v: Anniv) => `Day ${v.n} together. Not that I was counting.`,
  'voice.tsundere.companion.anniv.late': (v: Anniv) =>
    `${v.n} days together, a bit ago. ...I'll still say congrats.`,
  'voice.tsundere.companion.anniv.year': (v: Anniv) =>
    `${v.n} year${s(v.n)} already? ...Not a bad time, I guess.`,
  'voice.tsundere.assist.week.friday': (v: N) => `${v.n} done this week. Rest a bit this weekend.`,
  'voice.tsundere.panel.focus.done': (v: Focus) =>
    `${v.minutes} min of focus, done.${v.coins > 0 ? ` ${v.coins} coin${s(v.coins)}.` : ''} Rest ${v.breakMin}. That's an order.`,
  'voice.tsundere.panel.focus.breakDone': "Break's over. One more round, right?",
  'voice.tsundere.pet.energy.fresh': "That break helped. Let's go again.",
  'voice.tsundere.pet.life.rested': (v: { coins: number }) =>
    `Back from your break? ${v.coins} coins. ...Good.`,
  'voice.tsundere.pet.life.madeUpCoins': (v: { coins: number }) =>
    `...I'll let it go this once. Here, ${v.coins} coins.`,
  'voice.tsundere.pet.life.madeUp': "...I'll let it go this once. Hmph.",
  'voice.tsundere.pet.noCoins': 'No coins. Go finish a to-do first.',
  'voice.tsundere.pet.full': "I'm full. Not eating more. ...Later.",

  'voice.calm.briefing.nothing': "No events or deadlines today. Let's write down one thing you want to do.",
  'voice.calm.briefing.next': "Let's start calmly with '{title}'.",
  'voice.calm.briefing.review.none': 'Nothing finished today. Getting through the day is enough.',
  'voice.calm.briefing.review.one': 'You finished "{title}" today. A good finish.',
  'voice.calm.briefing.review.many': '{n} finished today. Step by step, well done.',
  'voice.calm.briefing.review.left': (v: N) =>
    `${v.n} still due today. It's fine to move ${v.n === 1 ? 'it' : 'them'} to tomorrow. Shall we?`,
  'voice.calm.routine.hi.early': (v: I) =>
    one(
      [
        "You're early. Let's start with room to spare.",
        'An early start. A good habit.',
        "Early today. Let's get ready slowly.",
      ],
      v.i,
    ),
  'voice.calm.routine.hi.onTime': (v: I) =>
    one(
      [
        'On time. Good to see you.',
        "You kept the time. Let's begin.",
        "Right on time. Let's stay calm today.",
      ],
      v.i,
    ),
  'voice.calm.routine.hi.late': (v: I) =>
    one(
      [
        "You're here. Late is fine, we start now.",
        "I was waiting. Let's start slowly.",
        "You're here. No need to rush.",
      ],
      v.i,
    ),
  'voice.calm.routine.streak': (v: N) => `Day ${v.n} in a row. Steadiness is adding up.`,
  'voice.calm.routine.coins': (v: N) => `${v.n} coins for coming by.`,
  'voice.calm.routine.coinsBonus': (v: { days: number; n: number }) =>
    `${v.days} days in a row. Here are ${v.n} coins.`,
  'voice.calm.routine.cue': "It's time to start. One thing at a time.",
  'voice.calm.routine.bye.head': (v: I) =>
    one(['Good work today.', 'You spent the day well.', "Let's stop here for today."], v.i),
  'voice.calm.routine.bye.doneOne': 'You finished "{title}". Well done.',
  'voice.calm.routine.bye.tomorrowMeet': "Let's meet again tomorrow at {time}.",
  'voice.calm.routine.bye.nextMeet': "Rest well, and let's meet on {weekday}.",
  'voice.calm.routine.rest': (v: I) =>
    one(
      [
        "It's a day off. Let your body and mind rest.",
        "You came on a day off. Let's keep it easy.",
        'A day off. Resting well is a skill too.',
        "A day to slow down. Let's take it easy.",
      ],
      v.i,
    ),
  'voice.calm.companion.anniv.day': (v: Anniv) => `Day ${v.n} together today. We built it one day at a time.`,
  'voice.calm.companion.anniv.late': (v: Anniv) =>
    `We passed ${v.n} days together a little while ago. Thank you.`,
  'voice.calm.companion.anniv.year': (v: Anniv) =>
    `${v.n} year${s(v.n)} together. I'm grateful for those days.`,
  'voice.calm.assist.week.friday': (v: N) => `${v.n} done this week. Let's rest well this weekend.`,
  'voice.calm.panel.focus.done': (v: Focus) =>
    `${v.minutes} minutes of focus, complete.${v.coins > 0 ? ` ${v.coins} coin${s(v.coins)}.` : ''} Let's rest ${v.breakMin}.`,
  'voice.calm.panel.focus.breakDone': 'The break is over. Shall we focus once more?',
  'voice.calm.pet.energy.fresh': "That rest cleared my head. Let's continue slowly.",
  'voice.calm.pet.life.rested': (v: { coins: number }) => `A good rest. Here are ${v.coins} coins.`,
  'voice.calm.pet.life.madeUpCoins': (v: { coins: number }) =>
    `It's all right now. Let's carry on together. Here are ${v.coins} coins.`,
  'voice.calm.pet.life.madeUp': "It's all right now. Let's carry on together.",
};
