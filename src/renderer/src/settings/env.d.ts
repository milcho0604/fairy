declare module '*.css';

interface Window {
  jjakkungSettings: import('../../../shared/ipc.ts').SettingsBridge;
  jjakkungHub: import('../../../shared/ipc.ts').HubBridge;
  jjakkungExport: import('../../../shared/day-ipc.ts').ExportBridge;
  jjakkungLines: import('../../../shared/lines-ipc.ts').LinesBridge;
}
