// Полный анализ токена на сервере — те же 5 критериев, что и на сайте, но без участия человека.
import { analyze, DEFAULT_THRESHOLDS, marketFromPair, type Analysis, type Market } from '../../src/lib/analysis';
import { isChainId, type ChainId } from '../../src/lib/chains';
import { extractSocials, getTokenPairs, mainPair, type DexPair, type Socials } from '../../src/lib/dexscreener';
import { DEFAULT_NARRATIVES } from '../../src/lib/narratives';
import { checkSecurity, type SecurityReport } from '../../src/lib/security';
import type { TwitterSignals } from '../../src/lib/twitterSignals';
import type { Env } from './env';
import { budgetLeft, getJsonKV, putJsonKV, spendBudget } from './store';
import { fetchTwitterSignals } from './twitter';

/** Сколько Twitter-анализ считается свежим (секунд) */
export const SIGNALS_TTL = 30 * 60;
/** Сколько запись хранится: сканер по ней понимает, что монету недавно проверяли, и не тратит лимит повторно */
const SIGNALS_KEEP = 2 * 3600;

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validToken(chain: string, address: string): chain is ChainId {
  if (!isChainId(chain)) return false;
  return chain === 'solana' ? SOLANA.test(address) : EVM.test(address);
}

export interface TokenInfo {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  pair: DexPair;
  market: Market;
  socials: Socials;
}

export async function loadToken(chain: ChainId, address: string): Promise<TokenInfo | undefined> {
  const pairs = await getTokenPairs(chain, address);
  const pair = mainPair(pairs, address);
  if (!pair) return undefined;
  return {
    chain,
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    pair,
    market: marketFromPair(pair),
    socials: extractSocials(pair),
  };
}

const memory = new Map<string, TwitterSignals>();

export type SignalsResult = { signals: TwitterSignals; cached: boolean } | { error: 'not_configured' | 'budget' | 'failed'; message?: string };

/** Twitter-анализ с кэшем на 30 минут и дневным лимитом расходов. */
export async function getSignals(env: Env, token: TokenInfo, now: number): Promise<SignalsResult> {
  const key = `sig:${token.chain}:${token.address.toLowerCase()}`;
  const fresh = (s?: TwitterSignals) => s && now - s.fetchedAt < SIGNALS_TTL * 1000;
  const mem = memory.get(key);
  if (fresh(mem)) return { signals: mem!, cached: true };
  const stored = await getJsonKV<TwitterSignals>(env, key);
  if (fresh(stored)) {
    memory.set(key, stored!);
    return { signals: stored!, cached: true };
  }

  if (!env.TWITTERAPI_KEY) return { error: 'not_configured' };
  if ((await budgetLeft(env, now)) <= 0) return { error: 'budget' };
  await spendBudget(env, now);
  try {
    const signals = await fetchTwitterSignals(env, { address: token.address, symbol: token.symbol, handle: token.socials.twitter }, now);
    memory.set(key, signals);
    await putJsonKV(env, key, signals, SIGNALS_KEEP);
    return { signals, cached: false };
  } catch (e) {
    return { error: 'failed', message: (e as Error).message };
  }
}

export interface FullReport {
  token: TokenInfo;
  security: SecurityReport;
  signals?: TwitterSignals;
  signalsError?: string;
  analysis: Analysis;
}

/** Все 5 проверок. Twitter можно пропустить (например, если контракт уже опасен — незачем тратить лимит). */
export async function fullReport(
  env: Env,
  token: TokenInfo,
  now: number,
  opts: { twitter: boolean; security?: SecurityReport },
): Promise<FullReport> {
  const security = opts.security ?? (await checkSecurity(token.chain, token.address, token.pair.dexId));
  let signals: TwitterSignals | undefined;
  let signalsError: string | undefined;
  if (opts.twitter) {
    const r = await getSignals(env, token, now);
    if ('signals' in r) signals = r.signals;
    else signalsError = r.error;
  }
  const analysis = analyze({
    market: token.market,
    security,
    securityLoaded: true,
    twitter: token.socials.twitter,
    hasTwitterLink: Boolean(token.socials.twitter || token.socials.twitterUrl),
    token: { name: token.name, symbol: token.symbol },
    narratives: DEFAULT_NARRATIVES,
    answers: {},
    thresholds: DEFAULT_THRESHOLDS,
    signals,
  });
  return { token, security, signals, signalsError, analysis };
}
