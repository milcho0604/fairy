declare module '*.css';

interface Window {
  jjakkungPanel: import('../../../shared/ipc.ts').PanelBridge;
  jjakkungDay: import('../../../shared/day-ipc.ts').DayBridge;
  jjakkungNotes: import('../../../shared/note-ipc.ts').NoteBridge;
  /** 큰 창에만 있다 (읽기만) */
  jjakkungFriendsView?: import('../../../shared/server-friends.ts').FriendsViewBridge;
}
