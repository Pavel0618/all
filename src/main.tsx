import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SolanaProvider } from './wallet/SolanaProvider';
import { EvmProvider } from './wallet/evm';
import './styles.css';
import { initTelegram, isTelegram } from './lib/telegram';
import { loadBuiltin } from './wallet/builtin';

// В Telegram: тема, разворот на весь экран, диплинк на токен, встроенный кошелёк
initTelegram();
if (isTelegram()) void loadBuiltin();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaProvider>
      <EvmProvider>
        <App />
      </EvmProvider>
    </SolanaProvider>
  </StrictMode>,
);
