// EVM-кошельки (MetaMask, Rabby, OKX, Phantom EVM, Coinbase…) через стандарт EIP-6963.
// Без сторонних сервисов: работаем напрямую с расширением/встроенным браузером кошелька.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { arbitrum, base, bsc, mainnet } from 'viem/chains';
import { builtinStore } from './builtin';
import { isTelegram } from '../lib/telegram';
import { useMemory } from '../lib/ui';

export interface EvmWalletInfo {
  uuid: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface EvmCtx {
  wallets: EvmWalletInfo[];
  /** Подключённый кошелёк; uuid 'builtin' — встроенный кошелёк Telegram */
  active?: { uuid: string; name: string; icon?: string };
  account?: Address;
  chainId?: number;
  connect: (w: EvmWalletInfo) => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
  sendTransaction: (tx: { to: Address; data: Hex; value?: bigint }) => Promise<Hex>;
  waitForReceipt: (hash: Hex) => Promise<'success' | 'reverted'>;
  tokenBalance: (token: Address) => Promise<{ raw: bigint; decimals: number }>;
  nativeBalance: () => Promise<bigint>;
  ensureAllowance: (token: Address, spender: Address, amount: bigint) => Promise<void>;
  /** Операции строго в указанной сети (для встроенного кошелька — без ожидания перерисовки после смены сети) */
  forChain: (chainId: number) => Ops;
}

const Ctx = createContext<EvmCtx | null>(null);

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean };
  }
}

interface AnnounceEvent extends Event {
  detail: { info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider };
}

const LAST_WALLET_KEY = 'gr.evmWallet';

export function EvmProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<EvmWalletInfo[]>([]);
  const [active, setActive] = useState<EvmWalletInfo>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();

  // Находим установленные кошельки
  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const { info, provider } = (e as AnnounceEvent).detail;
      setWallets((list) => (list.some((w) => w.uuid === info.uuid) ? list : [...list, { uuid: info.uuid, name: info.name, icon: info.icon, provider }]));
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    // Старые кошельки без EIP-6963
    const t = setTimeout(() => {
      setWallets((list) => {
        if (list.length || !window.ethereum) return list;
        return [{ uuid: 'injected', name: window.ethereum.isMetaMask ? 'MetaMask' : 'Браузерный кошелёк', provider: window.ethereum }];
      });
    }, 500);
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // Подписка на смену аккаунта / сети
  useEffect(() => {
    if (!active) return;
    const p = active.provider;
    const onAccounts = (accs: unknown) => {
      const list = accs as Address[];
      setAccount(list?.[0]);
      if (!list?.length) setActive(undefined);
    };
    const onChain = (id: unknown) => setChainId(Number(id));
    p.on('accountsChanged', onAccounts);
    p.on('chainChanged', onChain);
    return () => {
      p.removeListener('accountsChanged', onAccounts);
      p.removeListener('chainChanged', onChain);
    };
  }, [active]);

  const connect = useCallback(async (w: EvmWalletInfo) => {
    const accs = (await w.provider.request({ method: 'eth_requestAccounts' })) as Address[];
    const id = (await w.provider.request({ method: 'eth_chainId' })) as string;
    setActive(w);
    setAccount(accs[0]);
    setChainId(Number(id));
    try {
      localStorage.setItem(LAST_WALLET_KEY, w.uuid);
    } catch {
      /* ignore */
    }
  }, []);

  // Тихое переподключение к последнему кошельку
  useEffect(() => {
    if (active || !wallets.length) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET_KEY);
    } catch {
      /* ignore */
    }
    const w = wallets.find((x) => x.uuid === last) ?? (last === 'injected' ? wallets[0] : undefined);
    if (!w) return;
    w.provider
      .request({ method: 'eth_accounts' })
      .then(async (accs) => {
        const list = accs as Address[];
        if (!list.length) return;
        const id = (await w.provider.request({ method: 'eth_chainId' })) as string;
        setActive(w);
        setAccount(list[0]);
        setChainId(Number(id));
      })
      .catch(() => undefined);
  }, [wallets, active]);

  const disconnect = useCallback(() => {
    setActive(undefined);
    setAccount(undefined);
    try {
      localStorage.removeItem(LAST_WALLET_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Встроенный кошелёк Telegram: сеть переключается мгновенно, без подтверждений
  const builtin = useMemory(builtinStore);
  const builtinAccount = isTelegram() && builtin.status === 'ready' ? builtin.evm : undefined;
  const [builtinChainId, setBuiltinChainId] = useState(8453);

  const value = useMemo<EvmCtx>(() => {
    if (builtinAccount) {
      const opsFor = (id: number): Ops => {
        const chain = VIEM_CHAINS[id];
        if (!chain) throw new Error('Сеть не поддерживается');
        const transport = fallback([http(PUBLIC_RPC[chain.id]), http()]);
        return operations(
          () => createPublicClient({ chain, transport }),
          () => createWalletClient({ account: builtinAccount, chain, transport }),
          builtinAccount.address,
        );
      };
      return {
        wallets,
        active: { uuid: 'builtin', name: 'Встроенный кошелёк' },
        account: builtinAccount.address,
        chainId: builtinChainId,
        connect: async () => undefined,
        disconnect: () => undefined,
        switchChain: async (target) => {
          if (!VIEM_CHAINS[target]) throw new Error('Сеть не поддерживается');
          setBuiltinChainId(target);
        },
        forChain: opsFor,
        ...opsFor(builtinChainId),
      };
    }

    const need = () => {
      if (!active || !account) throw new Error('Подключите EVM-кошелёк');
      return { provider: active.provider, account };
    };
    // Расширение отправляет в ту сеть, на которой оно сейчас стоит — проверка сети в интерфейсе
    const injectedOps = operations(
      () => createPublicClient({ transport: custom(need().provider) }),
      () => createWalletClient({ account: need().account, transport: custom(need().provider) }),
      account,
    );
    return {
      wallets,
      active,
      account,
      chainId,
      connect,
      disconnect,
      switchChain: async (target: number) => {
        const { provider } = need();
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${target.toString(16)}` }] });
        setChainId(target);
      },
      forChain: () => injectedOps,
      ...injectedOps,
    };
  }, [wallets, active, account, chainId, connect, disconnect, builtinAccount, builtinChainId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvm(): EvmCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('EvmProvider missing');
  return ctx;
}

const VIEM_CHAINS: Record<number, Chain> = { 1: mainnet, 8453: base, 56: bsc, 42161: arbitrum };

/** Публичные узлы с поддержкой запросов из браузера (резерв — узел по умолчанию из viem). */
const PUBLIC_RPC: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  56: 'https://bsc-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
};

type Ops = Pick<EvmCtx, 'sendTransaction' | 'waitForReceipt' | 'tokenBalance' | 'nativeBalance' | 'ensureAllowance'>;

/** Общие операции для любого кошелька: расширение (EIP-1193) или встроенный ключ. */
function operations(pc: () => PublicClient, wc: () => WalletClient, owner: Address | undefined): Ops {
  const need = () => {
    if (!owner) throw new Error('Подключите EVM-кошелёк');
    return owner;
  };
  const send = (tx: { to: Address; data?: Hex; value?: bigint }) => {
    const w = wc();
    return w.sendTransaction({ account: w.account ?? need(), to: tx.to, data: tx.data, value: tx.value ?? 0n, chain: w.chain ?? null });
  };
  return {
    sendTransaction: (tx) => send(tx),
    waitForReceipt: async (hash) => (await pc().waitForTransactionReceipt({ hash, timeout: 180_000 })).status,
    tokenBalance: async (token) => {
      const c = pc();
      const [raw, decimals] = await Promise.all([
        c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [need()] }),
        c.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      return { raw, decimals };
    },
    nativeBalance: async () => pc().getBalance({ address: need() }),
    ensureAllowance: async (token, spender, amount) => {
      const c = pc();
      const current = await c.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [need(), spender] });
      if (current >= amount) return;
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
      const hash = await send({ to: token, data });
      const r = await c.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (r.status !== 'success') throw new Error('Разрешение (approve) не прошло');
    },
  };
}
