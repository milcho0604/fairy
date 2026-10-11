import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 다른 앱에서 부르기(jjakkung:// 주소), 배터리 절약, 접근성(읽어 주기, 키보드로 펫 다루기), 메뉴 막대 글자
export const ko = {
  'settings.shortcut.pet': '펫 고르기 (키보드로 펫 다루기)',
  'pet.shortcut.pet': '펫 고르기',
  'settings.integrations': '다른 앱에서 부르기',
  'settings.urlScheme': 'jjakkung:// 주소 받기',
  'settings.urlSchemeHint':
    '단축어, Raycast, Alfred, PowerToys에서 할 일, 메모를 넣고 집중을 시작해. 넣으면 펫이 말풍선으로 알려 줘.',
  'settings.urlSchemeExample': '예: jjakkung://add?text=내일 3시 회의',
  'settings.power': '배터리일 때 움직임 줄이기',
  'settings.saverAria': '배터리 절약 때',
  'settings.saver.auto': '켜기 (자동)',
  'settings.saver.always': '항상 줄이기',
  'settings.saver.off': '끄기',
  'settings.saverHint':
    '기본은 켜기(자동)야. 배터리나 저전력일 때 펫이 덜 걷고, 통통 튀는 움직임을 초당 15번까지만 그리고, 창 위에 앉은 걸 3초마다 봐. 펫 우클릭 메뉴에서도 끌 수 있어.',
  'settings.saverNow': '지금 움직임을 줄이는 중이야.',
  'settings.access': '접근성',
  'pet.menu.saver': '배터리일 때 움직임 줄이기',
  'pet.saver.told': '배터리라서 움직임을 조금 줄였어. 배터리가 오래 가게!',
  'pet.saver.keep': '그대로 움직이기',
  'pet.saver.ok': '좋아',
  'pet.saver.kept': '알았어, 그대로 움직일게. 설정의 편의나 우클릭 메뉴에서 다시 켤 수 있어.',
  'onboarding.tips.saver': '배터리일 때',
  'onboarding.tips.saverDesc': '움직임을 줄여. 우클릭 메뉴나 설정의 편의에서 끌 수 있어',
  'settings.readAloud': '말풍선 읽어 주기',
  'settings.readAloudHint': 'VoiceOver, 내레이터 같은 화면 읽기 프로그램이 펫 말을 읽어 줘.',
  'settings.trayTitle': '메뉴 막대에 다음 일정 보이기',
  'settings.trayTitleHint':
    '아이콘 옆에 다음 일정이나 집중 남은 시간이 보여. 일정 제목이 화면에 늘 보이니 필요할 때만 켜.',
  'settings.petKeysHint': (v: { keys: string }) =>
    `${v.keys}로 펫을 고르면 Enter는 패널, Shift+F10은 메뉴, 화살표는 걷기, Esc는 나가기야.`,
  'pet.url.todo': (v: { title: string }) => `할 일에 넣었어: ${v.title}`,
  'pet.url.todos': (v: { n: number }) => `할 일 ${v.n}개 넣었어`,
  'pet.url.event': (v: { title: string; when: string }) => `일정에 넣었어: ${v.when} ${v.title}`,
  'pet.url.memo': (v: { title: string }) => `메모에 적었어: ${v.title}`,
  'pet.url.focus': (v: { n: number }) => `${v.n}분 집중 시작!`,
  'pet.url.focusBusy': '이미 집중 중이야.',
  'pet.url.bad': '그 주소는 못 읽겠어. 예시는 설정의 편의에 있어.',
  'pet.url.tooLong': '글이 너무 길어. 조금 줄여서 다시 보내 줘.',
  'pet.url.off': '주소 받기가 꺼져 있어. 설정의 편의에서 켤 수 있어.',
  'pet.url.failed': (v: { error: string }) => `못 넣었어: ${v.error}`,
  'pet.keys.label': (v: { name: string }) =>
    `${v.name}. Enter는 패널, Shift+F10은 메뉴, 화살표는 걷기, Esc는 나가기`,
  'pet.keys.focused': (v: { name: string }) =>
    `${withParticle(v.name, '을')} 골랐어. Enter는 패널, Esc는 나가기.`,
  'tray.title.focus': (v: { min: number }) => `집중 ${v.min}분`,
  'tray.title.break': (v: { min: number }) => `쉬기 ${v.min}분`,
};

export const en: Translation<typeof ko> = {
  'settings.shortcut.pet': 'Select pet (keyboard control)',
  'pet.shortcut.pet': 'Select pet',
  'settings.integrations': 'Open from other apps',
  'settings.urlScheme': 'Accept jjakkung:// links',
  'settings.urlSchemeHint':
    'Add to-dos and memos or start focus from Shortcuts, Raycast, Alfred or PowerToys. Your pet confirms in a bubble.',
  'settings.urlSchemeExample': 'e.g. jjakkung://add?text=meeting tomorrow 3pm',
  'settings.power': 'Reduce motion on battery',
  'settings.saverAria': 'When to save battery',
  'settings.saver.auto': 'On (auto)',
  'settings.saver.always': 'Always reduce',
  'settings.saver.off': 'Off',
  'settings.saverHint':
    'On (auto) by default. On battery or low power your pet walks less, draws bouncy motion at most 15 frames a second and checks the window it sits on every 3 seconds. You can also turn it off from the pet right-click menu.',
  'settings.saverNow': 'Reducing motion now.',
  'settings.access': 'Accessibility',
  'pet.menu.saver': 'Reduce motion on battery',
  'pet.saver.told': "On battery, so I'm moving a little less to save power!",
  'pet.saver.keep': 'Keep moving',
  'pet.saver.ok': 'OK',
  'pet.saver.kept':
    "Got it, I'll keep moving. You can turn it back on in Settings, General or the right-click menu.",
  'onboarding.tips.saver': 'On battery',
  'onboarding.tips.saverDesc': 'I move less. Turn it off from the right-click menu or Settings, General',
  'settings.readAloud': 'Read bubbles aloud',
  'settings.readAloudHint': 'Screen readers like VoiceOver or Narrator read what your pet says.',
  'settings.trayTitle': 'Show next event in the menu bar',
  'settings.trayTitleHint':
    'Shows the next event or focus time left next to the icon. Event titles stay visible, so turn it on only if you want that.',
  'settings.petKeysHint': (v: { keys: string }) =>
    `Press ${v.keys} to select your pet, then Enter opens the panel, Shift+F10 the menu, arrows walk and Esc leaves.`,
  'pet.url.todo': (v: { title: string }) => `Added to-do: ${v.title}`,
  'pet.url.todos': (v: { n: number }) => `Added ${v.n} to-dos`,
  'pet.url.event': (v: { title: string; when: string }) => `Added event: ${v.when} ${v.title}`,
  'pet.url.memo': (v: { title: string }) => `Saved memo: ${v.title}`,
  'pet.url.focus': (v: { n: number }) => `${v.n}-minute focus started!`,
  'pet.url.focusBusy': 'Already focusing.',
  'pet.url.bad': "I can't read that link. Examples are in Settings, General.",
  'pet.url.tooLong': 'That text is too long. Please shorten it and send again.',
  'pet.url.off': 'Links are turned off. You can turn them on in Settings, General.',
  'pet.url.failed': (v: { error: string }) => `Couldn't add it: ${v.error}`,
  'pet.keys.label': (v: { name: string }) =>
    `${v.name}. Enter opens the panel, Shift+F10 the menu, arrows walk, Esc leaves`,
  'pet.keys.focused': (v: { name: string }) => `${v.name} selected. Enter opens the panel, Esc leaves.`,
  'tray.title.focus': (v: { min: number }) => `Focus ${v.min}m`,
  'tray.title.break': (v: { min: number }) => `Break ${v.min}m`,
};
