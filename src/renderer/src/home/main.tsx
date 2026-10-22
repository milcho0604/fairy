import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import '../panel/panel.css';
import { PanelApp } from '../panel/PanelApp.tsx';
import './home.css';

initLang('common.title.home');
// 큰 창은 불투명 창이라 투명 바탕(panel.css)을 덮는다
document.documentElement.classList.add('home-win');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <PanelApp kind="home" />
  </StrictMode>,
);
