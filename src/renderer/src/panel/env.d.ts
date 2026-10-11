declare module '*.css';

interface Window {
  jjakkungPanel: import('../../../shared/ipc.ts').PanelBridge;
  jjakkungDay: import('../../../shared/day-ipc.ts').DayBridge;
}
