import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import './notice.css';
import { NoticeApp } from './NoticeApp.tsx';

initLang('notice.window');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <NoticeApp />
  </StrictMode>,
);
