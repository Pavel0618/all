// Страница токена: 5 шагов методики → финальное решение → покупка.
import { useMemo } from 'react';
import { CHAINS, isChainId, toolLinks } from '../lib/chains';
import { analyze, fmtUsd, marketFromPair, type Answer, type ManualAnswers } from '../lib/analysis';
import { answersStore, settingsStore, tokenKey, useStore, watchStore } from '../lib/storage';
import { useToken } from '../lib/useToken';
import { fmtAmount, fmtPct, fmtPrice, shortAddr, timeAgo } from '../lib/format';
import { toast } from '../lib/ui';
import { SecurityList, StepCard, VerdictCard, type ToolLink } from './Steps';
import { TokenIcon } from './TokenCard';
import { TradePanel } from './TradePanel';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('ok', `${what} скопирован`);
  } catch {
    toast('error', 'Не удалось скопировать');
  }
}

export function TokenPage({ chain: chainParam, address }: { chain: string; address: string }) {
  const state = useToken(chainParam, address);
  const [settings] = useStore(settingsStore);
  const [allAnswers, setAllAnswers] = useStore(answersStore);
  const [watch, setWatch] = useStore(watchStore);

  const chain = isChainId(chainParam) ? chainParam : undefined;
  const key = chain ? tokenKey(chain, address) : '';
  const answers: ManualAnswers = allAnswers[key] ?? {};
  const setAnswer = (k: keyof ManualAnswers) => (a?: Answer) =>
    setAllAnswers((all) => ({ ...all, [key]: { ...(all[key] ?? {}), [k]: a } }));

  const data = state.data;
  const pair = data?.pair;
  const market = useMemo(() => marketFromPair(pair), [pair]);
  const socials = data?.socials;
  const symbol = pair?.baseToken.symbol ?? '';
  const name = pair?.baseToken.name ?? '';

  const analysis = useMemo(
    () =>
      analyze({
        market,
        security: state.security,
        securityLoaded: state.securityLoaded,
        twitter: socials?.twitter,
        hasTwitterLink: Boolean(socials?.twitter || socials?.twitterUrl),
        token: { name, symbol },
        narratives: settings.narratives,
        answers,
        thresholds: settings.thresholds,
      }),
    [market, state.security, state.securityLoaded, socials, name, symbol, settings.narratives, settings.thresholds, answers],
  );

  if (state.loading) {
    return (
      <div className="page">
        <div className="card">
          <div className="skeleton" style={{ height: 80 }} />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }
  if (state.error || !data || !chain) {
    return (
      <div className="page">
        <div className="card">
          <h2>Не получилось загрузить токен</h2>
          <p className="muted">{state.error ?? 'Проверьте адрес и сеть.'}</p>
          <p className="small muted">
            Адрес: <code>{address}</code>
          </p>
          <a className="btn btn-ghost" href="#/">
            ← На радар
          </a>
        </div>
      </div>
    );
  }

  const [cHype, cInfl, cPrice, cContract, cNarr] = analysis.criteria;
  const handle = socials?.twitter;
  const xQuery = symbol ? `$${symbol}` : address;
  const inWatch = watch.some((w) => w.chain === chain && w.address === address);
  const priceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : undefined;

  const toggleWatch = () => {
    if (inWatch) setWatch((list) => list.filter((w) => !(w.chain === chain && w.address === address)));
    else
      setWatch((list) => [
        { chain, address, symbol, name, image: pair?.info?.imageUrl, addedAt: Date.now(), verdict: analysis.verdict.level },
        ...list,
      ]);
  };

  const twitterTools: ToolLink[] = [];
  if (handle) {
    twitterTools.push({ label: 'Профиль в X', href: toolLinks.twitterProfile(handle) });
  } else if (socials?.twitterUrl) {
    twitterTools.push({ label: 'Twitter проекта', href: socials.twitterUrl });
  }

  const jumpToTrade = () => document.getElementById('final')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="page">
      {/* -------- Шапка -------- */}
      <section className="card token-head">
        <div className="token-head-top">
          <TokenIcon src={pair?.info?.imageUrl} symbol={symbol || '?'} size={52} />
          <div className="token-head-name">
            <h1>
              {symbol || shortAddr(address)} <span className="chain-tag">{CHAINS[chain].name}</span>
            </h1>
            <div className="muted ellipsis">{name}</div>
            <button className="addr" onClick={() => copy(address, 'Адрес')} title="Скопировать адрес">
              {shortAddr(address)} ⧉
            </button>
          </div>
          <button className={`icon-btn star ${inWatch ? 'star-on' : ''}`} onClick={toggleWatch} aria-label="В избранное" title="В избранное">
            {inWatch ? '★' : '☆'}
          </button>
        </div>

        {pair ? (
          <>
            <div className="price-row">
              <span className="price">{fmtPrice(pair.priceUsd)}</span>
              {(['m5', 'h1', 'h6', 'h24'] as const).map((k) => (
                <span key={k} className={`chg ${(market.change[k] ?? 0) >= 0 ? 'up' : 'down'}`}>
                  <span className="muted small">{k.replace('m', '').replace('h', '')}{k.startsWith('m') ? 'м' : 'ч'} </span>
                  {fmtPct(market.change[k])}
                </span>
              ))}
            </div>
            <div className="stats">
              <div>
                <span className="muted small">Капа</span>
                <b>{fmtUsd(market.mcap)}</b>
              </div>
              <div>
                <span className="muted small">Ликвидность</span>
                <b>{fmtUsd(market.liquidity)}</b>
              </div>
              <div>
                <span className="muted small">Объём 24ч</span>
                <b>{fmtUsd(pair.volume?.h24)}</b>
              </div>
              <div>
                <span className="muted small">Сделок за 1ч</span>
                <b>{fmtAmount(market.txH1)}</b>
              </div>
            </div>
          </>
        ) : (
          <div className="alert">Пул на DexScreener пока не найден — токен очень новый или адрес неверный.</div>
        )}
        <div className="tools-row">
          <a className="btn btn-small btn-ghost" href={pair?.url ?? toolLinks.dexscreenerToken(chain, address)} target="_blank" rel="noreferrer">
            DexScreener ↗
          </a>
          {toolLinks.gmgnToken(chain, address) && (
            <a className="btn btn-small btn-ghost" href={toolLinks.gmgnToken(chain, address)} target="_blank" rel="noreferrer">
              GMGN ↗
            </a>
          )}
          <a className="btn btn-small btn-ghost" href={toolLinks.explorerToken(chain, address)} target="_blank" rel="noreferrer">
            {chain === 'solana' ? 'Solscan' : 'Обозреватель'} ↗
          </a>
          {state.updatedAt && <span className="muted small">обновлено {timeAgo(state.updatedAt)}</span>}
        </div>
      </section>

      <VerdictCard verdict={analysis.verdict} criteria={analysis.criteria} compact onJump={jumpToTrade} />

      {/* -------- Шаг 1 -------- */}
      <StepCard
        n={1}
        title="Всплеск интереса в Twitter"
        quote="Монеты, про которые резко начали говорить, чаще всего выстреливают в ближайшие часы или дни."
        criterion={cHype}
        tools={[
          { label: `Свежие твиты ${xQuery}`, href: toolLinks.xSearchLive(xQuery) },
          ...(handle ? [{ label: 'TwitterScore', href: toolLinks.twitterScore(handle) }] : []),
          { label: 'TweetScout', href: toolLinks.tweetScout },
          ...twitterTools,
        ]}
        question={{
          text: 'Упоминаний и вовлечённости (лайки, ретвиты) стало резко больше?',
          value: answers.hype,
          onChange: setAnswer('hype'),
          yes: 'Да, растёт',
          no: 'Нет',
        }}
      />

      {/* -------- Шаг 2 -------- */}
      <StepCard
        n={2}
        title="Кто раскачивает монету"
        quote="Иногда хайпит толпа, иногда — один инфлюенсер. Важно понять, что запускает волну."
        criterion={cInfl}
        tools={
          handle
            ? [
                { label: 'Moni: карточка проекта', href: toolLinks.moni(handle) },
                { label: 'TwitterScore: Smart Followers', href: toolLinks.twitterScore(handle) },
                { label: 'Скопировать ссылку на X', onClick: () => copy(`https://x.com/${handle}`, 'Ссылка') },
              ]
            : [
                { label: 'Moni', href: toolLinks.moniTrending },
                ...twitterTools,
              ]
        }
        question={{
          text: 'Smart Followers / Score растут, а пишут реальные KOL — не боты и не рекламные пуши?',
          value: answers.influencers,
          onChange: setAnswer('influencers'),
          yes: 'Да, реальные',
          no: 'Боты / реклама',
        }}
      >
        {!handle && !socials?.twitterUrl && <div className="alert">У токена нет Twitter в данных DexScreener.</div>}
      </StepCard>

      {/* -------- Шаг 3 -------- */}
      <StepCard
        n={3}
        title="Быстрая проверка безопасности"
        quote="Twitter может привести к скаму, если не фильтруешь. Проверка контракта — обязательна."
        criterion={cContract}
        tools={
          chain === 'solana'
            ? [
                { label: 'RugCheck', href: toolLinks.rugcheck(address) },
                { label: 'GoPlus', href: toolLinks.goplus(chain, address) },
              ]
            : [
                ...(toolLinks.tokenSniffer(chain, address) ? [{ label: 'TokenSniffer', href: toolLinks.tokenSniffer(chain, address) }] : []),
                { label: 'GoPlus', href: toolLinks.goplus(chain, address) },
              ]
        }
      >
        <SecurityList report={state.security} loaded={state.securityLoaded} />
      </StepCard>

      {/* -------- Шаг 4 -------- */}
      <StepCard
        n={4}
        title="Анализ графика"
        quote="Twitter даёт сигнал, но слепо залетать — не наш стиль. Заходи, пока график «тихий, но уже пульсирует»."
        criterion={cPrice}
        tools={[
          ...(toolLinks.gmgnToken(chain, address) ? [{ label: 'GMGN: KOL и smart-кошельки', href: toolLinks.gmgnToken(chain, address) }] : []),
          { label: 'DexScreener', href: pair?.url ?? toolLinks.dexscreenerToken(chain, address) },
        ]}
        question={{
          text: 'Посмотрели график: начало пампа, ранний боковик или 1–2 волна роста?',
          value: answers.price,
          onChange: setAnswer('price'),
          yes: 'Да, рано',
          no: 'Нет, поздно',
        }}
      >
        {pair && (
          <div className="chart">
            <iframe
              title="График"
              src={`https://dexscreener.com/${pair.chainId}/${pair.pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usdPrice&interval=5`}
              loading="lazy"
            />
          </div>
        )}
      </StepCard>

      {/* -------- Шаг 5 -------- */}
      <StepCard
        n={5}
        title="Нарратив"
        quote="Если монета попадает в актуальный нарратив — у неё больше шансов на вирусный рост."
        criterion={cNarr}
        tools={[
          { label: 'TweetScout: Trending Tags', href: toolLinks.tweetScout },
          ...(symbol ? [{ label: `#${symbol} в X`, href: toolLinks.xSearchTop(`#${symbol}`) }] : []),
          { label: 'Мои нарративы', href: '#/settings' },
        ]}
        question={{
          text: 'Тема монеты сейчас в тренде (AI, TRUMP, жабы/животные, ETF/L2, ICM…)?',
          value: answers.narrative,
          onChange: setAnswer('narrative'),
          yes: 'Да, в струе',
          no: 'Нет',
        }}
      />

      {/* -------- Итог и покупка -------- */}
      <div id="final" />
      <VerdictCard verdict={analysis.verdict} criteria={analysis.criteria} />
      <TradePanel
        verdict={analysis.verdict.level}
        token={{
          chain,
          address,
          symbol: symbol || shortAddr(address),
          name,
          image: pair?.info?.imageUrl,
          priceUsd,
        }}
      />
    </div>
  );
}
