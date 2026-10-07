// Встроенный кошелёк для Telegram Mini App.
// Внутри Telegram нет расширений Phantom/MetaMask, поэтому ключи создаются прямо в приложении
// и хранятся ТОЛЬКО на устройстве пользователя (SecureStorage → DeviceStorage → localStorage).
// На сервер ключи не отправляются — сервера у приложения нет.
import bs58 from 'bs58';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { keyStores, type KeyValueStore } from '../lib/telegram';
import { memory } from '../lib/ui';

const STORAGE_KEY = 'gr_wallet_v1';

interface StoredWallet {
  v: 1;
  /** Секретный ключ Solana (64 байта) в base58 — в таком виде его принимает Phantom */
  sol: string;
  /** Приватный ключ EVM (hex) — в таком виде его принимает MetaMask */
  evm: Hex;
  backedUp: boolean;
  createdAt: number;
}

export interface BuiltinState {
  status: 'idle' | 'loading' | 'none' | 'ready';
  sol?: Keypair;
  solAddress?: PublicKey;
  evm?: PrivateKeyAccount;
  storage?: KeyValueStore['kind'];
  backedUp?: boolean;
}

export const builtinStore = memory<BuiltinState>({ status: 'idle' });

let current: StoredWallet | undefined;

function apply(w: StoredWallet | undefined, storage?: KeyValueStore['kind']) {
  current = w;
  if (!w) {
    builtinStore.set({ status: 'none' });
    return;
  }
  const sol = Keypair.fromSecretKey(bs58.decode(w.sol));
  builtinStore.set({
    status: 'ready',
    sol,
    solAddress: sol.publicKey,
    evm: privateKeyToAccount(w.evm),
    storage,
    backedUp: w.backedUp,
  });
}

function parseStored(raw: string): StoredWallet | undefined {
  try {
    const w = JSON.parse(raw) as StoredWallet;
    if (w?.v === 1 && typeof w.sol === 'string' && typeof w.evm === 'string') return w;
  } catch {
    /* повреждённые данные */
  }
  return undefined;
}

export async function loadBuiltin(): Promise<void> {
  builtinStore.set({ status: 'loading' });
  for (const store of keyStores()) {
    try {
      const raw = await store.get(STORAGE_KEY);
      const w = raw ? parseStored(raw) : undefined;
      if (w) {
        apply(w, store.kind);
        return;
      }
    } catch {
      /* хранилище недоступно на этой платформе — пробуем следующее */
    }
  }
  apply(undefined);
}

async function save(w: StoredWallet): Promise<KeyValueStore['kind']> {
  const raw = JSON.stringify(w);
  const stores = keyStores();
  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    try {
      await store.set(STORAGE_KEY, raw);
      if ((await store.get(STORAGE_KEY)) !== raw) continue;
      // Убираем старые копии из менее надёжных хранилищ
      for (const weaker of stores.slice(i + 1)) await weaker.remove(STORAGE_KEY).catch(() => undefined);
      return store.kind;
    } catch {
      /* пробуем следующее */
    }
  }
  throw new Error('Не удалось сохранить ключи на устройстве');
}

/**
 * Защита от потери средств: если хранилище ответило медленно и кошелёк «не нашёлся»,
 * нельзя молча перезаписать существующий ключ новым.
 */
async function assertNoExistingWallet(): Promise<void> {
  for (const store of keyStores()) {
    let raw: string | undefined;
    try {
      raw = await store.get(STORAGE_KEY);
    } catch {
      continue;
    }
    if (raw && parseStored(raw)) {
      await loadBuiltin();
      throw new Error('На этом устройстве уже есть кошелёк — открыли его. Чтобы заменить, сначала удалите его в настройках кошелька.');
    }
  }
}

export async function createBuiltin(): Promise<void> {
  await assertNoExistingWallet();
  const w: StoredWallet = {
    v: 1,
    sol: bs58.encode(Keypair.generate().secretKey),
    evm: generatePrivateKey(),
    backedUp: false,
    createdAt: Date.now(),
  };
  const kind = await save(w);
  apply(w, kind);
}

/** Разбор ключа Solana: base58 (Phantom) или массив из 64 чисел (Solflare / CLI). */
export function parseSolanaSecret(text: string): Keypair | undefined {
  const t = text.trim();
  try {
    if (t.startsWith('[')) {
      const arr = JSON.parse(t) as number[];
      if (Array.isArray(arr) && arr.length === 64) return Keypair.fromSecretKey(Uint8Array.from(arr));
      return undefined;
    }
    const bytes = bs58.decode(t);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  } catch {
    /* не ключ Solana */
  }
  return undefined;
}

export function parseEvmKey(text: string): Hex | undefined {
  const t = text.trim();
  const hex = t.startsWith('0x') ? t : `0x${t}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as Hex) : undefined;
}

/**
 * Импорт: можно вставить ключ Solana, ключ EVM или оба (с новой строки).
 * Недостающий ключ создаётся заново.
 */
export async function importBuiltin(text: string): Promise<{ sol: boolean; evm: boolean }> {
  let sol: Keypair | undefined;
  let evm: Hex | undefined;
  for (const part of text.split(/[\s,;]+(?![^[]*\])/).filter(Boolean)) {
    sol ??= parseSolanaSecret(part);
    evm ??= parseEvmKey(part);
  }
  // Массив Solflare может содержать пробелы — пробуем строку целиком
  sol ??= parseSolanaSecret(text);
  if (!sol && !evm) throw new Error('Не похоже на приватный ключ Solana или EVM');
  await assertNoExistingWallet();
  const w: StoredWallet = {
    v: 1,
    sol: bs58.encode((sol ?? Keypair.generate()).secretKey),
    evm: evm ?? generatePrivateKey(),
    backedUp: true,
    createdAt: Date.now(),
  };
  const kind = await save(w);
  apply(w, kind);
  return { sol: Boolean(sol), evm: Boolean(evm) };
}

export async function markBackedUp(): Promise<void> {
  if (!current) return;
  const w = { ...current, backedUp: true };
  const kind = await save(w);
  apply(w, kind);
}

export function exportKeys(): { sol: string; evm: Hex } | undefined {
  return current ? { sol: current.sol, evm: current.evm } : undefined;
}

export async function deleteBuiltin(): Promise<void> {
  for (const store of keyStores()) await store.remove(STORAGE_KEY).catch(() => undefined);
  apply(undefined);
}
