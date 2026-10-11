import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaId } from '../../../../shared/ai/persona.ts';
import { briefingText } from '../../../../shared/briefing.ts';
import { t } from '../../../../shared/i18n/index.ts';
import { setSpeechSource, setVoiceSource, voiced } from '../../../../shared/persona-voice.ts';
import {
  CALL_MAX,
  type CallKind,
  DEFAULT_STYLE,
  ENDING_CHIPS,
  ENDING_MAX,
  LINE_MAX,
  LINES_MAX,
  MOMENTS,
  type Moment,
  parseStyle,
  type SpeechStyle,
} from '../../../../shared/speech-style.ts';

// 내 말투 만들기 (2026-10-11, shared/speech-style.ts): 말 높이, 말끝, 부르는 말, 이모지, 느낌표, 때마다 직접 쓴 말.
// 고르면 바로 저장하고 글 칸은 잠깐 멈추면 저장한다. 미리 보기는 이 창 안에서 같은 규칙으로 바로 만든다

/** 미리 보기 말풍선 (말투 프리셋도 같이 본다) */
export function SpeechPreview({
  persona,
  style,
  petName,
}: {
  persona: PersonaId;
  style: SpeechStyle;
  petName: string;
}) {
  const lines = useMemo(() => {
    // 이 창 안의 말 고르기만 바꾼다 (펫 말풍선은 메인이 만든다)
    setVoiceSource(() => persona);
    setSpeechSource({ style: () => style, petName: () => petName, todo: () => t('speech.preview.todo') });
    const todo = t('speech.preview.todo');
    return [
      briefingText({
        events: [{ minute: 10 * 60, title: t('speech.preview.event') }],
        dueToday: 1,
        overdue: 0,
        nowMinute: 8 * 60 + 30,
        next: todo,
      }),
      voiced('companion.cheer.count', { name: petName, n: 3 }),
      voiced('pet.rest.1'),
      voiced('idle.late.2', { name: petName }),
    ];
  }, [persona, style, petName]);
  return (
    <div className="speech-preview" aria-live="polite">
      <span>{t('speech.preview')}</span>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 미리 보기 줄 자리가 정해져 있다
        <p key={i} className="speech-bubble">
          {line}
        </p>
      ))}
    </div>
  );
}

const CALLS: CallKind[] = ['none', 'butler', 'master', 'name', 'custom'];

export function SpeechEditor({
  value,
  petName,
  onSave,
}: {
  value: SpeechStyle;
  petName: string;
  onSave: (next: SpeechStyle) => void;
}) {
  const [draft, setDraft] = useState<SpeechStyle>(value);
  // 다른 곳(백업 가져오기 등)에서 바뀌면 따라간다. 글을 쓰는 중이면 그대로
  const typing = useRef(false);
  // 저장된 값이 바뀔 때만 본다 (쓰는 중인 칸은 그대로)
  useEffect(() => {
    if (!typing.current)
      setDraft((d) => (JSON.stringify(parseStyle(d)) === JSON.stringify(value) ? d : value));
  }, [value]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commit = (next: SpeechStyle, later = false) => {
    const clean = parseStyle(next);
    setDraft(next);
    clearTimeout(timer.current);
    if (!later) {
      typing.current = false;
      onSave(clean);
      return;
    }
    typing.current = true;
    timer.current = setTimeout(() => {
      typing.current = false;
      onSave(clean);
    }, 500);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const preview = useMemo(() => parseStyle(draft), [draft]);
  const customEnding = draft.ending !== '' && !(ENDING_CHIPS as readonly string[]).includes(draft.ending);
  const seg = <T extends string>(
    label: string,
    list: readonly T[],
    on: T,
    set: (v: T) => void,
    key: string,
  ) => (
    <div className="field">
      <span>{label}</span>
      {/* 세 칸은 한 줄로 (wrap 이면 2 + 1 로 꺾였다) */}
      <fieldset className="segmented" aria-label={label}>
        {list.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={on === v}
            className={on === v ? 'on' : ''}
            onClick={() => set(v)}
          >
            {t(`${key}.${v}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </fieldset>
    </div>
  );
  return (
    <div className="speech-editor">
      <strong>{t('speech.title')}</strong>
      <small>{t('speech.lead')}</small>
      {seg(
        t('speech.level'),
        ['banmal', 'haeyo', 'hapsyo'] as const,
        draft.level === 'hao' ? 'hapsyo' : draft.level,
        (level) => commit({ ...draft, level }),
        'speech.level',
      )}
      <div className="field">
        <span>{t('speech.ending')}</span>
        <div className="speech-chips">
          <button
            type="button"
            aria-pressed={draft.ending === ''}
            className={draft.ending === '' ? 'on' : ''}
            onClick={() => commit({ ...draft, ending: '' })}
          >
            {t('speech.ending.none')}
          </button>
          {ENDING_CHIPS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={draft.ending === e}
              className={draft.ending === e ? 'on' : ''}
              onClick={() => commit({ ...draft, ending: e })}
            >
              …{e}
            </button>
          ))}
          <input
            className={customEnding ? 'on' : ''}
            aria-label={t('speech.ending.custom')}
            placeholder={t('speech.ending.custom')}
            maxLength={ENDING_MAX}
            value={customEnding ? draft.ending : ''}
            onChange={(e) => commit({ ...draft, ending: e.target.value.slice(0, ENDING_MAX) }, true)}
          />
        </div>
        <small>{t('speech.ending.hint')}</small>
      </div>
      <div className="field">
        <span>{t('speech.call')}</span>
        <fieldset className="segmented wrap" aria-label={t('speech.call')}>
          {CALLS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={draft.call === c}
              className={draft.call === c ? 'on' : ''}
              onClick={() => commit({ ...draft, call: c })}
            >
              {t(`speech.call.${c}`)}
            </button>
          ))}
        </fieldset>
        {(draft.call === 'name' || draft.call === 'custom') && (
          <input
            aria-label={t(`speech.call.${draft.call}`)}
            placeholder={t('speech.call.placeholder')}
            maxLength={CALL_MAX}
            value={draft.callText}
            onChange={(e) => commit({ ...draft, callText: e.target.value }, true)}
          />
        )}
      </div>
      {seg(
        t('speech.emoji'),
        ['many', 'some', 'none'] as const,
        draft.emoji,
        (emoji) => commit({ ...draft, emoji }),
        'speech.emoji',
      )}
      {seg(
        t('speech.bang'),
        ['soft', 'normal', 'strong'] as const,
        draft.bang,
        (bang) => commit({ ...draft, bang }),
        'speech.bang',
      )}
      <div className="field">
        <span>{t('speech.lines')}</span>
        <small>{t('speech.lines.hint')}</small>
        {MOMENTS.map((m: Moment) => (
          <label key={m} className="speech-lines">
            <span>{t(`speech.moment.${m}`)}</span>
            <textarea
              rows={2}
              maxLength={(LINE_MAX + 1) * LINES_MAX}
              value={draft.lines[m].join('\n')}
              onChange={(e) =>
                commit(
                  {
                    ...draft,
                    lines: { ...draft.lines, [m]: e.target.value.split('\n').slice(0, LINES_MAX) },
                  },
                  true,
                )
              }
            />
          </label>
        ))}
      </div>
      <SpeechPreview persona="custom" style={preview} petName={petName} />
      <button type="button" className="link" onClick={() => commit(DEFAULT_STYLE)}>
        {t('speech.reset')}
      </button>
    </div>
  );
}
