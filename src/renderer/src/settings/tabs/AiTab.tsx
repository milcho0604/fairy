import { useEffect, useRef, useState } from 'react';
import { PERSONAS } from '../../../../shared/ai/persona.ts';
import { t } from '../../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../../shared/ipc.ts';
import { addMemory, approvePending, MEMORY_ITEM_MAX, MEMORY_MAX } from '../../../../shared/pet-memory.ts';
import { RULES_MAX, type Settings } from '../../../../shared/settings.ts';
import { Section, type TabProps, Toggle } from '../ui.tsx';

/** AI 탭: 대화(말투, 할 일 알기, 도구), 짝꿍 규칙, 기억, 모델, 다른 AI 에서 쓰기(MCP) */
export function AiTab({ snap, update, flash }: TabProps) {
  const s = snap.settings;
  return (
    <>
      <Section title={t('settings.ai')}>
        <div className="field">
          <span>{t('settings.persona')}</span>
          <fieldset className="segmented wrap" aria-label={t('settings.persona')}>
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={s.persona === p.id}
                className={s.persona === p.id ? 'on' : ''}
                onClick={() => update({ persona: p.id })}
              >
                {p.label}
              </button>
            ))}
          </fieldset>
          <small>
            {PERSONAS.find((p) => p.id === s.persona)?.hint} {t('settings.personaNext')}
          </small>
        </div>
        <Toggle
          label={t('settings.aiKnowsTodos')}
          hint={t('settings.aiKnowsTodosHint')}
          on={s.aiKnowsTodos}
          onChange={(v) => update({ aiKnowsTodos: v })}
        />
        <Toggle
          label={t('settings.aiPetTools')}
          hint={t('settings.aiPetToolsHint')}
          on={s.aiPetTools}
          onChange={(v) => update({ aiPetTools: v })}
        />
        <Toggle
          label={t('settings.diaryAi')}
          hint={t('settings.diaryAiHint')}
          on={s.diaryAi}
          onChange={(v) => update({ diaryAi: v })}
        />
        {/* 격리를 꺼야 내 MCP 도구를 쓸 수 있어 켜는 조건(격리)을 먼저 둔다 */}
        <Toggle
          label={t('settings.aiIsolation')}
          hint={t('settings.aiIsolationHint')}
          on={s.aiIsolation}
          onChange={(v) => update({ aiIsolation: v })}
        />
        <Toggle
          label={t('settings.myMcp')}
          hint={
            s.aiIsolation ? t('settings.myMcpOff') : t('settings.myMcpOn', { n: snap.myMcpServers.length })
          }
          on={s.myMcp}
          disabled={s.aiIsolation}
          onChange={(v) => update({ myMcp: v })}
        />
      </Section>

      <Section title={t('settings.rules')}>
        <RulesEditor
          value={s.petRules}
          onSave={(petRules) => update({ petRules }, t('settings.rules.saved'))}
        />
      </Section>

      <Section title={t('settings.memory')}>
        <MemoryEditor list={s.petMemory} onChange={(petMemory, message) => update({ petMemory }, message)} />
        {s.petMemoryPending.length > 0 && (
          <PendingMemory
            list={s.petMemory}
            pending={s.petMemoryPending}
            onChange={(patch, message, warn) => {
              if (warn) {
                flash(message, true);
                return;
              }
              void update(patch, message);
            }}
          />
        )}
      </Section>

      <Section title={t('settings.models')}>
        <ModelPicker
          snap={snap}
          onChange={(provider, id) => {
            const next = { ...s.aiModels };
            if (id) next[provider] = id;
            else delete next[provider];
            update({ aiModels: next });
          }}
        />
      </Section>
      <Section title={t('settings.mcpSection')}>
        <McpSetup
          exec={snap.mcp.exec}
          script={snap.mcp.script}
          onCopied={(ok) => flash(ok ? t('settings.copied') : t('settings.copyFailed'), !ok)}
        />
      </Section>
    </>
  );
}

/**
 * 펫 MCP 서버 등록 안내 (v1). Claude Code 나 Codex 에서 "짝꿍 할 일에 넣어 줘"가 되게 한다.
 * 짝꿍 실행 파일을 Node 로 돌리므로 따로 설치할 것이 없다.
 */
function McpSetup({
  exec,
  script,
  onCopied,
}: {
  exec: string;
  script: string;
  onCopied: (ok: boolean) => void;
}) {
  const q = (p: string) => `"${p.replace(/"/g, '\\"')}"`;
  const claude = `claude mcp add jjakkung -s user -e ELECTRON_RUN_AS_NODE=1 -- ${q(exec)} ${q(script)}`;
  const codex = [
    '[mcp_servers.jjakkung]',
    `command = ${JSON.stringify(exec)}`,
    `args = [${JSON.stringify(script)}]`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }',
  ].join('\n');
  // 클립보드 권한이 없거나 창이 앞에 있지 않으면 쓰기가 실패한다. 그때도 말 없이 끝나지 않게
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied(true);
    } catch (err) {
      console.warn('copy failed', err);
      onCopied(false);
    }
  };
  return (
    <>
      <small>{t('settings.mcp.intro')}</small>
      <div className="field">
        <span>{t('settings.mcp.claude')}</span>
        <pre className="cmd">{claude}</pre>
        <div className="action-row">
          <button type="button" className="ghost" onClick={() => copy(claude)}>
            {t('settings.mcp.copyCmd')}
          </button>
        </div>
      </div>
      <div className="field">
        <span>{t('settings.mcp.codex')}</span>
        <pre className="cmd">{codex}</pre>
        <div className="action-row">
          <button type="button" className="ghost" onClick={() => copy(codex)}>
            {t('settings.mcp.copyConfig')}
          </button>
        </div>
      </div>
      <small>{t('settings.mcp.moved')}</small>
    </>
  );
}

/**
 * AI 마다 모델 고르기 (v2). 목록(catalog)에 있는 것만. 별칭은 최신 자동, 정확한 이름은 버전 고정.
 * 무료 AI 는 받아 둔 모델인지와 크기, 라이선스를 같이 보여 준다.
 */
function ModelPicker({
  snap,
  onChange,
}: {
  snap: SettingsSnapshot;
  onChange: (provider: string, id: string) => void;
}) {
  const { catalog, localReady } = snap.models;
  const chosen = snap.settings.aiModels;
  const local =
    catalog.local.find((m) => m.id === chosen.local) ??
    catalog.local.find((m) => m.id === catalog.localDefault);
  const cliRows = Object.entries(catalog.cli).filter(([, list]) => list.length > 0);
  return (
    <>
      {cliRows.map(([provider, list]) => (
        <label key={provider} className="field model-row">
          <span>{provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider}</span>
          <select
            value={list.some((m) => m.id === chosen[provider]) ? chosen[provider] : ''}
            onChange={(e) => onChange(provider, e.target.value)}
          >
            <option value="">{t('settings.models.default')}</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.pinned
                  ? t('settings.models.pinned', { label: m.label })
                  : t('settings.models.latest', { label: m.label })}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="field model-row">
        <span>{t('settings.models.free')}</span>
        <select value={local?.id ?? ''} onChange={(e) => onChange('local', e.target.value)}>
          {catalog.local.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({Math.round(m.bytes / 1e6)}MB)
            </option>
          ))}
        </select>
      </label>
      {local && (
        <small className="below">
          {localReady[local.id]
            ? t('settings.models.freeReady', { mb: Math.round(local.bytes / 1e6), license: local.license })
            : t('settings.models.freeLater', { mb: Math.round(local.bytes / 1e6), license: local.license })}
        </small>
      )}
      <small className="below">{t('settings.models.hint')}</small>
    </>
  );
}

/** 짝꿍 규칙: 한 줄에 하나. 칸을 떠나면 저장 */
function RulesEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  // 칸에서 나가지 않고 창을 닫아도 쓴 규칙을 잃지 않게: 쓰다 멈추면 저장하고, 닫을 때도 저장한다.
  // 고치는 중에는 저장 응답(value)으로 칸을 덮지 않는다 (왕복 사이에 친 글자가 지워진다)
  const edited = useRef(false);
  const draft = useRef({ text, value, onSave });
  draft.current = { text, value, onSave };
  useEffect(() => {
    if (!edited.current) setText(value);
    else if (value === draft.current.text) edited.current = false;
  }, [value]);
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => draft.current.onSave(draft.current.text), 1500);
    return () => clearTimeout(timer);
  }, [text, value]);
  useEffect(() => {
    const flush = () => {
      const d = draft.current;
      if (edited.current && d.text !== d.value) d.onSave(d.text);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
  return (
    <label className="field">
      <span>{t('settings.rules.label')}</span>
      <textarea
        className="rules"
        rows={6}
        maxLength={RULES_MAX}
        placeholder={t('settings.rules.placeholder')}
        value={text}
        onChange={(e) => {
          edited.current = true;
          setText(e.target.value);
        }}
        onBlur={() => text !== value && onSave(text)}
      />
      <small>
        {t('settings.rules.hint')} ({text.length}/{RULES_MAX})
      </small>
    </label>
  );
}

/**
 * 짝꿍이 기억하는 것: 보고, 잊고, 더한다. 기본은 비어 있고 사용자가 넣은 것만 질문과 같이 간다.
 * 잊기는 한 번 더 눌러야 (친구 집에 보내기와 같다)
 */
function MemoryEditor({
  list,
  onChange,
}: {
  list: readonly string[];
  onChange: (next: string[], message: string) => void;
}) {
  const [text, setText] = useState('');
  const [sure, setSure] = useState(-1);
  const [dupe, setDupe] = useState(false);
  const add = () => {
    const next = addMemory(list, text);
    if (!next.added) {
      setDupe(text.trim() !== '');
      return;
    }
    onChange(next.list, t('settings.memory.added'));
    setText('');
  };
  return (
    <div className="field">
      <small>{t('settings.memory.hint', { max: MEMORY_MAX, len: MEMORY_ITEM_MAX })}</small>
      {list.length === 0 ? (
        <small className="below">{t('settings.memory.empty')}</small>
      ) : (
        <ul className="friends">
          {list.map((m, i) => (
            <li key={m}>
              <span>{m}</span>
              <button
                type="button"
                className={`link${sure === i ? ' sure' : ''}`}
                aria-label={t('settings.memory.deleteAria', { text: m })}
                onClick={() => {
                  if (sure !== i) {
                    setSure(i);
                    return;
                  }
                  setSure(-1);
                  onChange(
                    list.filter((_, j) => j !== i),
                    t('settings.memory.deleted'),
                  );
                }}
                onBlur={() => setSure(-1)}
              >
                {sure === i ? t('settings.memory.deleteSure') : t('settings.memory.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="friend-add">
        <input
          value={text}
          maxLength={MEMORY_ITEM_MAX}
          placeholder={t('settings.memory.placeholder')}
          aria-label={t('settings.memory')}
          onChange={(e) => {
            setText(e.target.value);
            setDupe(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
          }}
        />
        <button type="button" className="ghost" disabled={!text.trim()} onClick={add}>
          {t('settings.memory.add')}
        </button>
      </div>
      {dupe && (
        <small className="below warn" role="status">
          {t('settings.memory.dupe')}
        </small>
      )}
    </div>
  );
}

/**
 * AI 도구(MCP remember)가 기억하자고 한 것. 허락해야 기억이 된다 (리뷰 MED: 다른 글에 숨은 지시로
 * AI 가 기억을 넣으면 질문마다 그 글이 같이 갔다). 버리면 기다리는 데서만 지운다
 */
function PendingMemory({
  list,
  pending,
  onChange,
}: {
  list: readonly string[];
  pending: readonly string[];
  onChange: (patch: Partial<Settings>, message: string, warn?: boolean) => void;
}) {
  return (
    <div className="field">
      <span>{t('settings.memory.pending')}</span>
      <small>{t('settings.memory.pendingHint')}</small>
      <ul className="friends">
        {pending.map((m) => (
          <li key={m}>
            <span>{m}</span>
            <span>
              <button
                type="button"
                className="link"
                aria-label={t('settings.memory.approveAria', { text: m })}
                onClick={() => {
                  const r = approvePending(list, pending, m);
                  if (r.result === 'full') {
                    onChange({}, t('settings.memory.full', { max: MEMORY_MAX }), true);
                    return;
                  }
                  onChange(
                    { petMemory: r.list, petMemoryPending: r.pending },
                    r.result === 'added' ? t('settings.memory.added') : t('settings.memory.dupe'),
                  );
                }}
              >
                {t('settings.memory.approve')}
              </button>{' '}
              <button
                type="button"
                className="link"
                aria-label={t('settings.memory.dismissAria', { text: m })}
                onClick={() =>
                  onChange(
                    { petMemoryPending: pending.filter((p) => p !== m) },
                    t('settings.memory.dismissed'),
                  )
                }
              >
                {t('settings.memory.dismiss')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
