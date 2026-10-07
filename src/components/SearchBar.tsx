import { useState, type FormEvent } from 'react';
import { parseUserInput } from '../lib/chains';
import { navigate } from '../lib/router';
import { toast } from '../lib/ui';

export function SearchBar({ autoFocus, big }: { autoFocus?: boolean; big?: boolean }) {
  const [value, setValue] = useState('');

  const go = (raw: string) => {
    const parsed = parseUserInput(raw);
    if (!parsed) return;
    if (parsed.address) {
      navigate({ name: 'token', chain: parsed.chain ?? 'auto', address: parsed.address });
    } else if (parsed.query) {
      navigate({ name: 'search', q: parsed.query });
    }
    setValue('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) go(text);
    } catch {
      toast('info', 'Разрешите доступ к буферу обмена или вставьте вручную');
    }
  };

  return (
    <form className={`search ${big ? 'search-big' : ''}`} onSubmit={onSubmit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Адрес, ссылка (DexScreener, GMGN, pump.fun, X) или $тикер"
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Поиск токена"
      />
      {value ? (
        <button type="submit" className="btn btn-primary">
          Проверить
        </button>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={paste} title="Вставить из буфера и проверить">
          Вставить
        </button>
      )}
    </form>
  );
}
