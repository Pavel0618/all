import { useEffect, useState } from 'react';
import { mainPair, searchPairs, type DexPair } from '../lib/dexscreener';
import { settingsStore, useStore } from '../lib/storage';
import { cardFromPair, TokenCard, type CardToken } from './TokenCard';
import { SearchBar } from './SearchBar';

export function SearchPage({ q }: { q: string }) {
  const [settings] = useStore(settingsStore);
  const [cards, setCards] = useState<CardToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    searchPairs(q)
      .then((pairs) => {
        const byToken = new Map<string, DexPair[]>();
        for (const p of pairs) {
          const k = `${p.chainId}:${p.baseToken.address.toLowerCase()}`;
          byToken.set(k, [...(byToken.get(k) ?? []), p]);
        }
        const out = [...byToken.values()]
          .map((list) => mainPair(list))
          .filter((p): p is DexPair => Boolean(p))
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
          .map((p) => cardFromPair(p, { narratives: settings.narratives, thresholds: settings.thresholds }));
        if (!cancelled) setCards(out);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [q, settings.narratives, settings.thresholds]);

  return (
    <div className="page">
      <SearchBar />
      <section className="card">
        <h2>Поиск: «{q}»</h2>
        <p className="muted small">
          Осторожно с одинаковыми тикерами — скамеры часто копируют название. Сверяйте адрес контракта с тем, что указан в Twitter проекта.
        </p>
        {loading && <div className="skeleton-list">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        {!loading && !error && cards.length === 0 && <div className="empty">Ничего не нашли. Попробуйте адрес контракта.</div>}
        <div className="grid">
          {cards.map((t) => (
            <TokenCard key={`${t.chain}:${t.address}`} t={t} />
          ))}
        </div>
      </section>
    </div>
  );
}
