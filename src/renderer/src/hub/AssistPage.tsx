import { useState } from 'react';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../shared/chatter.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { CalSync } from '../../../shared/ipc.ts';
import { RoutinePicker } from '../RoutinePicker.tsx';
import { calendarFlash } from '../settings/flash-of.ts';
import { GoogleCalendarBox } from '../settings/GoogleCalendarBox.tsx';
import { icsInput } from '../settings/ics-input.ts';
import { MemoryEditor, PendingMemory, RulesEditor } from '../settings/tabs/AiTab.tsx';
import { bridge, Section, type TabProps, Toggle } from '../settings/ui.tsx';
import { JumpNav } from './JumpNav.tsx';

const chatterHint = (level: ChatterLevel): string =>
  level === 'quiet'
    ? t('settings.chatterHint.quiet')
    : level === 'normal'
      ? t('settings.chatterHint.normal', { n: MAX_PER_HOUR.normal })
      : level === 'sometimes'
        ? t('settings.chatterHint.sometimes', { n: MAX_PER_HOUR.sometimes })
        : t('settings.chatterHint.chatty', { n: MAX_PER_HOUR.chatty });

/** 큰 창의 비서 구역: 말 걸기, 만나는 시간, 하루 회고와 쪽지, 캘린더 연결, AI 도우미, 규칙과 기억 (설정에서 꺼낸 것) */
export function AssistPage({ snap, update, flash }: TabProps) {
  const s = snap.settings;
  return (
    <>
      <p className="hub-intro">{t('hub.assist.intro')}</p>
      <JumpNav ns="assist" keys={['talk', 'routine', 'review', 'calendar', 'ai', 'memory'] as const} />
      <Section id="hub-assist-talk" title={t('hub.assist.talk')} lede={t('hub.assist.talk.lede')}>
        <fieldset className="segmented" aria-label={t('settings.bubblesAria')}>
          {(['quiet', 'normal', 'sometimes', 'chatty'] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={s.chatter === level}
              className={s.chatter === level ? 'on' : ''}
              onClick={() => update({ chatter: level })}
            >
              {LEVEL_LABEL[level]}
            </button>
          ))}
        </fieldset>
        <small className="below">{chatterHint(s.chatter)}</small>
      </Section>
      <Section id="hub-assist-routine" title={t('hub.assist.routine')} lede={t('hub.assist.routine.lede')}>
        <Toggle
          label={t('routine.set.on', { name: s.petName })}
          hint={t('routine.set.onHint')}
          on={s.routine.on}
          onChange={(v) => update({ routine: { ...s.routine, on: v } })}
        />
        {s.routine.on && (
          <>
            <RoutinePicker
              routine={s.routine}
              onChange={(routine) => update({ routine })}
              onError={(m) => flash(m, true)}
            />
            {s.review && <small>{t('routine.set.reviewNote')}</small>}
          </>
        )}
      </Section>
      <Section id="hub-assist-review" title={t('hub.assist.review')} lede={t('hub.assist.review.lede')}>
        <Toggle
          label={t('settings.reviewOn')}
          hint={t('settings.reviewOnHint')}
          on={s.review}
          onChange={(v) => update({ review: v })}
        />
        <label className="field">
          <span>{t('settings.reviewTime')}</span>
          <input
            type="time"
            disabled={!s.review}
            value={`${String(Math.floor(s.reviewMinute / 60)).padStart(2, '0')}:${String(s.reviewMinute % 60).padStart(2, '0')}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (Number.isInteger(h) && Number.isInteger(m))
                update({ reviewMinute: (h ?? 0) * 60 + (m ?? 0) });
            }}
          />
          <small>{t('settings.reviewHint')}</small>
        </label>
        <Toggle
          label={t('settings.dailyNotes')}
          hint={t('settings.dailyNotesHint')}
          on={s.dailyNotes}
          onChange={(v) => update({ dailyNotes: v })}
        />
        <Toggle
          label={t('settings.eveningNotes')}
          hint={t('settings.eveningNotesHint')}
          on={s.eveningNotes}
          disabled={!s.dailyNotes}
          onChange={(v) => update({ eveningNotes: v })}
        />
      </Section>
      <Section id="hub-assist-calendar" title={t('hub.assist.calendar')} lede={t('hub.assist.calendar.lede')}>
        <CalendarSetup
          url={s.icsUrl ?? ''}
          last={snap.calendarLast}
          onSave={(v) => update({ icsUrl: v || null } as never)}
          onMsg={flash}
        />
      </Section>
      <GoogleCalendarBox onMsg={flash} />
      <Section id="hub-assist-ai" title={t('hub.assist.ai')} lede={t('hub.assist.ai.lede')}>
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
      </Section>
      <Section id="hub-assist-memory" title={t('hub.assist.memory')} lede={t('hub.assist.memory.lede')}>
        <RulesEditor
          value={s.petRules}
          onSave={(petRules) => update({ petRules }, t('settings.rules.saved'))}
        />
        {/* 짝꿍이 아는 것 창: 출처와 날짜, 생일과 좋아하는 것, 모두 잊기 (knows/KnowsApp.tsx) */}
        <div className="action-row">
          <small className="grow">{t('bond.knows.fromSettings')}</small>
          <button type="button" className="ghost" onClick={() => window.jjakkungBond?.openKnows()}>
            {t('bond.knows.open')}
          </button>
        </div>
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
    </>
  );
}

/** 캘린더 주소 넣기 (v2): 구글 캘린더 설정 > 내 캘린더 > 캘린더 통합 > iCal 형식의 비공개 주소 */
function CalendarSetup({
  url,
  last,
  onSave,
  onMsg,
}: {
  url: string;
  last: CalSync;
  onSave: (v: string) => Promise<unknown>;
  onMsg: (m: string, error?: boolean) => void;
}) {
  const [value, setValue] = useState(url);
  const [result, setResult] = useState(last);
  /**
   * 칸의 글을 저장한다. https 가 아니면 저장하지 않고 빨간 글씨로 알린다 (설정 검사가 조용히 버려 "저장했어"만 떴다).
   * webcal 은 https 로 바꿔 저장하고 칸에도 그 주소를 보인다. 저장할 수 있었으면 true
   */
  const commit = async (): Promise<boolean> => {
    const r = icsInput(value, url || undefined);
    if (r.kind === 'bad') {
      onMsg(t('settings.cal.bad'), true);
      return false;
    }
    if (r.kind === 'clear') await onSave('');
    if (r.kind === 'save') {
      setValue(r.url);
      await onSave(r.url);
    }
    return true;
  };
  return (
    <>
      <label className="field">
        <span>{t('settings.cal.url')}</span>
        <input
          type="url"
          value={value}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
        />
        <small>{t('settings.cal.hint')}</small>
      </label>
      <div className="action-row">
        <button
          type="button"
          className="ghost"
          disabled={!value.trim()}
          onClick={async () => {
            // 틀린 주소면 가져오지 않는다 (예전에는 칸과 다른 옛 주소로 가져왔다)
            if (!(await commit())) return;
            const r = await bridge.syncCalendar();
            setResult(r);
            const f = calendarFlash(r);
            onMsg(f.text, f.error);
          }}
        >
          {t('settings.cal.fetch')}
        </button>
        {url && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setValue('');
              void onSave('');
            }}
          >
            {t('settings.cal.clear')}
          </button>
        )}
      </div>
      {result.text && <small className={result.ok ? undefined : 'warn'}>{result.text}</small>}
    </>
  );
}
