import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateCandles, geckoTuning, getCandles } from '../src/lib/gecko';
import { axisPrice, minMoveFor } from '../src/components/PriceChart';
import { barsLabel, fmtDuration, fmtMeasurePct, indexToTime, measure, timeToIndex } from '../src/components/chartRuler';

const TOKEN = 'FrogAi1111111111111111111111111111111111111';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const status = (code: number) => Promise.resolve(new Response('{"errors":[]}', { status: code }));
const ohlcv = (rows: number[][]) => ok({ data: { attributes: { ohlcv_list: rows } } });

// В тестах без пауз: лимит запросов и задержки повторов — минимальные
beforeEach(() => Object.assign(geckoTuning, { burst: 1_000, refillMs: 1, retryDelays: [1, 1] }));
afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string) => Promise<Response>) {
  const fn = vi.fn((url: string) => handler(url));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('свечи GeckoTerminal', () => {
  it('сортирует по времени, убирает дубли и битые строки', async () => {
    const fn = stubFetch(() =>
      ohlcv([
        [300, 3, 4, 2, 3.5, 10],
        [200, 2, 3, 1, 3, 20],
        [300, 3, 4, 2, 3.5, 10],
        [100, 1, 2, 0.5, 2, 0],
        [400, NaN, 1, 1, 1, 1],
      ]),
    );
    const list = await getCandles('solana', 'poolA', TOKEN, '5m');
    expect(list.map((c) => c.time)).toEqual([100, 200, 300]);
    expect(list[1]).toEqual({ time: 200, open: 2, high: 3, low: 1, close: 3, volume: 20 });
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v2/networks/solana/pools/poolA/ohlcv/minute');
    expect(url.searchParams.get('aggregate')).toBe('5');
    expect(url.searchParams.get('token')).toBe(TOKEN);
  });

  it('периоды переводятся в запрос API', async () => {
    const fn = stubFetch(() => ohlcv([]));
    await getCandles('base', 'poolTf', TOKEN, '4h');
    await getCandles('base', 'poolTf', TOKEN, '1d');
    const urls = fn.mock.calls.map((c) => c[0]);
    expect(urls[0]).toContain('/ohlcv/hour?aggregate=4&');
    expect(urls[1]).toContain('/ohlcv/day?aggregate=1&');
  });

  it('пул из DexScreener неизвестен → берёт главный пул токена', async () => {
    stubFetch((url) => {
      if (url.includes('/pools/pairX/ohlcv/')) return status(404);
      if (url.includes(`/tokens/${TOKEN}/pools`)) return ok({ data: [{ attributes: { address: 'geckoPool' } }] });
      if (url.includes('/pools/geckoPool/ohlcv/')) return ohlcv([[100, 1, 1, 1, 1, 1]]);
      return status(500);
    });
    expect(await getCandles('solana', 'pairX', TOKEN, '15m')).toHaveLength(1);
  });

  it('API не принял token → повтор без него', async () => {
    const fn = stubFetch((url) => (url.includes('token=') ? status(422) : ohlcv([[100, 1, 1, 1, 1, 1]])));
    expect(await getCandles('solana', 'poolT', TOKEN, '1m')).toHaveLength(1);
    expect(fn.mock.calls.at(-1)?.[0]).not.toContain('token=');
  });

  it('неизвестный id сети → ищет сеть по названию', async () => {
    stubFetch((url) => {
      if (url.includes('/networks/robinhood/')) return status(404);
      if (url.includes('/networks?page=1')) return ok({ data: [{ id: 'rh-chain', attributes: { name: 'Robinhood Chain' } }] });
      if (url.includes('/networks/rh-chain/pools/0xpool/ohlcv/')) return ohlcv([[100, 1, 1, 1, 1, 1]]);
      return status(404);
    });
    expect(await getCandles('robinhood', '0xpool', '0xtoken', '1h')).toHaveLength(1);
  });

  it('пула нет нигде → ошибка (приложение покажет ссылку на DexScreener)', async () => {
    stubFetch((url) => {
      if (url.includes('/networks?page=1')) return ok({ data: [{ id: 'solana', attributes: { name: 'Solana' } }] });
      if (url.includes('/tokens/')) return ok({ data: [] });
      return status(404);
    });
    await expect(getCandles('solana', 'nopool', TOKEN, '5m')).rejects.toThrow();
  });
});

describe('сервис графиков перегружен', () => {
  const row = (t: number, c = 1) => [t, c, c, c, c, 1];

  it('429 — повторяет запрос и получает свечи', async () => {
    let n = 0;
    const fn = stubFetch(() => (++n < 3 ? status(429) : ohlcv([row(100)])));
    expect(await getCandles('solana', 'poolBusy', TOKEN, '5m')).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('обрыв без CORS (так браузер видит 429) — тоже повторяет', async () => {
    let n = 0;
    stubFetch(() => (++n < 2 ? Promise.reject(new TypeError('Failed to fetch')) : ohlcv([row(100)])));
    expect(await getCandles('solana', 'poolCors', TOKEN, '5m')).toHaveLength(1);
  });

  it('404 не повторяет — это не перегрузка', async () => {
    const fn = stubFetch((url) => (url.includes('/networks?page=1') ? ok({ data: [{ id: 'solana' }] }) : url.includes('/tokens/') ? ok({ data: [] }) : status(404)));
    // свой адрес токена — чтобы не взять из кэша ответы прошлых тестов
    await expect(getCandles('solana', 'poolGone', 'GoneToken111', '5m')).rejects.toThrow();
    expect(fn.mock.calls.filter((c) => String(c[0]).includes('/ohlcv/'))).toHaveLength(1);
  });

  it('1ч недоступен → собирает из уже загруженных 15м', async () => {
    const base = 1_700_000_000 - (1_700_000_000 % 3600);
    stubFetch((url) => {
      if (url.includes('/ohlcv/minute')) return ohlcv([row(base, 1), row(base + 900, 3), row(base + 1800, 2), row(base + 3600, 5)]);
      return status(429);
    });
    expect(await getCandles('solana', 'poolAgg', TOKEN, '15m')).toHaveLength(4);
    const hour = await getCandles('solana', 'poolAgg', TOKEN, '1h');
    expect(hour.map((c) => [c.time, c.open, c.high, c.close, c.volume])).toEqual([
      [base, 1, 3, 2, 3],
      [base + 3600, 5, 5, 5, 1],
    ]);
  });

  it('тот же период недоступен → показывает последние загруженные свечи', async () => {
    let fail = false;
    stubFetch(() => (fail ? status(503) : ohlcv([row(100), row(160)])));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(await getCandles('base', 'poolStale', TOKEN, '1m')).toHaveLength(2);
      fail = true;
      vi.setSystemTime(Date.now() + 120_000); // кэш HTTP устарел — идёт настоящий запрос, и он падает
      expect(await getCandles('base', 'poolStale', TOKEN, '1m')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('запасных свечей нет → честная ошибка', async () => {
    stubFetch(() => status(429));
    await expect(getCandles('solana', 'poolNoCache', TOKEN, '4h')).rejects.toThrow();
  });

  it('лимит запросов: после запаса — не чаще заданного интервала', async () => {
    Object.assign(geckoTuning, { burst: 2, refillMs: 40 });
    stubFetch(() => ohlcv([row(100)]));
    // израсходовать накопленный запас
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((p) => getCandles('arbitrum', `warm${p}`, TOKEN, '5m')));
    const t0 = Date.now();
    await Promise.all(['k', 'l', 'm', 'n'].map((p) => getCandles('arbitrum', `lim${p}`, TOKEN, '5m')));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('склейка свечей по границам UTC', () => {
    const list = [row(0, 1), row(60, 2), row(120, 0.5), row(300, 4)].map(([time, o, h, l, c, v]) => ({ time, open: o, high: h, low: l, close: c, volume: v }));
    expect(aggregateCandles(list, 300)).toEqual([
      { time: 0, open: 1, high: 2, low: 0.5, close: 0.5, volume: 3 },
      { time: 300, open: 4, high: 4, low: 4, close: 4, volume: 1 },
    ]);
  });
});

describe('линейка', () => {
  const list = [0, 300, 600, 1200].map((time, i) => ({ time, open: 1, high: 1, low: 1, close: 1 + i, volume: 1 }));

  it('номер свечи ↔ время, включая пропуски и область за краями', () => {
    expect(indexToTime(list, 2, 300)).toBe(600);
    expect(indexToTime(list, 5, 300)).toBe(1800);
    expect(indexToTime(list, -1, 300)).toBe(-300);
    expect(timeToIndex(list, 1200, 300)).toBe(3);
    expect(timeToIndex(list, 900, 300)).toBe(2.5);
    expect(timeToIndex(list, 1800, 300)).toBe(5);
  });

  it('считает % роста, свечи и время', () => {
    const m = measure({ time: 0, price: 0.0002 }, { time: 1200, price: 0.00025 }, list, 300);
    expect(m.pct).toBeCloseTo(25, 6);
    expect(m.bars).toBe(3);
    expect(m.seconds).toBe(1200);
    expect(m.up).toBe(true);
    expect(measure({ time: 1200, price: 2 }, { time: 0, price: 1 }, list, 300)).toMatchObject({ pct: -50, up: false, bars: 3 });
  });

  it('подписи', () => {
    expect(fmtMeasurePct(23.456)).toBe('+23.46%');
    expect(fmtMeasurePct(-12.5)).toBe('−12.50%');
    expect(fmtMeasurePct(250)).toBe('+250.00% (×3.5)');
    expect(fmtMeasurePct(1900)).toBe('+1,900% (×20)');
    expect(fmtDuration(45 * 60)).toBe('45 мин');
    expect(fmtDuration(3 * 3600 + 15 * 60)).toBe('3 ч 15 мин');
    expect(fmtDuration(2 * 86400 + 4 * 3600)).toBe('2 д 4 ч');
    expect(barsLabel(1)).toBe('1 свеча');
    expect(barsLabel(3)).toBe('3 свечи');
    expect(barsLabel(12)).toBe('12 свечей');
    expect(barsLabel(22)).toBe('22 свечи');
  });
});

describe('ось цены', () => {
  it('шаг цены подстраивается под мелкие цены', () => {
    const c = (low: number) => ({ time: 1, open: low, high: low, low, close: low, volume: 0 });
    expect(minMoveFor([c(0.000021), c(0.00003)])).toBeCloseTo(1e-8, 15);
    expect(minMoveFor([c(2.5)])).toBeCloseTo(0.001, 10);
    expect(minMoveFor([])).toBe(1e-8);
  });

  it('подписи как в карточке токена', () => {
    expect(axisPrice(0.0000001234)).toBe('0.0₆1234');
    expect(axisPrice(0.0021)).toBe('0.00210');
    expect(axisPrice(0)).toBe('0');
  });
});
