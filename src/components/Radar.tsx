// Шаг 1: «Найди всплеск интереса». Лента токенов, которые сейчас набирают активность,
// с фильтром под критерии методики + ссылки на Twitter-аналитику.
import { useEffect, useMemo, useState } from 'react';
import { CHAIN_LIST, toolLinks, type ChainId } from '../lib/chains';
import { getBoosted, getLatestProfiles, getTokensBatch, mainPair, type DexPair, type TokenProfile } from '../lib/dexscreener';
import { getTrendingTokenAddresses } from '../lib/gecko';
import { settingsStore, useStore } from '../lib/storage';
import { cardFromPair, TokenCard, type CardToken } from './TokenCard';
import { SearchBar } from './SearchBar';
import { timeAgo } from '../lib/format';

type Source = 'trending' | 'new';

const LS_CHAIN = 'gr.radarChain';
const LS_INTRO = 'gr.introHidden';

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function Radar() {
  const [settings] = useStore(settingsStore);
  const [chain, setChain] = useState<ChainId>(() => (lsGet(LS_CHAIN) as ChainId) || 'solana');
  const [source, setSource] = useState<Source>('trending');
  const [onlyFit, setOnlyFit] = useState(true);
  const [cards, setCards] = useState<CardToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [reload, setReload] = useState(0);
  const [introHidden, setIntroHidden] = useState(() => lsGet(LS_INTRO) === '1');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    (async () => {
      let addresses: string[] = [];
      const profiles = new Map<string, TokenProfile>();
      const boosted = new Set<string>();

      const boosts = await getBoosted().catch(() => [] as TokenProfile[]);
      for (const b of boosts) if (b.chainId === chain) boosted.add(b.tokenAddress.toLowerCase());

      if (source === 'trending') {
        addresses = await getTrendingTokenAddresses(chain);
      } else {
        const list = await getLatestProfiles();
        for (const p of list) {
          if (p.chainId !== chain) continue;
          profiles.set(p.tokenAddress.toLowerCase(), p);
          if (!addresses.includes(p.tokenAddress)) addresses.push(p.tokenAddress);
        }
      }

      const pairs = await getTokensBatch(chain, addresses.slice(0, 60));
      const byToken = new Map<string, DexPair[]>();
      for (const p of pairs) {
        const k = p.baseToken.address.toLowerCase();
        byToken.set(k, [...(byToken.get(k) ?? []), p]);
      }
      const out: CardToken[] = [];
      for (const addr of addresses) {
        const k = addr.toLowerCase();
        const list = byToken.get(k);
        const best = list && mainPair(list, addr);
        if (!best) continue;
        out.push(
          cardFromPair(best, {
            narratives: settings.narratives,
            thresholds: settings.thresholds,
            profile: profiles.get(k),
            boosted: boosted.has(k),
          }),
        );
      }
      if (!cancelled) {
        setCards(out);
        setUpdatedAt(Date.now());
      }
    })()
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [chain, source, reload, settings.narratives, settings.thresholds]);

  // Автообновление раз в минуту
  useEffect(() => {
    const t = setInterval(() => setReload((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => (onlyFit ? cards.filter((c) => c.fits) : cards), [cards, onlyFit]);

  return (
    <div className="page">
      {!introHidden && (
        <section className="card intro">
          <button
            className="icon-btn intro-close"
            aria-label="Скрыть"
            onClick={() => {
              setIntroHidden(true);
              lsSet(LS_INTRO, '1');
            }}
          >
            ✕
          </button>
          <h2>Как это работает</h2>
          <ol className="steps-mini">
            <li>
              <b>Найдите монету</b> — в ленте ниже или вставьте адрес / ссылку из Twitter, DexScreener, GMGN, pump.fun.
            </li>
            <li>
              <b>Пройдите 5 проверок</b> методики: хайп, кто раскачивает, контракт, график, нарратив. Половину приложение делает само.
            </li>
            <li>
              <b>Купите в 1 клик</b> из своего кошелька (Phantom, MetaMask…) — или пропустите, если 2 из 5 слабые.
            </li>
          </ol>
        </section>
      )}

      <SearchBar big />

      <section className="card">
        <div className="row-between">
          <h2>Радар · всплеск интереса</h2>
          <button className="btn btn-small btn-ghost" onClick={() => setReload((x) => x + 1)} disabled={loading}>
            {loading ? 'Обновляем…' : '↻ Обновить'}
          </button>
        </div>

        <div className="chips" role="tablist" aria-label="Сеть">
          {CHAIN_LIST.map((c) => (
            <button
              key={c.id}
              className={`chip ${chain === c.id ? 'chip-active' : ''}`}
              onClick={() => {
                setChain(c.id);
                lsSet(LS_CHAIN, c.id);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="row-between wrap gap">
          <div className="seg">
            <button className={source === 'trending' ? 'seg-active' : ''} onClick={() => setSource('trending')}>
              🔥 Набирают активность
            </button>
            <button className={source === 'new' ? 'seg-active' : ''} onClick={() => setSource('new')}>
              🆕 Новые с соцсетями
            </button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} />
            <span>Только под методику</span>
          </label>
        </div>
        <p className="muted small">
          «Под методику» = есть Twitter, капа до {Math.round(settings.thresholds.maxMcap / 1000)}k$, ликвидность от{' '}
          {Math.round(settings.thresholds.minLiquidity / 1000)}k$. Метка «реклама» — токен купил продвижение на DexScreener: проверяйте, что хайп
          органический.
        </p>

        {error && <div className="alert alert-error">Не удалось загрузить ленту: {error}</div>}
        {!error && !loading && shown.length === 0 && (
          <div className="empty">
            {cards.length ? 'Сейчас нет монет под критерии — снимите фильтр или загляните позже.' : 'Пусто. Попробуйте другую сеть.'}
          </div>
        )}
        {loading && !cards.length && <div className="skeleton-list">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>}

        <div className="grid">
          {shown.map((t) => (
            <TokenCard key={`${t.chain}:${t.address}`} t={t} />
          ))}
        </div>
        {updatedAt && <div className="muted small center">Обновлено {timeAgo(updatedAt)} · данные DexScreener и GeckoTerminal</div>}
      </section>

      <section className="card">
        <h2>Где ещё ловить хайп в Twitter</h2>
        <p className="muted small">
          Twitter — первая искра пампа. Нашли монету в этих сервисах — скопируйте адрес или ссылку и вставьте в поиск выше.
        </p>
        <div className="tool-grid">
          <a className="tool" href={toolLinks.tweetScout} target="_blank" rel="noreferrer">
            <b>TweetScout</b>
            <span>Trending и Early projects — вирусный рост упоминаний</span>
          </a>
          <a className="tool" href={toolLinks.twitterScoreTop} target="_blank" rel="noreferrer">
            <b>TwitterScore</b>
            <span>TOP Researched — оценка вовлечённости, Score</span>
          </a>
          <a className="tool" href={toolLinks.moniTrending} target="_blank" rel="noreferrer">
            <b>Moni</b>
            <span>Trending — «хайп»-токены в моментуме</span>
          </a>
          <a className="tool" href={toolLinks.gmgnTrending(chain)} target="_blank" rel="noreferrer">
            <b>GMGN</b>
            <span>Тренды с разбивкой по KOL и smart-кошелькам</span>
          </a>
          <a className="tool" href={toolLinks.xSearchLive('$SOL OR pump.fun OR "just launched" min_faves:50')} target="_blank" rel="noreferrer">
            <b>Поиск в X</b>
            <span>Свежие твиты с тикерами и запусками</span>
          </a>
          <a className="tool" href={toolLinks.dexscreenerTrending(chain)} target="_blank" rel="noreferrer">
            <b>DexScreener</b>
            <span>Тренды по объёму и активности</span>
          </a>
        </div>
      </section>
    </div>
  );
}
