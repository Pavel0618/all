// Свой свечной график: данные GeckoTerminal, отрисовка TradingView Lightweight Charts.
// Встроенный виджет DexScreener внутри других сайтов и Telegram часто зависает на «Loading pair»,
// поэтому рисуем сами — это надёжнее и работает одинаково в браузере и в Mini App.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { getCandles, isTransient, tfSeconds, type Candle, type Timeframe } from '../lib/gecko';
import type { ChainId } from '../lib/chains';
import { fmtPrice } from '../lib/format';
import { RulerPrimitive, type RulerPoint } from './chartRuler';

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
const RETRY_MS = 12_000;
const UP = '#38e8a0';
const DOWN = '#ff5c7a';

/** busy — сервис временно перегружен (повторим сами), error — графика для монеты нет */
type State = 'loading' | 'ready' | 'empty' | 'busy' | 'error';
/** Линейка: off — выключена, armed — ждём первую точку, dragging — ведём, placing — ждём вторую точку */
type RulerPhase = 'off' | 'armed' | 'dragging' | 'placing';

interface Chart {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  ruler: RulerPrimitive;
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
  const dataRef = useRef<Candle[]>([]);
  const [libReady, setLibReady] = useState(false);
  const [tf, setTf] = useState<Timeframe>(savedTf);
  const tfRef = useRef(tf);
  tfRef.current = tf;
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);

  // Линейка: фаза в ref (события мыши частые), в state — только то, что видно на экране
  const phase = useRef<RulerPhase>('off');
  const pts = useRef<{ a?: RulerPoint; b?: RulerPoint; downX: number; downY: number }>({ downX: 0, downY: 0 });
  const finishedAt = useRef(0);
  const live = useRef<HTMLDivElement>(null);
  const [rulerUi, setRulerUi] = useState<RulerPhase>('off');
  const [hasMeasure, setHasMeasure] = useState(false);

  const setPhase = useCallback((p: RulerPhase) => {
    phase.current = p;
    setRulerUi(p);
  }, []);

  const clearRuler = useCallback(() => {
    pts.current = { downX: 0, downY: 0 };
    chartRef.current?.ruler.set();
    if (live.current) live.current.textContent = '';
    setHasMeasure(false);
    setPhase('off');
  }, [setPhase]);

  const finishRuler = () => {
    finishedAt.current = Date.now();
    if (live.current) live.current.textContent = chartRef.current?.ruler.describe() ?? '';
    setPhase('off');
  };

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
        const ruler = new RulerPrimitive({ candles: () => dataRef.current, step: () => tfSeconds(tfRef.current) });
        candles.attachPrimitive(ruler);
        // Обычный клик по графику убирает измерение — как в TradingView
        chart.subscribeClick(() => {
          if (phase.current === 'off' && pts.current.a && Date.now() - finishedAt.current > 400) clearRuler();
        });
        chartRef.current = { chart, candles, volume, ruler };
        setLibReady(true);
      })
      .catch(() => !disposed && setState('error'));
    return () => {
      disposed = true;
      chartRef.current?.chart.remove();
      chartRef.current = undefined;
    };
  }, [clearRuler]);

  // Другая монета — старое измерение не нужно
  useEffect(() => clearRuler(), [chain, pool, token, clearRuler]);

  // Esc — отмена линейки
  useEffect(() => {
    if (rulerUi === 'off' && !hasMeasure) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearRuler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rulerUi, hasMeasure, clearRuler]);

  // Данные: при смене пула/периода, раз в минуту и повтор, если сервис был занят
  useEffect(() => {
    if (!libReady) return;
    let cancelled = false;
    let fitted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(retry);
      try {
        const list = await getCandles(chain, pool, token, tf);
        const c = chartRef.current;
        if (cancelled || !c) return;
        if (!list.length) {
          setState((s) => (s === 'ready' ? s : 'empty'));
          return;
        }
        dataRef.current = list;
        c.candles.applyOptions({ priceFormat: { type: 'custom', minMove: minMoveFor(list), formatter: axisPrice } });
        c.candles.setData(list.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
        c.volume.setData(
          list.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? 'rgba(56,232,160,0.35)' : 'rgba(255,92,122,0.35)' })),
        );
        if (!fitted) {
          c.chart.timeScale().fitContent();
          fitted = true;
        }
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        // Ошибка при обновлении не стирает уже нарисованный график
        const transient = isTransient(e);
        setState((s) => (s === 'ready' ? s : transient ? 'busy' : 'error'));
        if (transient) retry = setTimeout(() => void load(), RETRY_MS);
      }
    };
    // Новая монета или период — сначала убираем старые свечи, чтобы не показать чужой график
    dataRef.current = [];
    chartRef.current?.candles.setData([]);
    chartRef.current?.volume.setData([]);
    setState('loading');
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearTimeout(retry);
    };
  }, [libReady, chain, pool, token, tf, attempt]);

  const pick = (id: Timeframe) => {
    setTf(id);
    try {
      localStorage.setItem(TF_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const toggleRuler = () => {
    if (phase.current !== 'off') return clearRuler();
    clearRuler();
    setPhase('armed');
  };

  // ---- Линейка: нажать и вести или нажать две точки; на компьютере ещё Shift + клик ----
  const pointAt = (e: ReactPointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    return chartRef.current?.ruler.pointAt(e.clientX - r.left, e.clientY - r.top) ?? null;
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const shift = e.shiftKey && e.pointerType === 'mouse';
    if (state !== 'ready' || (phase.current === 'off' && !shift)) return;
    const pt = pointAt(e);
    if (!pt) return;
    // Не даём графику начать прокрутку под линейкой
    e.preventDefault();
    e.stopPropagation();
    const ruler = chartRef.current?.ruler;
    if (phase.current === 'placing') {
      pts.current.b = pt;
      ruler?.set(pts.current.a, pt);
      finishRuler();
      return;
    }
    pts.current = { a: pt, b: pt, downX: e.clientX, downY: e.clientY };
    ruler?.set(pt, pt);
    setHasMeasure(true);
    setPhase('dragging');
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase.current !== 'dragging' && phase.current !== 'placing') return;
    const pt = pointAt(e);
    if (!pt) return;
    e.stopPropagation();
    pts.current.b = pt;
    chartRef.current?.ruler.set(pts.current.a, pt);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase.current !== 'dragging') return;
    e.stopPropagation();
    const moved = Math.hypot(e.clientX - pts.current.downX, e.clientY - pts.current.downY);
    if (moved > 6) {
      finishRuler();
    } else {
      // Это был клик — ждём вторую точку
      setPhase('placing');
    }
  };

  const rulerOn = rulerUi !== 'off';

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
        <button
          className={`chip chip-tool ${rulerOn ? 'chip-active' : ''}`}
          onClick={toggleRuler}
          disabled={state !== 'ready'}
          aria-pressed={rulerOn}
          title="Линейка: измерить рост в % (на компьютере — Shift + клик)"
        >
          📏 Линейка
        </button>
      </div>
      <div className="chart" onPointerDownCapture={onDown} onPointerMoveCapture={onMove} onPointerUpCapture={onUp}>
        {/* Холст библиотеки и оверлей React — соседи, чтобы не мешать друг другу в DOM */}
        <div className="chart-canvas" ref={box} />
        {rulerOn && (
          <div className="chart-ruler-layer">
            {rulerUi !== 'dragging' && (
              <div className="chart-ruler-hint">{rulerUi === 'placing' ? 'Теперь отметьте конечную точку' : 'Отметьте начало: нажмите или ведите от точки'}</div>
            )}
          </div>
        )}
        {state !== 'ready' && (
          <div className="chart-state">
            {(state === 'loading' || state === 'busy') && <span className="spinner" aria-hidden />}
            <span>
              {state === 'loading'
                ? 'Загружаем график…'
                : state === 'busy'
                  ? 'Сервис графиков сейчас перегружен — пробуем ещё раз…'
                  : state === 'empty'
                    ? 'По этому периоду пока нет сделок — выберите другой интервал'
                    : 'Для этой монеты пока нет графика (она совсем новая или ещё не попала в базу)'}
            </span>
            {state === 'busy' && (
              <button className="btn btn-small btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
                Повторить сейчас
              </button>
            )}
            {state !== 'loading' && (
              <a className="btn btn-small btn-ghost" href={dexUrl} target="_blank" rel="noreferrer">
                Открыть график на DexScreener ↗
              </a>
            )}
          </div>
        )}
      </div>
      <div className="sr-only chart-measure" aria-live="polite" ref={live} />
      <div className="muted small chart-src">
        Свечи: GeckoTerminal · обновление раз в минуту · график{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </div>
    </div>
  );
}
