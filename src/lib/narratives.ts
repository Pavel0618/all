// Шаг 5 методики: нарративы. Список можно править в настройках —
// добавляйте то, что сейчас в трендах (TweetScout → Trending Tags, хэштеги в X).

export interface Narrative {
  id: string;
  name: string;
  keywords: string[];
}

export const DEFAULT_NARRATIVES: Narrative[] = [
  {
    id: 'ai',
    name: 'AI / ChatGPT / агенты',
    keywords: ['ai', 'gpt', 'agent', 'agents', 'openai', 'chatgpt', 'neural', 'llm', 'grok', 'deepseek', 'agi', 'robot', 'claude', 'gemini'],
  },
  {
    id: 'politics',
    name: 'TRUMP / политика / выборы',
    keywords: ['trump', 'maga', 'president', 'election', 'vote', 'melania', 'barron', 'elon', 'musk', 'america', 'usa', 'kennedy', 'vance'],
  },
  {
    id: 'animals',
    name: 'Solana-мемы / жабы / животные',
    keywords: [
      'dog', 'cat', 'frog', 'pepe', 'toad', 'inu', 'doge', 'shib', 'wif', 'bonk', 'hamster', 'monkey', 'ape', 'penguin', 'pengu',
      'bear', 'bull', 'fish', 'duck', 'goat', 'kitty', 'puppy', 'zoge', 'frogchain', 'popcat', 'mew', 'moodeng', 'hippo', 'capybara',
    ],
  },
  {
    id: 'etf',
    name: 'Crypto ETF / L2',
    keywords: ['etf', 'l2', 'layer2', 'rollup', 'blackrock', 'sec'],
  },
  {
    id: 'icm',
    name: 'ICM (Internet Capital Markets)',
    keywords: ['icm', 'internet capital', 'capital markets', 'launchcoin', 'believe'],
  },
];

export interface NarrativeMatch {
  narrative: Narrative;
  keyword: string;
}

/** Находит нарративы, в которые попадает токен (по названию, тикеру и описанию). */
export function matchNarratives(text: { name?: string; symbol?: string; description?: string }, list: Narrative[]): NarrativeMatch[] {
  const symbol = (text.symbol ?? '').toLowerCase();
  const haystack = `${text.name ?? ''} ${text.symbol ?? ''} ${text.description ?? ''}`.toLowerCase();
  const words = new Set(haystack.split(/[^a-z0-9а-яё$#]+/i).map((w) => w.replace(/^[$#]/, '')).filter(Boolean));

  const out: NarrativeMatch[] = [];
  for (const n of list) {
    for (const raw of n.keywords) {
      const kw = raw.trim().toLowerCase();
      if (!kw) continue;
      let hit: boolean;
      if (kw.length <= 3) {
        // Короткие слова — только целиком или как приставка/окончание тикера (AIXBT, DOGAI)
        hit = words.has(kw) || (symbol.length > kw.length + 1 && (symbol.startsWith(kw) || symbol.endsWith(kw)));
      } else {
        hit = haystack.includes(kw);
      }
      if (hit) {
        out.push({ narrative: n, keyword: raw });
        break;
      }
    }
  }
  return out;
}
