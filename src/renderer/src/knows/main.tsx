import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import '../rows.css';
import '../settings/settings.css';
import './knows.css';
import { KnowsApp } from './KnowsApp.tsx';

initLang();
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <KnowsApp />
  </StrictMode>,
);
