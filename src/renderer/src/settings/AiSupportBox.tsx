import { useCallback, useEffect, useState } from 'react';
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  type CapabilityId,
  type DetectRow,
  type DetectState,
  isUsable,
} from '../../../shared/ai/capability.ts';
import { t } from '../../../shared/i18n/index.ts';
import { bridge } from './ui.tsx';
import './support.css';

const stateText = (id: CapabilityId, state: DetectState): string =>
  id === 'local' && state === 'missing' ? t('support.ai.state.localMissing') : t(`support.ai.state.${state}`);

/**
 * AI 찾기와 능력표 (AI 탭, 이슈 #126). 이 컴퓨터에 깔린 AI 를 가볍게 확인(설치, 로그인)해 "찾았어 ✓"를 보이고,
 * AI 마다 페어리에서 되는 일(대화, 할 일 정리, 화면 보기, 페어리 도구, 비용)과 읽기 전용으로 묶였는지 보인다.
 */
export function AiSupportBox() {
  // undefined: 찾는 중
  const [rows, setRows] = useState<DetectRow[] | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    try {
      setRows(await bridge.aiDetect(refresh));
    } catch {
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load(false);
  }, [load]);

  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  return (
    <>
      <small>{t('support.ai.intro')}</small>
      <ul className="ai-caps" aria-busy={busy}>
        {CAPABILITY_IDS.map((id) => {
          const row = byId.get(id);
          const cap = CAPABILITIES[id];
          const state = row?.state;
          const chip = (on: boolean, label: string) => (
            <li key={label} className={on ? 'on' : 'off'}>
              {label} <span className="sr-or-text">{on ? t('support.ai.yes') : t('support.ai.no')}</span>
            </li>
          );
          return (
            <li key={id} className="ai-cap" data-ai={id} data-state={state ?? 'checking'}>
              <div className="ai-cap-head">
                <b>{t(`support.ai.name.${id}`)}</b>
                {!cap.verified && <i className="ai-unverified">{t('support.ai.unverified')}</i>}
                <span className={`ai-state ${state && isUsable(state) ? 'ok' : 'no'}`}>
                  {state ? stateText(id, state) : t('support.ai.checking')}
                </span>
              </div>
              <ul className="ai-chips">
                {chip(cap.chat, t('support.ai.col.chat'))}
                {chip(cap.todos, t('support.ai.col.todos'))}
                {chip(cap.vision, t('support.ai.col.vision'))}
                {chip(cap.mcp, t('support.ai.col.mcp'))}
                <li className="on">{t(`support.ai.cost.${cap.cost}`)}</li>
                <li className="on">
                  {t('support.ai.col.safe')} {t(`support.ai.safe.${cap.readOnly}`)}
                </li>
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="action-row">
        <button type="button" className="ghost" disabled={busy} onClick={() => void load(true)}>
          {busy ? t('support.ai.refreshing') : t('support.ai.refresh')}
        </button>
      </div>
      <small>{t('support.ai.legend')}</small>
      <small>{t('support.ai.readOnly')}</small>
      <small>{t('support.ai.myMcp')}</small>
      <small>{t('support.ai.custom')}</small>
    </>
  );
}
