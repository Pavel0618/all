import { useEffect, useMemo, useState } from 'react';
import { CHAINS, toolLinks, type ChainId } from '../lib/chains';
import { getTokensBatch, mainPair, type DexPair } from '../lib/dexscreener';
import { buildPositions } from '../lib/portfolio';
import { tradesStore, useStore, watchStore } from '../lib/storage';
import { fmtAmount, fmtPrice, fmtUsd, timeAgo } from '../lib/format';
import { href } from '../lib/router';
import { TokenIcon } from './TokenCard';

const VERDICT_LABEL = { go: 'можно входить', caution: 'осторожно', skip: 'пропустить', danger: 'опасно' } as const;

export function Portfolio() {
  const [trades, setTrades] = useStore(tradesStore);
  const [watch, setWatch] = useStore(watchStore);
  const positions = useMemo(() => buildPositions(trades), [trades]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  // Текущие цены по всем токенам из позиций и избранного
  useEffect(() => {
    const byChain = new Map<ChainId, Set<string>>();
    for (const p of [...positions, ...watch]) {
      if (!byChain.has(p.chain)) byChain.set(p.chain, new Set());
      byChain.get(p.chain)!.add(p.address);
    }
    let cancelled = false;
    const load = async () => {
      const out: Record<string, number> = {};
      for (const [chain, set] of byChain) {
        const addrs = [...set];
        const pairs = await getTokensBatch(chain, addrs).catch(() => [] as DexPair[]);
        for (const a of addrs) {
          const best = mainPair(
            pairs.filter((p) => p.baseToken.address.toLowerCase() === a.toLowerCase()),
            a,
          );
          if (best?.priceUsd) out[`${chain}:${a}`] = parseFloat(best.priceUsd);
        }
      }
      if (!cancelled) setPrices(out);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [positions, watch]);

  const open = positions.filter((p) => p.holding > 0);
  const closed = positions.filter((p) => p.holding <= 0);

  return (
    <div className="page">
      <section className="card">
        <h2>Мои позиции</h2>
        <p className="muted small">Сделки, совершённые через приложение. Цены входа — по DexScreener в момент покупки (приблизительно).</p>
        {!open.length && <div className="empty">Пока нет открытых позиций. Найдите монету на радаре и пройдите проверку.</div>}
        <div className="list">
          {open.map((p) => {
            const now = prices[`${p.chain}:${p.address}`];
            const x = now && p.avgEntryUsd ? now / p.avgEntryUsd : undefined;
            return (
              <a key={`${p.chain}:${p.address}`} className="pos" href={href({ name: 'token', chain: p.chain, address: p.address })}>
                <TokenIcon src={p.image} symbol={p.symbol} />
                <div className="pos-main">
                  <div>
                    <b>{p.symbol}</b> <span className="chain-tag">{CHAINS[p.chain].name}</span>
                  </div>
                  <div className="muted small">
                    {fmtAmount(p.holding)} шт · вложено {fmtAmount(p.spentNative)} {p.nativeSymbol}
                  </div>
                  <div className="muted small">
                    Вход {fmtPrice(p.avgEntryUsd)} → сейчас {fmtPrice(now)}
                  </div>
                </div>
                <div className="pos-right">
                  <div className={`x ${x === undefined ? '' : x >= 1 ? 'up' : 'down'}`}>{x === undefined ? '—' : `×${x.toFixed(2)}`}</div>
                  <div className="small">{now ? fmtUsd(now * p.holding) : ''}</div>
                  {x !== undefined && x >= 2 && <div className="badge badge-hot">пора фиксировать?</div>}
                </div>
              </a>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>Избранное</h2>
        {!watch.length && <div className="empty">Нажмите ☆ на странице токена, чтобы следить за ним.</div>}
        <div className="list">
          {watch.map((w) => (
            <div key={`${w.chain}:${w.address}`} className="pos">
              <TokenIcon src={w.image} symbol={w.symbol} />
              <a className="pos-main" href={href({ name: 'token', chain: w.chain, address: w.address })}>
                <div>
                  <b>{w.symbol}</b> <span className="chain-tag">{CHAINS[w.chain].name}</span>
                </div>
                <div className="muted small">
                  {fmtPrice(prices[`${w.chain}:${w.address}`])} · добавлен {timeAgo(w.addedAt)}
                  {w.verdict && <> · был вердикт «{VERDICT_LABEL[w.verdict]}»</>}
                </div>
              </a>
              <button
                className="icon-btn"
                aria-label="Убрать"
                onClick={() => setWatch((list) => list.filter((x) => !(x.chain === w.chain && x.address === w.address)))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>История сделок</h2>
          {trades.length > 0 && (
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (confirm('Очистить историю сделок в этом браузере? Сами токены останутся на кошельке.')) setTrades([]);
              }}
            >
              Очистить
            </button>
          )}
        </div>
        {!trades.length && <div className="empty">Сделок пока нет.</div>}
        <div className="list">
          {trades.slice(0, 100).map((t) => (
            <div key={t.id} className="trade-row">
              <span className={`side side-${t.side}`}>{t.side === 'buy' ? 'Покупка' : 'Продажа'}</span>
              <span>
                <b>{fmtAmount(t.tokenAmount)}</b> {t.symbol} за {fmtAmount(t.nativeAmount)} {t.nativeSymbol}
              </span>
              <span className="muted small">{timeAgo(t.at)}</span>
              <a href={toolLinks.explorerTx(t.chain, t.tx)} target="_blank" rel="noreferrer" className="small">
                tx ↗
              </a>
            </div>
          ))}
        </div>
        {closed.length > 0 && <p className="muted small">Закрытых позиций: {closed.length}</p>}
      </section>
    </div>
  );
}
