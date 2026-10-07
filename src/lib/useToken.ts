// Загрузка всего, что нужно для анализа токена: рынок (DexScreener) + безопасность.
import { useEffect, useState } from 'react';
import { isChainId, type ChainId } from './chains';
import { extractSocials, getPair, getTokenAnyChain, getTokenPairs, mainPair, type DexPair, type Socials } from './dexscreener';
import { checkSecurity, type SecurityReport } from './security';
import { navigate } from './router';

export interface TokenData {
  chain: ChainId;
  address: string;
  pair?: DexPair;
  pairs: DexPair[];
  socials: Socials;
}

export interface TokenState {
  loading: boolean;
  error?: string;
  data?: TokenData;
  security?: SecurityReport;
  securityLoaded: boolean;
  updatedAt?: number;
}

const REFRESH_MS = 30_000;

export function useToken(chainParam: string, address: string): TokenState & { refresh: () => void } {
  const [state, setState] = useState<TokenState>({ loading: true, securityLoaded: false });
  const [tick, setTick] = useState(0);

  // Основная загрузка + определение сети и адреса токена
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, securityLoaded: false });

    (async () => {
      let chain: ChainId | undefined = isChainId(chainParam) ? chainParam : undefined;
      let pairs: DexPair[] = [];

      if (chain) {
        pairs = await getTokenPairs(chain, address);
        if (!pairs.length) {
          // Возможно, это адрес пула (ссылки DexScreener) — найдём сам токен
          const p = await getPair(chain, address).catch(() => undefined);
          if (p && p.baseToken.address.toLowerCase() !== address.toLowerCase()) {
            if (!cancelled) navigate({ name: 'token', chain: p.chainId, address: p.baseToken.address }, true);
            return;
          }
        }
      } else {
        pairs = (await getTokenAnyChain(address)).filter((p) => isChainId(p.chainId));
        const best = mainPair(pairs, address);
        if (best && isChainId(best.chainId)) {
          if (!cancelled) navigate({ name: 'token', chain: best.chainId, address: best.baseToken.address }, true);
          return;
        }
        throw new Error('Токен не найден ни в одной поддерживаемой сети');
      }

      const pair = mainPair(pairs, address);
      const data: TokenData = { chain, address, pair, pairs, socials: extractSocials(pair) };
      if (cancelled) return;
      setState((s) => ({ ...s, loading: false, data, updatedAt: Date.now() }));

      const security = await checkSecurity(chain, address, pair?.dexId);
      if (cancelled) return;
      setState((s) => ({ ...s, security, securityLoaded: true }));
    })().catch((e: Error) => {
      if (!cancelled) setState({ loading: false, error: e.message, securityLoaded: true });
    });

    return () => {
      cancelled = true;
    };
  }, [chainParam, address]);

  // Автообновление цены
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, [chainParam, address]);

  useEffect(() => {
    if (!tick || !isChainId(chainParam)) return;
    let cancelled = false;
    getTokenPairs(chainParam, address)
      .then((pairs) => {
        if (cancelled || !pairs.length) return;
        const pair = mainPair(pairs, address);
        setState((s) =>
          s.data ? { ...s, data: { ...s.data, pairs, pair, socials: extractSocials(pair) }, updatedAt: Date.now() } : s,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick, chainParam, address]);

  return { ...state, refresh: () => setTick((x) => x + 1) };
}
