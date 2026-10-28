import { createContext, useContext } from 'react';
import { getLang } from '../../shared/i18n/index.ts';

/** 지금 화면 언어. memo 로 감싼 줄은 props 가 같아도 언어가 바뀌면 다시 그려야 해서 이것을 읽는다 */
export const LanguageContext = createContext<'ko' | 'en'>(getLang());
export const useLanguage = (): 'ko' | 'en' => useContext(LanguageContext);
