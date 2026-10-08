export { fmtUsd } from './analysis';

export function fmtPct(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : 1;
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** Цена с поддержкой очень маленьких значений: 0.0000001234 → 0.0₆1234 */
export function fmtPrice(n?: number | string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  if (v >= 0.001) return `$${v.toFixed(5)}`;
  const s = v.toFixed(20);
  const m = s.match(/^0\.(0+)(\d{4})/);
  if (!m) return `$${v.toExponential(2)}`;
  const zeros = m[1].length;
  const sub = String(zeros)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    .join('');
  return `$0.0${sub}${m[2]}`;
}

export function fmtAmount(n?: number, maxDigits = 4): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { maximumSignificantDigits: maxDigits });
}

export function shortAddr(a?: string): string {
  if (!a) return '';
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн. назад`;
}

/** Перевод десятичной строки в целое число минимальных единиц (без потерь точности). */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const clean = amount.replace(',', '.').trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return 0n;
  const [int, frac = ''] = clean.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

export function fromBaseUnits(raw: bigint | string, decimals: number): number {
  const v = typeof raw === 'string' ? BigInt(raw) : raw;
  const base = 10n ** BigInt(decimals);
  return Number(v / base) + Number(v % base) / Number(base);
}
