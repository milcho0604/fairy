declare module '*.css';
declare module '*?url' {
  const url: string;
  export default url;
}

interface Window {
  jjakkungMaker: import('../../../shared/ipc.ts').MakerBridge;
}
