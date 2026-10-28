import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaId } from '../../../../shared/ai/persona.ts';
import { briefingText } from '../../../../shared/briefing.ts';
import { composeNote } from '../../../../shared/daily-note.ts';
import { getLang, type I18nKey, t } from '../../../../shared/i18n/index.ts';
import { setSpeechSource, setVoiceSource, styled, voiced } from '../../../../shared/persona-voice.ts';
import {
  CALL_MAX,
  type CallKind,
  DEFAULT_STYLE,
  ENDING_CHIPS,
  ENDING_MAX,
  ENDINGS_MAX,
  LINE_MAX,
  LINES_MAX,
  MOMENTS,
  type Moment,
  parseStyle,
  RATES,
  SELF_MAX,
  type SpeechStyle,
} from '../../../../shared/speech-style.ts';
import { variantsOf } from '../../../../shared/variants.ts';
import { laterSave } from '../later-save.ts';

// 내 말투 만들기 (2026-10-11, shared/speech-style.ts): 말 높이, 말끝, 부르는 말, 이모지, 느낌표, 때마다 직접 쓴 말.
// 고르면 바로 저장하고 글 칸은 잠깐 멈추면 저장한다. 미리 보기는 이 창 안에서 같은 규칙으로 바로 만든다

/** 미리 보기로 들어 볼 때 */
const SITUATIONS = ['mix', 'morning', 'praise', 'rest', 'event', 'note'] as const;
type Situation = (typeof SITUATIONS)[number];

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

/** base 의 변형 가운데 round 번째부터 n 개 (돌려 가며) */
function variantKeys(base: string, round: number, n: number): I18nKey[] {
  const list = variantsOf(base);
  if (list.length === 0) return [];
  return Array.from(
    { length: Math.min(n, list.length) },
    (_, i) => list[(round + i) % list.length] as I18nKey,
  );
}

/** 미리 보기 말풍선들 (같은 규칙으로 이 창 안에서 바로 만든다). round 를 올리면 다른 변형이 나온다 */
function previewLines(
  sit: Situation,
  round: number,
  persona: PersonaId,
  style: SpeechStyle,
  petName: string,
): string[] {
  const todo = t('speech.preview.todo');
  const nm = { name: petName };
  const brief = (hour: number) =>
    briefingText({
      events: [{ minute: 10 * 60, title: t('speech.preview.event') }],
      dueToday: 1,
      overdue: 0,
      nowMinute: hour * 60,
      next: todo,
    });
  const say = (key: I18nKey, vars: Record<string, string | number> = nm) => voiced(key, vars);
  switch (sit) {
    case 'morning':
      return [brief(8.5), ...variantKeys('idle.morning', round, 3).map((k) => say(k))];
    case 'praise':
      return [
        ...variantKeys('companion.cheer.count', round, 1).map((k) => say(k, { ...nm, n: 3 })),
        ...variantKeys('companion.cheer.clear', round, 1).map((k) => say(k, { ...nm, n: 3 })),
        ...variantKeys('idle.praise.3', round, 2).map((k) => say(k, { ...nm, done: 3 })),
      ];
    case 'rest':
      return variantKeys('pet.rest', round, 4).map((k) => say(k));
    case 'event':
      return [
        brief(9),
        ...variantKeys('idle.event.soon', round, 3).map((k) => say(k, { ...nm, eventMin: 30 })),
      ];
    case 'note': {
      const day = '2026-10-28';
      const sample = (n: number) =>
        composeNote(
          {
            day,
            persona,
            petName,
            yesterdayDone: 3,
            firstEvent: { time: '10:00', title: t('speech.preview.event') },
            facts: [],
          },
          () => ((n * 0.37) % 1) as number,
        );
      const lines = sample(round + 1).lines.map((l) => styled(looseT(l.key, l.vars), persona, style));
      return [lines.join(' ')];
    }
    default:
      return [
        brief(8.5),
        ...variantKeys('companion.cheer.count', round, 1).map((k) => say(k, { ...nm, n: 3 })),
        ...variantKeys('pet.rest', round, 1).map((k) => say(k)),
        ...variantKeys('idle.late', round, 1).map((k) => say(k)),
      ];
  }
}

/** 미리 보기 말풍선 (말투 프리셋도 같이 본다). 어떤 말인지 고르고 "다른 말로"로 다른 변형을 들어 본다 */
export function SpeechPreview({
  persona,
  style,
  petName,
}: {
  persona: PersonaId;
  style: SpeechStyle;
  petName: string;
}) {
  const [sit, setSit] = useState<Situation>('mix');
  const [round, setRound] = useState(0);
  const lines = useMemo(() => {
    // 이 창 안의 말 고르기만 바꾼다 (펫 말풍선은 메인이 만든다)
    setVoiceSource(() => persona);
    setSpeechSource({ style: () => style, petName: () => petName, todo: () => t('speech.preview.todo') });
    return previewLines(sit, round, persona, style, petName);
  }, [persona, style, petName, sit, round]);
  return (
    <div className="speech-preview" aria-live="polite">
      <span>{t('speech.preview')}</span>
      <div className="speech-preview-bar">
        <select
          aria-label={t('speech.preview.pick')}
          value={sit}
          onChange={(e) => {
            setSit(e.target.value as Situation);
            setRound(0);
          }}
        >
          {SITUATIONS.map((v) => (
            <option key={v} value={v}>
              {t(`speech.sit.${v}`)}
            </option>
          ))}
        </select>
        <button type="button" className="link" onClick={() => setRound((r) => r + 1)}>
          {t('speech.preview.next')}
        </button>
      </div>
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
  // 글 칸은 잠깐 멈추면 저장. 그사이 창을 닫거나(beforeunload) 칸이 사라지면 버리지 않고 바로 저장한다
  // (예전에는 타이머만 지워 0.5초 안에 닫으면 쓴 말끝, 부르는 말을 잃었다)
  const save = useRef(onSave);
  save.current = onSave;
  const saver = useRef(
    laterSave((v: SpeechStyle) => {
      typing.current = false;
      save.current(v);
    }, 500),
  );
  const commit = (next: SpeechStyle, later = false) => {
    const clean = parseStyle(next);
    setDraft(next);
    if (!later) {
      typing.current = false;
      saver.current.now(clean);
      return;
    }
    typing.current = true;
    saver.current.later(clean);
  };
  useEffect(() => {
    const s = saver.current;
    const flush = () => s.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      s.flush();
    };
  }, []);
  const preview = useMemo(() => parseStyle(draft), [draft]);
  const endings = draft.endings.length > 0 ? draft.endings : draft.ending ? [draft.ending] : [];
  const chipEnding = (e: string) => (ENDING_CHIPS as readonly string[]).includes(e);
  const customEnding = endings.find((e) => !chipEnding(e)) ?? '';
  /** 말끝 목록을 바꾼다 (첫째가 ending 이다) */
  const withEndings = (list: string[]): SpeechStyle => {
    const next = list.slice(0, ENDINGS_MAX);
    return { ...draft, endings: next, ending: next[0] ?? '' };
  };
  const toggleEnding = (e: string) =>
    commit(withEndings(endings.includes(e) ? endings.filter((x) => x !== e) : [...endings, e]));
  const anyLines = MOMENTS.some((m) => draft.lines[m].length > 0);
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
            aria-pressed={endings.length === 0}
            className={endings.length === 0 ? 'on' : ''}
            onClick={() => commit(withEndings([]))}
          >
            {t('speech.ending.none')}
          </button>
          {ENDING_CHIPS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={endings.includes(e)}
              className={endings.includes(e) ? 'on' : ''}
              onClick={() => toggleEnding(e)}
            >
              …{e}
            </button>
          ))}
          <input
            className={customEnding ? 'on' : ''}
            aria-label={t('speech.ending.custom')}
            placeholder={t('speech.ending.custom')}
            maxLength={ENDING_MAX}
            value={customEnding}
            onChange={(e) => {
              const v = e.target.value.slice(0, ENDING_MAX);
              const kept = endings.filter((x) => chipEnding(x));
              commit(withEndings(v ? [...kept, v] : kept), true);
            }}
          />
        </div>
        <small>{t('speech.ending.hint')}</small>
        <small>{t('speech.endings.hint')}</small>
      </div>
      {endings.length > 0 &&
        seg(
          t('speech.endingRate'),
          RATES,
          draft.endingRate,
          (endingRate) => commit({ ...draft, endingRate }),
          'speech.rate',
        )}
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
      {draft.call !== 'none' &&
        seg(
          t('speech.callRate'),
          RATES,
          draft.callRate,
          (callRate) => commit({ ...draft, callRate }),
          'speech.rate',
        )}
      {getLang() === 'ko' && (
        <div className="field">
          <span>{t('speech.self')}</span>
          <fieldset className="segmented" aria-label={t('speech.self')}>
            {(['name', 'me', 'custom'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={draft.self === v}
                className={draft.self === v ? 'on' : ''}
                onClick={() => commit({ ...draft, self: v })}
              >
                {t(`speech.self.${v}`)}
              </button>
            ))}
          </fieldset>
          {draft.self === 'custom' && (
            <input
              aria-label={t('speech.self.custom')}
              placeholder={t('speech.self.placeholder')}
              maxLength={SELF_MAX}
              value={draft.selfText}
              onChange={(e) => commit({ ...draft, selfText: e.target.value }, true)}
            />
          )}
          <small>{t('speech.self.hint')}</small>
        </div>
      )}
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
      {anyLines &&
        seg(
          t('speech.ownRate'),
          RATES,
          draft.ownRate,
          (ownRate) => commit({ ...draft, ownRate }),
          'speech.rate',
        )}
      {anyLines && <small>{t('speech.ownRate.hint')}</small>}
      <SpeechPreview persona="custom" style={preview} petName={petName} />
      <button type="button" className="link" onClick={() => commit(DEFAULT_STYLE)}>
        {t('speech.reset')}
      </button>
    </div>
  );
}
