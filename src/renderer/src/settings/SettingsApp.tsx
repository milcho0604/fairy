import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { saveErrorText } from '../../../shared/download-error.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import { lookKey, type Settings } from '../../../shared/settings.ts';
import { groupRows, type RowKind, searchSettings } from '../../../shared/settings-search.ts';
import {
  globalTabKey,
  SETTINGS_TABS,
  type SettingsTab,
  stepTab,
  tabFromHash,
  tabKeyStep,
  tabOfSection,
} from '../../../shared/settings-tabs.ts';
import { escClosesWindow } from '../panel/keys.ts';
import { AboutTab } from './tabs/AboutTab.tsx';
import { AiTab } from './tabs/AiTab.tsx';
import { AssistTab } from './tabs/AssistTab.tsx';
import { DataTab } from './tabs/DataTab.tsx';
import { EaseTab } from './tabs/EaseTab.tsx';
import { PetTab } from './tabs/PetTab.tsx';
import { bridge, type TabProps } from './ui.tsx';

/** 이 너비부터 탭을 왼쪽에 세로로 (settings.css 의 @media 와 같은 값) */
const SIDE_NAV = '(min-width: 640px)';

export function SettingsApp() {
  const [snap, setSnap] = useState<SettingsSnapshot>();
  const [saved, setSaved] = useState('');
  // 실패나 막힘 안내는 빨간 글씨 (성공 안내와 같은 초록이면 된 것처럼 읽힌다)
  const [savedError, setSavedError] = useState(false);
  const libraryKey = useRef('');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Esc 로 창을 닫는다 (패널과 같게). 찾기 칸이 먼저 글을 비우고(preventDefault), 한글 조합 중 Esc 는 조합만 끝낸다
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (escClosesWindow(e)) window.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    bridge.get().then(setSnap);
    bridge.onChanged((settings) => {
      // 펫 만들기 창에서 새 펫을 저장하면 보관함과 지금 그림이 바뀐다. 그때만 다시 받는다
      // 몸을 다시 만들면(걸음새) 설계도 파일만 바뀐다. 그때도 지금 펫 카드와 몸 모양을 다시 받는다
      // 밀크, 초코의 네 발 피규어를 켜고 끌 때도 (사진이 피규어로 바뀐다, #28)
      const key = lookKey(settings);
      if (key !== libraryKey.current) {
        libraryKey.current = key;
        // 설정과 보관함을 한 번에 바꾼다. 설정만 먼저 바꾸면 잠깐 새 지금 펫과 옛 보관함이 섞여 카드가 사라졌다 나타났다
        void bridge
          .get()
          .then((next) =>
            setSnap(
              (s) => s && { ...s, settings: next.settings, library: next.library, current: next.current },
            ),
          );
        return;
      }
      setSnap((s) => s && { ...s, settings });
    });
    bridge.onPower((onBattery) => setSnap((s) => s && { ...s, onBattery }));
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  // ---- 탭 (설정 창 재구성): 처음은 창 주소 # (칸 이름이나 메인이 기억한 지난번 탭) ----
  const [tab, setTabState] = useState<SettingsTab>(() => tabFromHash(location.hash));
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const [side, setSide] = useState(() => matchMedia(SIDE_NAV).matches);
  useEffect(() => {
    const mq = matchMedia(SIDE_NAV);
    const on = () => setSide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => bridge.rememberTab(tab), [tab]);

  // ---- 설정 찾기: 찾는 말에 맞는 칸과 줄만 보인다 (그리기는 그대로, 그린 뒤 hidden 만 바꾼다) ----
  // 탭은 모두 그려 두고(고치던 글, 진행 중인 일을 잃지 않게) 안 보는 탭만 숨긴다. 찾는 중에는 모든 탭에서 찾는다
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [noHit, setNoHit] = useState(false);
  // 탭마다 맞은 칸 수 (찾는 중에 탭 옆에 보인다). 다시 그리기를 줄이려고 글로 둔다
  const [hitKey, setHitKey] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== '';

  const setTab = (next: SettingsTab, focusTab = false) => {
    setTabState(next);
    mainRef.current?.scrollTo({ top: 0 });
    if (focusTab) tabRefs.current[next]?.focus();
  };
  /** 탭을 누르면 찾기를 끝내고 그 탭으로 */
  const pickTab = (next: SettingsTab, focusTab = false) => {
    if (searching) setQuery('');
    setTab(next, focusTab);
  };

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const panels = [...main.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]')];
    const sections = panels.flatMap((panel) =>
      [...panel.querySelectorAll<HTMLElement>(':scope > section')].map((sec) => {
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
          panel,
          sec,
          groups,
          title: sec.querySelector(':scope > h2')?.textContent ?? '',
          rows: groups.map((g) => g.map((k) => k.textContent ?? '').join(' ')),
        };
      }),
    );
    const r = searchSettings(sections, query, composing);
    sections.forEach((d, i) => {
      d.sec.hidden = !r[i]?.show;
      d.groups.forEach((g, j) => {
        for (const k of g) k.hidden = !r[i]?.rows[j];
      });
    });
    const counts = panels.map((panel) => sections.filter((d, i) => d.panel === panel && r[i]?.show).length);
    // 찾는 중이면 맞은 칸이 있는 탭을 모두, 아니면 고른 탭만
    panels.forEach((panel, i) => {
      panel.hidden = searching ? !counts[i] : panel.dataset.tab !== tab;
    });
    setNoHit(searching && r.every((x) => !x.show));
    setHitKey(searching ? counts.join(',') : '');
  });
  const hits = hitKey ? hitKey.split(',').map(Number) : [];

  // Cmd/Ctrl+F 로 찾기 칸에, Cmd/Ctrl+[ ] 와 1~6 으로 탭 옮기기
  const tabNow = useRef(tab);
  tabNow.current = tab;
  const searchingNow = useRef(searching);
  searchingNow.current = searching;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.isComposing) return;
      const next = globalTabKey(
        { key: e.key, code: e.code, mod, altKey: e.altKey, shiftKey: e.shiftKey },
        tabNow.current,
      );
      if (!next) return;
      e.preventDefault();
      if (searchingNow.current) setQuery('');
      setTabState(next);
      mainRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 메뉴 막대 "의견 보내기"(칸 열기): 찾기를 끝내고 그 칸의 탭으로. 칸으로 내려가기는 칸(Stats)이 한다
  useEffect(() => {
    bridge.onFocus((section) => {
      setQuery('');
      setTabState(tabOfSection(section));
    });
  }, []);

  if (!snap) return <div className="loading">{t('settings.loading')}</div>;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';

  // 앞 안내의 지우기 타이머가 새 안내를 일찍 지우지 않게 하나만 둔다 (빈 이름 안내 뒤 "이름을 바꿨어"가 바로 사라졌다)
  const flash = (message: string, error = false) => {
    setSaved(message);
    setSavedError(error);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSaved(''), 2400);
  };

  const update = async (patch: Partial<Settings>, message = t('settings.saved')) => {
    let next: Settings;
    try {
      next = await bridge.set(patch);
    } catch (err) {
      // 저장 공간이 없거나 폴더에 쓸 수 없으면 바뀌지 않았다고 알린다 (예전에는 말없이 원래대로 돌아갔다)
      console.warn('settings save failed', err);
      flash(saveErrorText(err), true);
      return snap.settings;
    }
    setSnap((v) => v && { ...v, settings: next });
    flash(message);
    return next;
  };

  const props: TabProps = { snap, setSnap, update, flash };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = tabKeyStep(e.key, side);
    if (!step) return;
    e.preventDefault();
    pickTab(stepTab(tab, step), true);
  };

  return (
    <div className="settings">
      <header>
        {/* 창 제목: 화면 읽기 프로그램에는 h1, 보이는 글은 그대로 */}
        <h1 className="sr-only">{t('settings.title')}</h1>
        <strong aria-hidden="true">{t('settings.title')}</strong>
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

      <div className="body">
        <div
          className={`tabs${searching ? ' searching' : ''}`}
          role="tablist"
          aria-label={t('settings.tabs.label')}
          aria-orientation={side ? 'vertical' : 'horizontal'}
        >
          {SETTINGS_TABS.map((id, i) => {
            const on = id === tab;
            const n = hits[i] ?? 0;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-controls={`panel-${id}`}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                className={`${on ? 'on' : ''}${searching && n === 0 ? ' miss' : ''}`}
                title={`${t(`settings.tab.${id}.hint`)} (${mod}+${i + 1})`}
                onClick={() => pickTab(id)}
                onKeyDown={onTabKey}
              >
                <span className="tab-name">{t(`settings.tab.${id}`)}</span>
                {/* 세로로 늘어놓을 때(넓은 창)만 보이는 풀이 */}
                <span className="tab-hint" aria-hidden="true">
                  {t(`settings.tab.${id}.hint`)}
                </span>
                {searching && n > 0 && (
                  <span className="tab-hits" role="img" aria-label={t('settings.tabs.hits', { n })}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <main ref={mainRef}>
          {noHit && (
            <p className="search-empty" role="status">
              {t('settings.search.empty', { q: query.trim() })}
            </p>
          )}
          {/* 패널의 hidden 은 위 useLayoutEffect 가 정한다 (찾는 중에는 맞은 칸이 있는 탭 모두) */}
          {SETTINGS_TABS.map((id) => (
            <div
              key={id}
              role="tabpanel"
              id={`panel-${id}`}
              aria-labelledby={`tab-${id}`}
              data-tab={id}
              className="tab-panel"
            >
              {/* 찾는 중에는 어느 탭의 칸인지 머리말로 */}
              {searching && <h3 className="tab-head">{t(`settings.tab.${id}.hint`)}</h3>}
              {id === 'pet' && <PetTab {...props} />}
              {id === 'assist' && <AssistTab {...props} />}
              {id === 'ai' && <AiTab {...props} />}
              {id === 'ease' && <EaseTab {...props} />}
              {id === 'data' && <DataTab {...props} />}
              {id === 'about' && <AboutTab {...props} searching={searching} />}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
