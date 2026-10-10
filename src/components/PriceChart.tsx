// Свой свечной график: данные GeckoTerminal, отрисовка TradingView Lightweight Charts.
// Встроенный виджет DexScreener внутри других сайтов и Telegram часто зависает на «Loading pair»,
// поэтому рисуем сами — это надёжнее и работает одинаково в браузере и в Mini App.
import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { getCandles, type Candle, type Timeframe } from '../lib/gecko';
import type { ChainId } from '../lib/chains';
import { fmtPrice } from '../lib/format';

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '1m', label: '1м' },
  { id: '5m', label: '5м' },
  { id: '15m', label: '15м' },
  { id: '1h', label: '1ч' },
  { id: '4h', label: '4ч' },
  { id: '1d', label: '1д' },
];

const TF_KEY = 'gr.chartTf';
const REFRESH_MS = 60_000;
const UP = '#38e8a0';
const DOWN = '#ff5c7a';

type State = 'loading' | 'ready' | 'empty' | 'error';

interface Chart {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
}

function savedTf(): Timeframe {
  try {
    const v = localStorage.getItem(TF_KEY) as Timeframe | null;
    if (v && TIMEFRAMES.some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  return '5m';
}

/** Шаг цены под мелкие цены мемкоинов (0.00000123 и т. п.) */
export function minMoveFor(candles: Candle[]): number {
  const min = Math.min(...candles.map((c) => c.low).filter((v) => v > 0));
  if (!Number.isFinite(min)) return 0.00000001;
  return Math.pow(10, Math.floor(Math.log10(min)) - 3);
}

/** Подпись цены на оси: те же «0.0₆1234», что и в карточке токена */
export function axisPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0';
  return fmtPrice(p).replace('$', '');
}

export function PriceChart(props: { chain: ChainId; pool: string; token: string; dexUrl: string }) {
  const { chain, pool, token, dexUrl } = props;
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | undefined>(undefined);
  const [libReady, setLibReady] = useState(false);
  const [tf, setTf] = useState<Timeframe>(savedTf);
  const [state, setState] = useState<State>('loading');

  // Создаём график один раз (библиотека грузится отдельно — главный экран не тяжелее)
  useEffect(() => {
    let disposed = false;
    import('lightweight-charts')
      .then(({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
        if (disposed || !box.current) return;
        const chart = createChart(box.current, {
          autoSize: true,
          // Ссылка на TradingView (условие лицензии) — в подписи под графиком, чтобы логотип не закрывал свечи
          layout: { background: { type: ColorType.Solid, color: '#11151d' }, textColor: '#8b94a7', fontSize: 11, attributionLogo: false },
          grid: { vertLines: { color: '#1b2130' }, horzLines: { color: '#1b2130' } },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
          crosshair: { mode: 0 },
          // Вертикальный свайп и колесо листают страницу, а не график (важно в Telegram на телефоне).
          // Масштаб — щипком или перетаскиванием шкал
          handleScroll: { vertTouchDrag: false, mouseWheel: false },
          handleScale: { mouseWheel: false },
        });
        const candles = chart.addSeries(CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          borderVisible: false,
        });
        // Свечи сверху, объёмы — полоской снизу, без наложения подписей
        candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
        const volume = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        chartRef.current = { chart, candles, volume };
        setLibReady(true);
      })
      .catch(() => !disposed && setState('error'));
    return () => {
      disposed = true;
      chartRef.current?.chart.remove();
      chartRef.current = undefined;
    };
  }, []);

  // Данные: при смене пула/периода и раз в минуту
  useEffect(() => {
    if (!libReady) return;
    let cancelled = false;
    const load = async (first: boolean) => {
      try {
        const list = await getCandles(chain, pool, token, tf);
        const c = chartRef.current;
        if (cancelled || !c) return;
        if (!list.length) {
          setState('empty');
          return;
        }
        c.candles.applyOptions({
          priceFormat: { type: 'custom', minMove: minMoveFor(list), formatter: axisPrice },
        });
        c.candles.setData(list.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
        c.volume.setData(
          list.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? 'rgba(56,232,160,0.35)' : 'rgba(255,92,122,0.35)' })),
        );
        if (first) c.chart.timeScale().fitContent();
        setState('ready');
      } catch {
        // Ошибка при обновлении не стирает уже нарисованный график
        if (!cancelled) setState((s) => (s === 'ready' ? s : 'error'));
      }
    };
    // Новая монета или период — сначала убираем старые свечи, чтобы не показать чужой график
    chartRef.current?.candles.setData([]);
    chartRef.current?.volume.setData([]);
    setState('loading');
    void load(true);
    const t = setInterval(() => void load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [libReady, chain, pool, token, tf]);

  const pick = (id: Timeframe) => {
    setTf(id);
    try {
      localStorage.setItem(TF_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="chart-wrap">
      <div className="chart-bar">
        <div className="chips chips-tight">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} className={`chip ${tf === t.id ? 'chip-active' : ''}`} onClick={() => pick(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart">
        {/* Холст библиотеки и оверлей React — соседи, чтобы не мешать друг другу в DOM */}
        <div className="chart-canvas" ref={box} />
        {state !== 'ready' && (
          <div className="chart-state">
            {state === 'loading' && <span className="spinner" aria-hidden />}
            <span>
              {state === 'loading'
                ? 'Загружаем график…'
                : state === 'empty'
                  ? 'По этому периоду пока нет сделок — выберите другой интервал'
                  : 'График пока недоступен (монета совсем новая или сервис перегружен)'}
            </span>
            {state !== 'loading' && (
              <a className="btn btn-small btn-ghost" href={dexUrl} target="_blank" rel="noreferrer">
                Открыть график на DexScreener ↗
              </a>
            )}
          </div>
        )}
      </div>
      <div className="muted small chart-src">
        Свечи: GeckoTerminal · обновление раз в минуту · график{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </div>
    </div>
  );
}
