import { app } from 'electron';
import { getLang, resolveLang, setLang, t } from '../shared/i18n/index.ts';
import { settings } from './settings.ts';

// 화면 말 (v2 다국어). 시작할 때 한 번 정하고, 창은 열릴 때 실행 인자로 받는다.
// 설정에서 바꾸면 이미 그린 메뉴와 창은 그대로라 다시 켠다.

/** 설정과 운영체제 말로 정한다. 메뉴, 메뉴 막대를 만들기 전에 부른다 */
export function initLang(): void {
  setLang(resolveLang(settings.get().lang, app.getPreferredSystemLanguages()));
  // 처음 켰으면 기본 펫 이름도 이 말로 (저장된 이름은 그대로)
  settings.nameIfNew(t('common.defaultPetName'));
}

/** 설정에서 바꾼 언어를 메인 프로세스의 다음 안내와 메뉴 구성에도 반영한다. */
export function refreshLang(): ReturnType<typeof getLang> {
  setLang(resolveLang(settings.get().lang, app.getPreferredSystemLanguages()));
  return getLang();
}

/** 창에 넘길 실행 인자. preload 가 읽어 화면에 알린다 */
export const langArg = (): string => `--jj-lang=${getLang()}`;
