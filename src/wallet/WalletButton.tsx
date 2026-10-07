import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useEvm } from './evm';
import { connectModal, toast, useMemory } from '../lib/ui';
import { metamaskBrowseLink, phantomBrowseLink, chainByEvmId } from '../lib/chains';
import { shortAddr } from '../lib/format';

export function WalletButton() {
  const sol = useWallet();
  const evm = useEvm();
  const connected = [sol.publicKey ? shortAddr(sol.publicKey.toBase58()) : null, evm.account ? shortAddr(evm.account) : null].filter(Boolean);

  return (
    <button className={`btn ${connected.length ? 'btn-ghost' : 'btn-primary'} wallet-btn`} onClick={() => connectModal.set(true)}>
      {connected.length ? (
        <>
          <span className="dot dot-ok" /> {connected.join(' · ')}
        </>
      ) : (
        'Подключить кошелёк'
      )}
    </button>
  );
}

export function ConnectModal() {
  const open = useMemory(connectModal);
  const sol = useWallet();
  const evm = useEvm();
  if (!open) return null;

  const solWallets = sol.wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );
  const close = () => connectModal.set(false);

  const connectEvm = async (w: (typeof evm.wallets)[number]) => {
    try {
      await evm.connect(w);
      toast('ok', `${w.name} подключён`);
      close();
    } catch (e) {
      toast('error', (e as Error).message || 'Подключение отменено');
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Подключение кошелька">
        <div className="modal-head">
          <h3>Кошелёк</h3>
          <button className="icon-btn" onClick={close} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="muted small">
          Приложение не хранит ключи и не имеет доступа к средствам. Каждую сделку вы подтверждаете в своём кошельке.
        </p>

        <h4>Solana</h4>
        {sol.publicKey ? (
          <div className="wallet-row">
            {sol.wallet?.adapter.icon && <img src={sol.wallet.adapter.icon} alt="" />}
            <span>
              {sol.wallet?.adapter.name} · <b>{shortAddr(sol.publicKey.toBase58())}</b>
            </span>
            <button className="btn btn-small btn-ghost" onClick={() => sol.disconnect()}>
              Отключить
            </button>
          </div>
        ) : solWallets.length ? (
          <div className="wallet-list">
            {solWallets.map((w) => (
              <button
                key={w.adapter.name}
                className="wallet-option"
                onClick={() => {
                  sol.select(w.adapter.name);
                  close();
                }}
              >
                <img src={w.adapter.icon} alt="" />
                {w.adapter.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted small">
            Кошелёк не найден. Установите{' '}
            <a href="https://phantom.com/download" target="_blank" rel="noreferrer">
              Phantom
            </a>{' '}
            или{' '}
            <a href="https://solflare.com/download" target="_blank" rel="noreferrer">
              Solflare
            </a>
            . На телефоне:{' '}
            <a href={phantomBrowseLink()} className="link-strong">
              открыть сайт в Phantom
            </a>
          </div>
        )}

        <h4>Ethereum / Base / BNB / Arbitrum</h4>
        {evm.account ? (
          <div className="wallet-row">
            {evm.active?.icon && <img src={evm.active.icon} alt="" />}
            <span>
              {evm.active?.name} · <b>{shortAddr(evm.account)}</b>
              {evm.chainId && <span className="muted"> · {chainByEvmId(evm.chainId)?.name ?? `сеть ${evm.chainId}`}</span>}
            </span>
            <button className="btn btn-small btn-ghost" onClick={evm.disconnect}>
              Отключить
            </button>
          </div>
        ) : evm.wallets.length ? (
          <div className="wallet-list">
            {evm.wallets.map((w) => (
              <button key={w.uuid} className="wallet-option" onClick={() => connectEvm(w)}>
                {w.icon ? <img src={w.icon} alt="" /> : <span className="wallet-ph">⬡</span>}
                {w.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted small">
            Кошелёк не найден. Установите{' '}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              MetaMask
            </a>{' '}
            или{' '}
            <a href="https://rabby.io/" target="_blank" rel="noreferrer">
              Rabby
            </a>
            . На телефоне:{' '}
            <a href={metamaskBrowseLink()} className="link-strong">
              открыть сайт в MetaMask
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
