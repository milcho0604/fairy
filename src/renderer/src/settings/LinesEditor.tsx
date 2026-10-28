// 펫 대사 고치기 (#125, 설정 창 안 시트). 말풍선 정해진 말을 상황별로 묶어 보여 주고 한 칸씩 고친다.
// 글 칸을 벗어나면(또는 Cmd/Ctrl+Enter) 그 칸만 저장하고, 기본과 같아지면 고친 칸이 지워진다. "기본값으로"는 그 칸만 되돌린다.
// 검사(값 {name} 보존 등)는 메인이 하고 거절 까닭을 그 칸 아래에 보인다 (shared/line-template.ts)
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getLang, t } from '../../../shared/i18n/index.ts';
import { LINE_TEXT_MAX, renderTemplate } from '../../../shared/line-template.ts';
import type { LineGroupId, LineLang } from '../../../shared/lines.ts';
import type { LineSaveResult, LinesState, LineView } from '../../../shared/lines-ipc.ts';

import { isEsc, takeEsc } from '../panel/keys.ts';

const lines = () => window.jjakkungLines;

/** 틀 미리 보기: 펫 이름은 지금 이름으로, 그 밖의 값은 예시 숫자 3 */
function previewOf(text: string, vars: readonly string[], petName: string): string {
  const sample: Record<string, string> = {};
  for (const v of vars) sample[v] = v === 'name' ? petName : v === 'food' || v === 'title' ? '…' : '3';
  return renderTemplate(text, sample);
}

function errorText(r: Extract<LineSaveResult, { ok: false }>): string {
  const vars = (r.vars ?? []).map((v) => `{${v}}`).join(', ');
  switch (r.reason) {
    case 'empty':
      return t('records.lines.err.empty');
    case 'long':
      return t('records.lines.err.long', { max: LINE_TEXT_MAX });
    case 'brace':
      return t('records.lines.err.brace');
    case 'particle':
      return t('records.lines.err.particle');
    case 'missing':
      return t('records.lines.err.missing', { vars });
    case 'unknown':
      return t('records.lines.err.unknown', { vars });
    default:
      return t('records.lines.err.nokey');
  }
}

export function LinesEditor({ onClose, onMsg }: { onClose: () => void; onMsg: (m: string) => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [lang, setLang] = useState<LineLang>(getLang());
  const [state, setState] = useState<LinesState>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async (next: LineLang) => {
    const v = await lines().state(next);
    if (v) setState(v);
  }, []);
  useEffect(() => {
    sheetRef.current?.focus();
    setDrafts({});
    setErrors({});
    void load(lang);
  }, [lang, load]);
  useEffect(() => {
    // 창 전체 Esc(설정 창 닫기)보다 먼저 받아 먹는다: 시트만 닫는다. 쓰던 칸은 벗어나게 해(blur) 저장하고 닫는다
    const onKey = (e: KeyboardEvent) => {
      if (!isEsc(e)) return;
      takeEsc(e);
      (document.activeElement as HTMLElement | null)?.blur();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const save = async (line: LineView) => {
    const draft = drafts[line.key];
    if (draft === undefined || draft === line.text) return;
    const r = await lines().save(lang, line.key, draft);
    if (!r) return;
    if (r.ok) {
      setState(r.state);
      setDrafts(({ [line.key]: _gone, ...rest }) => rest);
      setErrors(({ [line.key]: _gone, ...rest }) => rest);
      onMsg(t('records.lines.saved'));
    } else setErrors((e) => ({ ...e, [line.key]: errorText(r) }));
  };
  const mute = async (line: LineView, on: boolean) => {
    const v = await lines().mute(lang, line.key, on);
    if (v) setState(v);
  };
  const reset = async (key?: string) => {
    const v = await lines().reset(lang, key);
    if (!v) return;
    setState(v);
    if (key === undefined) {
      setDrafts({});
      setErrors({});
    } else {
      setDrafts(({ [key]: _gone, ...rest }) => rest);
      setErrors(({ [key]: _gone, ...rest }) => rest);
    }
    setConfirmAll(false);
    onMsg(t('records.lines.resetDone'));
  };

  const q = query.trim().toLowerCase();
  const matches = (l: LineView) =>
    !q ||
    l.text.toLowerCase().includes(q) ||
    l.base.toLowerCase().includes(q) ||
    l.key.toLowerCase().includes(q);

  return (
    // 바탕을 누르면 닫는다 (키보드는 Esc, 닫기 단추)
    // biome-ignore lint/a11y/noStaticElementInteractions: 바탕 누르기는 보조 수단
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 와 닫기 단추가 있다
    <div
      className="gcal-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="gcal-sheet lines-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="gcal-sheet-head">
          <strong id={titleId}>{t('records.lines.title')}</strong>
          <button type="button" className="link" onClick={onClose}>
            {t('records.lines.close')}
          </button>
        </div>
        <div className="gcal-sheet-body">
          <small>{t('records.lines.hint')}</small>
          <small>{t('records.lines.persona')}</small>
          <small className="lines-help">
            {/* {name:은} 같은 값 자리는 좁은 창에서도 중간에 끊기지 않게 한 덩어리로 */}
            {t('records.lines.varsHelp')
              .split(/(\{[^}]+\})/)
              .map((part, i) =>
                part.startsWith('{') ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 글 조각 자리가 정해져 있다
                  <span key={i} className="lines-token">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
          </small>
          <div className="lines-bar">
            <fieldset className="segmented" aria-label={t('records.lines.lang')}>
              {(['ko', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  className={lang === l ? 'on' : ''}
                  onClick={() => setLang(l)}
                >
                  {l === 'ko' ? '한국어' : 'English'}
                </button>
              ))}
            </fieldset>
            <input
              className="lines-find"
              value={query}
              aria-label={t('records.lines.find')}
              placeholder={t('records.lines.find')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {state && (
            <div className="lines-count">
              <small>{t('records.lines.count', { n: state.edited })}</small>
              {state.mutedCount > 0 && (
                <small title={t('records.lines.muteHint')}>
                  {t('records.lines.mutedCount', { n: state.mutedCount })}
                </small>
              )}
              {state.edited > 0 &&
                (confirmAll ? (
                  <span className="lines-confirm" role="alertdialog" aria-label={t('records.lines.resetAll')}>
                    <small>{t('records.lines.resetAllConfirm', { n: state.edited })}</small>
                    <button type="button" className="link" onClick={() => void reset()}>
                      {t('records.lines.resetAllYes')}
                    </button>
                    <button type="button" className="link" onClick={() => setConfirmAll(false)}>
                      {t('records.lines.resetAllNo')}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="link" onClick={() => setConfirmAll(true)}>
                    {t('records.lines.resetAll')}
                  </button>
                ))}
            </div>
          )}
          {state?.groups.map((g) => {
            const shown = g.lines.filter(matches);
            if (shown.length === 0) return null;
            const edited = g.lines.filter((l) => l.edited).length;
            return (
              <details key={g.id} className="lines-group" open={!!q} data-group={g.id}>
                <summary>
                  {t(`records.lines.group.${g.id satisfies LineGroupId}`)}
                  <small>
                    {shown.length}
                    {edited > 0 ? `, ${t('records.lines.count', { n: edited })}` : ''}
                  </small>
                </summary>
                {shown.map((l) => {
                  const value = drafts[l.key] ?? l.text;
                  const err = errors[l.key];
                  return (
                    <div
                      key={l.key}
                      className={`lines-row${l.edited ? ' edited' : ''}${l.muted ? ' muted' : ''}`}
                      data-key={l.key}
                    >
                      <textarea
                        rows={2}
                        value={value}
                        maxLength={LINE_TEXT_MAX + 40}
                        aria-label={t('records.lines.inputOf', { key: l.key })}
                        aria-invalid={!!err}
                        onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))}
                        onBlur={() => void save(l)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void save(l);
                          }
                        }}
                      />
                      {err && (
                        <small className="lines-error" role="alert">
                          {err}
                        </small>
                      )}
                      <small className="lines-preview">
                        {t('records.lines.preview')}: {previewOf(value, l.vars, state.petName)}
                      </small>
                      {l.vars.length > 0 && (
                        <small className="lines-vars">
                          {t('records.lines.vars', { vars: l.vars.map((v) => `{${v}}`).join(', ') })}
                        </small>
                      )}
                      <button
                        type="button"
                        className="link lines-mute"
                        aria-pressed={l.muted}
                        aria-label={t(l.muted ? 'records.lines.unmuteOf' : 'records.lines.muteOf', {
                          line: l.base,
                        })}
                        onClick={() => void mute(l, !l.muted)}
                      >
                        {t(l.muted ? 'records.lines.unmute' : 'records.lines.mute')}
                      </button>
                      {l.edited && (
                        <span className="lines-edited">
                          <small>
                            <b>{t('records.lines.edited')}</b> {t('records.lines.default')}: {l.base}
                          </small>
                          <button
                            type="button"
                            className="link"
                            aria-label={t('records.lines.resetOf', { line: l.base })}
                            onClick={() => void reset(l.key)}
                          >
                            {t('records.lines.reset')}
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </details>
            );
          })}
          {state && q && state.groups.every((g) => g.lines.filter(matches).length === 0) && (
            <small>{t('records.lines.none')}</small>
          )}
        </div>
      </div>
    </div>
  );
}
