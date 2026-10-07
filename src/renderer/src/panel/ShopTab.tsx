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
  // 커스텀 먹이 지우기는 두 번 눌러야 한다 (설정의 저장 공간 지우기와 같은 방식). 처음 누르면 이 키
  const [sure, setSure] = useState('');
  const shop = s.shop;
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
                disabled={pending || shop.balance < nextHouse}
                onClick={() => run(() => bridge.buyHouse(level), t('shop.newHouse'))}
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
