import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import { App } from './App.tsx';
import '../theme.css';
import './chat.css';

initLang('common.title.chat');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
