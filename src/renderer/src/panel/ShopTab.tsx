import { useRef, useState } from 'react';
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
import { useKeepScroll } from './view-keep.ts';

const bridge = window.jjakkungPanel;

/** 상점 (v1): 먹이(바로 주기), 커스텀 먹이, 장난감, 집. 코인은 할 일과 집중으로만 모인다. */
export function ShopTab({ s }: { s: PanelState }) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  // 커스텀 먹이 지우기는 두 번 눌러야 한다 (설정의 저장 공간 지우기와 같은 방식). 처음 누르면 이 키
  const [sure, setSure] = useState('');
  const shop = s.shop;
  const scroller = useRef<HTMLDivElement>(null);
  useKeepScroll(scroller, 'shop');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string, bad = false) => {
    // 앞 메시지의 지우기 타이머가 새 메시지를 지우지 않게 하나만 둔다
    clearTimeout(timer.current);
    setMsg({ text, bad });
    timer.current = setTimeout(() => setMsg(undefined), 2400);
  };
  // 사는 중에는 다른 사기를 막는다. 두 번 누르면 바뀐 단추(짓기에서 늘리기)로 한 번 더 사진다
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (start: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const r = await start();
      flash(r.ok ? ok : (r.error ?? t('shop.failed')), !r.ok);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const feed = (f: Food) => run(() => bridge.feedWith(f.key), t('shop.fed', { name: f.name }));
  const level = shop.houseLevel;
  const nextHouse = HOUSE_COSTS[level];

  return (
    <div className="shop-host">
      {/* 안내 띠 자리는 늘 같은 높이로 목록 위에 비워 둔다. 띠가 떠도 목록이 밀리지 않아 단추가 움직이지 않고, 첫 줄도 가리지 않는다 */}
      <div className="shop-slot" role="status">
        {msg && <p className={`shop-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</p>}
      </div>
      <div className="scroll shop" ref={scroller}>
        <section>
          <h2>{t('shop.foods')}</h2>
          <ul className="goods">
            {FOODS.map((f) => (
              <li key={f.key}>
                <span className="g-name">
                  {f.name}
                  <small>{t('shop.fullness', { n: f.gain })}</small>
                </span>
                <Price n={f.cost} />
                <button
                  type="button"
                  className="ghost small"
                  disabled={shop.balance < f.cost}
                  onClick={() => feed(f)}
                >
                  {t('shop.give')}
                </button>
              </li>
            ))}
            {shop.customFoods.map((f) => (
              <li key={f.key}>
                <span className="g-name custom">
                  {shop.foodImages[f.key] && <img src={shop.foodImages[f.key]} alt="" />}
                  {f.name}
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
                <button
                  type="button"
                  className="ghost small"
                  disabled={shop.balance < f.cost}
                  onClick={() => feed(f)}
                >
                  {t('shop.give')}
                </button>
              </li>
            ))}
          </ul>
          <div className="row-line">
            <span>
              {t('shop.custom')} <small>{t('shop.customHint', { n: CUSTOM_FOOD_MAX })}</small>
            </span>
            <Price n={CUSTOM_FOOD_COST} />
            <button
              type="button"
              className="ghost small"
              disabled={shop.balance < CUSTOM_FOOD_COST || shop.customFoods.length >= CUSTOM_FOOD_MAX}
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
              return (
                <li key={toy.key}>
                  <span className="g-name">
                    {toy.name}
                    <small>{toy.hint}</small>
                  </span>
                  {owned ? <span className="owned">{t('shop.owned')}</span> : <Price n={toy.cost} />}
                  {!owned && (
                    <button
                      type="button"
                      className="ghost small"
                      disabled={shop.balance < toy.cost}
                      onClick={() => run(() => bridge.buyToy(toy.key), t('shop.bought', { name: toy.name }))}
                    >
                      {t('shop.buy')}
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
          <div className="row-line">
            <span>
              {level === 0
                ? t('shop.noHouse')
                : `${t('shop.houseNow', { name: houseName(level - 1) ?? '' })} (${t('shop.houseLevel', { n: level, max: HOUSE_LEVELS })})`}
              <small>
                {nextHouse === undefined
                  ? t('shop.bestHouse')
                  : t(level === 0 ? 'shop.houseFirst' : 'shop.houseNext', { name: houseName(level) ?? '' })}
              </small>
            </span>
            {nextHouse !== undefined && (
              <>
                <Price n={nextHouse} />
                <button
                  type="button"
                  className="ghost small"
                  disabled={pending || shop.balance < nextHouse}
                  onClick={() => run(() => bridge.buyHouse(level), t('shop.newHouse'))}
                >
                  {level === 0 ? t('shop.build') : t('shop.upgrade')}
                </button>
              </>
            )}
          </div>
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
                {HOUSE_STYLES.map((style) => (
                  <StyleCard
                    key={style}
                    style={style}
                    level={level}
                    owned={shop.houseStyles[style]}
                    using={shop.houseStyle === style}
                    canBuy={!pending && shop.balance >= HOUSE_STYLE_COSTS[style]}
                    onPick={() =>
                      run(
                        () => bridge.buyHouseStyle(style),
                        t('shop.styleChanged', { name: houseStyleName(style) }),
                      )
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** 집 모양 하나: 지금 단계로 그린 미리 보기, 이름, 값 또는 바꾸기 */
function StyleCard(o: {
  style: HouseStyle;
  level: number;
  owned: boolean;
  using: boolean;
  canBuy: boolean;
  onPick: () => void;
}) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(houseSvg(o.style, o.level, { still: true }))}`;
  const name = houseStyleName(o.style);
  const cost = HOUSE_STYLE_COSTS[o.style];
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
          onClick={o.onPick}
        >
          {t('shop.styleUse')}
        </button>
      ) : (
        <button
          type="button"
          className="ghost small pick"
          disabled={!o.canBuy}
          aria-label={t('shop.styleBuyLabel', { name, n: cost })}
          onClick={o.onPick}
        >
          <Price n={cost} />
        </button>
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
