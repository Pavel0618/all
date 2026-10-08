// Шаг 3 методики: быстрая проверка безопасности контракта.
// EVM: GoPlus (аналог TokenSniffer). Solana: RugCheck + GoPlus.
// Всё приводим к одному виду: 4 группы из инструкции + honeypot и держатели.
import { getJson } from './http';
import { CHAINS, type ChainId } from './chains';
import { checkWithBlockscout } from './blockscout';

export type Severity = 'danger' | 'warn' | 'ok';

export type SecurityGroup = 'liquidity' | 'permissions' | 'tax' | 'owner' | 'honeypot' | 'holders' | 'other';

export const GROUP_LABELS: Record<SecurityGroup, string> = {
  liquidity: 'Ликвидность залочена / сожжена',
  permissions: 'Нет mint / pause / blacklist / whitelist',
  tax: 'Нормальная комиссия на вход/выход',
  owner: 'Владелец не прокси и не скрыт',
  honeypot: 'Можно продать (не honeypot)',
  holders: 'Нет перекоса у держателей',
  other: 'Прочие риски',
};

/** Группы, которые прямо перечислены в инструкции как «что исключаем». */
export const CORE_GROUPS: SecurityGroup[] = ['liquidity', 'permissions', 'tax', 'owner', 'honeypot'];

export interface SecurityFlag {
  group: SecurityGroup;
  severity: Severity;
  text: string;
  source: 'GoPlus' | 'RugCheck' | 'DexScreener' | 'Blockscout';
}

export interface SecurityReport {
  flags: SecurityFlag[];
  sources: string[];
  errors: string[];
  lpLockedPct?: number;
  rugcheckScore?: number;
  /** Ликвидность в бондинг-кривой pump.fun — вытащить её нельзя */
  bondingCurve?: boolean;
}

export type GroupStatus = Severity | 'unknown';

export function groupStatus(report: SecurityReport, group: SecurityGroup): GroupStatus {
  const flags = report.flags.filter((f) => f.group === group);
  if (!flags.length) return 'unknown';
  if (flags.some((f) => f.severity === 'danger')) return 'danger';
  if (flags.some((f) => f.severity === 'warn')) return 'warn';
  return 'ok';
}

// ---------------- GoPlus ----------------

type Flag01 = '0' | '1' | '' | undefined;

interface GoPlusEvm {
  is_open_source?: Flag01;
  is_proxy?: Flag01;
  is_mintable?: Flag01;
  owner_address?: string;
  can_take_back_ownership?: Flag01;
  owner_change_balance?: Flag01;
  hidden_owner?: Flag01;
  selfdestruct?: Flag01;
  external_call?: Flag01;
  buy_tax?: string;
  sell_tax?: string;
  cannot_buy?: Flag01;
  cannot_sell_all?: Flag01;
  slippage_modifiable?: Flag01;
  is_honeypot?: Flag01;
  transfer_pausable?: Flag01;
  is_blacklisted?: Flag01;
  is_whitelisted?: Flag01;
  trading_cooldown?: Flag01;
  is_in_dex?: Flag01;
  creator_percent?: string;
  owner_percent?: string;
  lp_holders?: { address?: string; tag?: string; is_locked?: number | string; percent?: string }[];
  holders?: { address?: string; tag?: string; is_locked?: number | string; percent?: string; is_contract?: number }[];
}

interface GoPlusSolanaAuthority {
  authority?: { address?: string }[];
  status?: Flag01;
}

interface GoPlusSolana {
  mintable?: GoPlusSolanaAuthority;
  freezable?: GoPlusSolanaAuthority;
  closable?: GoPlusSolanaAuthority;
  balance_mutable_authority?: GoPlusSolanaAuthority;
  default_account_state_upgradable?: GoPlusSolanaAuthority;
  metadata_mutable?: GoPlusSolanaAuthority;
  non_transferable?: Flag01;
  transfer_hook?: unknown[];
  transfer_fee?: { current_fee_rate?: { fee_rate?: string | number } } | Record<string, never>;
  holders?: { account?: string; percent?: string; is_locked?: number | string; tag?: string }[];
}

interface GoPlusResponse<T> {
  code: number;
  message?: string;
  result?: Record<string, T>;
}

const DEAD = ['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000'];

export async function fetchGoPlusEvm(chain: ChainId, address: string): Promise<GoPlusEvm | undefined> {
  const id = CHAINS[chain].goplusId;
  if (!id) return undefined;
  const data = await getJson<GoPlusResponse<GoPlusEvm>>(
    `https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${address}`,
    { ttlMs: 60_000 },
  );
  const res = data.result ?? {};
  return res[address.toLowerCase()] ?? Object.values(res)[0];
}

export async function fetchGoPlusSolana(mint: string): Promise<GoPlusSolana | undefined> {
  const data = await getJson<GoPlusResponse<GoPlusSolana>>(
    `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`,
    { ttlMs: 60_000 },
  );
  const res = data.result ?? {};
  return res[mint] ?? Object.values(res)[0];
}

const pct = (v?: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};

export function evmFlags(g: GoPlusEvm): { flags: SecurityFlag[]; lpLockedPct?: number } {
  const flags: SecurityFlag[] = [];
  const add = (group: SecurityGroup, severity: Severity, text: string) =>
    flags.push({ group, severity, text, source: 'GoPlus' });

  const renounced = !g.owner_address || DEAD.includes(g.owner_address.toLowerCase());

  // Ликвидность
  let lpLockedPct: number | undefined;
  if (g.lp_holders?.length) {
    lpLockedPct = 0;
    for (const h of g.lp_holders) {
      const locked = String(h.is_locked) === '1' || DEAD.includes((h.address ?? '').toLowerCase());
      if (locked) lpLockedPct += (pct(h.percent) ?? 0) * 100;
    }
    lpLockedPct = Math.min(100, lpLockedPct);
    if (lpLockedPct >= 90) add('liquidity', 'ok', `LP залочено/сожжено: ${lpLockedPct.toFixed(0)}%`);
    else if (lpLockedPct >= 50) add('liquidity', 'warn', `Залочено только ${lpLockedPct.toFixed(0)}% LP`);
    else add('liquidity', 'danger', `Ликвидность НЕ залочена (${lpLockedPct.toFixed(0)}% LP)`);
  }

  // Права контракта
  if (g.is_mintable === '1') add('permissions', renounced ? 'warn' : 'danger', 'Есть функция mint (допечатка токенов)');
  if (g.transfer_pausable === '1') add('permissions', 'danger', 'Владелец может поставить переводы на паузу');
  if (g.is_blacklisted === '1') add('permissions', 'danger', 'Есть blacklist — кошелёк могут заблокировать');
  if (g.is_whitelisted === '1') add('permissions', 'danger', 'Есть whitelist — продавать могут не все');
  if (g.trading_cooldown === '1') add('permissions', 'warn', 'Есть задержка между сделками (cooldown)');
  if (g.is_mintable === '0' && g.transfer_pausable !== '1' && g.is_blacklisted !== '1' && g.is_whitelisted !== '1') {
    add('permissions', 'ok', 'mint / pause / blacklist / whitelist не найдены');
  }

  // Комиссии
  const buy = pct(g.buy_tax);
  const sell = pct(g.sell_tax);
  if (buy !== undefined || sell !== undefined) {
    const max = Math.max(buy ?? 0, sell ?? 0) * 100;
    const text = `Налог: покупка ${((buy ?? 0) * 100).toFixed(1)}%, продажа ${((sell ?? 0) * 100).toFixed(1)}%`;
    add('tax', max > 10 ? 'danger' : max > 5 ? 'warn' : 'ok', text);
  }
  if (g.slippage_modifiable === '1') add('tax', 'danger', 'Владелец может менять налог');

  // Владелец
  if (g.is_proxy === '1') add('owner', 'danger', 'Контракт — прокси (логику можно подменить)');
  if (g.hidden_owner === '1') add('owner', 'danger', 'Скрытый владелец');
  if (g.can_take_back_ownership === '1') add('owner', 'danger', 'Владение можно вернуть после отказа');
  if (g.owner_change_balance === '1') add('owner', 'danger', 'Владелец может менять балансы');
  if (g.is_open_source === '0') add('owner', 'danger', 'Код контракта не открыт');
  if (g.selfdestruct === '1') add('owner', 'danger', 'Есть selfdestruct');
  if (!flags.some((f) => f.group === 'owner')) {
    add('owner', 'ok', renounced ? 'Владелец отказался от прав (renounced)' : 'Явных проблем с владельцем нет');
  }

  // Honeypot
  if (g.is_honeypot === '1') add('honeypot', 'danger', 'HONEYPOT — продать нельзя');
  else if (g.cannot_sell_all === '1') add('honeypot', 'danger', 'Нельзя продать весь баланс');
  else if (g.cannot_buy === '1') add('honeypot', 'warn', 'Покупка ограничена');
  else if (g.is_honeypot === '0') add('honeypot', 'ok', 'Продажа возможна');

  // Держатели
  const creator = Math.max(pct(g.creator_percent) ?? 0, pct(g.owner_percent) ?? 0) * 100;
  if (creator > 10) add('holders', 'danger', `У создателя/владельца ${creator.toFixed(1)}% supply`);
  else if (creator > 5) add('holders', 'warn', `У создателя/владельца ${creator.toFixed(1)}% supply`);

  return { flags, lpLockedPct };
}

export function solanaGoPlusFlags(g: GoPlusSolana): SecurityFlag[] {
  const flags: SecurityFlag[] = [];
  const add = (group: SecurityGroup, severity: Severity, text: string) =>
    flags.push({ group, severity, text, source: 'GoPlus' });

  if (g.mintable?.status === '1') add('permissions', 'danger', 'Mint authority не отозван — можно допечатать');
  if (g.freezable?.status === '1') add('permissions', 'danger', 'Freeze authority не отозван — кошелёк могут заморозить');
  if (g.balance_mutable_authority?.status === '1') add('owner', 'danger', 'Кто-то может менять балансы');
  if (g.closable?.status === '1') add('owner', 'warn', 'Токен-аккаунты можно закрыть');
  if (g.default_account_state_upgradable?.status === '1') add('permissions', 'warn', 'Состояние аккаунтов по умолчанию можно изменить');
  if (g.non_transferable === '1') add('honeypot', 'danger', 'Токен нельзя переводить');
  if (Array.isArray(g.transfer_hook) && g.transfer_hook.length) add('honeypot', 'danger', 'Есть transfer hook (может блокировать продажу)');
  const feeRaw = (g.transfer_fee as { current_fee_rate?: { fee_rate?: string | number } } | undefined)?.current_fee_rate?.fee_rate;
  const feeBps = pct(feeRaw);
  if (feeBps !== undefined && feeBps > 0) {
    const p = feeBps / 100;
    add('tax', p > 10 ? 'danger' : p > 5 ? 'warn' : 'ok', `Комиссия за перевод ${p.toFixed(1)}%`);
  }
  if (g.mintable?.status === '0' && g.freezable?.status === '0') {
    add('permissions', 'ok', 'Mint и Freeze authority отозваны');
  }
  return flags;
}

// ---------------- RugCheck (Solana) ----------------

interface RugRisk {
  name: string;
  value?: string;
  description?: string;
  score?: number;
  level?: 'danger' | 'warn' | 'info' | string;
}

interface RugSummary {
  score?: number;
  score_normalised?: number;
  risks?: RugRisk[];
  lpLockedPct?: number;
}

export async function fetchRugCheck(mint: string): Promise<RugSummary> {
  return getJson<RugSummary>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { ttlMs: 60_000 });
}

function rugGroup(name: string): SecurityGroup {
  const n = name.toLowerCase();
  if (n.includes('mint') || n.includes('freeze') || n.includes('permanent delegate')) return 'permissions';
  // Только про лок/сжигание LP; «Low Liquidity» — про объём пула, это шаг 4
  if (/\blp\b/.test(n) || n.includes('unlocked')) return 'liquidity';
  if (n.includes('fee') || n.includes('tax')) return 'tax';
  if (n.includes('holder') || n.includes('insider') || n.includes('creator') || n.includes('ownership')) return 'holders';
  if (n.includes('honeypot') || n.includes('transfer') || n.includes('sell')) return 'honeypot';
  return 'other';
}

export function rugCheckFlags(r: RugSummary, bondingCurve: boolean): { flags: SecurityFlag[]; lpLockedPct?: number } {
  const flags: SecurityFlag[] = [];
  for (const risk of r.risks ?? []) {
    const group = rugGroup(risk.name);
    // На бондинг-кривой pump.fun пула ещё нет — предупреждения про LP неактуальны
    if (bondingCurve && group === 'liquidity') continue;
    const severity: Severity = risk.level === 'danger' ? 'danger' : 'warn';
    const text = risk.value ? `${risk.name} (${risk.value})` : risk.name;
    flags.push({ group, severity, text, source: 'RugCheck' });
  }
  const lp = typeof r.lpLockedPct === 'number' ? r.lpLockedPct : undefined;
  if (!bondingCurve && lp !== undefined && !flags.some((f) => f.group === 'liquidity')) {
    flags.push({
      group: 'liquidity',
      severity: lp >= 90 ? 'ok' : lp >= 50 ? 'warn' : 'danger',
      text: `LP залочено/сожжено: ${lp.toFixed(0)}%`,
      source: 'RugCheck',
    });
  }
  return { flags, lpLockedPct: lp };
}

// ---------------- Сборка отчёта ----------------

export async function checkSecurity(chain: ChainId, address: string, dexId?: string): Promise<SecurityReport> {
  const report: SecurityReport = { flags: [], sources: [], errors: [] };
  const bondingCurve = chain === 'solana' && (dexId ?? '').toLowerCase() === 'pumpfun';
  report.bondingCurve = bondingCurve;

  if (CHAINS[chain].kind === 'evm') {
    let goplusOk = false;
    try {
      const g = await fetchGoPlusEvm(chain, address);
      // Для незнакомых GoPlus токенов/сетей приходит пустой объект — это не «чисто», а «нет данных»
      if (g && (g.is_open_source === '0' || g.is_open_source === '1' || g.buy_tax !== undefined)) {
        const { flags, lpLockedPct } = evmFlags(g);
        report.flags.push(...flags);
        report.lpLockedPct = lpLockedPct;
        report.sources.push('GoPlus');
        goplusOk = true;
      } else {
        report.errors.push('GoPlus: нет данных по токену');
      }
    } catch (e) {
      report.errors.push(`GoPlus: ${(e as Error).message}`);
    }
    // Нет данных в GoPlus (свежий токен или сеть вроде Robinhood) — проверяем контракт сами
    if (!goplusOk && CHAINS[chain].blockscoutApi) {
      try {
        const bs = await checkWithBlockscout(chain, address);
        if (bs) {
          report.flags.push(...bs.flags);
          report.sources.push('Blockscout');
        } else {
          report.errors.push('Blockscout: контракт не найден');
        }
      } catch (e) {
        report.errors.push(`Blockscout: ${(e as Error).message}`);
      }
    }
  } else {
    const [rug, gp] = await Promise.allSettled([fetchRugCheck(address), fetchGoPlusSolana(address)]);
    if (rug.status === 'fulfilled') {
      const { flags, lpLockedPct } = rugCheckFlags(rug.value, bondingCurve);
      report.flags.push(...flags);
      report.lpLockedPct = lpLockedPct;
      report.rugcheckScore = rug.value.score_normalised ?? rug.value.score;
      report.sources.push('RugCheck');
    } else {
      report.errors.push(`RugCheck: ${(rug.reason as Error).message}`);
    }
    if (gp.status === 'fulfilled' && gp.value) {
      report.flags.push(...solanaGoPlusFlags(gp.value));
      report.sources.push('GoPlus');
    } else if (gp.status === 'rejected') {
      report.errors.push(`GoPlus: ${(gp.reason as Error).message}`);
    }
  }

  if (bondingCurve) {
    report.flags.push({
      group: 'liquidity',
      severity: 'ok',
      text: 'Токен на бондинг-кривой pump.fun — ликвидность нельзя вытащить',
      source: 'DexScreener',
    });
  }

  // Если полноценный источник (GoPlus / RugCheck) ответил, но ничего плохого по группе не нашёл — группа чистая.
  // Своя проверка по Blockscout сама отмечает, что проверила, а что нет.
  const full = report.sources.find((src) => src === 'GoPlus' || src === 'RugCheck') as 'GoPlus' | 'RugCheck' | undefined;
  if (full) {
    for (const group of ['permissions', 'tax', 'owner', 'honeypot'] as SecurityGroup[]) {
      if (!report.flags.some((f) => f.group === group)) {
        report.flags.push({ group, severity: 'ok', text: 'Проблем не найдено', source: full });
      }
    }
  }

  return report;
}
