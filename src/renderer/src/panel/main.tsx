import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import './panel.css';
import { PanelApp } from './PanelApp.tsx';

initLang('common.title.panel');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
