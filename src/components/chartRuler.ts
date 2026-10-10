// Линейка как в TradingView: прямоугольник от точки A до точки B и подпись «+23.45% · 12 свечей · 3 ч».
// Точки хранятся в «время свечи + цена», поэтому измерение остаётся на месте при прокрутке, масштабе и обновлении данных.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Candle } from '../lib/gecko';
import { fmtPrice } from '../lib/format';

export interface RulerPoint {
  /** время свечи (unix, сек); за краями данных — продолжение с шагом периода */
  time: number;
  price: number;
}

export interface Measurement {
  pct: number;
  delta: number;
  bars: number;
  seconds: number;
  up: boolean;
}

/** Время свечи по её номеру; за краями данных — продолжение с шагом периода. */
export function indexToTime(list: Candle[], i: number, step: number): number {
  const n = list.length;
  if (!n) return i * step;
  if (i < 0) return list[0].time + i * step;
  if (i > n - 1) return list[n - 1].time + (i - (n - 1)) * step;
  return list[i].time;
}

/** Номер свечи (может быть дробным или за краями данных) по времени. */
export function timeToIndex(list: Candle[], t: number, step: number): number {
  const n = list.length;
  if (!n) return t / step;
  if (t <= list[0].time) return (t - list[0].time) / step;
  if (t >= list[n - 1].time) return n - 1 + (t - list[n - 1].time) / step;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time <= t) lo = mid;
    else hi = mid;
  }
  if (list[lo].time === t) return lo;
  // Между свечами (после обновления данных) — пропорционально
  return lo + (t - list[lo].time) / (list[hi].time - list[lo].time);
}

export function measure(a: RulerPoint, b: RulerPoint, list: Candle[], step: number): Measurement {
  const delta = b.price - a.price;
  return {
    pct: a.price > 0 ? (delta / a.price) * 100 : 0,
    delta,
    bars: Math.round(Math.abs(timeToIndex(list, b.time, step) - timeToIndex(list, a.time, step))),
    seconds: Math.abs(b.time - a.time),
    up: delta >= 0,
  };
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} д ${h % 24} ч` : `${d} д`;
}

export function fmtMeasurePct(pct: number): string {
  const abs = Math.abs(pct);
  const s = `${pct >= 0 ? '+' : '−'}${abs >= 1000 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2)}%`;
  // Иксы — привычнее для мемкоинов
  return pct >= 100 ? `${s} (×${(1 + pct / 100).toFixed(pct >= 900 ? 0 : 1)})` : s;
}

export function barsLabel(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'свеча' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'свечи' : 'свечей';
  return `${n} ${word}`;
}

const UP = { fill: 'rgba(56, 232, 160, 0.16)', line: '#38e8a0', box: '#1f6f50' };
const DOWN = { fill: 'rgba(255, 92, 122, 0.16)', line: '#ff5c7a', box: '#7a2a3a' };

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

interface Geometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lines: string[];
  up: boolean;
}

/** Рисует измерение на графике (плагин Lightweight Charts). */
export class RulerPrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private requestUpdate?: () => void;
  private a?: RulerPoint;
  private b?: RulerPoint;
  private geo: Geometry | null = null;
  private readonly view: IPrimitivePaneView;

  constructor(private readonly source: { candles: () => Candle[]; step: () => number }) {
    this.view = {
      zOrder: () => 'top',
      renderer: () => ({ draw: (t: Target) => this.draw(t) }),
    };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  set(a?: RulerPoint, b?: RulerPoint): void {
    this.a = a;
    this.b = b;
    this.requestUpdate?.();
  }

  /** Текст измерения — для экранного диктора (и автотеста). */
  describe(): string {
    if (!this.a || !this.b) return '';
    const list = this.source.candles();
    if (!list.length) return '';
    const m = measure(this.a, this.b, list, this.source.step());
    return `${fmtMeasurePct(m.pct)} · ${barsLabel(m.bars)} · ${fmtDuration(m.seconds)}`;
  }

  /** Точка графика под курсором (x, y — в пикселях от левого верхнего угла графика). */
  pointAt(x: number, y: number): RulerPoint | null {
    if (!this.chart || !this.series) return null;
    const ts = this.chart.timeScale();
    const pane = this.chart.paneSize();
    const cx = Math.max(0, Math.min(x, ts.width() - 1));
    const cy = Math.max(0, Math.min(y, pane.height - 1));
    const logical = ts.coordinateToLogical(cx);
    const price = this.series.coordinateToPrice(cy);
    if (logical === null || price === null || !(price > 0)) return null;
    return { time: indexToTime(this.source.candles(), Math.round(logical), this.source.step()), price };
  }

  updateAllViews(): void {
    this.geo = null;
    const { chart, series, a, b } = this;
    if (!chart || !series || !a || !b) return;
    const list = this.source.candles();
    if (!list.length) return; // свечи ещё грузятся
    const step = this.source.step();
    const ts = chart.timeScale();
    const x1 = ts.logicalToCoordinate(timeToIndex(list, a.time, step) as Logical);
    const x2 = ts.logicalToCoordinate(timeToIndex(list, b.time, step) as Logical);
    const y1 = series.priceToCoordinate(a.price);
    const y2 = series.priceToCoordinate(b.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    const m = measure(a, b, list, step);
    const priceFmt = (p: number) => fmtPrice(p).replace('$', '');
    this.geo = {
      x1,
      y1,
      x2,
      y2,
      up: m.up,
      lines: [fmtMeasurePct(m.pct), `${priceFmt(a.price)} → ${priceFmt(b.price)}`, `${barsLabel(m.bars)} · ${fmtDuration(m.seconds)}`],
    };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private draw(target: Target): void {
    const g = this.geo;
    if (!g) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const c = g.up ? UP : DOWN;
      const left = Math.min(g.x1, g.x2);
      const right = Math.max(g.x1, g.x2);
      const top = Math.min(g.y1, g.y2);
      const bottom = Math.max(g.y1, g.y2);
      ctx.save();
      ctx.fillStyle = c.fill;
      ctx.fillRect(left, top, right - left, bottom - top);

      // Стрелки: по вертикали — изменение цены, по горизонтали — время
      ctx.strokeStyle = c.line;
      ctx.fillStyle = c.line;
      ctx.lineWidth = 1.5;
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      arrow(ctx, midX, g.y1, midX, g.y2);
      arrow(ctx, g.x1, midY, g.x2, midY);

      // Подпись
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const lh = 16;
      const pad = 7;
      const w = Math.max(...g.lines.map((l) => ctx.measureText(l).width)) + pad * 2;
      const h = g.lines.length * lh + pad * 2 - 4;
      let bx = midX - w / 2;
      let by = g.up ? top - h - 6 : bottom + 6;
      if (by < 2) by = g.up ? bottom + 6 : 2;
      if (by + h > mediaSize.height - 2) by = Math.max(2, top - h - 6);
      bx = Math.max(2, Math.min(bx, mediaSize.width - w - 2));
      ctx.fillStyle = c.box;
      roundRect(ctx, bx, by, w, h, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      g.lines.forEach((l, i) => {
        ctx.font = `${i === 0 ? '700 13px' : '500 12px'} -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillText(l, bx + w / 2, by + pad - 1 + i * lh);
      });
      ctx.restore();
    });
  }
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.min(7, len / 2);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
