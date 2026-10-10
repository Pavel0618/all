import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCandles } from '../src/lib/gecko';
import { axisPrice, minMoveFor } from '../src/components/PriceChart';

const TOKEN = 'FrogAi1111111111111111111111111111111111111';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const status = (code: number) => Promise.resolve(new Response('{"errors":[]}', { status: code }));
const ohlcv = (rows: number[][]) => ok({ data: { attributes: { ohlcv_list: rows } } });

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
