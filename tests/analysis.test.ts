import { describe, expect, it } from 'vitest';
import { analyze, activityAcceleration, DEFAULT_THRESHOLDS, marketFromPair, type AnalysisInput, type Market } from '../src/lib/analysis';
import { DEFAULT_NARRATIVES, matchNarratives } from '../src/lib/narratives';
import { evmFlags, rugCheckFlags, type SecurityReport } from '../src/lib/security';
import { parseUserInput } from '../src/lib/chains';
import { extractSocials, twitterHandle, type DexPair } from '../src/lib/dexscreener';

const cleanSecurity: SecurityReport = {
  sources: ['RugCheck'],
  errors: [],
  flags: [
    { group: 'liquidity', severity: 'ok', text: 'LP 100%', source: 'RugCheck' },
    { group: 'permissions', severity: 'ok', text: 'ok', source: 'RugCheck' },
    { group: 'tax', severity: 'ok', text: 'ok', source: 'RugCheck' },
    { group: 'owner', severity: 'ok', text: 'ok', source: 'RugCheck' },
    { group: 'honeypot', severity: 'ok', text: 'ok', source: 'RugCheck' },
  ],
};

const earlyMarket: Market = {
  mcap: 250_000,
  liquidity: 40_000,
  change: { m5: 3, h1: 12, h6: 40, h24: 60 },
  txH1: 600,
  txH6: 1200,
  buysH1: 350,
  sellsH1: 250,
  ageHours: 10,
  boosted: false,
};

function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    market: earlyMarket,
    security: cleanSecurity,
    securityLoaded: true,
    twitter: 'frogcoin',
    hasTwitterLink: true,
    token: { name: 'Frog Coin', symbol: 'FROG' },
    narratives: DEFAULT_NARRATIVES,
    answers: { influencers: 'yes' },
    thresholds: DEFAULT_THRESHOLDS,
    ...over,
  };
}

describe('5 критериев методики', () => {
  it('все пункты зелёные → можно входить', () => {
    const a = analyze(input());
    expect(a.criteria.map((c) => c.status)).toEqual(['good', 'good', 'good', 'good', 'good']);
    expect(a.verdict.level).toBe('go');
  });

  it('2 слабых пункта → пропустить', () => {
    const a = analyze(input({ answers: { influencers: 'no', hype: 'no' } }));
    expect(a.verdict.level).toBe('skip');
    expect(a.verdict.weak).toBe(2);
  });

  it('один слабый пункт → осторожно', () => {
    const a = analyze(input({ answers: { influencers: 'no' } }));
    expect(a.verdict.level).toBe('caution');
  });

  it('опасный контракт → не входить, даже если всё остальное хорошо', () => {
    const security: SecurityReport = {
      ...cleanSecurity,
      flags: [...cleanSecurity.flags, { group: 'permissions', severity: 'danger', text: 'mint', source: 'GoPlus' }],
    };
    const a = analyze(input({ security }));
    expect(a.critical).toBe(true);
    expect(a.verdict.level).toBe('danger');
  });

  it('капа выше $500k → цена не на раннем этапе', () => {
    const a = analyze(input({ market: { ...earlyMarket, mcap: 2_000_000 } }));
    expect(a.criteria.find((c) => c.id === 'price')?.status).toBe('weak');
  });

  it('ликвидность ниже $20k → слабый пункт', () => {
    const a = analyze(input({ market: { ...earlyMarket, liquidity: 9_000 } }));
    expect(a.criteria.find((c) => c.id === 'price')?.status).toBe('weak');
  });

  it('«зелёная палка» (+40% за 5 минут) → не догонять', () => {
    const a = analyze(input({ market: { ...earlyMarket, change: { m5: 40, h1: 60 } } }));
    expect(a.criteria.find((c) => c.id === 'price')?.status).toBe('weak');
  });

  it('нет Twitter → хайп и инфлюенсеры слабые', () => {
    const a = analyze(input({ hasTwitterLink: false, twitter: undefined, answers: {} }));
    expect(a.criteria.find((c) => c.id === 'hype')?.status).toBe('weak');
    expect(a.criteria.find((c) => c.id === 'influencers')?.status).toBe('weak');
    expect(a.verdict.level).toBe('skip');
  });

  it('ручной ответ перекрывает автооценку', () => {
    const a = analyze(input({ answers: { influencers: 'yes', price: 'no' } }));
    const price = a.criteria.find((c) => c.id === 'price');
    expect(price?.status).toBe('weak');
    expect(price?.auto).toBe(false);
  });

  it('без автопроверки контракта — «осталось проверить»', () => {
    const a = analyze(input({ security: { sources: [], errors: ['x'], flags: [] } }));
    expect(a.criteria.find((c) => c.id === 'contract')?.status).toBe('unknown');
    expect(a.verdict.level).toBe('caution');
  });
});

describe('активность (косвенный хайп)', () => {
  it('считает ускорение относительно среднего за 6ч', () => {
    expect(activityAcceleration({ ...earlyMarket, txH1: 600, txH6: 1200, ageHours: 10 })).toBeCloseTo(3);
  });
  it('для молодого пула делит на фактический возраст', () => {
    expect(activityAcceleration({ ...earlyMarket, txH1: 100, txH6: 200, ageHours: 2 })).toBeCloseTo(1);
  });
});

describe('нарративы', () => {
  it('находит животных и AI', () => {
    expect(matchNarratives({ name: 'Frog Coin', symbol: 'FROG' }, DEFAULT_NARRATIVES)[0].narrative.id).toBe('animals');
    expect(matchNarratives({ name: 'aixbt', symbol: 'AIXBT' }, DEFAULT_NARRATIVES)[0].narrative.id).toBe('ai');
  });
  it('не путает «ai» внутри слов', () => {
    expect(matchNarratives({ name: 'Rain Chain', symbol: 'RAIN' }, DEFAULT_NARRATIVES)).toHaveLength(0);
  });
});

describe('безопасность', () => {
  it('GoPlus EVM: mint + налог 25% + прокси', () => {
    const { flags } = evmFlags({
      is_mintable: '1',
      owner_address: '0x1234567890123456789012345678901234567890',
      buy_tax: '0.25',
      sell_tax: '0.25',
      is_proxy: '1',
      is_honeypot: '0',
    });
    const dangers = flags.filter((f) => f.severity === 'danger').map((f) => f.group);
    expect(dangers).toContain('permissions');
    expect(dangers).toContain('tax');
    expect(dangers).toContain('owner');
  });

  it('GoPlus EVM: считает долю залоченного LP', () => {
    const { lpLockedPct } = evmFlags({
      lp_holders: [
        { address: '0x000000000000000000000000000000000000dead', percent: '0.6', is_locked: 0 },
        { address: '0xabc', percent: '0.3', is_locked: 1 },
        { address: '0xdef', percent: '0.1', is_locked: 0 },
      ],
    });
    expect(lpLockedPct).toBeCloseTo(90);
  });

  it('RugCheck: игнорирует LP-риски на бондинг-кривой pump.fun', () => {
    const { flags } = rugCheckFlags({ risks: [{ name: 'Large Amount of LP Unlocked', level: 'danger' }], lpLockedPct: 0 }, true);
    expect(flags).toHaveLength(0);
  });

  it('RugCheck: «Low Liquidity» не путается с локом LP', () => {
    const { flags } = rugCheckFlags({ risks: [{ name: 'Low Liquidity', level: 'warn' }, { name: 'Large Amount of LP Unlocked', level: 'danger' }] }, false);
    expect(flags.map((f) => f.group)).toEqual(['other', 'liquidity']);
  });

  it('RugCheck: mint authority → permissions danger', () => {
    const { flags } = rugCheckFlags({ risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] }, false);
    expect(flags[0]).toMatchObject({ group: 'permissions', severity: 'danger' });
  });
});

describe('разбор ввода', () => {
  const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  it('адрес Solana', () => expect(parseUserInput(mint)).toEqual({ address: mint, chain: 'solana' }));
  it('ссылка pump.fun', () => expect(parseUserInput(`https://pump.fun/coin/${mint}`)?.address).toBe(mint));
  it('ссылка GMGN', () => expect(parseUserInput(`https://gmgn.ai/sol/token/${mint}`)).toMatchObject({ address: mint, chain: 'solana' }));
  it('ссылка Jupiter', () => expect(parseUserInput(`https://jup.ag/swap/SOL-${mint}`)?.address).toBe(mint));
  it('ссылка DexScreener base', () =>
    expect(parseUserInput('https://dexscreener.com/base/0x1234567890123456789012345678901234567890')).toMatchObject({
      chain: 'base',
    }));
  it('ссылка X', () => expect(parseUserInput('https://x.com/frogcoin')?.twitter).toBe('frogcoin'));
  it('тикер', () => expect(parseUserInput('$BONK')?.query).toBe('BONK'));
});

describe('соцсети из DexScreener', () => {
  it('достаёт хэндл и из нового, и из старого формата', () => {
    expect(twitterHandle('https://x.com/frogcoin')).toBe('frogcoin');
    expect(twitterHandle('https://twitter.com/@frogcoin?s=21')).toBe('frogcoin');
    expect(twitterHandle('https://x.com/i/communities/123')).toBeUndefined();
    const pair = {
      info: { socials: [{ type: 'twitter', url: 'https://x.com/i/communities/1' }, { platform: 'telegram', handle: 't.me/x' }] },
    } as unknown as DexPair;
    const s = extractSocials(pair);
    expect(s.twitter).toBeUndefined();
    expect(s.twitterUrl).toContain('communities');
    expect(s.telegram).toBe('t.me/x');
  });

  it('marketFromPair берёт marketCap, иначе fdv', () => {
    const m = marketFromPair({ fdv: 100, liquidity: { usd: 5 }, boosts: { active: 1 } } as unknown as DexPair);
    expect(m.mcap).toBe(100);
    expect(m.boosted).toBe(true);
  });
});
