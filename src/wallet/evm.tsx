// EVM-кошельки (MetaMask, Rabby, OKX, Phantom EVM, Coinbase…) через стандарт EIP-6963.
// Без сторонних сервисов: работаем напрямую с расширением/встроенным браузером кошелька.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPublicClient, createWalletClient, custom, erc20Abi, type Address, type EIP1193Provider, type Hex } from 'viem';

export interface EvmWalletInfo {
  uuid: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface EvmCtx {
  wallets: EvmWalletInfo[];
  active?: EvmWalletInfo;
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

  const value = useMemo<EvmCtx>(() => {
    const need = () => {
      if (!active || !account) throw new Error('Подключите EVM-кошелёк');
      return { provider: active.provider, account };
    };
    const publicClient = () => createPublicClient({ transport: custom(need().provider) });

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
      sendTransaction: async ({ to, data, value }) => {
        const { provider, account: from } = need();
        const wallet = createWalletClient({ account: from, transport: custom(provider) });
        return wallet.sendTransaction({ account: from, to, data, value: value ?? 0n, chain: null });
      },
      waitForReceipt: async (hash) => {
        const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 180_000 });
        return r.status;
      },
      tokenBalance: async (token) => {
        const { account: owner } = need();
        const pc = publicClient();
        const [raw, decimals] = await Promise.all([
          pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
          pc.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
        ]);
        return { raw, decimals };
      },
      nativeBalance: async () => publicClient().getBalance({ address: need().account }),
      ensureAllowance: async (token, spender, amount) => {
        const { provider, account: owner } = need();
        const pc = publicClient();
        const current = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
        if (current >= amount) return;
        const wallet = createWalletClient({ account: owner, transport: custom(provider) });
        const hash = await wallet.writeContract({
          account: owner,
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, amount],
          chain: null,
        });
        const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
        if (r.status !== 'success') throw new Error('Разрешение (approve) не прошло');
      },
    };
  }, [wallets, active, account, chainId, connect, disconnect]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvm(): EvmCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('EvmProvider missing');
  return ctx;
}
