import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PERSONAS } from '../../../shared/ai/persona.ts';
import { type BetaReport, TARGET } from '../../../shared/beta-stats.ts';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../shared/chatter.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import {
  FRIENDS_MAX,
  type Friend,
  PET_KINDS,
  PET_NAME_MAX,
  type PetKind,
  POSE_KINDS,
  type Settings,
} from '../../../shared/settings.ts';
import {
  acceleratorLabel,
  SHORTCUT_DEFAULTS,
  SHORTCUT_LABEL,
  type ShortcutId,
  toAccelerator,
} from '../../../shared/shortcut.ts';
import { MAX_SCALE, MIN_SCALE } from '../../../shared/size.ts';

const bridge = window.jjakkungSettings;

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
  // 언어를 바꾸면 다시 켜야 보인다. 바꾼 뒤에만 다시 켜기 버튼을 보여 준다
  const [langChanged, setLangChanged] = useState(false);

  useEffect(() => {
    bridge.get().then((s) => {
      setSnap(s);
      setName(s.settings.petName);
      setScale(s.scale);
    });
    bridge.onChanged((settings) => setSnap((s) => s && { ...s, settings }));
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  if (!snap) return <div className="loading">{t('settings.loading')}</div>;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';

  const flash = (message: string) => {
    setSaved(message);
    setTimeout(() => setSaved(''), 2400);
  };

  const update = async (patch: Partial<Settings>, message = t('settings.saved')) => {
    const next = await bridge.set(patch);
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
    return next;
  };

  const saveName = async () => {
    const next = await update({ petName: name }, t('settings.nameChanged'));
    setName(next.petName);
  };

  const preview = name.trim() || s.petName;

  return (
    <div className="settings">
      <header>
        <strong>{t('settings.title')}</strong>
        <span className="saved" role="status" aria-live="polite">
          {saved}
        </span>
      </header>

      <main>
        <Section title={t('settings.pet')}>
          <label className="field">
            <span>{t('settings.name')}</span>
            <div className="row">
              <input
                value={name}
                maxLength={PET_NAME_MAX * 2}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <small>{t('settings.nameHint', { name: preview, max: PET_NAME_MAX })}</small>
          </label>

          <div className="field">
            <span>{t('settings.look')}</span>
            <div className="row">
              <button type="button" className="ghost" onClick={() => bridge.openMaker()}>
                {s.petImage ? t('settings.changePhotoPet') : t('settings.makePhotoPet')}
              </button>
            </div>
            <small>{s.petImage ? t('settings.photoPetNow') : t('settings.photoPetHint')}</small>
          </div>

          {!s.petImage && (
            <div className="field">
              <span>{t('settings.petKind')}</span>
              <fieldset className="segmented" aria-label={t('settings.petKind')}>
                {PET_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={s.petKind === k.id}
                    className={s.petKind === k.id ? 'on' : ''}
                    onClick={() => update({ petKind: k.id })}
                  >
                    {k.label}
                  </button>
                ))}
              </fieldset>
            </div>
          )}

          {s.petImage && (
            <div className="field">
              <span>{t('settings.poses')}</span>
              <div className="row wrap">
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

          <Toggle
            label={t('settings.wander')}
            hint={t('settings.wanderHint')}
            on={s.wander}
            onChange={(v) => update({ wander: v })}
          />
        </Section>

        <Section title={t('settings.friends')}>
          <Friends
            list={s.friends}
            onChange={(friends) => update({ friends }, t('settings.friendsChanged'))}
            onImport={async () => {
              const r = await bridge.importFriend();
              if (r.message) flash(r.message);
            }}
          />
        </Section>

        <Section title={t('settings.sulk')}>
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
            label={t('settings.myMcp')}
            hint={
              s.aiIsolation ? t('settings.myMcpOff') : t('settings.myMcpOn', { n: snap.myMcpServers.length })
            }
            on={s.myMcp}
            disabled={s.aiIsolation}
            onChange={(v) => update({ myMcp: v })}
          />
          <Toggle
            label={t('settings.aiIsolation')}
            hint={t('settings.aiIsolationHint')}
            on={s.aiIsolation}
            onChange={(v) => update({ aiIsolation: v })}
          />
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
            onCopied={() => flash(t('settings.copied'))}
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
            <div className="row">
              <small>{t('settings.langRestart')}</small>
              <button type="button" className="ghost" onClick={() => bridge.relaunch()}>
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
        </Section>

        <Section title={t('settings.review')}>
          <label className="field">
            <span>{t('settings.reviewTime')}</span>
            <input
              type="time"
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
          <div className="row wrap">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.exportData();
                if (r) flash(t('settings.exported'));
              }}
            >
              {t('settings.export')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.importData();
                if (r) flash(r);
              }}
            >
              {t('settings.import')}
            </button>
          </div>
          <small>{t('settings.petOnlyHint')}</small>
          <div className="row wrap">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.exportPet();
                if (r) flash(t('settings.petExported'));
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
          <div className="row">
            <button type="button" className="ghost" onClick={async () => flash(await bridge.checkUpdate())}>
              {t('settings.checkNow')}
            </button>
            <button type="button" className="ghost" onClick={() => bridge.openOnboarding()}>
              {t('settings.onboardingAgain')}
            </button>
          </div>
        </Section>

        <Section title={t('settings.shortcuts')}>
          <dl className="keys">
            {(['hide', 'quickAdd'] as const).map((id) => (
              <ShortcutRow
                key={id}
                id={id}
                value={s.shortcuts[id]}
                mac={mac}
                onSave={(acc) =>
                  update({ shortcuts: { ...s.shortcuts, [id]: acc } }, t('settings.shortcutChanged'))
                }
                onError={(m) => flash(m)}
              />
            ))}
            <dt>{t('settings.zoomKeys')}</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </dd>
          </dl>
        </Section>

        <Stats onCopied={() => flash(t('settings.statsCopied'))} />

        <p className="version">{t('settings.version', { v: snap.version })}</p>
      </main>
    </div>
  );
}

/**
 * 베타 기록 (P4-04). 기획서 성공 기준 다섯 가지를 지금 값과 목표로 보여 준다.
 * 메뉴 막대 "의견 보내기"로 열리면 이 칸으로 바로 내려온다.
 */
function Stats({ onCopied }: { onCopied: () => void }) {
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
      ok: started ? report.doneMedian >= TARGET.doneMedian : undefined,
    },
    {
      label: t('settings.stats.hidden'),
      value: `${Math.round(report.hiddenRatio * 100)}%`,
      goal: t('settings.stats.under', { n: TARGET.hiddenRatio * 100 }),
      ok: started ? report.hiddenRatio < TARGET.hiddenRatio : undefined,
    },
    {
      label: t('settings.stats.look'),
      value: t('settings.stats.times', { n: report.look7 }),
      goal: t('settings.stats.timesAtLeast', { n: TARGET.look7 }),
      ok: started ? report.look7 >= TARGET.look7 : undefined,
    },
    {
      label: t('settings.stats.crash'),
      value: t('settings.stats.times', { n: report.crash7 }),
      goal: t('settings.stats.times', { n: TARGET.crash7 }),
      ok: started ? report.crash7 <= TARGET.crash7 : undefined,
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
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              if (await bridge.copyStats()) onCopied();
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
function Friends({
  list,
  onChange,
  onImport,
}: {
  list: Friend[];
  onChange: (next: Friend[]) => void;
  onImport: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PetKind>('cat');
  const full = list.length >= FRIENDS_MAX;
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
              <button
                type="button"
                className="link"
                onClick={() => onChange(list.filter((x) => x.id !== f.id))}
              >
                {t('settings.friends.sendHome')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="friend-add">
          <input
            value={name}
            maxLength={PET_NAME_MAX * 2}
            placeholder={t('settings.friends.name')}
            aria-label={t('settings.friends.name')}
            onChange={(e) => setName(e.target.value)}
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
          <button
            type="button"
            className="ghost"
            disabled={!name.trim()}
            onClick={() => {
              onChange([...list, { id: `f-${Date.now().toString(36)}`, name: name.trim(), kind }]);
              setName('');
            }}
          >
            {t('settings.friends.add')}
          </button>
        </div>
      )}
      {!full && (
        <div className="row">
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
      <div className="row">
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
function McpSetup({ exec, script, onCopied }: { exec: string; script: string; onCopied: () => void }) {
  const q = (p: string) => `"${p.replace(/"/g, '\\"')}"`;
  const claude = `claude mcp add jjakkung -s user -e ELECTRON_RUN_AS_NODE=1 -- ${q(exec)} ${q(script)}`;
  const codex = [
    '[mcp_servers.jjakkung]',
    `command = ${JSON.stringify(exec)}`,
    `args = [${JSON.stringify(script)}]`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }',
  ].join('\n');
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    onCopied();
  };
  return (
    <>
      <small>{t('settings.mcp.intro')}</small>
      <div className="field">
        <span>{t('settings.mcp.claude')}</span>
        <pre className="cmd">{claude}</pre>
        <div className="row">
          <button type="button" className="ghost" onClick={() => copy(claude)}>
            {t('settings.mcp.copyCmd')}
          </button>
        </div>
      </div>
      <div className="field">
        <span>{t('settings.mcp.codex')}</span>
        <pre className="cmd">{codex}</pre>
        <div className="row">
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
  onChange: (on: boolean) => void;
}

function Toggle({ label, hint, on, disabled, onChange }: ToggleProps) {
  return (
    <div className={`toggle ${disabled ? 'disabled' : ''}`}>
      <div className="text">
        <span>{label}</span>
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
