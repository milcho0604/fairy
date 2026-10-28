// 웃게 하기 중 메인이 들고 있는 것: 끝말잇기 판(채팅 창에서 AI 없이)과 간지럼(쓰다듬기를 센다).
// 규칙은 shared/word-chain.ts, shared/fun.ts. 웃겨 줘와 하이파이브는 짧은 놀이(main/minigames.ts)로 한다.
import { pickLine, TICKLE, TICKLE_START, tickle } from '../shared/fun.ts';
import { getLang, type I18nKey, isMutedLine, t } from '../shared/i18n/index.ts';
import { grantCoins } from '../shared/minigames.ts';
import { voiced } from '../shared/persona-voice.ts';
import { localDay } from '../shared/todo-store.ts';
import {
  type ChainState,
  chainCoinsAllowed,
  chainExpired,
  chainTurn,
  isChainStart,
  lastChar,
  startChain,
  startChars,
  WORD_CHAIN,
} from '../shared/word-chain.ts';
import { EN_WORDS, KO_WORDS } from '../shared/word-chain-words.ts';

/** 끝말잇기 하루 기록 파일 이름 (받은 코인, 친밀도 받은 판 수). 읽고 쓰기는 부른 쪽 (store.ts readJson, writeJson) */
export const CHAIN_FILE = 'word-chain-day';
/** 끝말잇기가 놀이 친밀도를 올리는 하루 판 수 */
const CHAIN_AFFECTION_DAILY = 5;

export interface WordChainOptions {
  /** 오늘 놀이로 받은 코인 (놀이 하루 상한, shared/minigames.ts PLAY_COIN) */
  coinsToday: () => number;
  /** 놀이 코인을 넣는다 (상한은 여기서 이미 셌다) */
  giveCoins: (coins: number) => void;
  /** 기분, 친밀도 (pet-life 의 play 활동) */
  played: () => void;
  /** 하루 기록 읽기, 쓰기 (CHAIN_FILE) */
  load: () => unknown;
  save: (v: unknown) => void;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 시험용 */
  now?: () => number;
  rand?: () => number;
}

/** 하루 기록 파일 읽기. 날이 바뀌었거나 모양이 틀리면 0 */
export function chainDayOf(saved: unknown, day: string): { coins: number; plays: number } {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  if (s.day !== day) return { coins: 0, plays: 0 };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { coins: n(s.coins), plays: n(s.plays) };
}

export type WordChain = ReturnType<typeof createWordChain>;

export function createWordChain(o: WordChainOptions) {
  const now = o.now ?? Date.now;
  const rand = o.rand ?? Math.random;
  let game: ChainState | undefined;
  const words = (lang: ChainState['lang']) => (lang === 'ko' ? KO_WORDS : EN_WORDS);
  const needText = (need: readonly string[]) =>
    t('fun.chain.need', { ch: need[0] ?? '', alt: need[1] ?? '' });

  function start(at: number): string {
    const lang = getLang();
    game = startChain(lang, words(lang), rand, at);
    o.log('fun', 'chain', 'start', lang);
    return voiced('fun.chain.start', {
      word: game.last,
      need: needText(startChars(lastChar(game.last), lang)),
    });
  }

  /** 판이 끝났다. 사용자가 이겼으면 코인 (하루 상한 둘), 친밀도는 하루 판 수 안에서. 받은 코인 */
  function finish(userWon: boolean): number {
    game = undefined;
    const day = localDay(now());
    const rec = chainDayOf(o.load(), day);
    const coins = userWon ? grantCoins(chainCoinsAllowed(WORD_CHAIN.coin, rec.coins), o.coinsToday()) : 0;
    if (coins > 0) o.giveCoins(coins);
    if (rec.plays < CHAIN_AFFECTION_DAILY) o.played();
    try {
      o.save({ day, coins: rec.coins + coins, plays: rec.plays + 1 });
    } catch (e) {
      o.log('fun', 'chain', '기록 저장 실패', String(e));
    }
    o.log('fun', 'chain', userWon ? 'user-won' : 'pet-won', `coins=${coins}`);
    return coins;
  }

  /** 채팅 한 줄. 끝말잇기 말이면 펫 답, 아니면 undefined (보통 대화로 AI 에) */
  function turn(text: string): string | undefined {
    const at = now();
    if (game && chainExpired(game, at)) game = undefined;
    // 하자는 말이면 (노는 중이어도) 새 판
    if (isChainStart(text)) return start(at);
    if (!game) return undefined;
    const step = chainTurn(game, text, words(game.lang), rand, at);
    switch (step.kind) {
      case 'leave':
        // 말이 아니면 판을 접고 보통 대화로
        game = undefined;
        o.log('fun', 'chain', 'leave');
        return undefined;
      case 'giveUp':
        finish(false);
        return voiced('fun.chain.giveUp');
      case 'short':
        game = step.state;
        return voiced('fun.chain.short');
      case 'wrongStart':
        game = step.state;
        return voiced('fun.chain.wrongStart', { need: needText(step.need) });
      case 'used':
        game = step.state;
        return voiced('fun.chain.used', { word: step.word });
      case 'stumped': {
        const coins = finish(true);
        const need = needText(step.need);
        return coins > 0
          ? voiced('fun.chain.stumpedCoins', { need, coins })
          : voiced('fun.chain.stumped', { need });
      }
      case 'tired': {
        const coins = finish(true);
        return coins > 0
          ? voiced('fun.chain.tiredCoins', { n: step.turns, coins })
          : voiced('fun.chain.tired', { n: step.turns });
      }
      case 'next':
        game = step.state;
        return voiced(`fun.chain.next.${pickLine(3, rand)}` as I18nKey, {
          word: step.word,
          need: needText(step.need),
        });
    }
  }

  return {
    turn,
    /** 펫 메뉴에서 시작: 첫 말 */
    start: () => start(now()),
    /** 새 대화를 열었다 */
    reset: () => {
      game = undefined;
    },
    /** 지금 판 (개발용, 시험) */
    state: (): ChainState | undefined => game,
  };
}

// ---- 간지럼 ----

export interface TickleOptions {
  /** 지금 웃으면 안 된다 (숨음, 놀이 중, 집중, 들림) */
  busy: () => boolean;
  /** 깔깔: 말과 몸짓 */
  giggle: (text: string) => void;
  log: (tag: string, ...rest: unknown[]) => void;
  now?: () => number;
  rand?: () => number;
}

/** 쓰다듬기를 받을 때마다 부른다. 짧은 사이에 여러 번이면 깔깔 */
export function createTickle(o: TickleOptions) {
  const now = o.now ?? Date.now;
  const rand = o.rand ?? Math.random;
  let st: { pats: readonly number[]; lastAt: number } = TICKLE_START;
  return {
    /** 쓰다듬었다. 웃었으면 true */
    petted(): boolean {
      if (o.busy()) {
        st = { ...st, pats: [] };
        return false;
      }
      const r = tickle(st, now());
      st = { pats: r.pats, lastAt: r.lastAt };
      if (!r.tickled) return false;
      o.log('fun', 'tickle');
      const n = pickLine(TICKLE.lines, rand, (k) => !isMutedLine(`fun.tickle.${k}`));
      // 웃음 말을 모두 안 쓰기로 했으면 말 없이 웃는 몸짓만
      o.giggle(n === undefined ? '' : voiced(`fun.tickle.${n}` as I18nKey));
      return true;
    },
  };
}
