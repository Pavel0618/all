// Покупка и продажа прямо со страницы токена. Ключи остаются в кошельке пользователя:
// приложение только собирает транзакцию через агрегатор и отдаёт её кошельку на подпись.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, type ParsedAccountData } from '@solana/web3.js';
import type { Address } from 'viem';
import { CHAINS, toolLinks, type ChainId } from '../lib/chains';
import { jupQuote, jupSwapTransaction, priceImpactPercent, priorityCapLamports, routeLabel, SOL_MINT, waitForSignature, type JupQuote } from '../lib/jupiter';
import { assertSafeJupiterTx, UnsafeTxError } from '../lib/txGuard';
import { evmBuild, evmQuote, type EvmQuote, type SwapSide } from '../lib/evmSwap';
import { evmFeeFor, feeConfigured, feePercentLabel, solanaFeeFor, type SolanaFee } from '../lib/fees';
import { useSolSigner } from '../wallet/solSigner';
import { addTrade, settingsStore, useStore } from '../lib/storage';
import { connectModal, toast } from '../lib/ui';
import { fmtAmount, fmtUsd, fromBaseUnits, toBaseUnits } from '../lib/format';
import type { VerdictLevel } from '../lib/analysis';
import { useEvm } from '../wallet/evm';

export interface TradeToken {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image?: string;
  priceUsd?: number;
  priceNative?: number;
}

type Mode = 'buy' | 'sell';

const SLIPPAGES = [100, 300, 500, 1000, 2000];
const SELL_PCTS = [25, 50, 100];

function humanError(e: unknown): string {
  if (e instanceof UnsafeTxError) return e.message;
  const msg = (e as Error)?.message ?? String(e);
  if (/reject|denied|cancel|declined/i.test(msg)) return 'Операция отменена в кошельке';
  if (/insufficient|not enough|0x1\b/i.test(msg)) return 'Недостаточно средств на кошельке (с учётом комиссии сети)';
  if (/0x1771|slippage/i.test(msg)) return 'Цена ушла дальше допустимого проскальзывания — увеличьте slippage или попробуйте ещё раз';
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}

export function TradePanel({ token, verdict }: { token: TradeToken; verdict: VerdictLevel }) {
  const [mode, setMode] = useState<Mode>('buy');
  const [riskOk, setRiskOk] = useState(false);
  const risky = verdict === 'skip' || verdict === 'danger';
  const isSolana = CHAINS[token.chain].kind === 'solana';
  const feeOn = feeConfigured();

  return (
    <section className="card trade" id="trade">
      <div className="seg seg-wide">
        <button className={mode === 'buy' ? 'seg-active seg-buy' : ''} onClick={() => setMode('buy')}>
          Купить
        </button>
        <button className={mode === 'sell' ? 'seg-active seg-sell' : ''} onClick={() => setMode('sell')}>
          Продать
        </button>
      </div>

      {mode === 'buy' && risky && (
        <label className={`risk-gate ${verdict === 'danger' ? 'risk-danger' : ''}`}>
          <input type="checkbox" checked={riskOk} onChange={(e) => setRiskOk(e.target.checked)} />
          <span>
            {verdict === 'danger'
              ? 'Контракт опасен. Я понимаю, что могу потерять всё, и всё равно хочу купить.'
              : 'Методика советует пропустить эту монету. Я понимаю риск и покупаю на свою ответственность.'}
          </span>
        </label>
      )}

      {isSolana ? (
        <SolanaTrade token={token} mode={mode} blocked={mode === 'buy' && risky && !riskOk} />
      ) : (
        <EvmTrade token={token} mode={mode} blocked={mode === 'buy' && risky && !riskOk} />
      )}

      <div className="tp-hint small">
        💡 <b>Фиксация:</b> «фикси тогда, когда другие начинают покупать». Простое правило: на ×2 продайте 50% — вернёте вложенное, остальное
        пусть летит. Монета ушла в боковик на хаях с пустым стаканом — выходите.
      </div>
      {(isSolana ? feeOn.solana : feeOn.evm) && (
        <div className="muted small center">Комиссия сервиса {feePercentLabel()} уже учтена в сумме «Вы получите».</div>
      )}
      <div className="muted small center">
        Не работает встроенный обмен?{' '}
        <a href={toolLinks.externalSwap(token.chain, token.address)} target="_blank" rel="noreferrer">
          Открыть {isSolana ? 'Jupiter' : token.chain === 'bsc' ? 'PancakeSwap' : 'Uniswap'} ↗
        </a>
      </div>
    </section>
  );
}

// ---------------- Общие элементы ----------------

function SlippagePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <div className="field-label">
        Проскальзывание (slippage)
        <span className="muted small"> — для мемкоинов 3–10%</span>
      </div>
      <div className="chips">
        {SLIPPAGES.map((s) => (
          <button key={s} className={`chip ${value === s ? 'chip-active' : ''}`} onClick={() => onChange(s)}>
            {s / 100}%
          </button>
        ))}
      </div>
    </div>
  );
}

function AmountInput(props: { value: string; onChange: (v: string) => void; symbol: string; presets: number[]; balance?: number }) {
  return (
    <div className="field">
      <div className="field-label row-between">
        <span>Сумма покупки</span>
        {props.balance !== undefined && (
          <span className="muted small">
            Баланс: {fmtAmount(props.balance)} {props.symbol}
          </span>
        )}
      </div>
      <div className="amount">
        <input inputMode="decimal" value={props.value} onChange={(e) => props.onChange(e.target.value.replace(',', '.'))} aria-label="Сумма" />
        <span className="amount-sym">{props.symbol}</span>
      </div>
      <div className="chips">
        {props.presets.map((p) => (
          <button key={p} className={`chip ${props.value === String(p) ? 'chip-active' : ''}`} onClick={() => props.onChange(String(p))}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function SellPicker(props: { pct: number; onChange: (p: number) => void; balance?: number; symbol: string }) {
  return (
    <div className="field">
      <div className="field-label row-between">
        <span>Сколько продать</span>
        <span className="muted small">
          У вас: {props.balance === undefined ? '—' : `${fmtAmount(props.balance)} ${props.symbol}`}
        </span>
      </div>
      <div className="chips">
        {SELL_PCTS.map((p) => (
          <button key={p} className={`chip ${props.pct === p ? 'chip-active' : ''}`} onClick={() => props.onChange(p)}>
            {p === 100 ? 'Всё' : `${p}%`}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuoteBox({ children, error, loading }: { children?: ReactNode; error?: string; loading?: boolean }) {
  if (error) return <div className="quote quote-error">{error}</div>;
  if (loading) return <div className="quote muted">Считаем лучшую цену…</div>;
  if (!children) return null;
  return <div className="quote">{children}</div>;
}

function ActionButton(props: { mode: Mode; busy?: string; disabled?: boolean; onClick: () => void; connected: boolean; label: string }) {
  if (!props.connected) {
    return (
      <button className="btn btn-primary btn-block btn-big" onClick={() => connectModal.set(true)}>
        Подключить кошелёк
      </button>
    );
  }
  return (
    <button
      className={`btn btn-block btn-big ${props.mode === 'buy' ? 'btn-buy' : 'btn-sell'}`}
      disabled={props.disabled || Boolean(props.busy)}
      onClick={props.onClick}
    >
      {props.busy ?? props.label}
    </button>
  );
}

// ---------------- Solana (Jupiter) ----------------

function SolanaTrade({ token, mode, blocked }: { token: TradeToken; mode: Mode; blocked: boolean }) {
  const { connection } = useConnection();
  const signer = useSolSigner();
  const [settings, setSettings] = useStore(settingsStore);
  const [amount, setAmount] = useState(String(settings.defaultBuy.solana ?? 0.1));
  const [fee, setFee] = useState<SolanaFee>();
  // Пока не знаем, берётся ли комиссия, котировку не запрашиваем — иначе она мигнёт и перезапросится
  const [feeChecked, setFeeChecked] = useState(false);
  const [sellPct, setSellPct] = useState(100);
  const [slippage, setSlippage] = useState(settings.slippageBps);
  const [quote, setQuote] = useState<JupQuote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  const [quoting, setQuoting] = useState(false);
  const [decimals, setDecimals] = useState<number>();
  const [solBal, setSolBal] = useState<number>();
  const [tokBal, setTokBal] = useState<{ raw: bigint; decimals: number }>();
  const [busy, setBusy] = useState<string>();
  const mint = token.address;
  const owner = signer.publicKey;

  // Комиссия сервиса (если владелец указал адрес и счёт для комиссий готов)
  useEffect(() => {
    let cancelled = false;
    solanaFeeFor(connection)
      .then((f) => !cancelled && setFee(f))
      .finally(() => !cancelled && setFeeChecked(true));
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      return;
    }
    connection
      .getParsedAccountInfo(key)
      .then((info) => {
        const d = (info.value?.data as ParsedAccountData | undefined)?.parsed?.info?.decimals;
        if (typeof d === 'number') setDecimals(d);
      })
      .catch(() => undefined);
  }, [connection, mint]);

  const loadBalances = useCallback(async () => {
    if (!owner) {
      setSolBal(undefined);
      setTokBal(undefined);
      return;
    }
    try {
      const [lamports, accs] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }),
      ]);
      setSolBal(lamports / LAMPORTS_PER_SOL);
      let raw = 0n;
      let dec = decimals ?? 6;
      for (const a of accs.value) {
        const info = (a.account.data as ParsedAccountData).parsed.info.tokenAmount;
        raw += BigInt(info.amount);
        dec = info.decimals;
      }
      setTokBal({ raw, decimals: dec });
    } catch {
      /* RPC недоступен — покажем без баланса */
    }
  }, [connection, owner, mint, decimals]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  // bigint сравнивается по значению: обновление баланса при покупке не вызывает лишний перезапрос котировки
  const rawIn = useMemo(
    () => (mode === 'buy' ? toBaseUnits(amount, 9) : tokBal ? (tokBal.raw * BigInt(sellPct)) / 100n : 0n),
    [mode, amount, tokBal, sellPct],
  );

  const getQuote = useCallback(
    (raw: bigint, f: SolanaFee | undefined) =>
      jupQuote({
        inputMint: mode === 'buy' ? SOL_MINT : mint,
        outputMint: mode === 'buy' ? mint : SOL_MINT,
        amount: raw.toString(),
        slippageBps: slippage,
        platformFeeBps: f?.bps,
      }),
    [mode, mint, slippage],
  );

  // Предварительная котировка
  useEffect(() => {
    setQuote(undefined);
    setQuoteErr(undefined);
    const raw = rawIn;
    if (raw <= 0n || !feeChecked) return;
    setQuoting(true);
    let cancelled = false;
    const t = setTimeout(() => {
      getQuote(raw, fee)
        .then((q) => !cancelled && setQuote(q))
        .catch((e: Error) => !cancelled && setQuoteErr(`Нет маршрута: ${e.message}`))
        .finally(() => !cancelled && setQuoting(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [rawIn, getQuote, fee, feeChecked]);

  const execute = async () => {
    if (!owner) {
      connectModal.set(true);
      return;
    }
    const raw = rawIn;
    if (raw <= 0n) return;
    try {
      // Одна и та же комиссия должна быть и в котировке, и в транзакции
      let f = fee;
      setBusy('Получаем лучшую цену…');
      let q = await getQuote(raw, f);
      setBusy('Собираем транзакцию…');
      let built: Awaited<ReturnType<typeof jupSwapTransaction>>;
      try {
        built = await jupSwapTransaction(q, owner.toBase58(), settings.priority, f?.account);
      } catch (e) {
        if (!f) throw e;
        // Сделка пользователя важнее комиссии: если Jupiter не принял счёт комиссии — без неё
        console.warn('Jupiter отклонил комиссию, сделка без неё:', (e as Error).message);
        f = undefined;
        q = await getQuote(raw, undefined);
        built = await jupSwapTransaction(q, owner.toBase58(), settings.priority);
      }
      const { tx, lastValidBlockHeight } = built;
      // Подписываем только обмен Jupiter без лишних переводов — даже если ответ API подменили
      assertSafeJupiterTx(tx, owner, priorityCapLamports(settings.priority));
      setBusy(signer.kind === 'builtin' ? 'Отправляем…' : 'Подтвердите в кошельке…');
      const sig = await signer.send(tx, connection);
      setBusy('Ждём подтверждения сети…');
      await waitForSignature(connection, sig, lastValidBlockHeight);

      const dec = decimals ?? tokBal?.decimals ?? 6;
      const sol = fromBaseUnits(mode === 'buy' ? q.inAmount : q.outAmount, 9);
      const tokens = fromBaseUnits(mode === 'buy' ? q.outAmount : q.inAmount, dec);
      addTrade({
        side: mode,
        chain: 'solana',
        address: mint,
        symbol: token.symbol,
        name: token.name,
        image: token.image,
        nativeAmount: sol,
        nativeSymbol: 'SOL',
        tokenAmount: tokens,
        priceUsd: token.priceUsd,
        tx: sig,
      });
      if (mode === 'buy') setSettings((s) => ({ ...s, defaultBuy: { ...s.defaultBuy, solana: parseFloat(amount) } }));
      toast('ok', mode === 'buy' ? `Куплено ≈ ${fmtAmount(tokens)} ${token.symbol}` : `Продано, получено ≈ ${fmtAmount(sol)} SOL`, {
        href: toolLinks.explorerTx('solana', sig),
        label: 'Solscan',
      });
    } catch (e) {
      toast('error', humanError(e));
    } finally {
      setBusy(undefined);
      void loadBalances();
    }
  };

  const dec = decimals ?? tokBal?.decimals;
  const impact = quote ? priceImpactPercent(quote) : 0;
  // Комиссия в SOL: при покупке — доля от входа, при продаже — от выхода (outAmount уже без комиссии)
  const feeSol = !quote || !fee
    ? undefined
    : mode === 'buy'
      ? (fromBaseUnits(quote.inAmount, 9) * fee.bps) / 10_000
      : (fromBaseUnits(quote.outAmount, 9) * fee.bps) / (10_000 - fee.bps);
  const lowSol = mode === 'buy' && solBal !== undefined && parseFloat(amount) > solBal - 0.01;

  return (
    <>
      {mode === 'buy' ? (
        <AmountInput value={amount} onChange={setAmount} symbol="SOL" presets={CHAINS.solana.buyPresets} balance={solBal} />
      ) : (
        <SellPicker pct={sellPct} onChange={setSellPct} balance={tokBal && fromBaseUnits(tokBal.raw, tokBal.decimals)} symbol={token.symbol} />
      )}
      <SlippagePicker value={slippage} onChange={setSlippage} />

      <QuoteBox error={quoteErr} loading={quoting && !quote}>
        {quote && (
          <>
            <div className="row-between">
              <span>Вы получите ≈</span>
              <b>
                {mode === 'buy'
                  ? dec !== undefined
                    ? `${fmtAmount(fromBaseUnits(quote.outAmount, dec))} ${token.symbol}`
                    : '…'
                  : `${fmtAmount(fromBaseUnits(quote.outAmount, 9))} SOL`}
              </b>
            </div>
            <div className="row-between small">
              <span className="muted">Влияние на цену</span>
              <span className={impact > 5 ? 'text-bad' : impact > 2 ? 'text-warn' : ''}>{impact.toFixed(2)}%</span>
            </div>
            {routeLabel(quote) && (
              <div className="row-between small">
                <span className="muted">Маршрут</span>
                <span>{routeLabel(quote)}</span>
              </div>
            )}
            {fee && (
              <div className="row-between small">
                <span className="muted">Комиссия сервиса {feePercentLabel(fee.bps)}</span>
                <span>{feeSol !== undefined ? `≈ ${fmtAmount(feeSol)} SOL` : feePercentLabel(fee.bps)}</span>
              </div>
            )}
            {impact > 5 && <div className="text-bad small">Сделка сильно двигает цену — пул тонкий, уменьшите сумму.</div>}
          </>
        )}
      </QuoteBox>
      {lowSol && <div className="text-warn small">Оставьте ~0.01 SOL на комиссии сети.</div>}
      {mode === 'sell' && owner && tokBal?.raw === 0n && <div className="muted small">На подключённом кошельке нет этого токена.</div>}

      <ActionButton
        mode={mode}
        busy={busy}
        connected={Boolean(owner)}
        disabled={blocked || !quote || (mode === 'sell' && !tokBal?.raw)}
        onClick={execute}
        label={mode === 'buy' ? `Купить ${token.symbol} за ${amount || 0} SOL` : `Продать ${sellPct}% ${token.symbol}`}
      />
      <div className="muted small center">Обмен через Jupiter · приоритетная комиссия: {settings.priority}</div>
    </>
  );
}

// ---------------- EVM (KyberSwap) ----------------

function EvmTrade({ token, mode, blocked }: { token: TradeToken; mode: Mode; blocked: boolean }) {
  const evm = useEvm();
  const chain = CHAINS[token.chain];
  const [settings, setSettings] = useStore(settingsStore);
  const [amount, setAmount] = useState(String(settings.defaultBuy[token.chain] ?? chain.buyPresets[1]));
  const [sellPct, setSellPct] = useState(100);
  const [slippage, setSlippage] = useState(settings.slippageBps);
  const [route, setRoute] = useState<EvmQuote>();
  const [routeErr, setRouteErr] = useState<string>();
  const [quoting, setQuoting] = useState(false);
  const [tokBal, setTokBal] = useState<{ raw: bigint; decimals: number }>();
  const [nativeBal, setNativeBal] = useState<number>();
  const [busy, setBusy] = useState<string>();
  const tokenAddr = token.address as Address;
  const onChain = Boolean(evm.account) && evm.chainId === chain.evmChainId;

  const loadBalances = useCallback(async () => {
    if (!onChain) {
      setTokBal(undefined);
      setNativeBal(undefined);
      return;
    }
    try {
      const [t, n] = await Promise.all([evm.tokenBalance(tokenAddr), evm.nativeBalance()]);
      setTokBal(t);
      setNativeBal(fromBaseUnits(n, 18));
    } catch {
      /* ignore */
    }
  }, [onChain, evm, tokenAddr]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  const rawIn = useMemo(
    () => (mode === 'buy' ? toBaseUnits(amount, 18) : tokBal ? (tokBal.raw * BigInt(sellPct)) / 100n : 0n),
    [mode, amount, tokBal, sellPct],
  );

  // Комиссию всегда берём с нативной монеты: при покупке — со входа, при продаже — с выхода
  const fee = evmFeeFor(token.chain);
  const sideFor = useCallback(
    (raw: bigint): SwapSide => ({ chain: token.chain, buy: mode === 'buy', token: token.address, amountIn: raw, fee: evmFeeFor(token.chain) }),
    [mode, token.chain, token.address],
  );
  const account = evm.account;
  const getRoute = useCallback((raw: bigint) => evmQuote(sideFor(raw), account), [sideFor, account]);

  // Встроенный кошелёк переключает сеть сам, без вопросов
  useEffect(() => {
    if (evm.active?.uuid === 'builtin' && chain.evmChainId && evm.chainId !== chain.evmChainId) void evm.switchChain(chain.evmChainId);
  }, [evm, chain.evmChainId]);

  useEffect(() => {
    setRoute(undefined);
    setRouteErr(undefined);
    const raw = rawIn;
    if (raw <= 0n) return;
    setQuoting(true);
    let cancelled = false;
    const t = setTimeout(() => {
      getRoute(raw)
        .then((r) => !cancelled && setRoute(r))
        .catch((e: Error) => !cancelled && setRouteErr(`Нет маршрута: ${e.message}`))
        .finally(() => !cancelled && setQuoting(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [rawIn, getRoute]);

  const execute = async () => {
    if (!evm.account) {
      connectModal.set(true);
      return;
    }
    try {
      if (!onChain && chain.evmChainId) {
        setBusy(`Переключаем сеть на ${chain.name}…`);
        await evm.switchChain(chain.evmChainId);
        setBusy(undefined);
        return; // после переключения обновятся балансы и котировка
      }
      const raw = rawIn;
      if (raw <= 0n) return;
      const ops = evm.forChain(chain.evmChainId!);
      const side = sideFor(raw);
      setBusy('Получаем лучшую цену…');
      const q = await evmQuote(side, evm.account);
      if (mode === 'sell' && q.spender) {
        setBusy('Разрешите продажу токена (approve)…');
        await ops.ensureAllowance(tokenAddr, q.spender, raw);
      }
      setBusy('Собираем транзакцию…');
      const built = await evmBuild(side, q, evm.account, slippage);
      if (mode === 'sell' && built.spender && built.spender.toLowerCase() !== q.spender?.toLowerCase()) {
        await ops.ensureAllowance(tokenAddr, built.spender, raw);
      }
      setBusy(evm.active?.uuid === 'builtin' ? 'Отправляем…' : 'Подтвердите в кошельке…');
      const hash = await ops.sendTransaction({ to: built.to, data: built.data, value: built.value });
      setBusy('Ждём подтверждения сети…');
      const status = await ops.waitForReceipt(hash);
      if (status !== 'success') throw new Error('Транзакция отклонена сетью (чаще всего — цена ушла дальше slippage)');

      const dec = tokBal?.decimals ?? 18;
      const native = fromBaseUnits(mode === 'buy' ? built.amountIn : built.amountOut, 18);
      const tokens = fromBaseUnits(mode === 'buy' ? built.amountOut : built.amountIn, dec);
      addTrade({
        side: mode,
        chain: token.chain,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        image: token.image,
        nativeAmount: native,
        nativeSymbol: chain.native,
        tokenAmount: tokens,
        priceUsd: token.priceUsd,
        tx: hash,
      });
      if (mode === 'buy') setSettings((s) => ({ ...s, defaultBuy: { ...s.defaultBuy, [token.chain]: parseFloat(amount) } }));
      toast('ok', mode === 'buy' ? `Куплено ≈ ${fmtAmount(tokens)} ${token.symbol}` : `Продано, получено ≈ ${fmtAmount(native)} ${chain.native}`, {
        href: toolLinks.explorerTx(token.chain, hash),
        label: 'Обозреватель',
      });
    } catch (e) {
      toast('error', humanError(e));
    } finally {
      setBusy(undefined);
      void loadBalances();
    }
  };

  const outUsd = route?.amountOutUsd;
  const inUsd = route?.amountInUsd;
  const loss = inUsd && outUsd ? ((inUsd - outUsd) / inUsd) * 100 : undefined;

  return (
    <>
      {mode === 'buy' ? (
        <AmountInput value={amount} onChange={setAmount} symbol={chain.native} presets={chain.buyPresets} balance={nativeBal} />
      ) : (
        <SellPicker pct={sellPct} onChange={setSellPct} balance={tokBal && fromBaseUnits(tokBal.raw, tokBal.decimals)} symbol={token.symbol} />
      )}
      <SlippagePicker value={slippage} onChange={setSlippage} />

      {mode === 'sell' && !onChain && (
        <div className="muted small">Подключите кошелёк в сети {chain.name}, чтобы увидеть баланс токена.</div>
      )}

      <QuoteBox error={routeErr} loading={quoting && !route}>
        {route && (
          <>
            <div className="row-between">
              <span>Вы получите ≈</span>
              <b>
                {mode === 'buy'
                  ? tokBal
                    ? `${fmtAmount(fromBaseUnits(route.amountOut, tokBal.decimals))} ${token.symbol}`
                    : `${token.symbol} на ${fmtUsd(outUsd)}`
                  : `${fmtAmount(fromBaseUnits(route.amountOut, 18))} ${chain.native}`}
              </b>
            </div>
            {loss !== undefined && (
              <div className="row-between small">
                <span className="muted">Потери на обмене</span>
                <span className={loss > 5 ? 'text-bad' : loss > 2 ? 'text-warn' : ''}>{loss.toFixed(2)}%</span>
              </div>
            )}
            {fee && route.feeApplied && (
              <div className="row-between small">
                <span className="muted">Комиссия сервиса {feePercentLabel(fee.bps)}</span>
                <span>{inUsd ? `≈ $${((inUsd * fee.bps) / 10_000).toFixed(2)}` : feePercentLabel(fee.bps)}</span>
              </div>
            )}
            {route.gasUsd !== undefined && (
              <div className="row-between small">
                <span className="muted">Комиссия сети</span>
                <span>≈ ${route.gasUsd.toFixed(2)}</span>
              </div>
            )}
            <div className="row-between small">
              <span className="muted">Маршрут</span>
              <span>{route.provider}</span>
            </div>
          </>
        )}
      </QuoteBox>

      <ActionButton
        mode={mode}
        busy={busy}
        connected={Boolean(evm.account)}
        disabled={blocked || (onChain && !route) || (mode === 'sell' && onChain && !tokBal?.raw)}
        onClick={execute}
        label={
          !onChain
            ? `Переключить сеть на ${chain.name}`
            : mode === 'buy'
              ? `Купить ${token.symbol} за ${amount || 0} ${chain.native}`
              : `Продать ${sellPct}% ${token.symbol}`
        }
      />
      <div className="muted small center">Обмен через KyberSwap или LI.FI · {chain.name}</div>
    </>
  );
}
