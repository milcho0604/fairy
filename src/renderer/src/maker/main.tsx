import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import './maker.css';
import { MakerApp } from './MakerApp.tsx';

initLang('common.title.maker');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <MakerApp />
  </StrictMode>,
);
