import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from '../lang.ts';
import '../theme.css';
import './onboarding.css';
import { OnboardingApp } from './OnboardingApp.tsx';

initLang('common.title.onboarding');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <OnboardingApp />
  </StrictMode>,
);
