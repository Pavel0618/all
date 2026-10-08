import type { ChainId } from './chains';
import type { Trade } from './storage';

export interface Position {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image?: string;
  bought: number;
  sold: number;
  holding: number;
  spentNative: number;
  receivedNative: number;
  nativeSymbol: string;
  /** Средняя цена входа в $ (по ценам DexScreener в момент покупок) */
  avgEntryUsd?: number;
  lastAt: number;
}

/** Собирает позиции из истории сделок, сделанных через приложение. */
export function buildPositions(trades: Trade[]): Position[] {
  const map = new Map<string, Position & { _usdSum: number; _usdTokens: number }>();
  // Идём от старых к новым
  for (const t of [...trades].sort((a, b) => a.at - b.at)) {
    const key = `${t.chain}:${t.address}`;
    let p = map.get(key);
    if (!p) {
      p = {
        chain: t.chain,
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        image: t.image,
        bought: 0,
        sold: 0,
        holding: 0,
        spentNative: 0,
        receivedNative: 0,
        nativeSymbol: t.nativeSymbol,
        lastAt: t.at,
        _usdSum: 0,
        _usdTokens: 0,
      };
      map.set(key, p);
    }
    if (t.side === 'buy') {
      p.bought += t.tokenAmount;
      p.spentNative += t.nativeAmount;
      if (t.priceUsd) {
        p._usdSum += t.priceUsd * t.tokenAmount;
        p._usdTokens += t.tokenAmount;
      }
    } else {
      p.sold += t.tokenAmount;
      p.receivedNative += t.nativeAmount;
    }
    p.holding = Math.max(0, p.bought - p.sold);
    p.lastAt = t.at;
  }
  return [...map.values()]
    .map(({ _usdSum, _usdTokens, ...p }) => ({ ...p, avgEntryUsd: _usdTokens > 0 ? _usdSum / _usdTokens : undefined }))
    .sort((a, b) => b.lastAt - a.lastAt);
}
