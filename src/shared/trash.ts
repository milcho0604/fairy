export type TrashRecord =
  | {
      kind: 'todo';
      id: number;
      title: string;
      due: string | null;
      doneAt: number | null;
      deletedAt: number;
      daysLeft: number;
    }
  | {
      kind: 'note';
      id: number;
      title: string;
      preview: string;
      deletedAt: number;
      daysLeft: number;
    }
  | {
      kind: 'event';
      id: number;
      title: string;
      startAt: number;
      endAt: number | null;
      allDay: boolean;
      source: 'local' | 'ics' | 'google';
      deletedAt: number;
      daysLeft: number;
    };

export type TrashKind = TrashRecord['kind'];
