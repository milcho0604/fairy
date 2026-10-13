import { type FormEvent, useEffect, useRef, useState } from 'react';
import { guideModeOf, hasGuide } from '../../../shared/ai/install-guide.ts';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ChatState } from '../../../shared/chat-state.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { dotOf, isReady, statusText } from './providerStatus.ts';

interface Props {
  providers: ProviderView[];
  status: Partial<Record<AiProvider, AiStatus>>;
  checking: boolean;
  onRefresh: () => void;
  onAdd: (input: { label: string; bin: string; args: string }) => Promise<string | undefined>;
  onRemove: (id: AiProvider) => void;
  onClose: () => void;
  /** 못 찾은 AI 의 설치 방법 시트 열기 (#29) */
  onGuide: (id: AiProvider) => void;
  /** 무료 AI 모델 받기 (받는 중이면 진행) */
  onDownload: () => void;
  download?: ChatState['modelDownload'];
}

/** AI 관리: 깔린 AI 상태를 보고, 목록에 없는 CLI 를 직접 추가한다. */
export function AiManager({
  providers,
  status,
  checking,
  onRefresh,
  onAdd,
  onRemove,
  onClose,
  onGuide,
  onDownload,
  download,
}: Props) {
  const [label, setLabel] = useState('');
  const [bin, setBin] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  // 닫기는 부모가 그릴 때마다 새 함수라 ref 로 (효과가 다시 돌면 쓰던 칸의 포커스를 뺏는다)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 열리면 시트 안으로 포커스, Esc 로 닫기 (aria-modal 인데 둘 다 없었다)
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 위에 뜬 설치 방법 시트를 Esc 로 닫았으면(채팅 창이 먼저 받아 막는다) AI 관리는 그대로 둔다
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // 바로 쓸 수 있는 AI 가 하나도 없으면 무료 AI 를 맨 위에 "추천" 으로 (받기 단추와 같이). 깔린 AI 를 찾아 헤매지 않게
  const recommend = providers.every((p) => p.id === 'local' || !isReady(status[p.id]));
  const shown = recommend
    ? [...providers.filter((p) => p.id === 'local'), ...providers.filter((p) => p.id !== 'local')]
    : providers;

  return (
    <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={t('chat.manage')}>
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
        {shown.map((p) => {
          const s = status[p.id];
          const pick = recommend && p.id === 'local';
          return (
            <li key={p.id}>
              <span className={`dot ${dotOf(s)}`} aria-hidden="true" />
              <div className="ai-info">
                <span className="name">
                  {p.label}
                  {!p.verified && (
                    <span className="tag" title={t('chat.notVerifiedTitle')}>
                      {t('chat.notVerified')}
                    </span>
                  )}
                  {pick && <span className="tag pick">{t('chat.recommended')}</span>}
                  {p.images && <span className="tag">{t('chat.tagImages')}</span>}
                  {p.usage && <span className="tag">{t('chat.tagUsage')}</span>}
                </span>
                {p.command && <code className="detail command">{p.command}</code>}
                <span className="detail">{statusText(p, s)}</span>
                {guideModeOf(s) && hasGuide(p) && (
                  <span className="detail action-row">
                    <button type="button" className="ghost small" onClick={() => onGuide(p.id)}>
                      {guideModeOf(s) === 'login' ? t('ai.guide.showLogin') : t('ai.guide.show')}
                    </button>
                  </span>
                )}
                {p.id === 'local' && s?.needsModel && (
                  <span className="detail action-row">
                    {download && !download.failed ? (
                      <>
                        <progress max={100} value={download.pct} />
                        {t('ai.local.downloading', { pct: download.pct })}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={pick ? 'primary small' : 'ghost small'}
                          onClick={onDownload}
                        >
                          {t('chat.local.downloadNow')}
                        </button>
                        {download?.failed && (
                          <span className="download failed">
                            {download.message ?? t('ai.local.downloadFailed')}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                )}
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
