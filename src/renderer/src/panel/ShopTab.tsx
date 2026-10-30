import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import { HOUSE_LEVELS, HOUSE_STYLES, type HouseStyle, houseSvg } from '../../../shared/house-art.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import {
  CUSTOM_FOOD_COST,
  CUSTOM_FOOD_MAX,
  FOODS,
  type Food,
  HOUSE_COSTS,
  HOUSE_STYLE_COSTS,
  houseName,
  houseStyleName,
  TOYS,
} from '../../../shared/shop.ts';
import { CoinIcon } from './icons.tsx';
import { coinsShort, feedHint, needsConfirm } from './shop-rules.ts';
import { useKeepScroll } from './view-keep.ts';

const bridge = window.jjakkungPanel;

/** 확인 상태가 된 뒤 이만큼은 구매를 받지 않는다 (두 번 누르거나 키를 누르고 있어서 뚫리지 않게) */
const CONFIRM_DELAY_MS = 400;

/** 상점 (v1): 먹이(바로 주기), 커스텀 먹이, 장난감, 집. 코인은 할 일과 집중으로만 모인다. */
export function ShopTab({ s }: { s: PanelState }) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  // 커스텀 먹이 지우기는 두 번 눌러야 한다 (설정의 저장 공간 지우기와 같은 방식). 처음 누르면 이 키
  const [sure, setSure] = useState('');
  // 100 코인 이상 구매는 한 번 더 눌러야 산다. 처음 누르면 이 키 (다른 곳으로 포커스가 가거나 Esc 면 풀림)
  const [ask, setAsk] = useState('');
  const askedAt = useRef(0);
  // 안내 글이 줄 아래에 들어갈 자리가 없으면(스크롤 칸 맨 아래) 위쪽에 띄운다. 어느 쪽이든 줄 높이는 그대로다
  const [askUp, setAskUp] = useState(false);
  const shop = s.shop;
  const scroller = useRef<HTMLDivElement>(null);
  useKeepScroll(scroller, 'shop');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string, bad = false, ms = 2400) => {
    // 앞 메시지의 지우기 타이머가 새 메시지를 지우지 않게 하나만 둔다
    clearTimeout(timer.current);
    setMsg({ text, bad });
    timer.current = setTimeout(() => setMsg(undefined), ms);
  };
  // 사는 중에는 다른 사기를 막는다. 두 번 누르면 바뀐 단추(짓기에서 늘리기)로 한 번 더 사진다
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (start: () => Promise<{ ok: boolean; error?: string }>, ok: string, okMs?: number) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const r = await start();
      flash(r.ok ? ok : (r.error ?? t('shop.failed')), !r.ok, r.ok ? okMs : undefined);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const feed = (f: Food) => run(() => bridge.feedWith(f.key), t('shop.fed', { name: f.name }));
  const level = shop.houseLevel;
  const nextHouse = HOUSE_COSTS[level];

  /** 사기 단추 하나의 공통 속성: 이름표(항목과 값), 코인 모자람, 큰 구매는 한 번 더 확인 */
  const buyProps: BuyProps = (o) => {
    const short = coinsShort(shop.balance, o.cost);
    const asking = ask === o.key && short === 0;
    return {
      disabled: o.blocked || short > 0,
      'aria-label': asking
        ? t('shop.sureLabel', { name: o.name, n: o.cost })
        : short > 0
          ? `${o.label}, ${t('shop.needMore', { n: short })}`
          : o.label,
      onClick: (e: MouseEvent<HTMLElement>) => {
        // 더블클릭의 두 번째 누름은 확인으로 치지 않는다
        if (e.detail > 1 && needsConfirm(o.cost)) return;

        if (!needsConfirm(o.cost) || asking) {
          // 확인 상태가 된 직후(실수로 두 번 누름)에는 받지 않는다
          if (asking && Date.now() - askedAt.current < CONFIRM_DELAY_MS) return;
          setAsk('');
          o.go();
          return;
        }
        askedAt.current = Date.now();
        setAsk(o.key);
        const row = e.currentTarget.closest('li, .row-line, .house-styles');
        const box = scroller.current?.getBoundingClientRect();
        const at = (row ?? e.currentTarget).getBoundingClientRect();
        setAskUp(!!box && box.bottom - at.bottom < 90);
      },
      onBlur: () => setAsk((k) => (k === o.key ? '' : k)),
      onKeyDown: (e: KeyboardEvent) => {
        // Enter 나 Space 를 누르고 있으면 반복해서 눌림이 온다: 확인으로 치지 않는다
        if (e.repeat && (e.key === 'Enter' || e.key === ' ') && needsConfirm(o.cost)) e.preventDefault();
        if (e.key === 'Escape' && asking) {
          e.stopPropagation();
          setAsk('');
        }
      },
      asking,
      short,
    };
  };

  return (
    <div className="shop-host">
      {/* 안내 띠 자리는 늘 같은 높이로 목록 위에 비워 둔다. 띠가 떠도 목록이 밀리지 않아 단추가 움직이지 않고, 첫 줄도 가리지 않는다 */}
      <div className="shop-slot" role="status">
        {msg && <p className={`shop-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</p>}
      </div>
      <div
        className="scroll shop"
        ref={scroller}
        data-ask-up={askUp || undefined}
        data-ask-style={ask.startsWith('style:') || undefined}
      >
        <section>
          <h2>{t('shop.foods')}</h2>
          <ul className="goods">
            {FOODS.map((f) => (
              <li key={f.key}>
                <span className="g-name">
                  {f.name}
                  <small>{t('shop.fullness', { n: f.gain })}</small>
                  <FeedNote fullness={s.fullness} gain={f.gain} short={coinsShort(shop.balance, f.cost)} />
                </span>
                <Price n={f.cost} />
                <GiveButton
                  food={f}
                  full={feedHint(s.fullness, f.gain)?.kind === 'full'}
                  balance={shop.balance}
                  onGive={() => feed(f)}
                />
              </li>
            ))}
            {shop.customFoods.map((f) => (
              <li key={f.key}>
                <span className="g-name custom">
                  {shop.foodImages[f.key] && <img src={shop.foodImages[f.key]} alt="" />}
                  <span className="g-title">
                    {f.name}
                    <FeedNote fullness={s.fullness} gain={f.gain} short={coinsShort(shop.balance, f.cost)} />
                  </span>
                  {/* 지우기는 이름 옆에 둔다. 줄 끝에 두면 이 줄만 가격과 주기 단추가 밀린다 */}
                  <button
                    type="button"
                    className={`remove${sure === f.key ? ' sure' : ''}`}
                    aria-label={
                      sure === f.key ? t('shop.removeSure') : t('panel.todo.remove', { title: f.name })
                    }
                    onClick={() => {
                      if (sure !== f.key) {
                        setSure(f.key);
                        return;
                      }
                      setSure('');
                      bridge.removeFood(f.key);
                    }}
                    onBlur={() => setSure((k) => (k === f.key ? '' : k))}
                  >
                    {sure === f.key ? t('shop.removeSure') : '×'}
                  </button>
                </span>
                <Price n={f.cost} />
                <GiveButton
                  food={f}
                  full={feedHint(s.fullness, f.gain)?.kind === 'full'}
                  balance={shop.balance}
                  onGive={() => feed(f)}
                />
              </li>
            ))}
          </ul>
          <div className="row-line">
            <span>
              {t('shop.custom')} <small>{t('shop.customHint', { n: CUSTOM_FOOD_MAX })}</small>
              {coinsShort(shop.balance, CUSTOM_FOOD_COST) > 0 && (
                <small className="need">
                  {t('shop.needMore', { n: coinsShort(shop.balance, CUSTOM_FOOD_COST) })}
                </small>
              )}
            </span>
            <Price n={CUSTOM_FOOD_COST} />
            <button
              type="button"
              className="ghost small"
              disabled={shop.balance < CUSTOM_FOOD_COST || shop.customFoods.length >= CUSTOM_FOOD_MAX}
              aria-label={t('shop.makeLabel', { n: CUSTOM_FOOD_COST })}
              onClick={() => run(() => bridge.makeFood(), t('shop.makerOpened'))}
            >
              {t('shop.make')}
            </button>
          </div>
        </section>

        <section>
          <h2>{t('shop.toys')}</h2>
          <ul className="goods">
            {TOYS.map((toy) => {
              const owned = shop.toys[toy.key];
              const b = buyProps({
                key: `toy:${toy.key}`,
                name: toy.name,
                cost: toy.cost,
                label: t('shop.buyLabel', { name: toy.name, n: toy.cost }),
                go: () => run(() => bridge.buyToy(toy.key), t('shop.bought', { name: toy.name })),
              });
              const { asking, short, ...btn } = b;
              return (
                <li key={toy.key}>
                  <span className="g-name">
                    {toy.name}
                    <small>{toy.hint}</small>
                    {!owned && <BuyNote asking={asking} short={short} cost={toy.cost} />}
                  </span>
                  {owned ? <span className="owned">{t('shop.owned')}</span> : <Price n={toy.cost} />}
                  {!owned && (
                    <button type="button" className={`ghost small buy${asking ? ' asking' : ''}`} {...btn}>
                      {asking ? t('shop.sure') : t('shop.buy')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="play-row">
            <button
              type="button"
              className="ghost"
              disabled={!shop.toys.ball && !shop.toys.yarn}
              title={shop.toys.ball || shop.toys.yarn ? undefined : t('shop.needBall')}
              onClick={() => bridge.play('ball')}
            >
              {shop.toys.yarn ? t('shop.throwYarn') : t('shop.throwBall')}
            </button>
            <button type="button" className="ghost" onClick={() => bridge.play('walk')}>
              {t('shop.walk')}
            </button>
          </div>
        </section>

        <section>
          <h2>{t('shop.house')}</h2>
          <HouseRow
            level={level}
            nextHouse={nextHouse}
            balance={shop.balance}
            pending={pending}
            buyProps={buyProps}
            onBuy={() =>
              run(
                () => bridge.buyHouse(level),
                t(level === 0 ? 'shop.newHouseFirst' : 'shop.newHouseGrown'),
                5200,
              )
            }
          />
          {/* 집을 숨겨 두었으면 사고 바꾸기는 그대로 되고, 화면에 보이려면 꺼내야 한다고 알린다 (shared/house-stow.ts) */}
          {level > 0 && shop.houseHidden && (
            <div className="row-line">
              <span>{t('shop.houseHidden')}</span>
              <button type="button" className="ghost small" onClick={() => bridge.setHouseHidden(false)}>
                {t('shop.houseShow')}
              </button>
            </div>
          )}
          {level > 0 && (
            <>
              <h2 className="sub">
                {t('shop.styles')} <small>{t('shop.stylesHint')}</small>
              </h2>
              <ul className="house-styles">
                {HOUSE_STYLES.map((style) => {
                  const name = houseStyleName(style);
                  const cost = HOUSE_STYLE_COSTS[style];
                  const owned = shop.houseStyles[style];
                  const b = buyProps({
                    key: `style:${style}`,
                    name,
                    cost,
                    label: t('shop.styleBuyLabel', { name, n: cost }),
                    blocked: pending,
                    go: () => run(() => bridge.buyHouseStyle(style), t('shop.styleChanged', { name })),
                  });
                  return (
                    <StyleCard
                      key={style}
                      style={style}
                      level={level}
                      owned={owned}
                      using={shop.houseStyle === style}
                      buy={b}
                      onUse={() => run(() => bridge.buyHouseStyle(style), t('shop.styleChanged', { name }))}
                    />
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

interface BuyArgs {
  key: string;
  name: string;
  cost: number;
  label: string;
  blocked?: boolean;
  go: () => void;
}
type Buy = ReturnType<BuyProps>;
type BuyProps = (o: BuyArgs) => {
  disabled: boolean;
  'aria-label': string;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  asking: boolean;
  short: number;
};

/** 먹이 주기 단추: 이름표에 항목과 값, 배가 꽉 찼으면 막는다 */
function GiveButton(o: { food: Food; full: boolean; balance: number; onGive: () => void }) {
  const short = coinsShort(o.balance, o.food.cost);
  const label = t('shop.giveLabel', { name: o.food.name, n: o.food.cost });
  return (
    <button
      type="button"
      className="ghost small"
      disabled={short > 0 || o.full}
      aria-label={short > 0 ? `${label}, ${t('shop.needMore', { n: short })}` : label}
      onClick={o.onGive}
    >
      {t('shop.give')}
    </button>
  );
}

/** 먹이 줄 아래 안내: 코인이 모자라면 몇 개 더, 배가 거의 찼으면 얼마나 들어가는지 */
function FeedNote(o: { fullness: number; gain: number; short: number }) {
  // 코인이 모자라면 그 말이 먼저다 (배부름 안내는 살 수 있을 때만)
  const hint = o.short > 0 ? undefined : feedHint(o.fullness, o.gain);
  return (
    <>
      {o.short > 0 && <small className="need">{t('shop.needMore', { n: o.short })}</small>}
      {hint?.kind === 'full' && <small className="need">{t('shop.fullNow')}</small>}
      {hint?.kind === 'part' && <small className="need">{t('shop.fullFor', { n: hint.room })}</small>}
    </>
  );
}

/** 사기 줄 아래 안내: 한 번 더 누르라는 말(되돌릴 수 없음), 아니면 모자란 코인 */
function BuyNote(o: { asking: boolean; short: number; cost: number }) {
  if (o.asking) return <AskNote cost={o.cost} />;
  return o.short > 0 ? <small className="need">{t('shop.needMore', { n: o.short })}</small> : null;
}

/** "한 번 더" 안내: 뜨면 보이는 자리로 스크롤한다 (아래 칸에서 잘리지 않게) */
function AskNote(o: { cost: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <small className="need ask" role="status" ref={ref}>
      {t('shop.sureNote', { n: o.cost })}
    </small>
  );
}

/** 집 줄: 지금 집, 다음 집 이야기, 짓기 또는 늘리기 단추 */
function HouseRow(o: {
  level: number;
  nextHouse: number | undefined;
  balance: number;
  pending: boolean;
  buyProps: BuyProps;
  onBuy: () => void;
}) {
  const { level, nextHouse } = o;
  const nextName = houseName(level) ?? '';
  const b =
    nextHouse === undefined
      ? undefined
      : o.buyProps({
          key: 'house',
          name: nextName,
          cost: nextHouse,
          label: t(level === 0 ? 'shop.buildLabel' : 'shop.upgradeLabel', { name: nextName, n: nextHouse }),
          blocked: o.pending,
          go: o.onBuy,
        });
  const { asking, short, ...btn } = b ?? { asking: false, short: 0 };
  return (
    <div className="row-line">
      <span>
        {level === 0
          ? t('shop.noHouse')
          : `${t('shop.houseNow', { name: houseName(level - 1) ?? '' })} (${t('shop.houseLevel', { n: level, max: HOUSE_LEVELS })})`}
        <small>
          {nextHouse === undefined
            ? t('shop.bestHouse')
            : t(level === 0 ? 'shop.houseFirst' : 'shop.houseNext', { name: nextName })}
        </small>
        {nextHouse !== undefined && <BuyNote asking={asking} short={short} cost={nextHouse} />}
      </span>
      {nextHouse !== undefined && b && (
        <>
          <Price n={nextHouse} />
          <button type="button" className={`ghost small buy${asking ? ' asking' : ''}`} {...btn}>
            {asking ? t('shop.sure') : level === 0 ? t('shop.build') : t('shop.upgrade')}
          </button>
        </>
      )}
    </div>
  );
}

/** 집 모양 하나: 지금 단계로 그린 미리 보기, 이름, 값 또는 바꾸기 */
function StyleCard(o: {
  style: HouseStyle;
  level: number;
  owned: boolean;
  using: boolean;
  buy: Buy;
  onUse: () => void;
}) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(houseSvg(o.style, o.level, { still: true }))}`;
  const name = houseStyleName(o.style);
  const cost = HOUSE_STYLE_COSTS[o.style];
  const { asking, short, ...btn } = o.buy;
  return (
    <li className={o.using ? 'using' : ''}>
      <img src={src} alt="" />
      <span className="s-name">{name}</span>
      {o.using ? (
        <span className="owned">{t('shop.styleNow')}</span>
      ) : o.owned ? (
        <button
          type="button"
          className="ghost small pick"
          aria-label={t('shop.styleUseLabel', { name })}
          onClick={o.onUse}
        >
          {t('shop.styleUse')}
        </button>
      ) : (
        <>
          {/* 안내가 단추 뒤에 오면 마지막 칸이 아니게 되어 단추 자리가 바뀐다(.house-styles li > :last-child). 안내를 앞에 둔다 */}
          {asking && <BuyNote asking={asking} short={short} cost={cost} />}
          <button type="button" className={`ghost small pick buy${asking ? ' asking' : ''}`} {...btn}>
            {asking ? t('shop.sure') : <Price n={cost} />}
          </button>
          {!asking && short > 0 && <BuyNote asking={false} short={short} cost={cost} />}
        </>
      )}
    </li>
  );
}

function Price({ n }: { n: number }) {
  return (
    <span className="price">
      <CoinIcon />
      {n}
    </span>
  );
}
