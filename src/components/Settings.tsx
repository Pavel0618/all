import { useState } from 'react';
import { DEFAULT_SETTINGS, settingsStore, useStore, answersStore } from '../lib/storage';
import { DEFAULT_NARRATIVES, type Narrative } from '../lib/narratives';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../lib/analysis';
import type { PriorityLevel } from '../lib/jupiter';
import { toast } from '../lib/ui';

const PRIORITY: { id: PriorityLevel; label: string; hint: string }[] = [
  { id: 'medium', label: 'Обычная', hint: 'дешевле, может проходить дольше' },
  { id: 'high', label: 'Высокая', hint: 'баланс скорости и цены' },
  { id: 'veryHigh', label: 'Максимальная', hint: 'для горячих запусков' },
];

export function Settings() {
  const [settings, setSettings] = useStore(settingsStore);
  const [, setAnswers] = useStore(answersStore);
  const [rpc, setRpc] = useState(settings.solanaRpc);

  const setThreshold = (k: keyof Thresholds, v: string) => {
    const n = Number(v.replace(/\s/g, ''));
    if (!Number.isFinite(n) || n < 0) return;
    setSettings((s) => ({ ...s, thresholds: { ...s.thresholds, [k]: n } }));
  };

  const updateNarrative = (i: number, patch: Partial<Narrative>) =>
    setSettings((s) => ({ ...s, narratives: s.narratives.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));

  return (
    <div className="page">
      <section className="card">
        <h2>Критерии методики</h2>
        <p className="muted small">Пороги для шага 4 «Анализ графика». По умолчанию — как в инструкции.</p>
        <div className="form-grid">
          <NumField label="Капа — отлично до, $" value={settings.thresholds.idealMcap} onChange={(v) => setThreshold('idealMcap', v)} />
          <NumField label="Капа — максимум, $" value={settings.thresholds.maxMcap} onChange={(v) => setThreshold('maxMcap', v)} />
          <NumField label="Ликвидность — минимум, $" value={settings.thresholds.minLiquidity} onChange={(v) => setThreshold('minLiquidity', v)} />
          <NumField label="Ликвидность — комфортно, $" value={settings.thresholds.idealLiquidity} onChange={(v) => setThreshold('idealLiquidity', v)} />
        </div>
        <button className="btn btn-small btn-ghost" onClick={() => setSettings((s) => ({ ...s, thresholds: DEFAULT_THRESHOLDS }))}>
          Вернуть как в инструкции
        </button>
      </section>

      <section className="card">
        <h2>Актуальные нарративы</h2>
        <p className="muted small">
          Шаг 5. Обновляйте по TweetScout → Trending Tags и хэштегам в X. Ключевые слова — через запятую; ищутся в названии и тикере токена.
        </p>
        {settings.narratives.map((n, i) => (
          <div key={n.id} className="narr">
            <input value={n.name} onChange={(e) => updateNarrative(i, { name: e.target.value })} aria-label="Название нарратива" />
            <input
              value={n.keywords.join(', ')}
              onChange={(e) => updateNarrative(i, { keywords: e.target.value.split(',').map((k) => k.trim()) })}
              aria-label="Ключевые слова"
            />
            <button
              className="icon-btn"
              aria-label="Удалить"
              onClick={() => setSettings((s) => ({ ...s, narratives: s.narratives.filter((_, j) => j !== i) }))}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="tools-row">
          <button
            className="btn btn-small btn-ghost"
            onClick={() =>
              setSettings((s) => ({ ...s, narratives: [...s.narratives, { id: `n${Date.now()}`, name: 'Новый нарратив', keywords: [] }] }))
            }
          >
            + Добавить
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => setSettings((s) => ({ ...s, narratives: DEFAULT_NARRATIVES }))}>
            Сбросить к примерам из инструкции
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Сделки</h2>
        <div className="field">
          <div className="field-label">Проскальзывание по умолчанию</div>
          <div className="chips">
            {[100, 300, 500, 1000, 2000].map((s) => (
              <button
                key={s}
                className={`chip ${settings.slippageBps === s ? 'chip-active' : ''}`}
                onClick={() => setSettings((x) => ({ ...x, slippageBps: s }))}
              >
                {s / 100}%
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Приоритет транзакций Solana</div>
          <div className="chips">
            {PRIORITY.map((p) => (
              <button
                key={p.id}
                className={`chip ${settings.priority === p.id ? 'chip-active' : ''}`}
                onClick={() => setSettings((x) => ({ ...x, priority: p.id }))}
                title={p.hint}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Solana RPC</div>
          <p className="muted small">
            Публичный узел подходит для старта. Для стабильной работы возьмите бесплатный ключ у Helius / QuickNode и вставьте ссылку сюда.
          </p>
          <div className="search">
            <input value={rpc} onChange={(e) => setRpc(e.target.value)} spellCheck={false} aria-label="Solana RPC" />
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!/^https:\/\//.test(rpc)) {
                  toast('error', 'Ссылка должна начинаться с https://');
                  return;
                }
                setSettings((s) => ({ ...s, solanaRpc: rpc.trim() }));
                toast('ok', 'RPC сохранён');
              }}
            >
              Сохранить
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Данные</h2>
        <p className="muted small">Всё хранится только в этом браузере. Сервера у приложения нет.</p>
        <div className="tools-row">
          <button
            className="btn btn-small btn-ghost"
            onClick={() => {
              setAnswers({});
              toast('ok', 'Ответы по чек-листам очищены');
            }}
          >
            Очистить ответы чек-листов
          </button>
          <button
            className="btn btn-small btn-ghost"
            onClick={() => {
              if (!confirm('Вернуть все настройки по умолчанию?')) return;
              setSettings(DEFAULT_SETTINGS);
              setRpc(DEFAULT_SETTINGS.solanaRpc);
            }}
          >
            Сбросить настройки
          </button>
        </div>
      </section>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label className="num-field">
      <span className="small muted">{label}</span>
      <input inputMode="numeric" value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
