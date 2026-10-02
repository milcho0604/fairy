import { type FormEvent, useState } from 'react';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
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
    <div className="sheet" role="dialog" aria-modal="true" aria-label="AI 관리">
      <div className="sheet-head">
        <strong>AI 관리</strong>
        <button type="button" className="ghost" disabled={checking} onClick={onRefresh}>
          {checking ? '찾는 중' : '다시 찾기'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
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
                  {!p.verified && <span className="tag">확인 전</span>}
                  {p.images && <span className="tag">그림</span>}
                  {p.usage && <span className="tag">사용량</span>}
                </span>
                <span className="detail">{p.command ?? statusText(p, s)}</span>
              </div>
              {p.custom && (
                <button type="button" className="ghost small" onClick={() => onRemove(p.id)}>
                  빼기
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <form className="add-ai" onSubmit={submit}>
        <strong>직접 추가</strong>
        <p className="hint">
          터미널에서 질문 하나를 넣으면 답을 글로 내주는 AI 라면 무엇이든 돼. 인자의 {'{prompt}'} 자리에
          질문이 들어가. 예: 명령 <code>ollama</code>, 인자 <code>run llama3.2 {'{prompt}'}</code>
        </p>
        <label>
          이름
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: Llama" required />
        </label>
        <label>
          명령
          <input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="예: ollama" required />
        </label>
        <label>
          인자
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="예: run llama3.2 {prompt}"
          />
        </label>
        {error && <p className="notice">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>
          추가
        </button>
        <p className="hint">
          직접 추가한 AI 는 그림을 받지 않고, 대화를 이어 가도록 최근 대화 4개를 질문 앞에 붙여 보내. 셸을
          거치지 않아서 파이프나 변수는 못 써.
        </p>
      </form>
    </div>
  );
}
