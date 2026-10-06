import { useRef, useState } from 'react';
import type { PanelState } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
import {
  CUSTOM_FOOD_COST,
  CUSTOM_FOOD_MAX,
  FOODS,
  type Food,
  HOUSE_COSTS,
  HOUSE_NAMES,
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
    flash(r.ok ? ok : (r.error ?? '못 했어'), !r.ok);
  };
  const feed = (f: Food) => run(bridge.feedWith(f.key), `${f.name} 줬어`);
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
        <h3>먹이</h3>
        <ul className="goods">
          {FOODS.map((f) => (
            <li key={f.key}>
              <span className="g-name">
                {f.name}
                <small>배부름 +{f.gain}</small>
              </span>
              <Price n={f.cost} />
              <button
                type="button"
                className="ghost small"
                disabled={shop.balance < f.cost}
                onClick={() => feed(f)}
              >
                주기
              </button>
            </li>
          ))}
          {shop.customFoods.map((f) => (
            <li key={f.key}>
              <span className="g-name custom">
                {shop.foodImages[f.key] && <img src={shop.foodImages[f.key]} alt="" />}
                {f.name}
              </span>
              <Price n={f.cost} />
              <button
                type="button"
                className="ghost small"
                disabled={shop.balance < f.cost}
                onClick={() => feed(f)}
              >
                주기
              </button>
              <button
                type="button"
                className="remove"
                aria-label={`${f.name} 지우기`}
                onClick={() => bridge.removeFood(f.key)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="row-line">
          <span>
            커스텀 먹이 만들기 <small>사진 한 장으로, {CUSTOM_FOOD_MAX}개까지</small>
          </span>
          <Price n={CUSTOM_FOOD_COST} />
          <button
            type="button"
            className="ghost small"
            disabled={shop.balance < CUSTOM_FOOD_COST || shop.customFoods.length >= CUSTOM_FOOD_MAX}
            onClick={() => run(bridge.makeFood(), '먹이 만들기 창을 열었어')}
          >
            만들기
          </button>
        </div>
      </section>

      <section>
        <h3>장난감</h3>
        <ul className="goods">
          {TOYS.map((t) => {
            const owned = shop.toys[t.key];
            return (
              <li key={t.key}>
                <span className="g-name">
                  {t.name}
                  <small>{t.hint}</small>
                </span>
                {owned ? <span className="owned">있음</span> : <Price n={t.cost} />}
                {!owned && (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={shop.balance < t.cost}
                    onClick={() => run(bridge.buyToy(t.key), `${withParticle(t.name, '을')} 샀어`)}
                  >
                    사기
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
            title={shop.toys.ball || shop.toys.yarn ? undefined : '공이나 털실이 있어야 해'}
            onClick={() => bridge.play('ball')}
          >
            {shop.toys.yarn ? '털실' : '공'} 던져 주기
          </button>
          <button type="button" className="ghost" onClick={() => bridge.play('walk')}>
            산책 가자
          </button>
        </div>
      </section>

      <section>
        <h3>집</h3>
        <div className="row-line">
          <span>
            {level === 0 ? '아직 집이 없어' : `지금: ${HOUSE_NAMES[level - 1]}`}
            <small>
              {nextHouse === undefined
                ? '가장 좋은 집이야.'
                : `다음: ${HOUSE_NAMES[level]} (화면 왼쪽 아래 구석에 놓여)`}
            </small>
          </span>
          {nextHouse !== undefined && (
            <>
              <Price n={nextHouse} />
              <button
                type="button"
                className="ghost small"
                disabled={shop.balance < nextHouse}
                onClick={() => run(bridge.buyHouse(), '새 집이야!')}
              >
                {level === 0 ? '짓기' : '늘리기'}
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
