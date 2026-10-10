// Единый обмен для EVM-сетей: сначала KyberSwap (комиссия сразу на адрес владельца),
// при ошибке — LI.FI. Интерфейс один, поэтому экран покупки не зависит от агрегатора.
import type { Address, Hex } from 'viem';
import type { ChainId } from './chains';
import { kyberBuild, kyberRoute, NATIVE, type KyberFee, type KyberRoute } from './kyber';
import { LIFI_NATIVE, lifiQuote, type LifiQuote } from './lifi';
import { LIFI_INTEGRATOR } from '../config';
import { assertEvmValue, assertTrustedRouter } from './txGuard';

export interface EvmQuote {
  provider: 'KyberSwap' | 'LI.FI';
  amountIn: string;
  amountOut: string;
  amountInUsd?: number;
  amountOutUsd?: number;
  gasUsd?: number;
  /** Комиссия сервиса включена в этот маршрут */
  feeApplied: boolean;
  /** Кому выдавать разрешение (approve) при продаже */
  spender?: Address;
  kyber?: KyberRoute;
}

export interface EvmTx {
  to: Address;
  data: Hex;
  value: bigint;
  spender?: Address;
  amountIn: string;
  amountOut: string;
}

export interface SwapSide {
  chain: ChainId;
  /** true — покупаем токен за нативную монету, false — продаём токен */
  buy: boolean;
  token: string;
  amountIn: bigint;
  /** Комиссия сервиса в bps и адрес получателя (для KyberSwap) */
  fee?: { bps: number; receiver: string };
}

const num = (v?: string) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

function lifiFee(fee: SwapSide['fee']) {
  return fee && LIFI_INTEGRATOR ? { fraction: fee.bps / 10_000, integrator: LIFI_INTEGRATOR } : undefined;
}

function fromLifi(q: LifiQuote, feeApplied: boolean): EvmQuote {
  if (q.estimate.approvalAddress) assertTrustedRouter('LI.FI', q.estimate.approvalAddress, 'для разрешения (approve)');
  return {
    provider: 'LI.FI',
    amountIn: q.estimate.fromAmount,
    amountOut: q.estimate.toAmount,
    amountInUsd: num(q.estimate.fromAmountUSD),
    amountOutUsd: num(q.estimate.toAmountUSD),
    gasUsd: q.estimate.gasCosts?.reduce((s, g) => s + (num(g.amountUSD) ?? 0), 0),
    feeApplied,
    spender: q.estimate.approvalAddress as Address | undefined,
  };
}

export async function evmQuote(side: SwapSide, account?: string): Promise<EvmQuote> {
  const kf: KyberFee | undefined = side.fee ? { ...side.fee, chargeFeeBy: side.buy ? 'currency_in' : 'currency_out' } : undefined;
  try {
    const r = side.buy
      ? await kyberRoute(side.chain, NATIVE, side.token, side.amountIn.toString(), kf)
      : await kyberRoute(side.chain, side.token, NATIVE, side.amountIn.toString(), kf);
    assertTrustedRouter('KyberSwap', r.routerAddress, 'роутера');
    return {
      provider: 'KyberSwap',
      amountIn: r.routeSummary.amountIn,
      amountOut: r.routeSummary.amountOut,
      amountInUsd: num(r.routeSummary.amountInUsd),
      amountOutUsd: num(r.routeSummary.amountOutUsd),
      gasUsd: num(r.routeSummary.gasUsd),
      feeApplied: Boolean(kf),
      spender: r.routerAddress as Address,
      kyber: r,
    };
  } catch (kyberError) {
    try {
      const fee = lifiFee(side.fee);
      const q = await lifiQuote({
        chain: side.chain,
        fromToken: side.buy ? LIFI_NATIVE : side.token,
        toToken: side.buy ? side.token : LIFI_NATIVE,
        fromAmount: side.amountIn.toString(),
        fromAddress: account,
        slippageBps: 500,
        fee,
      });
      return fromLifi(q, Boolean(fee));
    } catch {
      throw kyberError;
    }
  }
}

/** Собрать транзакцию у того же агрегатора, что дал котировку. */
export async function evmBuild(side: SwapSide, quote: EvmQuote, account: string, slippageBps: number): Promise<EvmTx> {
  if (quote.provider === 'KyberSwap' && quote.kyber) {
    const built = await kyberBuild(side.chain, quote.kyber, account, slippageBps);
    assertTrustedRouter('KyberSwap', built.routerAddress, 'получателя транзакции');
    const value = side.buy ? BigInt(built.transactionValue ?? built.amountIn) : 0n;
    assertEvmValue(side.buy, value, side.amountIn);
    return {
      to: built.routerAddress as Address,
      data: built.data as Hex,
      value,
      spender: quote.kyber.routerAddress as Address,
      amountIn: built.amountIn,
      amountOut: built.amountOut,
    };
  }
  const q = await lifiQuote({
    chain: side.chain,
    fromToken: side.buy ? LIFI_NATIVE : side.token,
    toToken: side.buy ? side.token : LIFI_NATIVE,
    fromAmount: side.amountIn.toString(),
    fromAddress: account,
    slippageBps,
    fee: quote.feeApplied ? lifiFee(side.fee) : undefined,
  });
  if (!q.transactionRequest) throw new Error('LI.FI не вернул транзакцию');
  assertTrustedRouter('LI.FI', q.transactionRequest.to, 'получателя транзакции');
  if (q.estimate.approvalAddress) assertTrustedRouter('LI.FI', q.estimate.approvalAddress, 'для разрешения (approve)');
  const value = side.buy ? BigInt(q.transactionRequest.value ?? side.amountIn.toString()) : 0n;
  assertEvmValue(side.buy, value, side.amountIn);
  return {
    to: q.transactionRequest.to as Address,
    data: q.transactionRequest.data as Hex,
    value,
    spender: q.estimate.approvalAddress as Address | undefined,
    amountIn: q.estimate.fromAmount,
    amountOut: q.estimate.toAmount,
  };
}
