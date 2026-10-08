// Ядро методики: 5 критериев из «Финального решения» и вердикт.
//   ✔️ Хайп в Twitter нарастает
//   ✔️ Его качают реальные инфлюенсеры
//   ✔️ Цена — на раннем этапе
//   ✔️ Контракт чист
//   ✔️ Нарратив — в струе
// «Если хотя бы 2 из 5 слабые — лучше пропустить.»
import type { DexPair } from './dexscreener';
import { CORE_GROUPS, groupStatus, type SecurityReport } from './security';
import { matchNarratives, type Narrative } from './narratives';
import { hypeFromSignals, influencersFromSignals, type TwitterSignals } from './twitterSignals';

export type CriterionId = 'hype' | 'influencers' | 'price' | 'contract' | 'narrative';
export type CriterionStatus = 'good' | 'weak' | 'unknown';
export type Answer = 'yes' | 'no';

export interface ManualAnswers {
  hype?: Answer;
  influencers?: Answer;
  price?: Answer;
  narrative?: Answer;
}

export interface Thresholds {
  /** Капа «желательно до» — верхняя граница */
  maxMcap: number;
  /** Капа, при которой вход считается отличным */
  idealMcap: number;
  /** Минимальная ликвидность пула */
  minLiquidity: number;
  /** Комфортная ликвидность пула */
  idealLiquidity: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  maxMcap: 500_000,
  idealMcap: 300_000,
  minLiquidity: 20_000,
  idealLiquidity: 30_000,
};

export interface Reason {
  ok: boolean | null; // null — нейтральная информация
  text: string;
}

export interface Criterion {
  id: CriterionId;
  title: string;
  status: CriterionStatus;
  /** true — статус посчитан автоматически (без ответа пользователя) */
  auto: boolean;
  reasons: Reason[];
}

export type VerdictLevel = 'go' | 'caution' | 'skip' | 'danger';

export interface Verdict {
  level: VerdictLevel;
  title: string;
  text: string;
  weak: number;
  unknown: number;
}

export interface Market {
  mcap?: number;
  liquidity?: number;
  change: { m5?: number; h1?: number; h6?: number; h24?: number };
  txH1?: number;
  txH6?: number;
  buysH1?: number;
  sellsH1?: number;
  volM5?: number;
  volH1?: number;
  ageHours?: number;
  boosted: boolean;
}

export function marketFromPair(pair: DexPair | undefined, now = Date.now()): Market {
  const tx = (k: 'm5' | 'h1' | 'h6' | 'h24') => {
    const t = pair?.txns?.[k];
    return t ? t.buys + t.sells : undefined;
  };
  return {
    mcap: pair?.marketCap ?? pair?.fdv,
    liquidity: pair?.liquidity?.usd,
    change: { ...(pair?.priceChange ?? {}) },
    txH1: tx('h1'),
    txH6: tx('h6'),
    buysH1: pair?.txns?.h1?.buys,
    sellsH1: pair?.txns?.h1?.sells,
    volM5: pair?.volume?.m5,
    volH1: pair?.volume?.h1,
    ageHours: pair?.pairCreatedAt ? Math.max(0, (now - pair.pairCreatedAt) / 3_600_000) : undefined,
    boosted: (pair?.boosts?.active ?? 0) > 0,
  };
}

/**
 * Во сколько раз активность за последний час выше средней за 6 часов.
 * Это косвенный признак «всплеска интереса» (шаг 1), который виден без платных API Twitter.
 */
export function activityAcceleration(m: Market): number | undefined {
  if (m.txH1 === undefined || m.txH6 === undefined) return undefined;
  // Если пулу меньше 6 часов, среднее считаем по фактическому возрасту
  const hours = m.ageHours !== undefined ? Math.min(6, Math.max(1, m.ageHours)) : 6;
  const avg = m.txH6 / hours;
  if (avg <= 0) return m.txH1 > 0 ? 3 : undefined;
  return m.txH1 / avg;
}

export const fmtUsd = (n?: number) => {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
};

const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;

// ---------------- Критерии ----------------

export interface AnalysisInput {
  market: Market;
  security?: SecurityReport;
  /** false — проверка безопасности ещё грузится */
  securityLoaded: boolean;
  twitter?: string;
  hasTwitterLink: boolean;
  token: { name?: string; symbol?: string; description?: string };
  narratives: Narrative[];
  answers: ManualAnswers;
  thresholds: Thresholds;
  /** Автоматическая Twitter-аналитика с сервера (если подключена) */
  signals?: TwitterSignals;
}

export function hypeCriterion(i: AnalysisInput): Criterion {
  const reasons: Reason[] = [];
  const accel = activityAcceleration(i.market);
  if (!i.hasTwitterLink) reasons.push({ ok: false, text: 'У токена не указан Twitter — для этой методики это минус' });
  if (accel !== undefined) {
    const ok = accel >= 1.5 ? true : accel < 0.7 ? false : null;
    reasons.push({ ok, text: `Активность в пуле за час: ×${accel.toFixed(1)} к среднему (${i.market.txH1 ?? 0} сделок/ч)` });
  }

  if (i.answers.hype) {
    reasons.unshift({
      ok: i.answers.hype === 'yes',
      text: i.answers.hype === 'yes' ? 'Вы подтвердили: упоминаний в Twitter резко больше' : 'Вы отметили: всплеска в Twitter нет',
    });
    return { id: 'hype', title: 'Хайп в Twitter нарастает', status: i.answers.hype === 'yes' ? 'good' : 'weak', auto: false, reasons };
  }

  // Есть данные из Twitter — решаем по ним, активность в пуле остаётся пояснением
  if (i.signals) {
    const v = hypeFromSignals(i.signals);
    return { id: 'hype', title: 'Хайп в Twitter нарастает', status: v.status, auto: true, reasons: [...v.reasons, ...reasons] };
  }

  let status: CriterionStatus = 'unknown';
  if (!i.hasTwitterLink) status = 'weak';
  else if (accel !== undefined && accel >= 1.5) status = 'good';
  else if (accel !== undefined && accel < 0.7) status = 'weak';
  return { id: 'hype', title: 'Хайп в Twitter нарастает', status, auto: true, reasons };
}

export function influencersCriterion(i: AnalysisInput): Criterion {
  const reasons: Reason[] = [];
  if (i.market.boosted) {
    reasons.push({ ok: false, text: 'Токен куплен в рекламу DexScreener (boost) — убедитесь, что хайп не только рекламный' });
  }
  if (i.answers.influencers) {
    reasons.unshift({
      ok: i.answers.influencers === 'yes',
      text:
        i.answers.influencers === 'yes'
          ? 'Вы подтвердили: о токене пишут smart-аккаунты / реальные KOL'
          : 'Вы отметили: раскачивают боты / рекламные пуши',
    });
    return {
      id: 'influencers',
      title: 'Его качают реальные инфлюенсеры',
      status: i.answers.influencers === 'yes' ? 'good' : 'weak',
      auto: false,
      reasons,
    };
  }
  if (i.signals) {
    const v = influencersFromSignals(i.signals);
    return { id: 'influencers', title: 'Его качают реальные инфлюенсеры', status: v.status, auto: true, reasons: [...v.reasons, ...reasons] };
  }
  if (!i.hasTwitterLink) {
    reasons.push({ ok: false, text: 'Нет Twitter — проверить, кто раскачивает, невозможно' });
    return { id: 'influencers', title: 'Его качают реальные инфлюенсеры', status: 'weak', auto: true, reasons };
  }
  reasons.push({ ok: null, text: 'Откройте Moni / TwitterScore и посмотрите Smart Followers и упоминания' });
  return { id: 'influencers', title: 'Его качают реальные инфлюенсеры', status: 'unknown', auto: true, reasons };
}

export function priceCriterion(i: AnalysisInput): Criterion {
  const { market: m, thresholds: t } = i;
  const reasons: Reason[] = [];
  let weak = false;
  let known = 0;

  if (m.mcap !== undefined) {
    known++;
    if (m.mcap > t.maxMcap) {
      weak = true;
      reasons.push({ ok: false, text: `Капа ${fmtUsd(m.mcap)} — выше ${fmtUsd(t.maxMcap)}, ранний этап пройден` });
    } else {
      reasons.push({
        ok: true,
        text: `Капа ${fmtUsd(m.mcap)} — ${m.mcap <= t.idealMcap ? 'отлично, ранний этап' : `в пределах ${fmtUsd(t.maxMcap)}`}`,
      });
    }
  } else {
    reasons.push({ ok: null, text: 'Капитализация неизвестна' });
  }

  if (m.liquidity !== undefined) {
    known++;
    if (m.liquidity < t.minLiquidity) {
      weak = true;
      reasons.push({ ok: false, text: `Ликвидность ${fmtUsd(m.liquidity)} — меньше ${fmtUsd(t.minLiquidity)}, выйти будет сложно` });
    } else {
      reasons.push({
        ok: true,
        text: `Ликвидность ${fmtUsd(m.liquidity)}${m.liquidity >= t.idealLiquidity ? '' : ' — на нижней границе'}`,
      });
    }
  } else if (i.security?.bondingCurve) {
    reasons.push({ ok: null, text: 'Токен ещё на бондинг-кривой pump.fun — пула нет, это самый ранний этап' });
  } else {
    reasons.push({ ok: null, text: 'Ликвидность неизвестна' });
  }

  const { m5, h1, h24 } = m.change;
  if ((m5 ?? 0) > 25 || (h1 ?? 0) > 80) {
    weak = true;
    reasons.push({
      ok: false,
      text: `Цена сейчас летит вверх (${m5 !== undefined ? `5м ${fmtPct(m5)}` : ''}${h1 !== undefined ? `, 1ч ${fmtPct(h1)}` : ''}) — не прыгай на «зелёную палку», дождись отката/боковика`,
    });
  } else if ((h24 ?? 0) > 500 && (m.liquidity ?? 0) < t.idealLiquidity) {
    weak = true;
    reasons.push({ ok: false, text: `Уже +${(h24 ?? 0).toFixed(0)}% за сутки при тонкой ликвидности — монета на хаях` });
  } else if ((h1 ?? 0) < -40) {
    weak = true;
    reasons.push({ ok: false, text: `Цена падает (${fmtPct(h1 ?? 0)} за час) — монету сливают` });
  } else if (h1 !== undefined) {
    const accel = activityAcceleration(m);
    const quiet = Math.abs(h1) <= 25;
    reasons.push({
      ok: true,
      text:
        quiet && accel !== undefined && accel >= 1.3
          ? `График «тихий, но пульсирует» (1ч ${fmtPct(h1)}, активность растёт) — лучшая зона входа`
          : `Без резкого пампа сейчас (1ч ${fmtPct(h1)}${h24 !== undefined ? `, 24ч ${fmtPct(h24)}` : ''})`,
    });
  }

  if (m.buysH1 !== undefined && m.sellsH1 !== undefined && m.sellsH1 > m.buysH1 * 1.5 && m.sellsH1 > 20) {
    reasons.push({ ok: false, text: `Продаж за час больше, чем покупок (${m.sellsH1} vs ${m.buysH1})` });
  }
  if (m.ageHours !== undefined) {
    reasons.push({ ok: null, text: `Пулу ${m.ageHours < 48 ? `${m.ageHours.toFixed(1)} ч` : `${(m.ageHours / 24).toFixed(0)} дн.`}` });
  }

  if (i.answers.price) {
    reasons.unshift({
      ok: i.answers.price === 'yes',
      text: i.answers.price === 'yes' ? 'Вы посмотрели график: ранний этап / 1–2 волна' : 'Вы посмотрели график: вход поздний',
    });
    return { id: 'price', title: 'Цена — на раннем этапе', status: i.answers.price === 'yes' ? 'good' : 'weak', auto: false, reasons };
  }

  const status: CriterionStatus = weak ? 'weak' : known === 0 && !i.security?.bondingCurve ? 'unknown' : 'good';
  return { id: 'price', title: 'Цена — на раннем этапе', status, auto: true, reasons };
}

export function contractCriterion(i: AnalysisInput): Criterion & { critical: boolean } {
  const reasons: Reason[] = [];
  const base = { id: 'contract' as const, title: 'Контракт чист', auto: true };
  if (!i.securityLoaded) {
    return { ...base, status: 'unknown', reasons: [{ ok: null, text: 'Проверяем контракт…' }], critical: false };
  }
  const r = i.security;
  if (!r || !r.sources.length) {
    return {
      ...base,
      status: 'unknown',
      reasons: [{ ok: null, text: 'Автопроверка недоступна — откройте RugCheck / TokenSniffer по ссылкам ниже' }],
      critical: false,
    };
  }
  let critical = false;
  let weak = false;
  for (const g of CORE_GROUPS) {
    const st = groupStatus(r, g);
    if (st === 'danger') critical = true;
  }
  if (groupStatus(r, 'holders') === 'danger' || groupStatus(r, 'other') === 'danger') weak = true;

  // Опасное — крестиком, «не проверено / обратите внимание» — нейтрально
  for (const f of r.flags) {
    if (f.severity === 'ok') continue;
    reasons.push({ ok: f.severity === 'danger' ? false : null, text: f.text });
  }
  if (!reasons.some((x) => x.ok === false)) reasons.unshift({ ok: true, text: `Опасных функций не найдено (${r.sources.join(' + ')})` });

  return { ...base, status: critical || weak ? 'weak' : 'good', reasons, critical };
}

export function narrativeCriterion(i: AnalysisInput): Criterion {
  // Ищем тему и в названии токена, и в том, что о нём пишут в Twitter
  const description = [i.token.description, i.signals?.hashtags.join(' '), i.signals?.textSample].filter(Boolean).join(' ');
  const matches = matchNarratives({ ...i.token, description }, i.narratives);
  const reasons: Reason[] = matches.map((m) => ({ ok: true, text: `Нарратив «${m.narrative.name}» (по слову «${m.keyword}»)` }));
  if (i.signals?.hashtags.length) reasons.push({ ok: null, text: `Хэштеги в твитах: ${i.signals.hashtags.map((h) => `#${h}`).join(' ')}` });
  if (i.answers.narrative) {
    reasons.unshift({
      ok: i.answers.narrative === 'yes',
      text: i.answers.narrative === 'yes' ? 'Вы подтвердили: нарратив сейчас в тренде' : 'Вы отметили: нарратив не в тренде',
    });
    return { id: 'narrative', title: 'Нарратив — в струе', status: i.answers.narrative === 'yes' ? 'good' : 'weak', auto: false, reasons };
  }
  if (!matches.length) {
    reasons.push({ ok: null, text: 'Совпадений со списком актуальных нарративов нет — проверьте Trending Tags' });
  }
  return { id: 'narrative', title: 'Нарратив — в струе', status: matches.length ? 'good' : 'unknown', auto: true, reasons };
}

export interface Analysis {
  criteria: Criterion[];
  verdict: Verdict;
  critical: boolean;
}

export function analyze(i: AnalysisInput): Analysis {
  const contract = contractCriterion(i);
  const criteria: Criterion[] = [hypeCriterion(i), influencersCriterion(i), priceCriterion(i), contract, narrativeCriterion(i)];
  return { criteria, verdict: verdictFor(criteria, contract.critical), critical: contract.critical };
}

export function verdictFor(criteria: Criterion[], critical: boolean): Verdict {
  const weak = criteria.filter((c) => c.status === 'weak');
  const unknown = criteria.filter((c) => c.status === 'unknown');
  const good = criteria.filter((c) => c.status === 'good');
  const names = (list: Criterion[]) => list.map((c) => `«${c.title}»`).join(', ');

  if (critical) {
    return {
      level: 'danger',
      title: 'Не входить — опасный контракт',
      text: 'В контракте найдены функции, которые методика требует исключать. Хайп этого не компенсирует.',
      weak: weak.length,
      unknown: unknown.length,
    };
  }
  if (weak.length >= 2) {
    return {
      level: 'skip',
      title: 'Пропустить',
      text: `Слабые пункты: ${names(weak)}. По правилу методики: если 2 из 5 слабые — лучше пропустить.`,
      weak: weak.length,
      unknown: unknown.length,
    };
  }
  if (good.length === criteria.length) {
    return {
      level: 'go',
      title: 'Можно входить',
      text: 'Все 5 пунктов в порядке. Заходи, пока график «тихий, но пульсирует», и фиксируй, когда начинают покупать другие.',
      weak: 0,
      unknown: 0,
    };
  }
  const parts: string[] = [];
  if (weak.length) parts.push(`Слабый пункт: ${names(weak)}.`);
  if (unknown.length) parts.push(`Осталось проверить: ${names(unknown)}.`);
  return {
    level: 'caution',
    title: weak.length ? 'Осторожно — один пункт слабый' : 'Проверка не завершена',
    text: `${parts.join(' ')} ${weak.length ? 'Если входить — только малой суммой.' : 'Ответьте на вопросы ниже.'}`.trim(),
    weak: weak.length,
    unknown: unknown.length,
  };
}
