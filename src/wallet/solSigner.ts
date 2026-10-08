// Единый способ подписать и отправить транзакцию Solana:
// в Telegram — встроенным кошельком, в браузере — Phantom/Solflare/Backpack через wallet-adapter.
import { useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, VersionedTransaction, type Connection, type PublicKey } from '@solana/web3.js';
import { builtinStore } from './builtin';
import { isTelegram } from '../lib/telegram';
import { useMemory } from '../lib/ui';

export interface SolSigner {
  kind: 'builtin' | 'adapter';
  publicKey: PublicKey | null;
  name?: string;
  send: (tx: VersionedTransaction | Transaction, connection: Connection) => Promise<string>;
}

export function useSolSigner(): SolSigner {
  const adapter = useWallet();
  const builtin = useMemory(builtinStore);
  const useBuiltin = isTelegram() && builtin.status === 'ready' && Boolean(builtin.sol);

  return useMemo<SolSigner>(() => {
    if (useBuiltin && builtin.sol && builtin.solAddress) {
      const kp = builtin.sol;
      return {
        kind: 'builtin',
        publicKey: builtin.solAddress,
        name: 'Встроенный кошелёк',
        send: async (tx, connection) => {
          if (tx instanceof VersionedTransaction) {
            tx.sign([kp]);
          } else {
            tx.feePayer ??= kp.publicKey;
            if (!tx.recentBlockhash) tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
            tx.sign(kp);
          }
          return connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        },
      };
    }
    return {
      kind: 'adapter',
      publicKey: adapter.publicKey,
      name: adapter.wallet?.adapter.name,
      send: (tx, connection) => adapter.sendTransaction(tx, connection, { maxRetries: 3 }),
    };
  }, [useBuiltin, builtin.sol, builtin.solAddress, adapter]);
}
