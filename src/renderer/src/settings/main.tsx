import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './settings.css';
import { SettingsApp } from './SettingsApp.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
