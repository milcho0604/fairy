// 운영자 칸 (이슈 #101): 운영자 계정(서버가 ADMIN_GOOGLE_SUBS 로 정한다)일 때만 그린다. 아니면 DOM 에 아무것도 없다.
// 웹 /admin 과 같은 일을 한다: 기능 스위치(채팅 이용권 접근 모드), 예산과 정책, 계정 찾기와 허용, 차단, 정기 지급, 회수,
// 쪽지, 이벤트, 쿠폰, 공지와 최소/권장 버전, 운영 기록. 위험한 동작(모드 바꾸기, 회수, 최소 버전 올리기, 강제 업데이트 글)은
// 두 번 눌러야 한다. 세션 토큰은 화면에 오지 않는다: 메인이 대신 부르고 서버가 요청마다 운영자인지 다시 본다.
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { getLang, t } from '../../../shared/i18n/index.ts';
import type { AdminActionResult, ServerBridge } from '../../../shared/server-account.ts';
import { useServerStatus } from './ServerAccountBox.tsx';
import { Section } from './ui.tsx';

// biome-ignore lint/suspicious/noExplicitAny: 서버가 주는 운영자 화면 자료를 그대로 그린다 (모양은 server/src/admin-page.ts AdminView)
type View = any;
type Fields = Record<string, string | string[] | boolean | number>;

const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;

const ERRORS = [
  'confirm',
  'no_account',
  'over_cap',
  'over_remaining',
  'no_seat',
  'age',
  'live',
  'no_subscription',
  'too_high',
  'no_latest',
  'not_admin',
] as const;

/**
 * 서버 결과를 지금 말로. 한국어면 서버가 쓴 글 그대로 (자세한 까닭이 들어 있다), 영어면 코드로 고른 글.
 * 만든 쿠폰 코드는 어느 말이든 붙인다
 */
export function resultText(r: AdminActionResult): string {
  if (getLang() === 'ko') return r.text;
  const coupon =
    typeof r.data?.coupon === 'string' ? ` ${t('admin.couponCode', { code: r.data.coupon })}` : '';
  const mode = typeof r.data?.mode === 'string' ? ` ${t('admin.ai.mode')}: ${r.data.mode}` : '';
  if (r.ok) return `${t('admin.done')}${mode}${coupon}`;
  const code = (ERRORS as readonly string[]).includes(r.code ?? '')
    ? (r.code as (typeof ERRORS)[number])
    : 'invalid';
  return t(`admin.err.${code}`);
}

/** 언어에 맞는 글, 없으면 다른 말 */
const pick = (ko: string | undefined, en: string | undefined) =>
  (getLang() === 'en' ? en || ko : ko || en) ?? '';

/** 두 번 눌러야 하는 단추 (위험한 동작) */
function Sure(o: { label: string; onGo: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={`ghost small${armed ? ' danger' : ''}`}
      disabled={o.disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        o.onGo();
      }}
    >
      {armed ? t('admin.sure') : o.label}
    </button>
  );
}

/** 칸 몇 개짜리 작은 폼. 값은 이름으로 모은다 */
function useForm(init: Record<string, string>) {
  const [v, setV] = useState(init);
  const input = (name: string, label: string, type = 'text') => (
    <label className="field admin-field">
      <span className="admin-field-name">{label}</span>
      <input
        className="plain-input"
        type={type}
        value={v[name] ?? ''}
        onChange={(e) => setV((x) => ({ ...x, [name]: e.target.value }))}
      />
    </label>
  );
  return { v, setV, input };
}

/** 운영자 설정 세 칸을 서버가 알려 준 저장값으로 (비어 있으면 .env 상한을 쓰는 중이라 빈 칸) */
function limitsOf(ai: View): Record<string, string> {
  return {
    budget_usd: ai.setBudgetMicros == null ? '' : String(ai.setBudgetMicros / 1_000_000),
    daily_limit: ai.setDailyLimit == null ? '' : String(ai.setDailyLimit),
    input_chars: ai.setInputChars == null ? '' : String(ai.setInputChars),
  };
}

function Group(o: { title: string; children: ReactNode }) {
  return (
    <div className="admin-group">
      <strong>{o.title}</strong>
      {o.children}
    </div>
  );
}

export function AdminBox({ flash }: { flash: (message: string, error?: boolean) => void }) {
  const [s] = useServerStatus();
  const b: ServerBridge | undefined = window.jjakkungServer;
  const [view, setView] = useState<View>();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = !!s?.admin;

  const load = useCallback(
    async (query = q) => {
      if (!b) return;
      const r = await b.adminOverview(query || undefined);
      if (r) setView(r);
      else flash(t('admin.failed'), true);
    },
    [q, flash],
  );
  // 운영자일 때만 처음 한 번 (찾는 말이 바뀔 때마다 다시 받지 않는다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음과 운영자 여부가 바뀔 때만
  useEffect(() => {
    if (admin) void load('');
  }, [admin]);

  const act = async (action: string, fields: Fields) => {
    if (!b) return;
    setBusy(true);
    try {
      const r = await b.adminAction(action, fields);
      flash(resultText(r), !r.ok);
      if (r.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  const note = useForm({ message: '', coins: '0', chat_passes: '0', days: '30' });
  const sub = useForm({ monthly: '100', starts_on: '', ends_on: '' });
  const revoke = useForm({ count: '1' });
  const limits = useForm({ budget_usd: '', daily_limit: '', input_chars: '' });
  const ev = useForm({
    id: '',
    title_ko: '',
    title_en: '',
    body_ko: '',
    body_en: '',
    from: '',
    until: '',
    coins: '30',
  });
  const cp = useForm({ label: '', coins: '50', tickets: '0', max_uses: '100', until: '' });
  const nt = useForm({ id: '', title_ko: '', title_en: '', body_ko: '', body_en: '', link: '' });
  const ver = useForm({ minVersion: '', restrictVersion: '', recommendVersion: '' });
  const [evKind, setEvKind] = useState<'gift' | 'boost'>('gift');
  const [ntKind, setNtKind] = useState('info');
  const [mode, setMode] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: 새로 받은 자료로만 채운다
  useEffect(() => {
    if (!view) return;
    setMode(view.ai.mode);
    limits.setV(limitsOf(view.ai));
    ver.setV({
      minVersion: view.notices?.minVersion ?? '',
      restrictVersion: view.notices?.restrictVersion ?? '',
      recommendVersion: view.notices?.recommendVersion ?? '',
    });
  }, [view]);

  if (!admin || !b) return null;
  if (!view)
    return (
      <Section title={t('admin.title')}>
        <small>{t('admin.loading')}</small>
      </Section>
    );

  const ai = view.ai;
  const a = view.account;
  const ref = a?.code ?? '';
  return (
    <Section title={t('admin.title')}>
      <div className="admin-box server-box">
        <small>{t('admin.hint')}</small>
        <small className="server-sync">
          {t('admin.stats', {
            accounts: view.summary.accounts,
            coins: view.summary.coins,
            passes: view.summary.tickets,
            cost: usd(view.summary.aiCostMicros),
            budget: usd(ai.monthlyBudgetMicros),
          })}
        </small>
        <div className="action-row">
          <button type="button" className="ghost small" disabled={busy} onClick={() => void load()}>
            {t('admin.refresh')}
          </button>
        </div>

        <Group title={`${t('admin.features')}: ${t('admin.ai.title')}`}>
          <label className="field admin-field">
            <span className="admin-field-name">{t('admin.ai.mode')} (ai_chat)</span>
            <select className="plain-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              {(['off', 'allowlist', 'everyone'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`admin.ai.mode.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="action-row">
            <Sure
              label={t('admin.ai.modeSave')}
              disabled={busy || mode === ai.mode}
              onGo={() => void act('ai/mode', { mode, confirm: 'yes' })}
            />
          </div>
          {limits.input('budget_usd', t('admin.ai.budget', { cap: usd(ai.capBudgetMicros) }))}
          {limits.input('daily_limit', t('admin.ai.daily', { cap: ai.capDailyLimit }), 'number')}
          {limits.input('input_chars', t('admin.ai.inputChars', { cap: ai.capInputChars }), 'number')}
          <div className="action-row">
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() => {
                // 손댄 칸만 보낸다: 그대로인 칸은 서버가 저장된 값을 지키고, 비운 칸만 상한으로 되돌린다
                const saved = limitsOf(ai);
                void act(
                  'ai/limits',
                  Object.fromEntries(Object.entries(limits.v).filter(([k, x]) => x !== saved[k])),
                );
              }}
            >
              {t('admin.ai.limitsSave')}
            </button>
          </div>
          <small>
            {t('admin.ai.allow', { n: ai.allow.length })}:{' '}
            {ai.allow.map((x: View) => `${x.nickname ?? ''} ${x.code}`).join(', ')}
          </small>
        </Group>

        <Group title={t('admin.features')}>
          <small>{t('admin.features.kakao')}</small>
        </Group>

        <Group title={t('admin.find')}>
          <div className="action-row">
            <input
              className="plain-input admin-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('admin.find')}
            />
            <button type="button" className="ghost small" disabled={busy} onClick={() => void load(q)}>
              {t('admin.findGo')}
            </button>
          </div>
          {view.accounts.length > 1 && (
            <ul className="admin-list">
              {view.accounts.map((x: View) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setQ(x.code);
                      void load(x.code);
                    }}
                  >
                    {x.nickname ?? '-'} {x.code}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {a === null && <small className="warn">{t('admin.none')}</small>}
          {a && (
            <>
              <small className="admin-acct">
                {t('admin.acct.line', {
                  name: a.nickname ?? '-',
                  code: a.code,
                  age: a.age,
                  coins: a.balance,
                  passes: a.ai.remaining,
                })}
                {a.ai.allowed ? `, ${t('admin.acct.allowed')}` : ''}
                {a.ai.blocked ? `, ${t('admin.acct.blocked')}` : ''}
                {a.merged_into ? `, ${t('admin.acct.merged')}` : ''}
              </small>
              <small>{t('admin.acct.month', { n: a.ai.monthAsks, cost: usd(a.ai.monthCostMicros) })}</small>
              <small>
                {a.ai.subscription
                  ? t('admin.acct.sub', {
                      n: a.ai.subscription.monthly,
                      next: a.ai.subscription.nextFill ?? '-',
                    })
                  : t('admin.acct.noSub')}
              </small>
              <div className="action-row admin-wrap">
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() => void act('ai/allow', { account: ref, allowed: !a.ai.allowed })}
                >
                  {a.ai.allowed ? t('admin.allowOff') : t('admin.allowOn')}
                </button>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() => void act('ai/block', { account: ref, blocked: !a.ai.blocked })}
                >
                  {a.ai.blocked ? t('admin.blockOff') : t('admin.blockOn')}
                </button>
                {a.ai.subscription && (
                  <Sure
                    label={t('admin.cancelSub')}
                    disabled={busy}
                    onGo={() => void act('ai/cancel', { account: ref })}
                  />
                )}
              </div>
              {!a.ai.subscription && (
                <>
                  {sub.input('monthly', t('admin.subMonthly'), 'number')}
                  {sub.input('starts_on', t('admin.subStart'), 'date')}
                  {sub.input('ends_on', t('admin.subEnd'), 'date')}
                  <div className="action-row">
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy}
                      onClick={() => void act('ai/subscribe', { account: ref, mode: 'fill', ...sub.v })}
                    >
                      {t('admin.subscribe')}
                    </button>
                  </div>
                </>
              )}
              {revoke.input('count', t('admin.revokeCount'), 'number')}
              <div className="action-row">
                <Sure
                  label={t('admin.revoke')}
                  disabled={busy}
                  onGo={() =>
                    void act('ai/revoke', { account: ref, count: revoke.v.count ?? '1', confirm: 'yes' })
                  }
                />
              </div>
              <strong>{t('admin.note.title')}</strong>
              {note.input('message', t('admin.note.message'))}
              {note.input('coins', t('admin.note.coins'), 'number')}
              {note.input('chat_passes', t('admin.note.passes'), 'number')}
              {note.input('days', t('admin.note.days'), 'number')}
              <div className="action-row">
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy}
                  onClick={() => void act('notes', { account: ref, ...note.v })}
                >
                  {t('admin.note.send')}
                </button>
              </div>
            </>
          )}
        </Group>

        <Group title={t('admin.events.title')}>
          <ul className="admin-list">
            {view.events.slice(0, 10).map((e: View) => (
              <li key={e.id}>
                <small className="admin-item">
                  {e.id} {e.kind} {pick(e.title_ko, e.title_en)}
                </small>
                {Date.now() < Number(e.ends) && (
                  <Sure
                    label={t('admin.events.end')}
                    disabled={busy}
                    onGo={() => void act('events/end', { id: e.id })}
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="action-row">
            {(['gift', 'boost'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`ghost small${evKind === k ? ' on' : ''}`}
                aria-pressed={evKind === k}
                onClick={() => setEvKind(k)}
              >
                {t(`admin.events.kind.${k}`)}
              </button>
            ))}
          </div>
          {ev.input('id', t('admin.events.id'))}
          {ev.input('title_ko', t('admin.events.titleKo'))}
          {ev.input('title_en', t('admin.events.titleEn'))}
          {ev.input('body_ko', t('admin.events.bodyKo'))}
          {ev.input('body_en', t('admin.events.bodyEn'))}
          {ev.input('from', t('admin.events.from'), 'datetime-local')}
          {ev.input('until', t('admin.events.until'), 'datetime-local')}
          {evKind === 'gift' && ev.input('coins', t('admin.events.coins'), 'number')}
          <div className="action-row">
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() =>
                void act('events', {
                  ...ev.v,
                  kind: evKind,
                  ...(evKind === 'boost' ? { reasons: ['meet', 'focus'], times: '2' } : {}),
                })
              }
            >
              {t('admin.events.create')}
            </button>
          </div>
        </Group>

        <Group title={t('admin.coupons.title')}>
          <ul className="admin-list">
            {view.coupons.slice(0, 10).map((c: View) => (
              <li key={c.id}>
                <small className="admin-item">
                  #{c.id} {c.hint} {c.label} {t('admin.coupons.used', { used: c.used, max: c.max_uses })}
                </small>
                {!c.disabled && (
                  <Sure
                    label={t('admin.coupons.disable')}
                    disabled={busy}
                    onGo={() => void act('coupons/disable', { id: c.id })}
                  />
                )}
              </li>
            ))}
          </ul>
          {cp.input('label', t('admin.coupons.label'))}
          {cp.input('coins', t('admin.note.coins'), 'number')}
          {cp.input('tickets', t('admin.note.passes'), 'number')}
          {cp.input('max_uses', t('admin.coupons.max'), 'number')}
          {cp.input('until', t('admin.events.until'), 'datetime-local')}
          <div className="action-row">
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() => void act('coupons', cp.v)}
            >
              {t('admin.coupons.create')}
            </button>
          </div>
        </Group>

        <Group title={t('admin.notices.title')}>
          <small>{t('admin.notices.latest', { v: view.latest ?? '?' })}</small>
          {ver.input('minVersion', t('admin.notices.min'))}
          {ver.input('restrictVersion', t('admin.notices.restrict'))}
          {ver.input('recommendVersion', t('admin.notices.rec'))}
          <small>{t('admin.notices.order')}</small>
          <div className="action-row">
            <Sure
              label={t('admin.notices.saveVersions')}
              disabled={busy}
              onGo={() => void act('versions', { ...ver.v, confirm: 'yes' })}
            />
          </div>
          <small>{t('admin.versions.title', { n: view.versions?.active ?? 0 })}</small>
          <ul className="admin-list">
            {(view.versions?.rows ?? []).map((r: { version: string; count: number }) => (
              <li key={r.version}>
                <small>
                  {r.version} · {r.count}
                </small>
              </li>
            ))}
            <li>
              <small>
                {t('admin.versions.unknown')} · {view.versions?.unknown ?? 0}
              </small>
            </li>
          </ul>
          <ul className="admin-list">
            {(view.notices?.notices ?? []).map((n: View) => (
              <li key={n.id}>
                <small className="admin-item">
                  {n.id} {n.kind} {pick(n.title?.ko, n.title?.en)}
                </small>
                <Sure
                  label={t('admin.notices.delete')}
                  disabled={busy}
                  onGo={() => void act('notices/delete', { id: n.id })}
                />
              </li>
            ))}
          </ul>
          <label className="field admin-field">
            <span className="admin-field-name">{t('admin.notices.kind')}</span>
            <select className="plain-input" value={ntKind} onChange={(e) => setNtKind(e.target.value)}>
              {['info', 'important', 'update', 'force'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {nt.input('id', t('admin.events.id'))}
          {nt.input('title_ko', t('admin.events.titleKo'))}
          {nt.input('title_en', t('admin.events.titleEn'))}
          {nt.input('body_ko', t('admin.events.bodyKo'))}
          {nt.input('body_en', t('admin.events.bodyEn'))}
          {nt.input('link', t('admin.notices.link'))}
          <div className="action-row">
            {ntKind === 'force' ? (
              <Sure
                label={t('admin.notices.save')}
                disabled={busy}
                onGo={() => void act('notices', { ...nt.v, kind: ntKind, confirm: 'yes' })}
              />
            ) : (
              <button
                type="button"
                className="ghost small"
                disabled={busy}
                onClick={() => void act('notices', { ...nt.v, kind: ntKind })}
              >
                {t('admin.notices.save')}
              </button>
            )}
          </div>
        </Group>

        <Group title={t('admin.log.title')}>
          <ul className="admin-list admin-log">
            {view.log.slice(0, 15).map((l: View, i: number) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 기록 줄은 바뀌지 않는다
              <li key={i}>
                <small>
                  {new Date(Number(l.at)).toLocaleString()} {l.actor} {l.action} {l.target ?? ''}
                </small>
              </li>
            ))}
          </ul>
        </Group>
      </div>
    </Section>
  );
}
