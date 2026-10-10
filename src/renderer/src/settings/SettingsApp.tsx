import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PERSONAS } from '../../../shared/ai/persona.ts';
import { type BetaReport, goalsMet, TARGET } from '../../../shared/beta-stats.ts';
import { formatBytes } from '../../../shared/bytes.ts';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../shared/chatter.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PetLookView, SettingsSnapshot } from '../../../shared/ipc.ts';
import { addMemory, approvePending, MEMORY_ITEM_MAX, MEMORY_MAX } from '../../../shared/pet-memory.ts';
import type { Gait } from '../../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../../shared/pet3d/defaults.ts';
import { restDaysOf } from '../../../shared/routine.ts';
import {
  cleanPetName,
  FRIENDS_MAX,
  type Friend,
  GAIT_PICKS,
  type GaitPick,
  gaitPatch,
  PET_KINDS,
  PET_NAME_MAX,
  PET_STYLES,
  type PetKind,
  POSE_KINDS,
  petNameLength,
  pickedGait,
  RULES_MAX,
  type Settings,
} from '../../../shared/settings.ts';
import { groupRows, type RowKind, searchSettings } from '../../../shared/settings-search.ts';
import {
  acceleratorLabel,
  NO_SHORTCUT,
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  SHORTCUT_LABEL,
  type ShortcutId,
  shortcutClash,
  toAccelerator,
} from '../../../shared/shortcut.ts';
import { MAX_SCALE, MIN_SCALE } from '../../../shared/size.ts';
import { CANVAS_SIZE, drawPet } from '../draw.ts';
import { MakeProgress } from '../MakeProgress.tsx';
import { browserStore, loadExpected, saveDuration } from '../make-progress.ts';
import { PetNameInput } from '../PetNameInput.tsx';
import { Pet3D } from '../pet3d.ts';
import { gaitMismatch, shapeOf } from '../pet3d-gait.ts';
import { RoutinePicker } from '../RoutinePicker.tsx';

const bridge = window.jjakkungSettings;

/** 만나는 시간을 켰을 때 삐짐 칸의 안내: 만나지 않는 요일을 이름으로 (일, 토) */
const restByRoutine = (days: readonly number[]): string => {
  const names = t('settings.weekdays').split(',');
  return days.length === 0
    ? t('settings.restDaysByRoutineNone')
    : t('settings.restDaysByRoutine', { days: days.map((d) => names[d] ?? '').join(', ') });
};

const chatterHint = (level: ChatterLevel): string =>
  level === 'quiet'
    ? t('settings.chatterHint.quiet')
    : level === 'normal'
      ? t('settings.chatterHint.normal', { n: MAX_PER_HOUR.normal })
      : t('settings.chatterHint.chatty', { n: MAX_PER_HOUR.chatty });

export function SettingsApp() {
  const [snap, setSnap] = useState<SettingsSnapshot>();
  const [name, setName] = useState('');
  const [scale, setScale] = useState(1);
  const [saved, setSaved] = useState('');
  // 실패나 막힘 안내는 빨간 글씨 (성공 안내와 같은 초록이면 된 것처럼 읽힌다)
  const [savedError, setSavedError] = useState(false);
  // 언어를 바꾸면 다시 켜야 보인다. 바꾼 뒤에만 다시 켜기 버튼을 보여 준다
  const [langChanged, setLangChanged] = useState(false);
  const libraryKey = useRef('');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 이름 칸에서 나가지 않고 창을 닫아도 고친 이름을 잃지 않게 (닫을 때 저장).
  // 사용자가 칸을 고쳤을 때만 저장한다. 다른 곳(펫 만들기, 가져오기)에서 바뀐 이름은 칸에 받아 온다
  const nameEdited = useRef(false);
  const nameDraft = useRef(name);
  nameDraft.current = name;
  const savedName = useRef('');
  savedName.current = snap?.settings.petName ?? '';
  useEffect(() => {
    const flush = () => {
      // 비었거나 그대로면 저장하지 않는다 (saveName 과 같은 기준)
      const next = cleanPetName(nameDraft.current);
      if (nameEdited.current && next && next !== savedName.current)
        void bridge.set({ petName: next, petNameEdited: true });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  useEffect(() => {
    bridge.get().then((s) => {
      setSnap(s);
      setName(s.settings.petName);
      setScale(s.scale);
    });
    bridge.onChanged((settings) => {
      setSnap((s) => s && { ...s, settings });
      if (!nameEdited.current) setName(settings.petName);
      // 펫 만들기 창에서 새 펫을 저장하면 보관함과 지금 그림이 바뀐다. 그때만 다시 받는다
      // 몸을 다시 만들면(걸음새) 설계도 파일만 바뀐다. 그때도 지금 펫 카드와 몸 모양을 다시 받는다
      const key = JSON.stringify([
        settings.petImage,
        settings.petModel,
        settings.petDepth,
        settings.petLibrary.map((p) => p.id),
      ]);
      if (key !== libraryKey.current) {
        libraryKey.current = key;
        void bridge
          .get()
          .then((next) => setSnap((s) => s && { ...s, library: next.library, current: next.current }));
      }
    });
    bridge.onPower((onBattery) => setSnap((s) => s && { ...s, onBattery }));
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
    // 펫 크기는 펫 위에서 휠, 손가락으로도 바뀐다. 이 창으로 돌아오면 다시 받는다 (밀대가 옛 값으로 펫을 되돌렸다)
    const onFocus = () => void bridge.get().then((s) => setScale(s.scale));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ---- 설정 찾기: 찾는 말에 맞는 칸과 줄만 보인다 (그리기는 그대로, 그린 뒤 hidden 만 바꾼다) ----
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [noHit, setNoHit] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const sections = [...main.querySelectorAll<HTMLElement>(':scope > section')].map((sec) => {
      const box = sec.querySelector<HTMLElement>(':scope > .card') ?? sec;
      const kids = [...box.children].filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.tagName !== 'H2',
      );
      const kinds: RowKind[] = kids.map((k) =>
        k.tagName === 'SMALL' ? 'small' : k.classList.contains('action-row') ? 'action' : 'other',
      );
      const group = groupRows(kinds);
      const groups: HTMLElement[][] = [];
      kids.forEach((k, i) => {
        const g = group[i] ?? 0;
        if (!groups[g]) groups[g] = [];
        groups[g].push(k);
      });
      return {
        sec,
        groups,
        title: sec.querySelector(':scope > h2')?.textContent ?? '',
        rows: groups.map((g) => g.map((k) => k.textContent ?? '').join(' ')),
      };
    });
    const r = searchSettings(sections, query, composing);
    sections.forEach((d, i) => {
      d.sec.hidden = !r[i]?.show;
      d.groups.forEach((g, j) => {
        for (const k of g) k.hidden = !r[i]?.rows[j];
      });
    });
    setNoHit(query.trim() !== '' && r.every((x) => !x.show));
  });
  // Cmd/Ctrl+F 로 찾기 칸에
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!snap) return <div className="loading">{t('settings.loading')}</div>;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';

  // 앞 안내의 지우기 타이머가 새 안내를 일찍 지우지 않게 하나만 둔다 (빈 이름 안내 뒤 "이름을 바꿨어"가 바로 사라졌다)
  const flash = (message: string, error = false) => {
    setSaved(message);
    setSavedError(error);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSaved(''), 2400);
  };

  const update = async (patch: Partial<Settings>, message = t('settings.saved')) => {
    const next = await bridge.set(patch);
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
    return next;
  };

  // 비우면 저장하지 않고 원래 이름으로 돌린다 ("이름을 바꿨어"가 떴지만 실제로는 그대로였다).
  // 그대로면 아무 말 없이 넘어간다. 바꾸면 손댄 이름이라 모습을 바꿔도 따라가지 않는다
  const saveName = async () => {
    if (!nameEdited.current) return;
    nameEdited.current = false;
    const clean = cleanPetName(name);
    if (!clean) {
      setName(s.petName);
      flash(t('settings.nameEmpty'), true);
      return;
    }
    if (clean === s.petName) {
      setName(clean);
      return;
    }
    const next = await update({ petName: clean, petNameEdited: true }, t('settings.nameChanged'));
    setName(next.petName);
  };

  const preview = cleanPetName(name) ?? s.petName;

  return (
    <div className="settings">
      <header>
        <strong>{t('settings.title')}</strong>
        <span className={`saved${savedError ? ' error' : ''}`} role="status" aria-live="polite">
          {saved}
        </span>
      </header>

      <div className="search">
        <input
          ref={searchRef}
          type="search"
          value={query}
          aria-label={t('settings.search.label')}
          placeholder={t('settings.search.placeholder', { keys: `${mod}+F` })}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            // 한글 조합 중 Esc 는 조합만 끝낸다
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label={t('settings.search.clear')}
            title={t('settings.search.clear')}
            onClick={() => {
              setQuery('');
              searchRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>

      <main ref={mainRef}>
        {noHit && (
          <p className="search-empty" role="status">
            {t('settings.search.empty', { q: query.trim() })}
          </p>
        )}
        <Section title={t('settings.pet')}>
          <label className="field">
            <span>{t('settings.name')}</span>
            <div className="row">
              <PetNameInput
                value={name}
                onValue={(v) => {
                  nameEdited.current = true;
                  setName(v);
                }}
                onLimit={() => flash(t('settings.nameMax', { max: PET_NAME_MAX }), true)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <small>
              {t('settings.nameHint', { name: preview, n: petNameLength(name.trim()), max: PET_NAME_MAX })}
            </small>
          </label>

          <div className="field">
            <span>{t('settings.look')}</span>
            <PetPicker
              snap={snap}
              onPick={async (choice) => {
                const library = await bridge.choosePet(choice);
                const next = await bridge.get();
                setSnap({ ...next, library });
                setName(next.settings.petName);
                flash(t('settings.saved'));
              }}
              onRemove={async (id) => {
                const library = await bridge.removeSavedPet(id);
                setSnap((v) => v && { ...v, library });
                flash(t('settings.pets.removed'));
              }}
            />
            <div className="action-row">
              <button type="button" className="ghost" onClick={() => bridge.openMaker()}>
                {t('settings.makePhotoPet')}
              </button>
            </div>
            <small>{t('settings.pets.hint')}</small>
          </div>

          {s.petImage && (
            <div className="field">
              <span>{t('settings.poses')}</span>
              <div className="action-row">
                {POSE_KINDS.map((p) => (
                  <button key={p.id} type="button" className="ghost" onClick={() => bridge.openMaker(p.id)}>
                    {s.petPoses[p.id]
                      ? t('settings.poseChange', { label: p.label })
                      : t('settings.posePhoto', { label: p.label })}
                  </button>
                ))}
              </div>
              <small>{t('settings.posesHint')}</small>
            </div>
          )}

          <label className="field">
            <span>
              {t('settings.size')} <b>{Math.round(scale * 100)}%</b>
            </span>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.05}
              value={scale}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScale(v);
                bridge.setScale(v);
              }}
            />
            <small>{t('settings.sizeHint', { mod })}</small>
          </label>

          {(!s.petImage || s.petModel || s.petDepth) && (
            <Toggle
              label={t('settings.pet3d')}
              hint={t('settings.pet3dHint')}
              on={s.pet3d}
              onChange={(v) => update({ pet3d: v })}
            />
          )}
          {(!s.petImage || s.petModel) && s.pet3d && (
            <div className="field">
              <span>{t('settings.petStyle')}</span>
              <fieldset className="segmented wrap" aria-label={t('settings.petStyle')}>
                {PET_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={s.petStyle === style}
                    className={s.petStyle === style ? 'on' : ''}
                    onClick={() => update({ petStyle: style })}
                  >
                    {t(`settings.petStyle.${style}`)}
                  </button>
                ))}
              </fieldset>
              <small>{t(`settings.petStyleHint.${s.petStyle}`)}</small>
            </div>
          )}

          <GaitPicker snap={snap} update={update} flash={flash} />

          <Toggle
            label={t('settings.wander')}
            hint={t('settings.wanderHint')}
            on={s.wander}
            onChange={(v) => update({ wander: v })}
          />
          <Toggle
            label={t('settings.lookAtCursor')}
            hint={t('settings.lookAtCursorHint')}
            on={s.lookAtCursor}
            onChange={(v) => update({ lookAtCursor: v })}
          />
          <Toggle
            label={t('settings.dayRhythm')}
            hint={t('settings.dayRhythmHint')}
            on={s.dayRhythm}
            onChange={(v) => update({ dayRhythm: v })}
          />
          <Toggle
            label={t('settings.sounds')}
            hint={t('settings.soundsHint')}
            on={s.sounds}
            onChange={(v) => update({ sounds: v })}
          />
          <Toggle
            label={t('settings.boost')}
            hint={t('settings.boostHint')}
            on={s.boost}
            note={s.boost && snap.onBattery ? t('settings.boostResting') : undefined}
            onChange={(v) => update({ boost: v })}
          />
          <Toggle
            label={t(mac ? 'settings.sysMonitor' : 'settings.sysMonitorWin')}
            hint={t(mac ? 'settings.sysMonitorHint' : 'settings.sysMonitorWinHint')}
            on={s.sysMonitor}
            onChange={(v) => update({ sysMonitor: v })}
          />
        </Section>

        <Section title={t('settings.friends')}>
          <Friends
            list={s.friends}
            petName={s.petName}
            onMsg={flash}
            onChange={(friends) => update({ friends }, t('settings.friendsChanged'))}
            onImport={async () => {
              const r = await bridge.importFriend();
              if (r.message) flash(r.message);
            }}
          />
        </Section>

        <Section title={t('settings.sulk')}>
          {/* 만나는 시간을 켜면 쉬는 날은 거기서 정한다 (만나지 않는 요일). restDays 는 지우지 않고 꺼지면 다시 쓴다 */}
          {s.routine.on ? (
            <div className="field">
              <span>{t('settings.restDaysAria')}</span>
              <small>{restByRoutine(restDaysOf(s))}</small>
            </div>
          ) : (
            <div className="field">
              <span>{t('settings.restDays')}</span>
              <fieldset className="days" aria-label={t('settings.restDaysAria')}>
                {t('settings.weekdays')
                  .split(',')
                  .map((d, i) => {
                    const on = s.restDays.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        className={on ? 'on' : ''}
                        onClick={() =>
                          update({ restDays: on ? s.restDays.filter((x) => x !== i) : [...s.restDays, i] })
                        }
                      >
                        {d}
                      </button>
                    );
                  })}
              </fieldset>
            </div>
          )}
          <Toggle
            label={t('settings.spicy')}
            hint={t('settings.spicyHint')}
            on={s.spicy}
            onChange={(v) => update({ spicy: v })}
          />
        </Section>

        <Section title={t('settings.bubbles')}>
          <fieldset className="segmented" aria-label={t('settings.bubblesAria')}>
            {(['quiet', 'normal', 'chatty'] as const).map((level) => (
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
          <Toggle
            label={t('settings.osNotify')}
            hint={t('settings.osNotifyHint')}
            on={s.osNotify}
            onChange={(v) => update({ osNotify: v })}
          />
        </Section>

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
          <MemoryEditor
            list={s.petMemory}
            onChange={(petMemory, message) => update({ petMemory }, message)}
          />
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

        <Section title={t('settings.storage')}>
          <Storage
            list={snap.storage}
            onDelete={async (id) => {
              try {
                const r = await bridge.deleteModel(id);
                setSnap(
                  (v) => v && { ...v, storage: r.storage, models: { ...v.models, localReady: r.localReady } },
                );
                flash(t(r.ok ? 'settings.storage.deleted' : 'settings.storage.busy'));
              } catch {
                flash(t('settings.storage.busy'));
              }
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

        <Section title={t('settings.lang')}>
          <fieldset className="segmented" aria-label={t('settings.langAria')}>
            {(['auto', 'ko', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={s.lang === l}
                className={s.lang === l ? 'on' : ''}
                onClick={async () => {
                  if (s.lang === l) return;
                  await update({ lang: l });
                  setLangChanged(true);
                }}
              >
                {t(`settings.lang.${l}`)}
              </button>
            ))}
          </fieldset>
          {langChanged ? (
            <div className="action-row notice" role="status">
              <small className="grow">{t('settings.langRestart')}</small>
              <button type="button" className="primary" onClick={() => bridge.relaunch()}>
                {t('settings.restart')}
              </button>
            </div>
          ) : (
            <small className="below">{t('settings.langHint')}</small>
          )}
        </Section>

        <Section title={t('settings.start')}>
          <Toggle
            label={t('settings.launchAtLogin')}
            hint={snap.packaged ? t('settings.launchPackaged') : t('settings.launchDev')}
            on={s.launchAtLogin}
            disabled={!snap.packaged}
            onChange={(v) => update({ launchAtLogin: v })}
          />
          {/* 시작 안내는 업데이트가 아니라 시작 칸에 (예전엔 업데이트 칸 안에 있었다) */}
          <div className="action-row">
            <button type="button" className="ghost" onClick={() => bridge.openOnboarding()}>
              {t('settings.onboardingAgain')}
            </button>
          </div>
        </Section>

        <Section title={t('routine.set.title')}>
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

        <Section title={t('settings.review')}>
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
        </Section>

        <Section title={t('settings.calendar')}>
          <CalendarSetup
            url={s.icsUrl ?? ''}
            last={snap.calendarLast}
            onSave={(v) => update({ icsUrl: v || null } as never)}
            onMsg={flash}
          />
        </Section>

        <Section title={t('settings.backup')}>
          <small>{t('settings.backupHint')}</small>
          <div className="action-row">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                // 실패하면(쓰기 권한, 디스크 등) 아무 표시 없이 끝나지 않게 상태줄에 알린다
                const r = await bridge.exportData().catch(() => undefined);
                if (r === undefined) flash(t('settings.exportFailed'));
                else if (r) flash(t('settings.exported'));
              }}
            >
              {t('settings.export')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.importData().catch(() => undefined);
                if (r === undefined) flash(t('settings.importFailed'));
                else if (r) flash(r);
              }}
            >
              {t('settings.import')}
            </button>
          </div>
          <small>{t('settings.petOnlyHint')}</small>
          <div className="action-row">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                // 쓰기 실패(권한, 디스크, 그림 파일 읽기)도 말 없이 끝나지 않게 알린다
                const r = await bridge.exportPet().catch(() => undefined);
                if (r === undefined) flash(t('settings.petExportFailed'), true);
                else if (r) flash(t('settings.petExported'));
              }}
            >
              {t('settings.exportPet')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.importPet();
                if (r.message) flash(r.message);
              }}
            >
              {t('settings.importPet')}
            </button>
          </div>
        </Section>

        <Section title={t('settings.update')}>
          <Toggle
            label={t('settings.updateCheck')}
            hint={t('settings.updateHint')}
            on={s.updateCheck}
            onChange={(v) => update({ updateCheck: v })}
          />
          <div className="action-row">
            <button type="button" className="ghost" onClick={async () => flash(await bridge.checkUpdate())}>
              {t('settings.checkNow')}
            </button>
          </div>
        </Section>

        <Section title={t('settings.shortcuts')}>
          <dl className="keys">
            {SHORTCUT_IDS.map((id) => (
              <ShortcutRow
                key={id}
                id={id}
                value={s.shortcuts[id]}
                mac={mac}
                onSave={(acc) => {
                  // 다른 단축키와 같으면 저장하지 않고 알린다 (설정 검사가 조용히 버려 "바꿨어"만 떴다)
                  const next = { ...s.shortcuts, [id]: acc };
                  const clash = shortcutClash(next);
                  if (clash) {
                    const other = clash[0] === id ? clash[1] : clash[0];
                    flash(t('settings.shortcut.taken', { name: SHORTCUT_LABEL[other] }), true);
                    return;
                  }
                  void update(
                    { shortcuts: next },
                    acc === NO_SHORTCUT ? t('settings.shortcutOff') : t('settings.shortcutChanged'),
                  );
                }}
                onError={(m) => flash(m, true)}
              />
            ))}
            <dt>{t('settings.zoomKeys')}</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </dd>
            {/* 패널 안에서만 듣는 키 (바꿀 수 없다, 알려 주기만) */}
            <dt>{t('settings.panelTabKeys')}</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>1</kbd> ~ <kbd>5</kbd>
            </dd>
            <dt>{t('settings.panelUndoKeys')}</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>Z</kbd>
            </dd>
          </dl>
        </Section>

        <Stats onCopied={(ok) => flash(ok ? t('settings.statsCopied') : t('settings.copyFailed'), !ok)} />

        <p className="version">{t('settings.version', { v: snap.version })}</p>
      </main>
    </div>
  );
}

/**
 * 베타 기록 (P4-04). 기획서 성공 기준 다섯 가지를 지금 값과 목표로 보여 준다.
 * 메뉴 막대 "의견 보내기"로 열리면 이 칸으로 바로 내려온다.
 */
function Stats({ onCopied }: { onCopied: (ok: boolean) => void }) {
  const [report, setReport] = useState<BetaReport>();
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const load = () => bridge.stats().then(setReport);
    const show = () => {
      load();
      setFocus(true);
      setTimeout(() => setFocus(false), 1600);
    };
    load();
    bridge.onFocus(show);
    if (location.hash === '#stats') show();
    // 창을 다시 볼 때 숫자를 새로 읽는다 (1분마다 쌓인다).
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    // 숫자를 읽기 전에는 칸이 없어서, 읽은 뒤에 내려간다.
    if (focus && report) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, report]);

  if (!report) return null;
  const started = report.dayNumber > 0;
  // 기록이 없으면 달성 표시를 하지 않는다 (켜 둔 시간 0 인데 숨김 0%, 멈춤 0회가 달성으로 떴다)
  const met = goalsMet(report);
  const rows: { label: string; value: string; goal: string; ok: boolean | undefined }[] = [
    {
      label: t('settings.stats.daysUsed'),
      value: started
        ? t(report.daysUsed === 1 ? 'settings.stats.dayValueOne' : 'settings.stats.dayValue', {
            day: report.dayNumber,
            used: report.daysUsed,
          })
        : t('settings.stats.fromToday'),
      goal: t('settings.stats.daysGoal'),
      ok: started ? report.dayNumber >= 14 || undefined : undefined,
    },
    {
      label: t('settings.stats.doneMedian'),
      value: t('settings.stats.count', { n: report.doneMedian }),
      goal: t('settings.stats.countAtLeast', { n: TARGET.doneMedian }),
      ok: met.done,
    },
    {
      label: t('settings.stats.hidden'),
      value: `${Math.round(report.hiddenRatio * 100)}%`,
      goal: t('settings.stats.under', { n: TARGET.hiddenRatio * 100 }),
      ok: met.hidden,
    },
    {
      label: t('settings.stats.look'),
      value: t('settings.stats.times', { n: report.look7 }),
      goal: t('settings.stats.timesAtLeast', { n: TARGET.look7 }),
      ok: met.look,
    },
    {
      label: t('settings.stats.crash'),
      value: t('settings.stats.times', { n: report.crash7 }),
      goal: t('settings.stats.times', { n: TARGET.crash7 }),
      ok: met.crash,
    },
  ];

  return (
    <section ref={ref} id="stats" className={focus ? 'focus' : ''}>
      <h2>{t('settings.stats.title')}</h2>
      <div className="card">
        <small>{t('settings.stats.intro')}</small>
        <table className="stats">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  <b>{r.value}</b>
                  <small>
                    {t('settings.stats.goal', { goal: r.goal })}
                    {r.ok === true && <i className="met"> {t('settings.stats.met')}</i>}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="action-row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              onCopied(await bridge.copyStats().catch(() => false));
            }}
          >
            {t('settings.stats.copy')}
          </button>
        </div>
        <small>{t('settings.stats.privacy')}</small>
      </div>
    </section>
  );
}

/** 친구 펫 (v2 여러 마리): 이름과 모양을 정해 데려오고, 집에 보낸다. 3마리까지 */
/**
 * 걸음새 고르기 (자동, 두 발, 네 발). 지금 펫에만 적용하고 펫(몸)마다 따로 기억한다 (settings.petGaits).
 * 기본 펫은 2D 와 입체 모두 바로 바꾼다. 입체 피규어 사진 펫은 몸 모양과 다른 걸음새를 고르면 바로 바꾸지 않고
 * "이 걸음새에 맞게 다시 만들기"(같은 사진, 같은 요청사항)와 "그냥 바꾸기"를 같이 보여 준다.
 * 다리가 없는 사진 펫(평면, 2.5D, 입체로 보기 꺼짐)은 흐리게 두고 이유를 적는다
 */
function GaitPicker({
  snap,
  update,
  flash,
}: {
  snap: SettingsSnapshot;
  update: (patch: Partial<Settings>, message?: string) => Promise<Settings>;
  flash: (message: string, error?: boolean) => void;
}) {
  const s = snap.settings;
  // 고르는 중인 걸음새 (몸과 달라 물어보는 중), 다시 만드는 중인 걸음새, 다시 만들기 실패 글
  const [ask, setAsk] = useState<Gait>();
  const [busy, setBusy] = useState<Gait>();
  // 다시 만들기 진행 표시: 시작한 때, 예상 시간(지난번 걸린 시간), 끝나서 100% 를 잠깐 보여 주는 중
  const [busyAt, setBusyAt] = useState(0);
  const [busyMs, setBusyMs] = useState(0);
  const [busyDone, setBusyDone] = useState(false);
  // 그만두기를 눌렀으면 "멈췄어"를 오류처럼 띄우지 않고 묻던 칸으로 조용히 돌아간다
  const stopped = useRef(false);
  const [error, setError] = useState('');
  const figure = s.petImage && snap.current?.look === 'figure' ? snap.current.model : undefined;
  // 몸 모양: 기본 펫은 기본 설계도, 사진 펫은 그 설계도 (고른 값을 덮기 전)
  const shape: Gait | undefined = !s.petImage
    ? shapeOf(DEFAULT_BLUEPRINTS[s.petKind])
    : figure && s.pet3d
      ? shapeOf(figure)
      : undefined;
  const why = shape ? '' : figure ? t('settings.gait.off3d') : t('settings.gait.flat');
  const picked = shape ? pickedGait(s) : undefined;
  const now: GaitPick = picked ?? 'auto';
  const canRemake = !!figure;
  // 펫을 바꾸면 묻던 것을 접는다
  const petKey = `${s.petImage ?? s.petKind}|${s.petModel ?? ''}`;
  const lastPet = useRef(petKey);
  useEffect(() => {
    if (lastPet.current === petKey) return;
    lastPet.current = petKey;
    setAsk(undefined);
    setError('');
  }, [petKey]);

  const apply = async (pick: GaitPick) => {
    const patch = gaitPatch(s, pick);
    setAsk(undefined);
    setError('');
    if (patch) await update(patch);
  };
  const choose = (pick: GaitPick) => {
    if (!shape || busy) return;
    if (pick === now) {
      setAsk(undefined);
      return;
    }
    if (pick !== 'auto' && canRemake && gaitMismatch(pick, shape)) {
      setAsk(pick);
      setError('');
      return;
    }
    void apply(pick);
  };
  const remake = async (pick: Gait) => {
    const at = performance.now();
    setBusy(pick);
    setBusyAt(at);
    setBusyMs(loadExpected('figure', browserStore()));
    setBusyDone(false);
    setError('');
    stopped.current = false;
    const r = await bridge.remakeBody(pick);
    if (!r.ok && stopped.current) {
      setBusy(undefined);
      return;
    }
    if (r.ok) {
      saveDuration('figure', performance.now() - at, browserStore());
      setBusyDone(true);
      await new Promise((done) => setTimeout(done, 520));
      setBusyDone(false);
    }
    setBusy(undefined);
    if (r.ok) {
      setAsk(undefined);
      flash(t('settings.gait.remade', { name: s.petName }));
    } else setError(r.error);
  };
  const walk = (g: Gait) => t(`settings.gait.${g}`);
  const body = (g: Gait) => t(`settings.gait.body.${g}`);
  const odd = !!shape && !!picked && gaitMismatch(picked, shape);

  return (
    <div className="field">
      <span id="gait-label">{t('settings.gait')}</span>
      <fieldset className="segmented" aria-labelledby="gait-label" disabled={!shape || !!busy}>
        {GAIT_PICKS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={now === g}
            className={now === g && shape ? 'on' : ''}
            onClick={() => choose(g)}
          >
            {t(`settings.gait.${g}`)}
          </button>
        ))}
      </fieldset>
      {!shape ? (
        <small>{why}</small>
      ) : busy ? (
        <div className="notice">
          <MakeProgress
            compact
            task="remake"
            title={t('settings.gait.remaking', { pick: walk(busy) })}
            startedAt={busyAt}
            expectedMs={busyMs}
            image={snap.current?.thumb}
            silhouette
            done={busyDone}
            onStop={() => {
              stopped.current = true;
              bridge.cancelRemake();
            }}
          />
        </div>
      ) : ask ? (
        <div className="notice gait-ask" role="status">
          <small>
            {t('settings.gait.mismatch', { name: s.petName, body: body(shape), pick: walk(ask) })}
          </small>
          <div className="action-row">
            <button type="button" className="primary" onClick={() => void remake(ask)}>
              {t('settings.gait.remake', { pick: walk(ask) })}
            </button>
            <button type="button" className="ghost" onClick={() => void apply(ask)}>
              {t('settings.gait.justSwitch', { pick: walk(ask) })}
            </button>
            <button type="button" className="link" onClick={() => setAsk(undefined)}>
              {t('settings.gait.keep')}
            </button>
          </div>
          <small className="muted">{t('settings.gait.remakeHint')}</small>
          {error && (
            <small className="warn" role="alert">
              {error}
            </small>
          )}
        </div>
      ) : odd && picked ? (
        <div className="action-row">
          <small className="grow">{t('settings.gait.odd', { name: s.petName, body: body(shape) })}</small>
          {canRemake && (
            <button type="button" className="link" onClick={() => setAsk(picked)}>
              {t('settings.gait.remake', { pick: walk(picked) })}
            </button>
          )}
        </div>
      ) : (
        <small>{picked ? t('settings.gait.kept') : t('settings.gait.autoNow', { gait: walk(shape) })}</small>
      )}
    </div>
  );
}

function Friends({
  list,
  petName,
  onChange,
  onImport,
  onMsg,
}: {
  list: Friend[];
  /** 기본 펫 이름 (같은 이름 경고에 쓴다) */
  petName: string;
  onChange: (next: Friend[]) => void;
  onImport: () => void;
  onMsg: (m: string, error?: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PetKind>('cat');
  // 같은 이름이면 한 번 알리고, 그래도 데려오기를 다시 누르면 데려온다 (막지는 않는다)
  const [dupe, setDupe] = useState('');
  // 집에 보내기는 두 번 눌러 확인 (보관한 펫 지우기와 같은 방식)
  const [sure, setSure] = useState('');
  const full = list.length >= FRIENDS_MAX;
  const clean = cleanPetName(name);
  const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const taken = !!clean && [petName, ...list.map((f) => f.name)].some((n) => same(n, clean));
  const add = () => {
    if (!clean || full) return;
    if (taken && dupe !== clean) {
      setDupe(clean);
      return;
    }
    onChange([...list, { id: `f-${Date.now().toString(36)}`, name: clean, kind }]);
    setName('');
    setDupe('');
  };
  const leaving = list.find((f) => f.id === sure);
  return (
    <>
      <small>{t('settings.friends.hint', { max: FRIENDS_MAX })}</small>
      {list.length > 0 && (
        <ul className="friends">
          {list.map((f) => (
            <li key={f.id}>
              <b>{f.name}</b>
              <small>
                {f.image
                  ? t('settings.friends.photo')
                  : (PET_KINDS.find((k) => k.id === f.kind)?.label ?? '')}
              </small>
              {/* 걸음새는 다리가 있는 몸(기본 펫, 입체 설계도가 있는 사진 친구)만. 친구마다 따로 */}
              {(!f.image || f.model) && (
                <select
                  className="friend-gait"
                  value={f.gait ?? 'auto'}
                  aria-label={t('settings.gait.friendAria', { name: f.name })}
                  onChange={(e) => {
                    const pick = e.target.value as GaitPick;
                    onChange(
                      list.map((x) => {
                        if (x.id !== f.id) return x;
                        const { gait: _, ...rest } = x;
                        return pick === 'auto' ? rest : { ...rest, gait: pick };
                      }),
                    );
                  }}
                >
                  {/* 칸 이름이 따로 없어 "자동"만 보이면 무엇인지 모른다. 고른 값 앞에 "걸음새"를 붙인다 */}
                  {GAIT_PICKS.map((g) => (
                    <option key={g} value={g}>
                      {`${t('settings.gait')}: ${t(`settings.gait.${g}`)}`}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className={`link${sure === f.id ? ' sure' : ''}`}
                aria-label={
                  sure === f.id
                    ? t('settings.friends.sendHomeSureAria', { name: f.name })
                    : t('settings.friends.sendHomeAria', { name: f.name })
                }
                onClick={() => {
                  if (sure !== f.id) {
                    setSure(f.id);
                    return;
                  }
                  setSure('');
                  onChange(list.filter((x) => x.id !== f.id));
                }}
                onBlur={() => setSure('')}
              >
                {sure === f.id ? t('settings.friends.sendHomeSure') : t('settings.friends.sendHome')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {leaving?.image && (
        <small className="below warn" role="status">
          {t('settings.friends.photoGone', { name: leaving.name })}
        </small>
      )}
      {!full && (
        <div className="friend-add">
          <PetNameInput
            value={name}
            placeholder={t('settings.friends.name')}
            aria-label={t('settings.friends.name')}
            onValue={(v) => {
              setName(v);
              setDupe('');
            }}
            onLimit={() => onMsg(t('settings.nameMax', { max: PET_NAME_MAX }), true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
            }}
          />
          <select
            value={kind}
            aria-label={t('settings.friends.kind')}
            onChange={(e) => setKind(e.target.value as PetKind)}
          >
            {PET_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button type="button" className="ghost" disabled={!clean} onClick={add}>
            {dupe && dupe === clean ? t('settings.friends.addAnyway') : t('settings.friends.add')}
          </button>
        </div>
      )}
      {!full && dupe && dupe === clean && (
        <small className="below warn" role="status">
          {t('settings.friends.dupe', { name: clean })}
        </small>
      )}
      {!full && (
        <div className="action-row">
          <button type="button" className="link" onClick={onImport}>
            {t('settings.friends.import')}
          </button>
        </div>
      )}
    </>
  );
}

/** 단축키 한 줄: 누르면 기록 모드, 키 조합을 누르면 저장 (v2 단축키 바꾸기) */
function ShortcutRow({
  id,
  value,
  mac,
  onSave,
  onError,
}: {
  id: ShortcutId;
  value: string;
  mac: boolean;
  onSave: (acc: string) => void;
  onError: (m: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <>
      <dt>{SHORTCUT_LABEL[id]}</dt>
      <dd className="shortcut">
        <span className="keys-line">
          {recording ? (
            <span className="recording">{t('settings.shortcut.recording')}</span>
          ) : value === NO_SHORTCUT ? (
            // 새 기본 키가 쓰던 키와 겹쳐 비워 둔 단축키. "바꾸기"로 새 키를 넣는다
            <span className="none">{t('settings.shortcut.none')}</span>
          ) : (
            acceleratorLabel(value, mac).map((k) => <kbd key={k}>{k}</kbd>)
          )}
        </span>
        <button
          type="button"
          className="ghost small"
          aria-pressed={recording}
          onClick={() => setRecording((v) => !v)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            if (e.key === 'Escape') {
              setRecording(false);
              return;
            }
            const r = toAccelerator(e, mac);
            if (!r) return;
            if ('error' in r) {
              onError(r.error);
              return;
            }
            setRecording(false);
            onSave(r.accelerator);
          }}
          onBlur={() => setRecording(false)}
        >
          {recording ? t('settings.shortcut.recordingBtn') : t('settings.shortcut.change')}
        </button>
        {value !== SHORTCUT_DEFAULTS[id] && !recording && (
          <button type="button" className="link" onClick={() => onSave(SHORTCUT_DEFAULTS[id])}>
            {t('settings.shortcut.default')}
          </button>
        )}
        {/* 맥은 다른 앱과 겹쳐도 알 수 없어(L18) 끌 수 있게 둔다 */}
        {value !== NO_SHORTCUT && !recording && (
          <button type="button" className="link" onClick={() => onSave(NO_SHORTCUT)}>
            {t('settings.shortcut.off')}
          </button>
        )}
      </dd>
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
  last: string;
  onSave: (v: string) => void;
  onMsg: (m: string) => void;
}) {
  const [value, setValue] = useState(url);
  const [result, setResult] = useState(last);
  return (
    <>
      <label className="field">
        <span>{t('settings.cal.url')}</span>
        <input
          type="url"
          value={value}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() !== url && onSave(value.trim())}
        />
        <small>{t('settings.cal.hint')}</small>
      </label>
      <div className="action-row">
        <button
          type="button"
          className="ghost"
          disabled={!value.trim()}
          onClick={async () => {
            if (value.trim() !== url) onSave(value.trim());
            const r = await window.jjakkungSettings.syncCalendar();
            setResult(r);
            onMsg(r);
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
              onSave('');
            }}
          >
            {t('settings.cal.clear')}
          </button>
        )}
      </div>
      {result && <small>{result}</small>}
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

/**
 * 펫 고르기 (6단계): 기본 펫 다섯 마리(입체로 보기면 실제 3D 그림)와 보관한 사진 펫.
 * 고르면 지금 사진 펫은 보관함으로 간다. 보관한 펫은 두 번 눌러 지운다
 */
function PetPicker({
  snap,
  onPick,
  onRemove,
}: {
  snap: SettingsSnapshot;
  onPick: (choice: { kind: PetKind } | { id: string }) => void;
  onRemove: (id: string) => void;
}) {
  const s = snap.settings;
  const [thumbs, setThumbs] = useState<Partial<Record<PetKind, string>>>({});
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    setThumbs(kindThumbs(s.pet3d));
  }, [s.pet3d]);
  // 만든 펫도 펫 화면과 같은 모습으로: 입체로 보기면 figure 는 3D, relief 는 2.5D, 아니면 사진
  const [, setDrawn] = useState(0);
  useEffect(() => {
    if (!s.pet3d) return;
    let alive = true;
    void drawLooks([...(snap.current ? [snap.current] : []), ...snap.library], () => alive).then(
      (n) => alive && n > 0 && setDrawn((v) => v + 1),
    );
    return () => {
      alive = false;
    };
  }, [s.pet3d, snap.current, snap.library]);
  const look = (v: PetLookView) => (s.pet3d && lookThumbs.get(v.key)) || v.thumb;
  return (
    <div className="pet-grid">
      {s.petImage && snap.current && (
        <div className="pet-card on" aria-current="true">
          <img src={look(snap.current)} alt="" />
          <span className="pet-name">{s.petName}</span>
          <small>
            {t('settings.pets.now')}
            {snap.current.age && (
              <span className="pet-age">{t(`settings.pets.age.${snap.current.age}`)}</span>
            )}
          </small>
        </div>
      )}
      {PET_KINDS.map((k) => {
        const on = !s.petImage && s.petKind === k.id;
        return (
          <button
            key={k.id}
            type="button"
            className={`pet-card${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => !on && onPick({ kind: k.id })}
          >
            {thumbs[k.id] ? <img src={thumbs[k.id]} alt="" /> : <i />}
            <span className="pet-name">{k.label}</span>
          </button>
        );
      })}
      {snap.library.map((p) => (
        <div key={p.id} className="pet-card saved">
          <button type="button" className="pick" onClick={() => onPick({ id: p.id })}>
            {p.thumb ? <img src={look(p)} alt="" /> : <i />}
            <span className="pet-name">{p.name}</span>
            {(p.look !== 'photo' || p.age) && (
              <small>
                {p.look !== 'photo' &&
                  (p.look === 'figure' ? t('settings.pets.figure') : t('settings.pets.relief'))}
                {/* AI 일러스트 나이 단계 (아기, 청소년, 어른) */}
                {p.age && <span className="pet-age">{t(`settings.pets.age.${p.age}`)}</span>}
              </small>
            )}
          </button>
          <button
            type="button"
            className={`remove${confirm === p.id ? ' sure' : ''}`}
            aria-label={t('settings.pets.remove', { name: p.name })}
            title={t('settings.pets.remove', { name: p.name })}
            onClick={() => {
              if (confirm === p.id) onRemove(p.id);
              else setConfirm(p.id);
            }}
            onBlur={() => setConfirm('')}
          >
            {confirm === p.id ? t('settings.pets.removeSure') : '×'}
          </button>
        </div>
      ))}
    </div>
  );
}

/** 기본 펫 미리보기 그림. 입체로 보기면 3D 를 한 번씩 그려 사진으로 만든다 (렌더러는 하나만) */
let thumbPet: Pet3D | undefined;
const THUMB_SIDE = 96;
function thumbCanvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = THUMB_SIDE * dpr;
  c.height = THUMB_SIDE * dpr;
  const ctx = c.getContext('2d');
  return ctx ? { c, ctx } : undefined;
}
/** 펫 하나를 쉬는 모습으로 그려 PNG data URL 로 */
function shot(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, kind: PetKind, model3d?: Pet3D): string {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const scale = c.width / CANVAS_SIZE;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPet(ctx, { mood: 'idle', elapsed: 0, blink: -1, kind, viewSize: THUMB_SIDE, model3d });
  return c.toDataURL('image/png');
}
function kindThumbs(use3d: boolean): Partial<Record<PetKind, string>> {
  const tc = thumbCanvas();
  if (!tc) return {};
  if (use3d) thumbPet ??= Pet3D.create(() => {});
  const out: Partial<Record<PetKind, string>> = {};
  for (const k of PET_KINDS) {
    if (use3d && thumbPet) thumbPet.setBlueprint(DEFAULT_BLUEPRINTS[k.id]);
    out[k.id] = shot(tc.c, tc.ctx, k.id, use3d ? thumbPet : undefined);
  }
  thumbPet?.clear();
  return out;
}

/**
 * 만든 펫 입체 썸네일 (key 마다 한 번, 창이 열려 있는 동안 기억). 그리지 못하면 빈 글이라 사진이 보인다.
 * 보관함이 12마리여도 창이 멈추지 않게 한 마리 그릴 때마다 한 번 쉰다. 렌더러는 기본 펫과 같은 thumbPet 하나
 */
const lookThumbs = new Map<string, string>();
async function drawLooks(views: PetLookView[], alive: () => boolean): Promise<number> {
  const todo = views.filter((v) => v.look !== 'photo' && !lookThumbs.has(v.key));
  if (!todo.length) return 0;
  const tc = thumbCanvas();
  thumbPet ??= Pet3D.create(() => {});
  let n = 0;
  for (const v of todo) {
    await new Promise((r) => setTimeout(r, 0));
    if (!alive()) break;
    if (lookThumbs.has(v.key)) continue;
    let url = '';
    try {
      if (tc && thumbPet?.ok) {
        if (v.look === 'figure' && v.model) thumbPet.setBlueprint(v.model);
        else if (v.look === 'relief' && v.depth && v.thumb) {
          const [photo, depth] = await Promise.all([loadImage(v.thumb), loadImage(v.depth)]);
          if (!alive()) break;
          thumbPet.setRelief(photo, depth);
        } else throw new Error('no look');
        // drawPet 을 거치지 않는다: 입체를 못 그리면 drawPet 은 기본 펫(콩이)을 그려 다른 펫처럼 보인다
        const { c, ctx } = tc;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        const scale = c.width / CANVAS_SIZE;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const top = thumbPet.draw(
          ctx,
          { mood: 'idle', elapsed: 0, blink: -1, viewSize: THUMB_SIDE },
          0,
          1,
          1,
          undefined,
        );
        url = top === undefined ? '' : c.toDataURL('image/png');
      }
    } catch {
      url = '';
    }
    lookThumbs.set(v.key, url);
    n++;
  }
  thumbPet?.clear();
  return n;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
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

/** 받은 모델과 크기, 지우기 */
function Storage({ list, onDelete }: { list: SettingsSnapshot['storage']; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const total = list.reduce((a, m) => a + m.bytes, 0);
  if (list.length === 0) return <small className="below">{t('settings.storage.empty')}</small>;
  return (
    <>
      <ul className="storage">
        {list.map((m) => (
          <li key={m.id}>
            <span className="model-name">{m.label}</span>
            <b>{formatBytes(m.bytes)}</b>
            <button
              type="button"
              className={`ghost small${confirm === m.id ? ' danger' : ''}`}
              onClick={() => {
                if (confirm === m.id) onDelete(m.id);
                else setConfirm(m.id);
              }}
              onBlur={() => setConfirm('')}
            >
              {confirm === m.id ? t('settings.storage.sure') : t('settings.storage.delete')}
            </button>
          </li>
        ))}
      </ul>
      <small className="below">{t('settings.storage.hint', { total: formatBytes(total) })}</small>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  /** 지금 상태 한 줄 (부스트가 배터리라 쉬는 중 등) */
  note?: string | undefined;
  onChange: (on: boolean) => void;
}

function Toggle({ label, hint, on, disabled, note, onChange }: ToggleProps) {
  return (
    <div className={`toggle ${disabled ? 'disabled' : ''}`}>
      <div className="text">
        <span>{label}</span>
        {note && <small className="toggle-note">{note}</small>}
        <small>{hint}</small>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={on ? 'on' : ''}
        onClick={() => onChange(!on)}
      >
        <i />
      </button>
    </div>
  );
}
