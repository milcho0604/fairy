import { type FormEvent, useState } from 'react';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { dotOf, statusText } from './providerStatus.ts';

interface Props {
  providers: ProviderView[];
  status: Partial<Record<AiProvider, AiStatus>>;
  checking: boolean;
  onRefresh: () => void;
  onAdd: (input: { label: string; bin: string; args: string }) => Promise<string | undefined>;
  onRemove: (id: AiProvider) => void;
  onClose: () => void;
}

/** AI 관리: 깔린 AI 상태를 보고, 목록에 없는 CLI 를 직접 추가한다. */
export function AiManager({ providers, status, checking, onRefresh, onAdd, onRemove, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [bin, setBin] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const err = await onAdd({ label, bin, args });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setLabel('');
    setBin('');
    setArgs('');
    setError('');
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t('chat.manage')}>
      <div className="sheet-head">
        <strong>{t('chat.manage')}</strong>
        <button type="button" className="ghost" disabled={checking} onClick={onRefresh}>
          {checking ? t('chat.searching') : t('chat.searchAgain')}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          {t('chat.close')}
        </button>
      </div>

      <ul className="ai-list">
        {providers.map((p) => {
          const s = status[p.id];
          return (
            <li key={p.id}>
              <span className={`dot ${dotOf(s)}`} aria-hidden="true" />
              <div className="ai-info">
                <span className="name">
                  {p.label}
                  {!p.verified && <span className="tag">{t('chat.notVerified')}</span>}
                  {p.images && <span className="tag">{t('chat.tagImages')}</span>}
                  {p.usage && <span className="tag">{t('chat.tagUsage')}</span>}
                </span>
                {p.command && <code className="detail command">{p.command}</code>}
                <span className="detail">{statusText(p, s)}</span>
              </div>
              {p.custom && (
                <button type="button" className="ghost small" onClick={() => onRemove(p.id)}>
                  {t('chat.remove')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <form className="add-ai" onSubmit={submit}>
        <strong>{t('chat.addTitle')}</strong>
        <p className="hint">
          {t('chat.addHint', { prompt: '{prompt}' })}
          <code>ollama</code>
          {t('chat.addHintArgs')}
          <code>run llama3.2 {'{prompt}'}</code>
        </p>
        <label>
          {t('chat.name')}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('chat.namePlaceholder')}
            required
          />
        </label>
        <label>
          {t('chat.command')}
          <input
            value={bin}
            onChange={(e) => setBin(e.target.value)}
            placeholder={t('chat.commandPlaceholder')}
            required
          />
        </label>
        <label>
          {t('chat.args')}
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder={t('chat.argsPlaceholder')}
          />
        </label>
        {error && <p className="notice">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>
          {t('chat.add')}
        </button>
        <p className="hint">{t('chat.addFoot')}</p>
      </form>
    </div>
  );
}
