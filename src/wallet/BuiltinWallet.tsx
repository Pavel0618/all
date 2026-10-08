// Экран встроенного кошелька в Telegram Mini App.
import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { formatEther, isAddress, parseEther, type Address } from 'viem';
import { builtinStore, createBuiltin, deleteBuiltin, exportKeys, importBuiltin, markBackedUp } from './builtin';
import { useEvm } from './evm';
import { useSolSigner } from './solSigner';
import { CHAIN_LIST, CHAINS, chainByEvmId, phantomBrowseLink, toolLinks, type ChainId } from '../lib/chains';
import { fmtAmount, shortAddr, toBaseUnits } from '../lib/format';
import { waitForSignature } from '../lib/jupiter';
import { confirmDialog } from '../lib/telegram';
import { toast, useMemory } from '../lib/ui';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('ok', `${what} скопирован`);
  } catch {
    toast('error', 'Не удалось скопировать — выделите и скопируйте вручную');
  }
}

const STORAGE_TEXT = {
  secure: 'в защищённом хранилище телефона (Keychain / Keystore)',
  device: 'в хранилище Telegram на этом устройстве',
  local: 'в памяти браузера на этом устройстве — держите здесь только небольшую сумму',
};

export function BuiltinWallet() {
  const state = useMemory(builtinStore);
  const [view, setView] = useState<'main' | 'import' | 'keys' | 'withdraw'>('main');

  if (state.status === 'idle' || state.status === 'loading') return <div className="muted">Загружаем кошелёк…</div>;

  if (state.status === 'none') {
    return view === 'import' ? <ImportView onBack={() => setView('main')} /> : <Onboarding onImport={() => setView('import')} />;
  }

  if (!state.backedUp) return <BackupView />;
  if (view === 'keys') return <KeysView onBack={() => setView('main')} />;
  if (view === 'withdraw') return <WithdrawView onBack={() => setView('main')} />;
  return <WalletHome onWithdraw={() => setView('withdraw')} onKeys={() => setView('keys')} />;
}

function Onboarding({ onImport }: { onImport: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="bw">
      <p>
        Внутри Telegram нельзя подключить Phantom или MetaMask, поэтому здесь работает <b>встроенный кошелёк</b>. Ключи создаются и хранятся
        только на вашем устройстве — у сервиса нет к ним доступа.
      </p>
      <button
        className="btn btn-primary btn-block btn-big"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await createBuiltin();
          } catch (e) {
            toast('error', (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Создаём…' : 'Создать кошелёк'}
      </button>
      <button className="btn btn-ghost btn-block" onClick={onImport}>
        У меня есть ключ — импортировать
      </button>
      <p className="muted small center">
        Хотите торговать своим Phantom?{' '}
        <a href={phantomBrowseLink()} target="_blank" rel="noreferrer">
          Откройте сайт в Phantom
        </a>
      </p>
    </div>
  );
}

function ImportView({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="bw">
      <p className="small">
        Вставьте приватный ключ Solana (из Phantom: Настройки → Управление аккаунтами → Показать приватный ключ) и/или приватный ключ EVM (из
        MetaMask). Можно оба — с новой строки.
      </p>
      <textarea
        className="key-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Приватный ключ…"
        rows={4}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Приватный ключ"
      />
      <button
        className="btn btn-primary btn-block"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await importBuiltin(text);
            setText('');
            toast('ok', r.sol && r.evm ? 'Оба ключа импортированы' : r.sol ? 'Ключ Solana импортирован, EVM создан новый' : 'Ключ EVM импортирован, Solana создан новый');
          } catch (e) {
            toast('error', (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Импортировать
      </button>
      <button className="btn btn-ghost btn-block" onClick={onBack}>
        Назад
      </button>
    </div>
  );
}

function KeyBox({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="key-box">
      <div className="row-between">
        <b>{label}</b>
        <button className="btn btn-small btn-ghost" onClick={() => copy(value, 'Ключ')}>
          Копировать
        </button>
      </div>
      <code className="key-value">{value}</code>
      <div className="muted small">{hint}</div>
    </div>
  );
}

function BackupView() {
  const keys = exportKeys();
  const [ok, setOk] = useState(false);
  if (!keys) return null;
  return (
    <div className="bw">
      <div className="alert alert-warn">
        <b>Сохраните ключи прямо сейчас.</b> Это единственный способ вернуть деньги, если вы смените телефон или удалите Telegram. Никому их не
        показывайте — с ключом можно забрать все средства.
      </div>
      <KeyBox label="Solana" value={keys.sol} hint="Импортируется в Phantom / Solflare" />
      <KeyBox label="EVM (Ethereum, Base, BNB, Arbitrum)" value={keys.evm} hint="Импортируется в MetaMask / Rabby" />
      <label className="risk-gate">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>Я сохранил ключи в надёжном месте (менеджер паролей, бумага)</span>
      </label>
      <button className="btn btn-primary btn-block" disabled={!ok} onClick={() => markBackedUp().catch((e) => toast('error', (e as Error).message))}>
        Готово
      </button>
    </div>
  );
}

function KeysView({ onBack }: { onBack: () => void }) {
  const keys = exportKeys();
  return (
    <div className="bw">
      <div className="alert alert-warn">Никому не показывайте эти ключи. Поддержка никогда их не попросит.</div>
      {keys && (
        <>
          <KeyBox label="Solana" value={keys.sol} hint="Импортируется в Phantom / Solflare" />
          <KeyBox label="EVM" value={keys.evm} hint="Импортируется в MetaMask / Rabby" />
        </>
      )}
      <button className="btn btn-ghost btn-block" onClick={onBack}>
        Назад
      </button>
    </div>
  );
}

function WalletHome({ onWithdraw, onKeys }: { onWithdraw: () => void; onKeys: () => void }) {
  const state = useMemory(builtinStore);
  const { connection } = useConnection();
  const evm = useEvm();
  const [sol, setSol] = useState<number>();
  const [eth, setEth] = useState<number>();
  const evmChain = chainByEvmId(evm.chainId ?? 8453);

  const load = useCallback(() => {
    if (state.solAddress) {
      connection
        .getBalance(state.solAddress)
        .then((l) => setSol(l / LAMPORTS_PER_SOL))
        .catch(() => setSol(undefined));
    }
    evm
      .nativeBalance()
      .then((b) => setEth(Number(formatEther(b))))
      .catch(() => setEth(undefined));
  }, [connection, state.solAddress, evm]);

  useEffect(() => {
    load();
  }, [load]);

  const solAddr = state.solAddress?.toBase58() ?? '';
  const evmAddr = state.evm?.address ?? '';

  return (
    <div className="bw">
      <div className="bw-acc">
        <div className="row-between">
          <span>
            <b>Solana</b> · {sol === undefined ? '—' : `${fmtAmount(sol)} SOL`}
          </span>
          <button className="btn btn-small btn-ghost" onClick={() => copy(solAddr, 'Адрес')}>
            {shortAddr(solAddr)} ⧉
          </button>
        </div>
        <div className="row-between">
          <span>
            <b>{evmChain?.name ?? 'EVM'}</b> · {eth === undefined ? '—' : `${fmtAmount(eth)} ${evmChain?.native ?? 'ETH'}`}
          </span>
          <button className="btn btn-small btn-ghost" onClick={() => copy(evmAddr, 'Адрес')}>
            {shortAddr(evmAddr)} ⧉
          </button>
        </div>
        <div className="chips">
          {CHAIN_LIST.filter((c) => c.kind === 'evm').map((c) => (
            <button
              key={c.id}
              className={`chip ${evm.chainId === c.evmChainId ? 'chip-active' : ''}`}
              onClick={() => c.evmChainId && evm.switchChain(c.evmChainId).then(() => setEth(undefined))}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">
        <b>Пополнение:</b> отправьте SOL на адрес Solana (с биржи или из другого кошелька). Для Base/Ethereum/Arbitrum — ETH, для BNB Chain — BNB
        на EVM-адрес. Ключи хранятся {STORAGE_TEXT[state.storage ?? 'local']}.
      </p>
      <div className="bw-actions">
        <button className="btn btn-ghost" onClick={load}>
          ↻ Баланс
        </button>
        <button className="btn btn-ghost" onClick={onWithdraw}>
          Вывести
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            if (await confirmDialog('Показать приватные ключи? Убедитесь, что экран никто не видит.')) onKeys();
          }}
        >
          Ключи
        </button>
      </div>
      <button
        className="btn btn-small btn-ghost btn-danger-text"
        onClick={async () => {
          if (!(await confirmDialog('Удалить кошелёк с этого устройства? Без сохранённых ключей средства будут потеряны навсегда.'))) return;
          if (!(await confirmDialog('Точно удалить? Это нельзя отменить.'))) return;
          await deleteBuiltin();
          toast('info', 'Кошелёк удалён с устройства');
        }}
      >
        Удалить кошелёк с устройства
      </button>
    </div>
  );
}

function WithdrawView({ onBack }: { onBack: () => void }) {
  const { connection } = useConnection();
  const signer = useSolSigner();
  const evm = useEvm();
  const [chain, setChain] = useState<ChainId>('solana');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string>();
  const info = CHAINS[chain];

  const valid = chain === 'solana' ? isSolAddress(to) : isAddress(to);

  const max = async () => {
    try {
      if (chain === 'solana' && signer.publicKey) {
        const l = await connection.getBalance(signer.publicKey);
        setAmount(String(Math.max(0, l - 5000) / LAMPORTS_PER_SOL));
      } else if (info.evmChainId) {
        const b = await evm.forChain(info.evmChainId).nativeBalance();
        const reserve = parseEther(chain === 'ethereum' ? '0.0015' : '0.0002');
        setAmount(formatEther(b > reserve ? b - reserve : 0n));
      }
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const send = async () => {
    if (!valid) return;
    try {
      if (chain === 'solana') {
        if (!signer.publicKey) throw new Error('Кошелёк не найден');
        const lamports = Number(toBaseUnits(amount, 9));
        if (lamports <= 0) throw new Error('Укажите сумму');
        setBusy('Отправляем…');
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(
          SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(to), lamports }),
        );
        const sig = await signer.send(tx, connection);
        setBusy('Ждём подтверждения…');
        await waitForSignature(connection, sig, lastValidBlockHeight);
        toast('ok', `Отправлено ${amount} SOL`, { href: toolLinks.explorerTx('solana', sig), label: 'Solscan' });
      } else {
        if (!info.evmChainId) return;
        const value = parseEther(amount || '0');
        if (value <= 0n) throw new Error('Укажите сумму');
        setBusy('Отправляем…');
        // Строго в выбранной сети, даже если кошелёк сейчас «стоит» на другой
        const ops = evm.forChain(info.evmChainId);
        const hash = await ops.sendTransaction({ to: to as Address, data: '0x', value });
        setBusy('Ждём подтверждения…');
        const status = await ops.waitForReceipt(hash);
        if (status !== 'success') throw new Error('Перевод не прошёл');
        toast('ok', `Отправлено ${amount} ${info.native}`, { href: toolLinks.explorerTx(chain, hash), label: 'Обозреватель' });
      }
      setAmount('');
      onBack();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="bw">
      <div className="chips">
        {CHAIN_LIST.map((c) => (
          <button key={c.id} className={`chip ${chain === c.id ? 'chip-active' : ''}`} onClick={() => setChain(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <p className="muted small">
        Вывод {info.native}. Токены сначала продайте или перенесите, импортировав ключ в {info.kind === 'solana' ? 'Phantom' : 'MetaMask'}.
      </p>
      <div className="search">
        <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={`Адрес получателя (${info.name})`} spellCheck={false} aria-label="Адрес" />
      </div>
      {to && !valid && <div className="text-bad small">Адрес не подходит для сети {info.name}</div>}
      <div className="amount">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0.0" aria-label="Сумма" />
        <span className="amount-sym">{info.native}</span>
        <button className="btn btn-small btn-ghost" onClick={max}>
          Макс
        </button>
      </div>
      <button className="btn btn-primary btn-block" disabled={!valid || !amount || Boolean(busy)} onClick={send}>
        {busy ?? 'Вывести'}
      </button>
      <button className="btn btn-ghost btn-block" onClick={onBack}>
        Назад
      </button>
    </div>
  );
}

function isSolAddress(v: string): boolean {
  try {
    return v.length >= 32 && Boolean(new PublicKey(v));
  } catch {
    return false;
  }
}
