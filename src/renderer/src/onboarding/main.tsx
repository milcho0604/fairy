import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './onboarding.css';
import { OnboardingApp } from './OnboardingApp.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <OnboardingApp />
  </StrictMode>,
);
