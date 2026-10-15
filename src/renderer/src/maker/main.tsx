import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import './maker.css';
import { MakerApp } from './MakerApp.tsx';
import { SpriteMakerApp } from './SpriteMakerApp.tsx';

initLang('common.title.maker');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
// 2D 그림 세트 만들기(#89)는 같은 창의 다른 화면이다. 무엇을 만드는 창인지 먼저 묻는다
void window.jjakkungMaker.info().then((info) => {
  createRoot(root).render(
    <StrictMode>{info?.target === 'sprites' ? <SpriteMakerApp /> : <MakerApp />}</StrictMode>,
  );
});
