import type { Translation } from './types.ts';

// 매일 쪽지 더하기 (feat/voice-style): 어제 집중, 연속 기록, 추신, 주간 편지, 저녁 쪽지. 줄은 성격(p)을 받아 그 말투로 쓴다
// (shared/daily-note.ts). v 는 날마다 다른 말을 고르는 번호 (1부터)

type Voice<T> = { friend: T; polite: T; tsundere: T; calm: T };
const P = <T>(p: unknown, m: Voice<T>): T => m[p as keyof Voice<T>] ?? m.friend;
const V = (v: unknown, list: readonly string[]): string => list[(Number(v) || 1) - 1] ?? list[0] ?? '';

type Pv = { p: string; v?: number };
type N = { p: string; n: number; v?: number };

export const ko = {
  // 제목과 가져오는 말
  'note.weekTitle': (v: { m: number; d: number }) => `${v.m}월 ${v.d}일 주간 편지`,
  'note.eveningTitle': (v: { m: number; d: number }) => `${v.m}월 ${v.d}일 저녁 쪽지`,
  'note.bringWeek': (v: { p: string; name: string }) =>
    P(v.p, {
      friend: '지난 한 주를 돌아보는 편지를 썼어! 나를 누르면 펼쳐 볼 수 있어.',
      polite: '지난 한 주를 돌아보는 편지를 썼어요. 저를 누르시면 펼쳐 보실 수 있어요.',
      tsundere: '지난주 얘기를 적어 왔어. 읽든 말든 알아서 해. 나 누르면 돼.',
      calm: '지난 한 주를 돌아보는 편지를 썼어. 나를 누르면 펼쳐 볼 수 있어.',
    }),
  'note.bringEvening': (v: { p: string; name: string }) =>
    P(v.p, {
      friend: '오늘 하루를 돌아보는 쪽지를 썼어! 나를 누르면 펼쳐 볼 수 있어.',
      polite: '오늘 하루를 돌아보는 쪽지를 썼어요. 저를 누르시면 펼쳐 보실 수 있어요.',
      tsundere: '오늘 하루 정리해 왔어. 읽든 말든 알아서 해. 나 누르면 돼.',
      calm: '오늘 하루를 돌아보는 쪽지를 썼어. 나를 누르면 펼쳐 볼 수 있어.',
    }),
  // 오늘 쪽지의 기록 줄
  'note.focus': (v: N) =>
    P(v.p, {
      friend: `어제 집중한 시간이 ${v.n}분이었어. 대단해!`,
      polite: `어제 ${v.n}분 집중하셨어요. 대단해요!`,
      tsundere: `어제 ${v.n}분이나 집중했더라. ...인정.`,
      calm: `어제 ${v.n}분을 집중했어. 깊이 파고든 시간이야.`,
    }),
  'note.streak': (v: N) =>
    P(v.p, {
      friend: `${v.n}일 연속으로 끝내고 있어. 오늘도 이어 가 볼까?`,
      polite: `${v.n}일 연속으로 끝내고 계세요. 오늘도 이어 가 보시겠어요?`,
      tsundere: `${v.n}일 연속이야. 여기서 끊으면 아까우니까 해.`,
      calm: `${v.n}일째 이어 오고 있어. 꾸준함이 쌓이고 있어.`,
    }),
  // 추신 (가끔 한 줄 더)
  'note.ps': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        'P.S. 오늘 물은 마셨어?',
        'P.S. 어깨 한 번 쭉 펴 봐.',
        'P.S. 쓰다듬어 주면 좋아.',
        'P.S. 이 쪽지는 쪽지함에 계속 있어.',
        'P.S. 오늘 한 번 웃는 것도 잊지 마!',
        'P.S. 점심은 꼭 챙겨 먹어.',
      ]),
      polite: V(v.v, [
        'P.S. 오늘 물은 드셨나요?',
        'P.S. 어깨를 한 번 펴 보세요.',
        'P.S. 쓰다듬어 주시면 좋아요.',
        'P.S. 이 쪽지는 쪽지함에 계속 남아 있어요.',
        'P.S. 오늘 한 번 웃는 것도 잊지 마세요.',
        'P.S. 점심은 꼭 챙겨 드세요.',
      ]),
      tsundere: V(v.v, [
        'P.S. 물 마셨는지 확인하는 거 아니야. 마셔.',
        'P.S. 어깨 좀 펴. 보는 쪽이 불편해.',
        'P.S. 쓰다듬는 건... 허락해 줄게.',
        'P.S. 이 쪽지, 버리지 마. 쪽지함에 있어.',
        'P.S. 웃는 얼굴, 가끔은 보여 줘.',
        'P.S. 점심 거르면 혼난다.',
      ]),
      calm: V(v.v, [
        'P.S. 물 한 모금 마시는 것도 잊지 마.',
        'P.S. 어깨의 힘을 조금 빼 보자.',
        'P.S. 쓰다듬어 주면 마음이 놓여.',
        'P.S. 이 쪽지는 쪽지함에 계속 남아 있어.',
        'P.S. 한 번 웃으면 긴장이 풀려.',
        'P.S. 점심은 꼭 챙기자.',
      ]),
    }),
  // 주간 편지 (한 주에 한 번, 코인 없음)
  'note.week.open': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        '한 주가 시작됐어! 지난주 이야기부터 해 줄게.',
        '편지를 썼어. 지난주를 돌아보는 이야기야.',
        '새로운 한 주야. 지난주에 네가 한 일을 적어 봤어.',
        '주간 편지 도착! 지난 한 주 정말 수고했어.',
      ]),
      polite: V(v.v, [
        '한 주가 시작됐어요. 지난주 이야기부터 해 드릴게요.',
        '편지를 썼어요. 지난주를 돌아보는 이야기예요.',
        '새로운 한 주예요. 지난주에 하신 일을 적어 봤어요.',
        '주간 편지가 도착했어요. 지난 한 주 정말 수고하셨어요.',
      ]),
      tsundere: V(v.v, [
        '한 주가 시작됐네. 지난주 얘기 좀 해 줄게. 듣든 말든.',
        '주간 편지야. 지난주 정리해 봤어. 시간이 남아서.',
        '새 주야. 지난주에 뭐 했는지, 다 적어 놨거든.',
        '주간 편지야. ...지난주, 수고했어.',
      ]),
      calm: V(v.v, [
        '한 주가 시작됐어. 지난주를 차분히 돌아보자.',
        '편지를 썼어. 지난주를 차분히 돌아봤어.',
        '새로운 한 주야. 지난주에 해 낸 것들을 적어 봤어.',
        '주간 편지가 도착했어. 지난 한 주 수고했어.',
      ]),
    }),
  'note.week.done': (v: N) =>
    P(v.p, {
      friend: `지난주에 할 일 ${v.n}개를 끝냈어. 꽤 알찬 한 주였지?`,
      polite: `지난주에 할 일 ${v.n}개를 끝내셨어요. 꽤 알찬 한 주였어요.`,
      tsundere: `지난주에 ${v.n}개 끝냈더라. ...나쁘지 않았어.`,
      calm: `지난주에 할 일 ${v.n}개를 끝냈어. 하나씩 쌓인 결과야.`,
    }),
  'note.week.doneNone': (v: Pv) =>
    P(v.p, {
      friend: '지난주는 푹 쉬어 간 주였네. 그것도 꼭 필요한 일이야.',
      polite: '지난주는 푹 쉬어 가신 주였네요. 그것도 꼭 필요한 일이에요.',
      tsundere: '지난주는 거의 쉬었더라? 뭐, 이번 주에 하면 되지.',
      calm: '지난주는 쉬어 간 주였어. 쉼도 일의 일부야.',
    }),
  'note.week.focus': (v: N) =>
    P(v.p, {
      friend: `지난주에 집중한 시간은 모두 ${v.n}분이야.`,
      polite: `지난주에 집중하신 시간은 모두 ${v.n}분이에요.`,
      tsundere: `지난주 집중 시간은 ${v.n}분. 세고 있었던 건 아니고.`,
      calm: `지난주에 ${v.n}분을 집중했어. 몰입의 시간이 쌓였어.`,
    }),
  'note.week.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        '이번 주도 같이 천천히 가 보자!',
        '이번 주도 옆에 있을게. 파이팅!',
        '이번 주 목표 하나만 정해 볼까?',
      ]),
      polite: V(v.v, [
        '이번 주도 함께 천천히 가 봐요.',
        '이번 주도 곁에 있을게요. 파이팅이에요!',
        '이번 주 목표를 하나만 정해 보시겠어요?',
      ]),
      tsundere: V(v.v, [
        '이번 주도 해 보든가. 지켜볼 거야.',
        '이번 주도 옆에 있어 줄게. 심심하니까.',
        '이번 주 목표 하나쯤은 정해. 시키는 거 아니고 권하는 거야.',
      ]),
      calm: V(v.v, [
        '이번 주도 천천히, 같이 가 보자.',
        '이번 주도 곁에 있을게. 무리하지 말고.',
        '이번 주 목표를 하나만 정해 보자.',
      ]),
    }),
  // 저녁 쪽지 (21시 이후, 설정에서 켠 사람만)
  'note.evening.open': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        '하루 수고했어. 저녁 쪽지야.',
        '오늘 하루는 어땠어? 돌아보는 쪽지를 썼어.',
        '저녁이야. 오늘 한 일을 적어 봤어.',
      ]),
      polite: V(v.v, [
        '하루 수고하셨어요. 저녁 쪽지예요.',
        '오늘 하루는 어떠셨어요? 돌아보는 쪽지를 썼어요.',
        '저녁이에요. 오늘 하신 일을 적어 봤어요.',
      ]),
      tsundere: V(v.v, [
        '하루 끝났네. 저녁 쪽지야.',
        '오늘 어땠는지, 정리해 놨어. 심심해서.',
        '저녁이야. 오늘 한 거, 다 봤거든.',
      ]),
      calm: V(v.v, [
        '하루를 마무리하는 저녁 쪽지야.',
        '오늘 하루를 차분히 돌아보자.',
        '저녁이야. 오늘 한 일을 적어 봤어.',
      ]),
    }),
  'note.evening.done': (v: N) =>
    P(v.p, {
      friend: `오늘 할 일 ${v.n}개를 끝냈어. 잘했어!`,
      polite: `오늘 할 일 ${v.n}개를 끝내셨어요. 잘하셨어요!`,
      tsundere: `오늘 ${v.n}개 끝냈네. ...잘했어.`,
      calm: `오늘 할 일 ${v.n}개를 끝냈어. 충분한 하루야.`,
    }),
  'note.evening.doneNone': (v: Pv) =>
    P(v.p, {
      friend: '오늘은 끝낸 할 일이 없네. 그래도 하루를 지나온 것만으로 충분해.',
      polite: '오늘은 끝낸 할 일이 없네요. 그래도 하루를 지나오신 것만으로 충분해요.',
      tsundere: '오늘은 끝낸 게 없네. 뭐, 그런 날도 있지.',
      calm: '오늘은 끝낸 일이 없어. 그래도 괜찮아, 내일 다시 하면 돼.',
    }),
  'note.evening.focus': (v: N) =>
    P(v.p, {
      friend: `오늘 집중한 시간은 ${v.n}분이었어.`,
      polite: `오늘 집중하신 시간은 ${v.n}분이었어요.`,
      tsundere: `오늘 집중 시간은 ${v.n}분. 나쁘지 않네.`,
      calm: `오늘 ${v.n}분을 집중했어. 몰입한 만큼 쉬어도 좋아.`,
    }),
  'note.evening.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, ['푹 쉬고 내일 또 보자!', '오늘도 옆에 있어 줘서 고마워.', '잘 자, 좋은 꿈 꿔.']),
      polite: V(v.v, [
        '푹 쉬시고 내일 또 뵈어요.',
        '오늘도 곁에 있어 주셔서 감사해요.',
        '안녕히 주무세요. 좋은 꿈 꾸세요.',
      ]),
      tsundere: V(v.v, [
        '얼른 자. 내일 또 보자.',
        '오늘도... 같이 있었던 거, 나쁘지 않았어.',
        '잘 자. 꿈에서까지 일하지는 마.',
      ]),
      calm: V(v.v, [
        '푹 쉬고 내일 다시 만나자.',
        '오늘도 곁에 있어 줘서 고마워.',
        '잘 자. 오늘 하루도 충분했어.',
      ]),
    }),
};

export const en: Translation<typeof ko> = {
  'note.weekTitle': (v: { m: number; d: number }) => `Weekly letter, ${v.m}/${v.d}`,
  'note.eveningTitle': (v: { m: number; d: number }) => `Evening note, ${v.m}/${v.d}`,
  'note.bringWeek': (v: { p: string; name: string }) =>
    P(v.p, {
      friend: 'I wrote a letter looking back on last week! Click me to open it.',
      polite: 'I wrote a letter looking back on last week. Click me to open it.',
      tsundere: "I wrote down last week. Read it or don't. Just click me.",
      calm: 'I wrote a letter looking back on last week. Click me to open it.',
    }),
  'note.bringEvening': (v: { p: string; name: string }) =>
    P(v.p, {
      friend: 'I wrote a note looking back on today! Click me to open it.',
      polite: 'I wrote a note looking back on your day. Click me to open it.',
      tsundere: "I summed up your day. Read it or don't. Just click me.",
      calm: 'I wrote a note looking back on today. Click me to open it.',
    }),
  'note.focus': (v: N) =>
    P(v.p, {
      friend: `You focused for ${v.n} minutes yesterday. Amazing!`,
      polite: `You focused for ${v.n} minutes yesterday. Impressive!`,
      tsundere: `${v.n} minutes of focus yesterday. ...Fine, I'm impressed.`,
      calm: `You focused for ${v.n} minutes yesterday. That's deep work.`,
    }),
  'note.streak': (v: N) =>
    P(v.p, {
      friend: `${v.n} days in a row of finishing things. Keep it going today?`,
      polite: `${v.n} days in a row of finishing things. Would you like to keep it going today?`,
      tsundere: `${v.n} days in a row. It'd be a waste to break it now, so do it.`,
      calm: `Day ${v.n} of your streak. Consistency is building up.`,
    }),
  'note.ps': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        'P.S. Had any water today?',
        'P.S. Give your shoulders a stretch.',
        'P.S. A pat would be nice.',
        'P.S. This note stays in your mailbox.',
        "P.S. Don't forget to smile once today!",
        'P.S. Make sure you eat lunch.',
      ]),
      polite: V(v.v, [
        'P.S. Have you had some water today?',
        'P.S. Please stretch your shoulders once.',
        'P.S. A gentle pat would be appreciated.',
        'P.S. This note will stay in your mailbox.',
        'P.S. Please remember to smile once today.',
        'P.S. Please be sure to have lunch.',
      ]),
      tsundere: V(v.v, [
        "P.S. I'm not checking if you drank water. Drink.",
        "P.S. Straighten your shoulders. It's uncomfortable to look at.",
        'P.S. Petting me... is allowed.',
        "P.S. Don't throw this note away. It stays in the mailbox.",
        'P.S. Show me a smile once in a while.',
        "P.S. Skip lunch and you'll be scolded.",
      ]),
      calm: V(v.v, [
        "P.S. Don't forget a sip of water.",
        'P.S. Let your shoulders loosen a little.',
        'P.S. A pat puts the mind at ease.',
        'P.S. This note stays in your mailbox.',
        'P.S. One smile loosens tension.',
        "P.S. Let's make sure to have lunch.",
      ]),
    }),
  'note.week.open': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        "A new week! Let's start with last week.",
        'I wrote a letter looking back on last week.',
        'New week! I wrote down what you did last week.',
        'Weekly letter is here! You worked hard last week.',
      ]),
      polite: V(v.v, [
        'A new week has begun. Let me start with last week.',
        'I wrote a letter looking back on last week.',
        'A new week. I wrote down what you accomplished last week.',
        'Your weekly letter has arrived. You worked hard last week.',
      ]),
      tsundere: V(v.v, [
        "A new week. I'll tell you about last week. Listen or don't.",
        'Weekly letter. I sorted out last week. I had time.',
        'New week. I wrote down everything you did last week.',
        'Weekly letter. ...You did well last week.',
      ]),
      calm: V(v.v, [
        "A new week begins. Let's look back on last week calmly.",
        'I wrote a letter calmly looking back on last week.',
        'A new week. I wrote down what you got done last week.',
        'Your weekly letter has arrived. Good work last week.',
      ]),
    }),
  'note.week.done': (v: N) =>
    P(v.p, {
      friend: `You finished ${v.n} to-dos last week. Pretty solid week, right?`,
      polite: `You finished ${v.n} to-dos last week. It was a solid week.`,
      tsundere: `${v.n} done last week. ...Not bad.`,
      calm: `You finished ${v.n} to-dos last week. It all adds up.`,
    }),
  'note.week.doneNone': (v: Pv) =>
    P(v.p, {
      friend: 'Last week was a restful one. That matters too.',
      polite: 'Last week was a restful one. That matters too.',
      tsundere: 'You mostly rested last week. Well, do it this week.',
      calm: 'Last week was a restful one. Rest is part of the work.',
    }),
  'note.week.focus': (v: N) =>
    P(v.p, {
      friend: `You focused for ${v.n} minutes in total last week.`,
      polite: `You focused for ${v.n} minutes in total last week.`,
      tsundere: `${v.n} minutes of focus last week. Not that I was counting.`,
      calm: `You focused for ${v.n} minutes last week. Deep time adds up.`,
    }),
  'note.week.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        "Let's take it slow again this week!",
        "I'll be right here this week too. You got this!",
        'Want to pick one goal for this week?',
      ]),
      polite: V(v.v, [
        "Let's take it slowly again this week.",
        "I'll be by your side this week as well.",
        'Would you like to choose one goal for this week?',
      ]),
      tsundere: V(v.v, [
        "Give this week a try. I'll be watching.",
        "I'll stay by you this week too. I'm bored otherwise.",
        "Pick one goal for this week. I'm not ordering, just suggesting.",
      ]),
      calm: V(v.v, [
        "Let's go slowly together this week too.",
        "I'll be with you this week. Don't overdo it.",
        "Let's pick just one goal for this week.",
      ]),
    }),
  'note.evening.open': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        "You worked hard today. Here's your evening note.",
        'How was your day? I wrote a note looking back.',
        "It's evening. I wrote down what you did today.",
      ]),
      polite: V(v.v, [
        'You worked hard today. Here is your evening note.',
        'How was your day? I wrote a note looking back on it.',
        'It is evening. I wrote down what you did today.',
      ]),
      tsundere: V(v.v, [
        "The day's over. Evening note.",
        'I sorted out how today went. I was bored.',
        "It's evening. I saw everything you did today.",
      ]),
      calm: V(v.v, [
        'An evening note to wrap up the day.',
        "Let's look back on today calmly.",
        "It's evening. I wrote down what you did today.",
      ]),
    }),
  'note.evening.done': (v: N) =>
    P(v.p, {
      friend: `You finished ${v.n} to-dos today. Nice work!`,
      polite: `You finished ${v.n} to-dos today. Well done!`,
      tsundere: `${v.n} done today. ...Good job.`,
      calm: `You finished ${v.n} to-dos today. That's a full day.`,
    }),
  'note.evening.doneNone': (v: Pv) =>
    P(v.p, {
      friend: 'Nothing finished today. Still, getting through the day is enough.',
      polite: 'Nothing was finished today. Still, getting through the day is enough.',
      tsundere: 'Nothing finished today. Well, some days are like that.',
      calm: "Nothing finished today. That's okay. You can try again tomorrow.",
    }),
  'note.evening.focus': (v: N) =>
    P(v.p, {
      friend: `You focused for ${v.n} minutes today.`,
      polite: `You focused for ${v.n} minutes today.`,
      tsundere: `${v.n} minutes of focus today. Not bad.`,
      calm: `You focused for ${v.n} minutes today. You've earned some rest.`,
    }),
  'note.evening.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, [
        'Rest up and see you tomorrow!',
        'Thanks for being here today too.',
        'Good night. Sweet dreams.',
      ]),
      polite: V(v.v, [
        'Please rest well. See you tomorrow.',
        'Thank you for being here today as well.',
        'Good night. Sweet dreams.',
      ]),
      tsundere: V(v.v, [
        'Go to sleep. See you tomorrow.',
        "Being with you today... wasn't bad.",
        "Good night. Don't work in your dreams.",
      ]),
      calm: V(v.v, [
        "Rest well. Let's meet again tomorrow.",
        'Thank you for being here today too.',
        'Good night. Today was enough.',
      ]),
    }),
};
