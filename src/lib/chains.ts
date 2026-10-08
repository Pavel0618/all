// Поддерживаемые сети и ссылки на внешние инструменты из методики.

export type ChainId = 'solana' | 'ethereum' | 'base' | 'bsc' | 'arbitrum' | 'robinhood';

export interface ChainInfo {
  id: ChainId;
  /** Название для людей */
  name: string;
  kind: 'solana' | 'evm';
  /** Нативная монета, за которую покупаем */
  native: string;
  /** EVM chainId (число) */
  evmChainId?: number;
  /** Идентификатор сети в GoPlus */
  goplusId?: string;
  /** Имя сети в KyberSwap Aggregator */
  kyberSlug?: string;
  /** Имя сети в GeckoTerminal (если не подойдёт — ищем по названию в списке сетей) */
  geckoSlug: string;
  /** Публичный API обозревателя Blockscout — для своей проверки контракта, когда GoPlus молчит */
  blockscoutApi?: string;
  /** Публичный RPC (EVM) */
  rpc?: string;
  /** Имя сети в GMGN (если поддерживается) */
  gmgnSlug?: string;
  /** Имя сети в TokenSniffer */
  snifferSlug?: string;
  explorer: string;
  /** Быстрые суммы покупки в нативной монете */
  buyPresets: number[];
}

export const CHAINS: Record<ChainId, ChainInfo> = {
  solana: {
    id: 'solana',
    name: 'Solana',
    kind: 'solana',
    native: 'SOL',
    geckoSlug: 'solana',
    gmgnSlug: 'sol',
    explorer: 'https://solscan.io',
    buyPresets: [0.05, 0.1, 0.25, 0.5, 1],
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    kind: 'evm',
    native: 'ETH',
    evmChainId: 1,
    goplusId: '1',
    kyberSlug: 'ethereum',
    geckoSlug: 'eth',
    gmgnSlug: 'eth',
    snifferSlug: 'eth',
    blockscoutApi: 'https://eth.blockscout.com/api/v2',
    rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io',
    buyPresets: [0.01, 0.02, 0.05, 0.1, 0.25],
  },
  base: {
    id: 'base',
    name: 'Base',
    kind: 'evm',
    native: 'ETH',
    evmChainId: 8453,
    goplusId: '8453',
    kyberSlug: 'base',
    geckoSlug: 'base',
    gmgnSlug: 'base',
    snifferSlug: 'base',
    blockscoutApi: 'https://base.blockscout.com/api/v2',
    rpc: 'https://base-rpc.publicnode.com',
    explorer: 'https://basescan.org',
    buyPresets: [0.005, 0.01, 0.025, 0.05, 0.1],
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    kind: 'evm',
    native: 'BNB',
    evmChainId: 56,
    goplusId: '56',
    kyberSlug: 'bsc',
    geckoSlug: 'bsc',
    gmgnSlug: 'bsc',
    snifferSlug: 'bsc',
    rpc: 'https://bsc-rpc.publicnode.com',
    explorer: 'https://bscscan.com',
    buyPresets: [0.02, 0.05, 0.1, 0.25, 0.5],
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    kind: 'evm',
    native: 'ETH',
    evmChainId: 42161,
    goplusId: '42161',
    kyberSlug: 'arbitrum',
    geckoSlug: 'arbitrum',
    snifferSlug: 'arbitrum',
    blockscoutApi: 'https://arbitrum.blockscout.com/api/v2',
    rpc: 'https://arbitrum-one-rpc.publicnode.com',
    explorer: 'https://arbiscan.io',
    buyPresets: [0.005, 0.01, 0.025, 0.05, 0.1],
  },
  // Robinhood Chain — L2 на Arbitrum Orbit (запущена 1 июля 2026), газ в ETH
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood',
    kind: 'evm',
    native: 'ETH',
    evmChainId: 4663,
    goplusId: '4663',
    kyberSlug: 'robinhood',
    geckoSlug: 'robinhood',
    blockscoutApi: 'https://robinhoodchain.blockscout.com/api/v2',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    buyPresets: [0.005, 0.01, 0.025, 0.05, 0.1],
  },
};

export const CHAIN_LIST: ChainInfo[] = Object.values(CHAINS);

export function isChainId(v: string): v is ChainId {
  return Object.prototype.hasOwnProperty.call(CHAINS, v);
}

export function chainByEvmId(id: number): ChainInfo | undefined {
  return CHAIN_LIST.find((c) => c.evmChainId === id);
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface ParsedInput {
  address: string;
  chain?: ChainId;
  /** Если ввели ссылку на X/Twitter — хэндл */
  twitter?: string;
  /** Если это не адрес — строка для поиска по названию/тикеру */
  query?: string;
}

/**
 * Понимает всё, что пользователь может вставить: адрес контракта, ссылку на
 * DexScreener / GMGN / pump.fun / Birdeye / RugCheck / Jupiter, ссылку на X или $ТИКЕР.
 */
export function parseUserInput(raw: string): ParsedInput | null {
  const input = raw.trim();
  if (!input) return null;

  if (EVM_ADDRESS.test(input)) return { address: input };
  if (SOLANA_ADDRESS.test(input)) return { address: input, chain: 'solana' };

  let url: URL | null = null;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    url = null;
  }

  if (url && url.hostname.includes('.')) {
    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'x.com' || host === 'twitter.com') {
      const handle = parts[0];
      if (handle && !['search', 'i', 'home', 'explore'].includes(handle)) {
        return { address: '', twitter: handle.replace(/^@/, ''), query: handle };
      }
    }

    // Ищем в пути адрес, похожий на контракт
    const chainFromPath = guessChainFromPath(host, parts);
    for (const part of [...parts].reverse()) {
      const clean = part.split('?')[0];
      if (EVM_ADDRESS.test(clean)) return { address: clean, chain: chainFromPath };
      if (SOLANA_ADDRESS.test(clean)) return { address: clean, chain: chainFromPath ?? 'solana' };
      // jup.ag/swap/SOL-<mint>
      const pair = clean.split('-');
      for (const p of pair.reverse()) {
        if (SOLANA_ADDRESS.test(p)) return { address: p, chain: 'solana' };
        if (EVM_ADDRESS.test(p)) return { address: p, chain: chainFromPath };
      }
    }
    const q = url.searchParams.get('outputCurrency') ?? url.searchParams.get('outputMint');
    if (q && (EVM_ADDRESS.test(q) || SOLANA_ADDRESS.test(q))) {
      return { address: q, chain: SOLANA_ADDRESS.test(q) ? 'solana' : chainFromPath };
    }
  }

  return { address: '', query: input.replace(/^\$/, '') };
}

function guessChainFromPath(host: string, parts: string[]): ChainId | undefined {
  if (host.includes('pump.fun') || host.includes('rugcheck') || host.includes('jup.ag') || host.includes('solscan')) {
    return 'solana';
  }
  const first = (parts[0] ?? '').toLowerCase();
  const map: Record<string, ChainId> = {
    solana: 'solana',
    sol: 'solana',
    ethereum: 'ethereum',
    eth: 'ethereum',
    base: 'base',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    robinhood: 'robinhood',
  };
  return map[first];
}

// ---------- Ссылки на инструменты из методики ----------

export const toolLinks = {
  tweetScout: 'https://app.tweetscout.io/',
  twitterScoreTop: 'https://twitterscore.io/',
  moniTrending: 'https://discover.getmoni.io/',
  dexscreenerTrending: (chain?: ChainId) =>
    `https://dexscreener.com/${chain ?? ''}?rankBy=trendingScoreH6&order=desc`,
  gmgnTrending: (chain: ChainId = 'solana') => `https://gmgn.ai/?chain=${CHAINS[chain].gmgnSlug ?? 'sol'}`,

  twitterProfile: (h: string) => `https://x.com/${h}`,
  twitterScore: (h: string) => `https://twitterscore.io/twitter/${h}/overview/`,
  moni: (h: string) => `https://discover.getmoni.io/${h}`,
  xSearchLive: (q: string) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live`,
  xSearchTop: (q: string) => `https://x.com/search?q=${encodeURIComponent(q)}&f=top`,

  gmgnToken: (chain: ChainId, addr: string) =>
    CHAINS[chain].gmgnSlug ? `https://gmgn.ai/${CHAINS[chain].gmgnSlug}/token/${addr}` : undefined,
  dexscreenerToken: (chain: ChainId, addr: string) => `https://dexscreener.com/${chain}/${addr}`,
  rugcheck: (mint: string) => `https://rugcheck.xyz/tokens/${mint}`,
  tokenSniffer: (chain: ChainId, addr: string) =>
    CHAINS[chain].snifferSlug ? `https://tokensniffer.com/token/${CHAINS[chain].snifferSlug}/${addr}` : undefined,
  goplus: (chain: ChainId, addr: string) =>
    CHAINS[chain].goplusId
      ? `https://gopluslabs.io/token-security/${CHAINS[chain].goplusId}/${addr}`
      : `https://gopluslabs.io/token-security/solana/${addr}`,
  explorerToken: (chain: ChainId, addr: string) =>
    chain === 'solana' ? `https://solscan.io/token/${addr}` : `${CHAINS[chain].explorer}/token/${addr}`,
  explorerTx: (chain: ChainId, tx: string) => `${CHAINS[chain].explorer}/tx/${tx}`,

  // Резервные ссылки на покупку, если встроенный обмен недоступен
  externalSwap: (chain: ChainId, addr: string) => {
    switch (chain) {
      case 'solana':
        return `https://jup.ag/swap/SOL-${addr}`;
      case 'bsc':
        return `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${addr}`;
      case 'ethereum':
        return `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${addr}`;
      default:
        return `https://app.uniswap.org/swap?chain=${chain}&outputCurrency=${addr}`;
    }
  },
};
