import { parseHash, useHash, type Route } from './lib/router';
import { Radar } from './components/Radar';
import { TokenPage } from './components/TokenPage';
import { SearchPage } from './components/SearchPage';
import { Portfolio } from './components/Portfolio';
import { Guide } from './components/Guide';
import { Settings } from './components/Settings';
import { ConnectModal, WalletButton } from './wallet/WalletButton';
import { toasts, useMemory } from './lib/ui';

const NAV: { route: Route['name']; href: string; label: string; icon: string }[] = [
  { route: 'radar', href: '#/', label: 'Радар', icon: '📡' },
  { route: 'portfolio', href: '#/portfolio', label: 'Портфель', icon: '💼' },
  { route: 'guide', href: '#/guide', label: 'Методика', icon: '📘' },
  { route: 'settings', href: '#/settings', label: 'Настройки', icon: '⚙️' },
];

export function App() {
  const hash = useHash();
  const route = parseHash(hash);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="logo">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <span>
            Gem<b>Radar</b>
          </span>
        </a>
        <nav className="topnav">
          {NAV.map((n) => (
            <a key={n.route} href={n.href} className={route.name === n.route ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
        <WalletButton />
      </header>

      <main>
        {route.name === 'radar' && <Radar />}
        {route.name === 'token' && <TokenPage key={`${route.chain}:${route.address}`} chain={route.chain} address={route.address} />}
        {route.name === 'search' && <SearchPage q={route.q} />}
        {route.name === 'portfolio' && <Portfolio />}
        {route.name === 'guide' && <Guide />}
        {route.name === 'settings' && <Settings />}
      </main>

      <footer className="footer muted small">
        Не финансовый совет. Мемкоины — высокий риск. Ключи остаются в вашем кошельке. Данные: DexScreener, GeckoTerminal, RugCheck, GoPlus. Обмен:
        Jupiter, KyberSwap.
      </footer>

      <nav className="bottomnav">
        {NAV.map((n) => (
          <a key={n.route} href={n.href} className={route.name === n.route ? 'active' : ''}>
            <span className="bn-icon">{n.icon}</span>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>

      <ConnectModal />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const list = useMemory(toasts);
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.link && (
            <a href={t.link.href} target="_blank" rel="noreferrer">
              {t.link.label} ↗
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
