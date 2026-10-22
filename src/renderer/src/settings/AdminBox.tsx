// 운영자 칸 (이슈 #101, #150): 운영자 계정(서버가 ADMIN_GOOGLE_SUBS 로 정한다)일 때만 그린다. 아니면 DOM 에 아무것도 없다.
// 요약 한 장(계정, 코인, 비용, 확인할 것, 신고 대기, 최근 운영 기록 몇 줄)과 "웹에서 열기"뿐이다. 관리 작업(지급, 공지,
// 이벤트, 쿠폰, 기능 스위치, 예산)은 웹 운영자 화면에서 한다. 같은 일을 하는 범위가 앱과 웹에서 달라 생기던 어긋남을 없애려고
// 앱의 쓰기 길은 닫았다 (서버 /v1/admin/* 쓰기는 옛 앱을 위해 그대로 둔다).
// 조회는 세 상태를 분명히 보인다: 불러오는 중, 실패(다시 시도), 받은 뒤 새로 못 받음(지난 내용과 안내). 빈 목록은 빈 상태 글.
// 세션 토큰은 화면에 오지 않는다: 메인이 대신 부르고 서버가 요청마다 운영자인지 다시 본다.
import { useCallback, useEffect, useState } from 'react';
import {
  type AdminSummary,
  actionName,
  adminSummaryOf,
  todoLabel,
  whoName,
} from '../../../shared/admin-summary.ts';
import type { AdminWebPlace } from '../../../shared/admin-web.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ServerBridge } from '../../../shared/server-account.ts';
import { useServerStatus } from './ServerAccountBox.tsx';
import { Section } from './ui.tsx';

const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;

type View = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: AdminSummary; stale: boolean };

export function AdminBox() {
  const [s] = useServerStatus();
  const b: ServerBridge | undefined = window.jjakkungServer;
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [webFailed, setWebFailed] = useState(false);
  const admin = !!s?.admin;

  const load = useCallback(async () => {
    if (!b) return;
    setBusy(true);
    let data: AdminSummary | undefined;
    try {
      data = adminSummaryOf(await b.adminOverview());
    } catch {
      data = undefined;
    }
    // 받았으면 새로, 못 받았으면 지난 내용은 두고 알린다 (처음부터 못 받았으면 실패 화면)
    setView((prev) =>
      data
        ? { kind: 'ready', data, stale: false }
        : prev.kind === 'ready'
          ? { ...prev, stale: true }
          : { kind: 'failed' },
    );
    setBusy(false);
  }, []);

  // 운영자일 때만 처음 한 번
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음과 운영자 여부가 바뀔 때만
  useEffect(() => {
    if (admin) void load();
  }, [admin]);

  const openWeb = async (place: AdminWebPlace) => {
    setWebFailed(false);
    let opened: string | undefined;
    try {
      opened = await b?.adminOpenWeb(place);
    } catch {
      opened = undefined;
    }
    if (!opened) setWebFailed(true);
  };

  if (!admin || !b) return null;

  if (view.kind === 'loading')
    return (
      <Section title={t('admin.title')}>
        <div className="admin-box server-box">
          <small className="admin-working" role="status" aria-live="polite">
            {t('admin.loading')}
          </small>
        </div>
      </Section>
    );

  if (view.kind === 'failed')
    return (
      <Section title={t('admin.title')}>
        <div className="admin-box server-box">
          <div className="admin-group">
            <small className="warn admin-err" role="alert">
              {t('admin.failed')}
            </small>
            <div className="action-row">
              <button type="button" className="ghost small" disabled={busy} onClick={() => void load()}>
                {busy ? t('admin.refreshing') : t('admin.retry')}
              </button>
            </div>
            {busy && (
              <small className="admin-working" role="status" aria-live="polite">
                {t('admin.refreshing')}
              </small>
            )}
          </div>
        </div>
      </Section>
    );

  const d = view.data;
  return (
    <Section title={t('admin.title')}>
      <div className="admin-box server-box">
        <small>{t('admin.hint')}</small>
        {view.stale && (
          <small className="warn admin-err" role="alert">
            {t('admin.stale')}
          </small>
        )}
        <small className="server-sync">
          {t('admin.stats', {
            accounts: d.accounts,
            coins: d.coins,
            passes: d.passes,
            cost: usd(d.costMicros),
            budget: usd(d.budgetMicros),
          })}
        </small>
        <small className="server-sync">
          {t('admin.counts', { todo: d.todo.length, reports: d.reports })}
        </small>

        {d.today && (
          <small className="server-sync">
            {t('admin.today', {
              signups: d.today.signups,
              active: d.today.active,
              asks: d.today.asks,
              cost: usd(d.today.costMicros),
            })}
          </small>
        )}
        {d.backup && (
          <small className="server-sync">
            {!d.backup.enabled
              ? t('admin.backup.off')
              : d.backup.lastUploadAt === null
                ? t('admin.backup.none')
                : t('admin.backup.last', {
                    at: new Date(d.backup.lastUploadAt).toLocaleString(),
                    files: d.backup.files,
                  })}
          </small>
        )}
        {d.backup?.enabled && <small>{t('admin.backup.unknown')}</small>}
        {d.locked && (
          <small className={`server-sync${d.locked.force > 0 ? ' warn' : ''}`}>
            {t('admin.locked', { force: d.locked.force, restricted: d.locked.restricted })}
          </small>
        )}

        <div className="admin-group">
          <strong>{t('admin.todo.title')}</strong>
          {d.todo.length === 0 ? (
            <small>{t('admin.todo.none')}</small>
          ) : (
            <ul className="admin-list">
              {d.todo.map((x) => (
                <li key={`${x.kind}`}>
                  <small className={`admin-item${x.level === 'bad' ? ' warn' : ''}`}>{todoLabel(x)}</small>
                  <button type="button" className="ghost small" onClick={() => void openWeb(x.place)}>
                    {t('admin.web.openThis')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-group">
          <strong>{t('admin.recent.title')}</strong>
          {d.recent.length === 0 ? (
            <small>{t('admin.recent.empty')}</small>
          ) : (
            <ul className="admin-list admin-log">
              {d.recent.map((l) => (
                <li key={`${l.at}-${l.action}-${l.actor}-${l.target ?? ''}`}>
                  <small>
                    {new Date(l.at).toLocaleString()} {whoName(l)} {actionName(l.action)}{' '}
                    {l.targetName ?? l.target ?? ''}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="action-row">
          <button type="button" className="ghost small" disabled={busy} onClick={() => void load()}>
            {busy ? t('admin.refreshing') : t('admin.refresh')}
          </button>
          <button type="button" className="ghost small" onClick={() => void openWeb('home')}>
            {t('admin.web.open')}
          </button>
        </div>
        {busy && (
          <small className="admin-working" role="status" aria-live="polite">
            {t('admin.refreshing')}
          </small>
        )}
        {webFailed && (
          <small className="warn admin-err" role="alert">
            {t('admin.web.failed')}
          </small>
        )}
        <small>{t('admin.web.hint')}</small>
      </div>
    </Section>
  );
}
