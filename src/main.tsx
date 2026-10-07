import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SolanaProvider } from './wallet/SolanaProvider';
import { EvmProvider } from './wallet/evm';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaProvider>
      <EvmProvider>
        <App />
      </EvmProvider>
    </SolanaProvider>
  </StrictMode>,
);
