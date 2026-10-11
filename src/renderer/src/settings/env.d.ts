declare module '*.css';

interface Window {
  jjakkungSettings: import('../../../shared/ipc.ts').SettingsBridge;
  jjakkungExport: import('../../../shared/day-ipc.ts').ExportBridge;
}
