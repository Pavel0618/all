// Комиссия сервиса с каждой сделки.
// Solana: платформенная комиссия Jupiter, всегда в SOL (wSOL-счёт владельца).
// EVM: комиссия KyberSwap, всегда в нативной монете (ETH/BNB) на адрес владельца.
// Если адрес не указан или счёт для комиссий не готов — сделка проходит без комиссии, а не падает.
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from '@solana/web3.js';
import { isAddress } from 'viem';
import { FEE_BPS, FEE_EVM_WALLET, FEE_SOLANA_WALLET } from '../config';
import type { ChainId } from './chains';
import { CHAINS } from './chains';
import { SOL_MINT } from './jupiter';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Адрес ассоциированного токен-счёта (ATA) владельца для минта. */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** Инструкция «создать ATA, если ещё нет» (CreateIdempotent). Платить может кто угодно. */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = associatedTokenAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function solanaFeeOwner(): PublicKey | undefined {
  if (!FEE_SOLANA_WALLET || FEE_BPS <= 0) return undefined;
  try {
    return new PublicKey(FEE_SOLANA_WALLET);
  } catch {
    return undefined;
  }
}

/** wSOL-счёт, на который Jupiter зачисляет комиссию (и при покупке, и при продаже — одна из сторон всегда SOL). */
export function solanaFeeAccount(): PublicKey | undefined {
  const owner = solanaFeeOwner();
  return owner ? associatedTokenAddress(owner, new PublicKey(SOL_MINT)) : undefined;
}

export function solanaFeeOwnerKey(): PublicKey | undefined {
  return solanaFeeOwner();
}

const READY_KEY = 'gr.feeAccountReady';
let readyCache: { account: string; ok: boolean; at: number } | undefined;

/** Есть ли уже счёт для комиссий. Положительный ответ запоминаем — счёт не исчезает сам. */
export async function isSolanaFeeAccountReady(connection: Connection, force = false): Promise<boolean> {
  const account = solanaFeeAccount();
  if (!account) return false;
  const key = account.toBase58();
  if (force) readyCache = undefined;
  try {
    if (localStorage.getItem(READY_KEY) === key) return true;
  } catch {
    /* ignore */
  }
  if (readyCache && readyCache.account === key && (readyCache.ok || Date.now() - readyCache.at < 60_000)) return readyCache.ok;
  try {
    const info = await connection.getAccountInfo(account);
    const ok = Boolean(info && info.owner.equals(TOKEN_PROGRAM_ID));
    readyCache = { account: key, ok, at: Date.now() };
    if (ok) {
      try {
        localStorage.setItem(READY_KEY, key);
      } catch {
        /* ignore */
      }
    }
    return ok;
  } catch {
    // RPC недоступен — безопаснее провести сделку без комиссии, чем сломать её
    return false;
  }
}

export interface SolanaFee {
  bps: number;
  account: string;
}

/** Параметры комиссии для сделки на Solana или undefined, если комиссия сейчас не берётся. */
export async function solanaFeeFor(connection: Connection): Promise<SolanaFee | undefined> {
  const account = solanaFeeAccount();
  if (!account) return undefined;
  return (await isSolanaFeeAccountReady(connection)) ? { bps: FEE_BPS, account: account.toBase58() } : undefined;
}

export interface EvmFee {
  bps: number;
  receiver: string;
}

export function evmFeeFor(chain: ChainId): EvmFee | undefined {
  if (CHAINS[chain].kind !== 'evm' || FEE_BPS <= 0 || !FEE_EVM_WALLET || !isAddress(FEE_EVM_WALLET)) return undefined;
  return { bps: FEE_BPS, receiver: FEE_EVM_WALLET };
}

/** Комиссия как строка для людей: 50 → «0.5%». */
export function feePercentLabel(bps = FEE_BPS): string {
  return `${(bps / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

export function feeConfigured(): { solana: boolean; evm: boolean } {
  return {
    solana: Boolean(solanaFeeOwner()),
    evm: FEE_BPS > 0 && Boolean(FEE_EVM_WALLET) && isAddress(FEE_EVM_WALLET),
  };
}
