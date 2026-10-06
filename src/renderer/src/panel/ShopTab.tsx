import { useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import {
  CUSTOM_FOOD_COST,
  CUSTOM_FOOD_MAX,
  FOODS,
  type Food,
  HOUSE_COSTS,
  houseName,
  TOYS,
} from '../../../shared/shop.ts';
import { CoinIcon } from './icons.tsx';

const bridge = window.jjakkungPanel;

/** 상점 (v1): 먹이(바로 주기), 커스텀 먹이, 장난감, 집. 코인은 할 일과 집중으로만 모인다. */
export function ShopTab({ s }: { s: PanelState }) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  const shop = s.shop;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string, bad = false) => {
    // 앞 메시지의 지우기 타이머가 새 메시지를 지우지 않게 하나만 둔다
    clearTimeout(timer.current);
    setMsg({ text, bad });
    timer.current = setTimeout(() => setMsg(undefined), 2400);
  };
  const run = async (p: Promise<{ ok: boolean; error?: string }>, ok: string) => {
    const r = await p;
    flash(r.ok ? ok : (r.error ?? t('shop.failed')), !r.ok);
  };
  const feed = (f: Food) => run(bridge.feedWith(f.key), t('shop.fed', { name: f.name }));
  const level = shop.houseLevel;
  const nextHouse = HOUSE_COSTS[level];

  return (
    <div className="scroll shop">
      {msg && (
        <p className={`shop-msg ${msg.bad ? 'bad' : ''}`} role="status">
          {msg.text}
        </p>
      )}

      <section>
        <h3>{t('shop.foods')}</h3>
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
                  className="remove"
                  aria-label={t('panel.todo.remove', { title: f.name })}
                  onClick={() => bridge.removeFood(f.key)}
                >
                  ×
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
            onClick={() => run(bridge.makeFood(), t('shop.makerOpened'))}
          >
            {t('shop.make')}
          </button>
        </div>
      </section>

      <section>
        <h3>{t('shop.toys')}</h3>
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
                    onClick={() => run(bridge.buyToy(toy.key), t('shop.bought', { name: toy.name }))}
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
        <h3>{t('shop.house')}</h3>
        <div className="row-line">
          <span>
            {level === 0 ? t('shop.noHouse') : t('shop.houseNow', { name: houseName(level - 1) ?? '' })}
            <small>
              {nextHouse === undefined
                ? t('shop.bestHouse')
                : t('shop.houseNext', { name: houseName(level) ?? '' })}
            </small>
          </span>
          {nextHouse !== undefined && (
            <>
              <Price n={nextHouse} />
              <button
                type="button"
                className="ghost small"
                disabled={shop.balance < nextHouse}
                onClick={() => run(bridge.buyHouse(), t('shop.newHouse'))}
              >
                {level === 0 ? t('shop.build') : t('shop.upgrade')}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
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
