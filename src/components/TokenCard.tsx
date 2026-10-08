import type { ChainId } from '../lib/chains';
import { CHAINS } from '../lib/chains';
import { extractSocials, type DexPair, type TokenProfile } from '../lib/dexscreener';
import { activityAcceleration, DEFAULT_THRESHOLDS, marketFromPair, type Thresholds } from '../lib/analysis';
import { matchNarratives, type Narrative } from '../lib/narratives';
import { fmtPct, fmtUsd } from '../lib/format';
import { href } from '../lib/router';

export interface CardToken {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image?: string;
  mcap?: number;
  liquidity?: number;
  h1?: number;
  h24?: number;
  accel?: number;
  ageHours?: number;
  hasTwitter: boolean;
  boosted: boolean;
  narrative?: string;
  /** Подходит ли по капе/ликвидности/наличию Twitter */
  fits: boolean;
}

export function cardFromPair(
  pair: DexPair,
  opts: { narratives: Narrative[]; thresholds?: Thresholds; profile?: TokenProfile; boosted?: boolean },
): CardToken {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const m = marketFromPair(pair);
  const socials = extractSocials(pair, opts.profile);
  const hasTwitter = Boolean(socials.twitter || socials.twitterUrl);
  const narrative = matchNarratives(
    { name: pair.baseToken.name, symbol: pair.baseToken.symbol, description: opts.profile?.description },
    opts.narratives,
  )[0]?.narrative.name;
  return {
    chain: pair.chainId as ChainId,
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    image: pair.info?.imageUrl ?? opts.profile?.icon,
    mcap: m.mcap,
    liquidity: m.liquidity,
    h1: m.change.h1,
    h24: m.change.h24,
    accel: activityAcceleration(m),
    ageHours: m.ageHours,
    hasTwitter,
    boosted: m.boosted || Boolean(opts.boosted),
    narrative,
    fits:
      hasTwitter &&
      m.mcap !== undefined &&
      m.mcap <= t.maxMcap &&
      (pair.dexId === 'pumpfun' || (m.liquidity ?? 0) >= t.minLiquidity),
  };
}

export function TokenCard({ t }: { t: CardToken }) {
  const age =
    t.ageHours === undefined ? '' : t.ageHours < 1 ? `${Math.round(t.ageHours * 60)} мин` : t.ageHours < 48 ? `${t.ageHours.toFixed(0)} ч` : `${(t.ageHours / 24).toFixed(0)} дн`;
  return (
    <a className="token-card" href={href({ name: 'token', chain: t.chain, address: t.address })}>
      <div className="token-card-top">
        <TokenIcon src={t.image} symbol={t.symbol} />
        <div className="token-card-name">
          <div>
            <b>{t.symbol}</b> <span className="chain-tag">{CHAINS[t.chain]?.name}</span>
          </div>
          <div className="muted small ellipsis">{t.name}</div>
        </div>
        <div className={`chg ${(t.h1 ?? 0) >= 0 ? 'up' : 'down'}`}>
          {fmtPct(t.h1)}
          <span className="muted small"> 1ч</span>
        </div>
      </div>
      <div className="token-card-stats">
        <span>
          Капа <b>{fmtUsd(t.mcap)}</b>
        </span>
        <span>
          Ликв. <b>{fmtUsd(t.liquidity)}</b>
        </span>
        {age && <span className="muted">{age}</span>}
      </div>
      <div className="badges">
        {t.fits && <span className="badge badge-ok">под методику</span>}
        {t.accel !== undefined && t.accel >= 1.5 && <span className="badge badge-hot">активность ×{t.accel.toFixed(1)}</span>}
        {!t.hasTwitter && <span className="badge badge-warn">нет Twitter</span>}
        {t.boosted && <span className="badge badge-ad">реклама</span>}
        {t.narrative && <span className="badge">{t.narrative}</span>}
      </div>
    </a>
  );
}

export function TokenIcon({ src, symbol, size = 40 }: { src?: string; symbol: string; size?: number }) {
  if (src) return <img className="token-icon" src={src} alt="" width={size} height={size} loading="lazy" />;
  return (
    <span className="token-icon token-icon-ph" style={{ width: size, height: size }}>
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
