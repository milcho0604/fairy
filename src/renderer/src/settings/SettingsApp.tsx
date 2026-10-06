import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PERSONAS } from '../../../shared/ai/persona.ts';
import { type BetaReport, TARGET } from '../../../shared/beta-stats.ts';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../shared/chatter.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
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

const CHATTER_HINT: Record<ChatterLevel, string> = {
  quiet: '답이 왔다는 알림만 해.',
  normal: `바쁠 때 같은 상태 알림까지, 한 시간에 ${MAX_PER_HOUR.normal}개까지.`,
  chatty: `혼잣말도 하고, 한 시간에 ${MAX_PER_HOUR.chatty}개까지.`,
};

export function SettingsApp() {
  const [snap, setSnap] = useState<SettingsSnapshot>();
  const [name, setName] = useState('');
  const [scale, setScale] = useState(1);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    bridge.get().then((s) => {
      setSnap(s);
      setName(s.settings.petName);
      setScale(s.scale);
    });
    bridge.onChanged((settings) => setSnap((s) => s && { ...s, settings }));
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  if (!snap) return <div className="loading">불러오는 중</div>;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';

  const flash = (message: string) => {
    setSaved(message);
    setTimeout(() => setSaved(''), 2400);
  };

  const update = async (patch: Partial<Settings>, message = '저장했어') => {
    const next = await bridge.set(patch);
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
    return next;
  };

  const saveName = async () => {
    const next = await update({ petName: name }, '이름을 바꿨어');
    setName(next.petName);
  };

  const preview = name.trim() || s.petName;

  return (
    <div className="settings">
      <header>
        <strong>설정</strong>
        <span className="saved" role="status" aria-live="polite">
          {saved}
        </span>
      </header>

      <main>
        <Section title="펫">
          <label className="field">
            <span>이름</span>
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
            <small>
              메뉴에는 "{withParticle(preview, '이랑')} 같이 보기", "{withParticle(preview, '과')} 대화"처럼
              보여. {PET_NAME_MAX}
              자까지.
            </small>
          </label>

          <div className="field">
            <span>모습</span>
            <div className="row">
              <button type="button" className="ghost" onClick={() => bridge.openMaker()}>
                {s.petImage ? '사진 펫 바꾸기' : '사진으로 펫 만들기'}
              </button>
            </div>
            <small>
              {s.petImage
                ? '지금은 사진으로 만든 펫이야. 기본 펫으로 돌아가기도 거기서 해.'
                : '반려동물이나 인형 사진 한 장으로 펫을 바꿀 수 있어.'}
            </small>
          </div>

          {!s.petImage && (
            <div className="field">
              <span>기본 펫 모양</span>
              <fieldset className="segmented" aria-label="기본 펫 모양">
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
              <span>상태별 포즈</span>
              <div className="row wrap">
                {POSE_KINDS.map((p) => (
                  <button key={p.id} type="button" className="ghost" onClick={() => bridge.openMaker(p.id)}>
                    {s.petPoses[p.id] ? `${p.label} 바꾸기` : `${p.label} 사진`}
                  </button>
                ))}
              </div>
              <small>기쁠 때, 졸릴 때, 배고플 때 다른 사진으로 바뀌어. 없으면 기본 사진 그대로야.</small>
            </div>
          )}

          <label className="field">
            <span>
              크기 <b>{Math.round(scale * 100)}%</b>
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
            <small>펫 위에서 {mod} + 휠, 트랙패드 핀치로도 바꿀 수 있어.</small>
          </label>

          <Toggle
            label="가끔 돌아다니기"
            hint="가만히 있다가 가끔 걷고 앉아. 끄면 늘 그 자리에 있어."
            on={s.wander}
            onChange={(v) => update({ wander: v })}
          />
        </Section>

        <Section title="친구 펫">
          <Friends
            list={s.friends}
            onChange={(friends) => update({ friends }, '친구 펫을 바꿨어')}
            onImport={async () => {
              const r = await bridge.importFriend();
              if (r.message) flash(r.message);
            }}
          />
        </Section>

        <Section title="삐짐">
          <div className="field">
            <span>쉬는 날 (이날은 안 와도 안 삐져)</span>
            <fieldset className="days" aria-label="쉬는 날">
              {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => {
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
            label="매운맛"
            hint="안 온 날이 4일을 넘으면 더 크게 삐져(7일까지). 잃는 건 없고 할 일 하나면 바로 풀려."
            on={s.spicy}
            onChange={(v) => update({ spicy: v })}
          />
        </Section>

        <Section title="말풍선">
          <fieldset className="segmented" aria-label="말풍선 빈도">
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
          <small className="below">{CHATTER_HINT[s.chatter]}</small>
        </Section>

        <Section title="AI">
          <div className="field">
            <span>성격과 말투</span>
            <fieldset className="segmented wrap" aria-label="성격과 말투">
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
            <small>{PERSONAS.find((p) => p.id === s.persona)?.hint} 다음 질문부터 바뀌어.</small>
          </div>
          <Toggle
            label="내 할 일 같이 보내기"
            hint="질문할 때 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 제목을 AI 에 같이 보내. '오늘 뭐부터 할까?'에 답할 수 있어. 채팅 창 아래에서도 켜고 끌 수 있어."
            on={s.aiKnowsTodos}
            onChange={(v) => update({ aiKnowsTodos: v })}
          />
          <Toggle
            label="내 MCP 도구 쓰기"
            hint={
              s.aiIsolation
                ? '아래 "내 AI 설정 없이 부르기"를 끄면 쓸 수 있어. Claude Code 에 연결해 둔 노션, 슬랙 같은 MCP 도구를 채팅에서 써.'
                : `Claude Code 에 연결해 둔 MCP 도구(${snap.myMcpServers.length}개 서버)를 채팅에서 묻지 않고 써. 파일, 명령 도구는 여전히 꺼 둬. 글쓰기 같은 도구도 쓸 수 있으니 켤 때 주의해 줘.`
            }
            on={s.myMcp}
            disabled={s.aiIsolation}
            onChange={(v) => update({ myMcp: v })}
          />
          <Toggle
            label="내 AI 설정 없이 부르기 (권장)"
            hint="Claude Code 와 Codex 를 부를 때 내 훅, MCP, 스킬을 싣지 않아. 끄면 내 설정을 그대로 쓰는데 답이 느려지고 한도를 더 쓸 수 있어. 바꾸면 새 대화로 시작해."
            on={s.aiIsolation}
            onChange={(v) => update({ aiIsolation: v })}
          />
        </Section>

        <Section title="다른 AI 에서 짝꿍 쓰기 (MCP)">
          <McpSetup exec={snap.mcp.exec} script={snap.mcp.script} onCopied={() => flash('복사했어')} />
        </Section>

        <Section title="시작">
          <Toggle
            label="컴퓨터를 켜면 같이 켜기"
            hint={
              snap.packaged
                ? '로그인하면 짝꿍이 저절로 떠.'
                : '설치한 앱에서만 바꿀 수 있어. 지금은 개발 중 실행이야.'
            }
            on={s.launchAtLogin}
            disabled={!snap.packaged}
            onChange={(v) => update({ launchAtLogin: v })}
          />
        </Section>

        <Section title="하루 회고">
          <label className="field">
            <span>회고 시각</span>
            <input
              type="time"
              value={`${String(Math.floor(s.reviewMinute / 60)).padStart(2, '0')}:${String(s.reviewMinute % 60).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (Number.isInteger(h) && Number.isInteger(m))
                  update({ reviewMinute: (h ?? 0) * 60 + (m ?? 0) });
              }}
            />
            <small>
              이 시각이 지나고 처음 자리에 있을 때 오늘 끝낸 일을 알려 주고, 남은 오늘 마감을 내일로 넘길지
              물어봐.
            </small>
          </label>
        </Section>

        <Section title="캘린더 가져오기">
          <CalendarSetup
            url={s.icsUrl ?? ''}
            last={snap.calendarLast}
            onSave={(v) => update({ icsUrl: v || null } as never)}
            onMsg={flash}
          />
        </Section>

        <Section title="백업과 옮기기">
          <small>할 일, 메모, 일정, 코인, 펫, 설정을 폴더 하나로 내보내고, 다른 컴퓨터에서 가져와.</small>
          <div className="row wrap">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.exportData();
                if (r) flash('내보냈어');
              }}
            >
              내보내기
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.importData();
                if (r) flash(r);
              }}
            >
              가져오기
            </button>
          </div>
          <small>펫만 친구에게 주려면 .jjpet 파일로.</small>
          <div className="row wrap">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.exportPet();
                if (r) flash('펫 파일을 만들었어');
              }}
            >
              펫 내보내기
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await bridge.importPet();
                if (r.message) flash(r.message);
              }}
            >
              펫 가져오기
            </button>
          </div>
        </Section>

        <Section title="업데이트">
          <Toggle
            label="새 버전 알림"
            hint="하루에 한 번 새 버전이 나왔는지 보고, 나왔으면 펫이 알려 줘. 앱 이름과 버전 말고는 보내지 않아."
            on={s.updateCheck}
            onChange={(v) => update({ updateCheck: v })}
          />
          <div className="row">
            <button type="button" className="ghost" onClick={async () => flash(await bridge.checkUpdate())}>
              지금 확인
            </button>
            <button type="button" className="ghost" onClick={() => bridge.openOnboarding()}>
              시작 안내 다시 보기
            </button>
          </div>
        </Section>

        <Section title="단축키">
          <dl className="keys">
            {(['hide', 'quickAdd'] as const).map((id) => (
              <ShortcutRow
                key={id}
                id={id}
                value={s.shortcuts[id]}
                mac={mac}
                onSave={(acc) => update({ shortcuts: { ...s.shortcuts, [id]: acc } }, '단축키를 바꿨어')}
                onError={(m) => flash(m)}
              />
            ))}
            <dt>크게, 작게, 원래대로 (마우스가 펫 위에 있을 때)</dt>
            <dd>
              <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </dd>
          </dl>
        </Section>

        <Stats onCopied={() => flash('복사했어. 의견과 같이 붙여 넣어 줘')} />

        <p className="version">짝꿍 {snap.version}</p>
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
      label: '쓴 날',
      value: started ? `${report.dayNumber}일째 (켠 날 ${report.daysUsed}일)` : '오늘부터',
      goal: '14일째에도 켜 두기',
      ok: started ? report.dayNumber >= 14 || undefined : undefined,
    },
    {
      label: '하루 끝낸 할 일 (중앙값)',
      value: `${report.doneMedian}개`,
      goal: `${TARGET.doneMedian}개 이상`,
      ok: started ? report.doneMedian >= TARGET.doneMedian : undefined,
    },
    {
      label: '펫을 숨긴 시간',
      value: `${Math.round(report.hiddenRatio * 100)}%`,
      goal: `${TARGET.hiddenRatio * 100}% 미만`,
      ok: started ? report.hiddenRatio < TARGET.hiddenRatio : undefined,
    },
    {
      label: '같이 보기 (최근 7일)',
      value: `${report.look7}번`,
      goal: `${TARGET.look7}번 이상`,
      ok: started ? report.look7 >= TARGET.look7 : undefined,
    },
    {
      label: '멈춤과 갑자기 꺼짐 (최근 7일)',
      value: `${report.crash7}번`,
      goal: `${TARGET.crash7}번`,
      ok: started ? report.crash7 <= TARGET.crash7 : undefined,
    },
  ];

  return (
    <section ref={ref} id="stats" className={focus ? 'focus' : ''}>
      <h2>내 기록 (베타)</h2>
      <div className="card">
        <small>
          짝꿍이 쓸 만한지 보는 숫자야. 이 컴퓨터에만 있고 어디로도 보내지 않아. 의견을 보낼 때 복사해서 같이
          붙여 주면 큰 도움이 돼.
        </small>
        <table className="stats">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  <b>{r.value}</b>
                  <small>
                    목표 {r.goal}
                    {r.ok === true && <i className="met"> 달성</i>}
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
            기록 복사
          </button>
        </div>
        <small>복사한 글에는 날짜와 숫자만 들어가. 할 일 제목이나 대화 내용은 없어.</small>
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
      <small>친구 펫은 같이 돌아다니고 놀아. 할 일과 대화는 기본 펫이 맡아. {FRIENDS_MAX}마리까지.</small>
      {list.length > 0 && (
        <ul className="friends">
          {list.map((f) => (
            <li key={f.id}>
              <b>{f.name}</b>
              <small>{f.image ? '사진' : (PET_KINDS.find((k) => k.id === f.kind)?.label ?? '')}</small>
              <button
                type="button"
                className="link"
                onClick={() => onChange(list.filter((x) => x.id !== f.id))}
              >
                집에 보내기
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
            placeholder="친구 이름"
            aria-label="친구 이름"
            onChange={(e) => setName(e.target.value)}
          />
          <select value={kind} aria-label="친구 모양" onChange={(e) => setKind(e.target.value as PetKind)}>
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
            데려오기
          </button>
        </div>
      )}
      {!full && (
        <div className="row">
          <button type="button" className="link" onClick={onImport}>
            .jjpet 파일로 데려오기
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
            <span className="recording">키를 눌러 줘 (Esc 는 그만)</span>
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
          {recording ? '기록 중' : '바꾸기'}
        </button>
        {value !== SHORTCUT_DEFAULTS[id] && !recording && (
          <button type="button" className="link" onClick={() => onSave(SHORTCUT_DEFAULTS[id])}>
            기본으로
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
        <span>캘린더 주소 (.ics)</span>
        <input
          type="url"
          value={value}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() !== url && onSave(value.trim())}
        />
        <small>
          구글 캘린더: 설정 → 내 캘린더 → 캘린더 통합 → "iCal 형식의 비공개 주소"를 붙여 넣어. 30분마다 앞으로
          60일 일정을 가져와서 펫이 알려 줘. 이 주소는 이 컴퓨터에만 둬. (읽기만 하고, 짝꿍에서 넣은 일정은
          구글로 가지 않아.)
        </small>
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
          지금 가져오기
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
            지우기
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
      <small>
        Claude Code, Codex 에 짝꿍을 연결하면 그 안에서 "이거 짝꿍 할 일에 넣어 줘", "내일 3시 회의 일정 잡아
        줘"가 돼. 할 일, 메모, 일정을 넣고 볼 수 있어. 넣은 것은 몇 초 안에 패널에 보여.
      </small>
      <div className="field">
        <span>Claude Code: 터미널에서 한 번 실행</span>
        <pre className="cmd">{claude}</pre>
        <div className="row">
          <button type="button" className="ghost" onClick={() => copy(claude)}>
            명령 복사
          </button>
        </div>
      </div>
      <div className="field">
        <span>Codex: ~/.codex/config.toml 에 붙여 넣기</span>
        <pre className="cmd">{codex}</pre>
        <div className="row">
          <button type="button" className="ghost" onClick={() => copy(codex)}>
            설정 복사
          </button>
        </div>
      </div>
      <small>짝꿍을 다른 폴더로 옮기거나 다시 설치하면 경로가 바뀌니 다시 등록해 줘.</small>
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
