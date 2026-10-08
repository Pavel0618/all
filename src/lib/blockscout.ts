// Своя проверка контракта по данным открытого обозревателя Blockscout — для сетей и свежих токенов,
// которых ещё нет в GoPlus (например, Robinhood Chain). Проверяем ровно то, что инструкция велит исключать:
// закрытый код, прокси, mint / pause / blacklist / whitelist, возможность менять налог, владельца,
// а также концентрацию у держателей.
import { getJson, postJson } from './http';
import { CHAINS, type ChainId } from './chains';
import type { SecurityFlag, SecurityGroup, Severity } from './security';

interface AbiItem {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: unknown[];
}

export interface BlockscoutContract {
  is_verified?: boolean;
  is_fully_verified?: boolean;
  name?: string;
  abi?: AbiItem[] | null;
  proxy_type?: string | null;
  implementations?: { address?: string; address_hash?: string; name?: string | null }[] | null;
}

export interface BlockscoutHolder {
  address?: { hash?: string; is_contract?: boolean };
  value?: string;
}

const DEAD = ['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead'];

/** Группы «опасных» функций по имени (только изменяющие состояние). */
const RULES: { group: SecurityGroup; re: RegExp; text: string }[] = [
  { group: 'permissions', re: /^_?mint|mint$/i, text: 'Есть функция mint (допечатка токенов)' },
  { group: 'permissions', re: /pause/i, text: 'Можно поставить переводы на паузу' },
  { group: 'permissions', re: /blacklist|blocklist|isbot|setbots?$|addbots?$|antibot/i, text: 'Есть blacklist / блокировка кошельков' },
  { group: 'permissions', re: /whitelist|allowlist/i, text: 'Есть whitelist — продавать могут не все' },
  // setFee, setBuyTax, updateFees… но не setFeeReceiver / setFeeWallet
  { group: 'tax', re: /^(set|update|change)\w*(fee|fees|tax|taxes)$/i, text: 'Владелец может менять налог' },
  { group: 'other', re: /^set\w*max\w*(tx|wallet|sell|transaction)|^set\w*limits?$/i, text: 'Владелец может ограничивать размер сделок' },
];

export function abiFlags(abi: AbiItem[], renounced: boolean): SecurityFlag[] {
  const flags: SecurityFlag[] = [];
  const seen = new Set<string>();
  const writers = abi.filter(
    (i) => i.type === 'function' && i.name && i.stateMutability !== 'view' && i.stateMutability !== 'pure',
  );
  for (const fn of writers) {
    for (const rule of RULES) {
      if (!rule.re.test(fn.name!) || seen.has(rule.text)) continue;
      // Функции стандарта ERC-20 (approve, transfer…) правила не задевают; owner-права без владельца не страшны
      const severity: Severity = renounced || rule.group === 'other' ? 'warn' : 'danger';
      flags.push({ group: rule.group, severity, text: `${rule.text} (${fn.name})`, source: 'Blockscout' });
      seen.add(rule.text);
    }
  }
  return flags;
}

/** Доля крупнейших держателей среди обычных кошельков (без контрактов: пулов, локеров) и «сожжённых» адресов. */
export function holdersConcentration(holders: BlockscoutHolder[], totalSupply: bigint): number | undefined {
  if (totalSupply <= 0n) return undefined;
  let top = 0n;
  let counted = 0;
  for (const h of holders) {
    const addr = (h.address?.hash ?? '').toLowerCase();
    if (!addr || h.address?.is_contract || DEAD.includes(addr)) continue;
    top += BigInt(h.value ?? '0');
    if (++counted >= 10) break;
  }
  return Number((top * 10_000n) / totalSupply) / 100;
}

async function ownerOf(chain: ChainId, token: string): Promise<string | undefined> {
  const rpc = CHAINS[chain].rpc;
  if (!rpc) return undefined;
  const res = await postJson<{ result?: string; error?: unknown }>(rpc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: token, data: '0x8da5cb5b' }, 'latest'], // owner()
  });
  if (!res.result || res.result === '0x' || res.result.length < 66) return undefined;
  return `0x${res.result.slice(-40)}`.toLowerCase();
}

export interface BlockscoutReport {
  flags: SecurityFlag[];
}

export async function checkWithBlockscout(chain: ChainId, token: string): Promise<BlockscoutReport | undefined> {
  const api = CHAINS[chain].blockscoutApi;
  if (!api) return undefined;
  const add = (flags: SecurityFlag[], group: SecurityGroup, severity: Severity, text: string) =>
    flags.push({ group, severity, text, source: 'Blockscout' });

  const [contract, owner, tokenInfo, holders] = await Promise.all([
    getJson<BlockscoutContract>(`${api}/smart-contracts/${token}`, { ttlMs: 300_000 }).catch(() => undefined),
    ownerOf(chain, token).catch(() => undefined),
    getJson<{ total_supply?: string }>(`${api}/tokens/${token}`, { ttlMs: 300_000 }).catch(() => undefined),
    getJson<{ items?: BlockscoutHolder[] }>(`${api}/tokens/${token}/holders`, { ttlMs: 300_000 }).catch(() => undefined),
  ]);
  if (!contract && !tokenInfo) return undefined;

  const flags: SecurityFlag[] = [];
  const renounced = owner === undefined ? false : DEAD.includes(owner);
  const verified = Boolean(contract?.is_verified || contract?.is_fully_verified);

  // Владелец и прокси
  if (!verified) add(flags, 'owner', 'danger', 'Код контракта не открыт (не верифицирован)');
  if (contract?.proxy_type && contract.proxy_type !== 'unknown') add(flags, 'owner', 'danger', `Контракт — прокси (${contract.proxy_type}), логику можно подменить`);
  else if (contract?.implementations?.length) add(flags, 'owner', 'danger', 'Контракт — прокси, логику можно подменить');
  if (owner && renounced) add(flags, 'owner', 'ok', 'Владелец отказался от прав (renounced)');

  // Опасные функции
  if (verified && contract?.abi?.length) {
    const fnFlags = abiFlags(contract.abi, renounced);
    flags.push(...fnFlags);
    if (!fnFlags.some((f) => f.group === 'permissions')) add(flags, 'permissions', 'ok', 'mint / pause / blacklist / whitelist не найдены');
    if (!fnFlags.some((f) => f.group === 'tax')) add(flags, 'tax', 'ok', 'Менять налог нельзя');
  }

  // Держатели
  if (tokenInfo?.total_supply && holders?.items?.length) {
    const share = holdersConcentration(holders.items, BigInt(tokenInfo.total_supply));
    if (share !== undefined) {
      if (share > 50) add(flags, 'holders', 'danger', `Топ-10 кошельков держат ${share.toFixed(0)}% supply`);
      else if (share > 30) add(flags, 'holders', 'warn', `Топ-10 кошельков держат ${share.toFixed(0)}% supply`);
      else add(flags, 'holders', 'ok', `Топ-10 кошельков: ${share.toFixed(0)}% supply`);
    }
  }

  // Лок ликвидности и honeypot по открытым данным надёжно не проверить — честно об этом говорим
  add(flags, 'liquidity', 'warn', 'Лок ликвидности автоматически не проверен — посмотрите пул в обозревателе');
  add(flags, 'honeypot', 'warn', 'Возможность продажи не проверена — начните с минимальной суммы и попробуйте продать');
  return { flags };
}
