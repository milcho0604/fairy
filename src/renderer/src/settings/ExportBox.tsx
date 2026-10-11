import { useState } from 'react';
import type { ExportKind } from '../../../shared/export.ts';
import { type I18nKey, t } from '../../../shared/i18n/index.ts';
import { Section } from './ui.tsx';

const exporter = window.jjakkungExport;

const ROWS: { kind: ExportKind; label: I18nKey }[] = [
  { kind: 'notes-md', label: 'export.notesMd' },
  { kind: 'notes-files', label: 'export.notesFiles' },
  { kind: 'todos-csv', label: 'export.todosCsv' },
  { kind: 'todos-md', label: 'export.todosMd' },
  { kind: 'events-ics', label: 'export.eventsIcs' },
];

/**
 * 설정 > 데이터 > 내보내기: 메모 마크다운(하나로, 메모마다), 할 일 CSV 와 체크리스트, 일정 .ics.
 * 저장 대화상자와 쓰기는 메인(main/day-tools.ts)이 한다. 화면은 무엇을 내보낼지만 보낸다
 */
export function ExportBox({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [busy, setBusy] = useState<ExportKind>();
  const run = async (kind: ExportKind) => {
    setBusy(kind);
    try {
      const r = await exporter.run(kind).catch(() => ({ ok: false as const, error: 'failed' as const }));
      if (!r) return;
      if (r.ok) flash(t('export.done', { n: r.n }));
      else flash(r.error === 'nothing' ? t('export.nothing') : t('export.failed'), r.error !== 'nothing');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Section title={t('export.title')}>
      <small>{t('export.hint')}</small>
      <div className="action-row">
        {ROWS.map((row) => (
          <button
            key={row.kind}
            type="button"
            className="ghost"
            disabled={busy !== undefined}
            aria-busy={busy === row.kind}
            onClick={() => run(row.kind)}
          >
            {t(row.label)}
          </button>
        ))}
      </div>
    </Section>
  );
}
