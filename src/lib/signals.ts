// Автоматический Twitter-анализ с нашего сервера (Cloudflare Worker). Если сервер не подключён — молчим,
// и шаги 1–2 работают как раньше: кнопки на сервисы + ответ «Да / Нет».
import { useEffect, useState } from 'react';
import { SIGNALS_URL } from '../config';
import { getJson } from './http';
import type { TwitterSignals } from './twitterSignals';

export interface SignalsState {
  enabled: boolean;
  loading: boolean;
  signals?: TwitterSignals;
  /** budget — дневной лимит исчерпан, not_configured — ключ не задан, failed — сервер/API недоступны */
  error?: 'budget' | 'not_configured' | 'failed';
}

interface SignalsResponse {
  signals?: TwitterSignals;
  error?: 'budget' | 'not_configured' | 'failed' | 'not_found' | 'bad_request';
}

export async function fetchSignals(chain: string, address: string): Promise<SignalsResponse> {
  return getJson<SignalsResponse>(`${SIGNALS_URL}/signals?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`, {
    ttlMs: 120_000,
    timeoutMs: 25_000,
  });
}

export function useSignals(chain: string | undefined, address: string, ready: boolean): SignalsState {
  const enabled = Boolean(SIGNALS_URL);
  const [state, setState] = useState<SignalsState>({ enabled, loading: enabled });

  useEffect(() => {
    if (!enabled || !chain || !ready) return;
    let cancelled = false;
    setState({ enabled, loading: true });
    fetchSignals(chain, address)
      .then((r) => {
        if (cancelled) return;
        if (r.signals) setState({ enabled, loading: false, signals: r.signals });
        else setState({ enabled, loading: false, error: r.error === 'budget' || r.error === 'not_configured' ? r.error : 'failed' });
      })
      .catch(() => !cancelled && setState({ enabled, loading: false, error: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [enabled, chain, address, ready]);

  return state;
}
