// Solana-кошельки: Phantom, Solflare, Backpack и любые другие с поддержкой Wallet Standard
// (определяются автоматически, отдельные адаптеры не нужны).
import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { settingsStore, useStore } from '../lib/storage';

export function SolanaProvider({ children }: { children: ReactNode }) {
  const [settings] = useStore(settingsStore);
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={settings.solanaRpc} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
