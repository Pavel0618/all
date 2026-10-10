// Методика простыми словами + что из неё делает приложение автоматически.
import type { ReactNode } from 'react';
import { toolLinks } from '../lib/chains';
import { settingsStore, useStore } from '../lib/storage';
import { fmtUsd } from '../lib/format';
import { feeConfigured, feePercentLabel } from '../lib/fees';

export function Guide() {
  const [settings] = useStore(settingsStore);
  const t = settings.thresholds;
  return (
    <div className="page guide">
      <section className="card">
        <h1>Методика: X-гемы через Twitter</h1>
        <p>
          Мемкоины и трендовые токены торгуются не «по теханализу», а по <b>вниманию в Twitter (X)</b>. Задача — увидеть хайп раньше других,
          отфильтровать скам и зайти, пока график «тихий, но уже пульсирует».
        </p>
      </section>

      <GuideStep
        n={1}
        title="Найди всплеск интереса"
        auto="Лента «Радар» с фильтром под методику; с подключённым сервером — сам считает упоминания в X за час и их рост. Бот присылает такие монеты сам."
      >
        <p>Монеты, про которые резко начали говорить, чаще всего выстреливают в ближайшие часы или дни.</p>
        <ul>
          <li>
            <a href={toolLinks.tweetScout} target="_blank" rel="noreferrer">TweetScout</a> → Trending и Early projects: вирусный рост упоминаний.
          </li>
          <li>
            <a href={toolLinks.twitterScoreTop} target="_blank" rel="noreferrer">TwitterScore</a> → TOP Researched: лайки, охваты, ретвиты, динамика.
          </li>
          <li>
            <a href={toolLinks.moniTrending} target="_blank" rel="noreferrer">Moni</a> → Trending: «хайп»-токены в моментуме.
          </li>
        </ul>
        <p className="muted small">Смотрите Score / Smart Followers (качество аккаунта) и резкий скачок вовлечённости — это ранняя волна.</p>
      </GuideStep>

      <GuideStep
        n={2}
        title="Проверь, кто раскачивает"
        auto="С подключённым сервером — сам: находит заметные аккаунты (KOL) среди авторов и долю ботов. Иначе кнопки сразу открывают Moni и TwitterScore."
      >
        <p>
          Иногда хайпит толпа, иногда — один инфлюенсер. Вставьте ссылку на Twitter проекта в Moni и посмотрите смарт-метрики. Положительная
          динамика = токен «горячий».
        </p>
      </GuideStep>

      <GuideStep n={3} title="Быстрая проверка безопасности" auto="Автоматически: RugCheck и GoPlus (Solana), GoPlus (EVM — аналог TokenSniffer), для Robinhood и свежих токенов — своя проверка по Blockscout.">
        <p>Исключаем:</p>
        <ul>
          <li>нелокнутую ликвидность;</li>
          <li>возможность mint / pause / blacklist / whitelist;</li>
          <li>огромную комиссию на вход/выход;</li>
          <li>владельца-прокси или нераскрытый адрес.</li>
        </ul>
      </GuideStep>

      <GuideStep n={4} title="Анализ графика" auto="Автоматически: капа, ликвидность, «зелёные палки», давление продаж. Свечной график от 1 минуты до 1 дня и линейка для замера роста в % прямо на странице монеты.">
        <ul>
          <li>
            Капа: желательно до {fmtUsd(t.idealMcap)}–{fmtUsd(t.maxMcap)}.
          </li>
          <li>График: начало пампа, ранний боковик или 1–2 волна роста.</li>
          <li>
            Ликвидность: не менее {fmtUsd(t.minLiquidity)}–{fmtUsd(t.idealLiquidity)} в пуле.
          </li>
        </ul>
        <p>
          Twitter кипит, а график только шевелится — потенциальный раннер. Наоборот — уже на хаях и с пустым стаканом — пропускаем.
        </p>
        <p className="muted small">
          Сколько уже выросло: нажмите «📏 Линейка» под графиком и проведите от начала движения до вершины — покажет рост в %, число свечей
          и время. На компьютере — Shift + клик. Убрать — клик по графику или Esc.
        </p>
      </GuideStep>

      <GuideStep n={5} title="Пойми нарратив" auto="Автоматически сверяет название, тикер и твиты о монете со списком трендов (редактируется в Настройках).">
        <p>Примеры: AI / ChatGPT (особенно под релизы OpenAI), TRUMP / выборы, Solana-мемы / жабы / животные, Crypto ETF / L2, ICM.</p>
      </GuideStep>

      <section className="card">
        <h2>Финальное решение</h2>
        <ul className="checklist">
          <li>✔️ Хайп в Twitter нарастает</li>
          <li>✔️ Его качают реальные инфлюенсеры</li>
          <li>✔️ Цена — на раннем этапе</li>
          <li>✔️ Контракт чист</li>
          <li>✔️ Нарратив — в струе</li>
        </ul>
        <p>
          → можно входить. <b>Если хотя бы 2 из 5 слабые — лучше пропустить.</b> Опасный контракт — не входить никогда.
        </p>
        <ul>
          <li>Twitter — индикатор толпы. Он не идеален, но показывает, где будет ликвидность.</li>
          <li>Не запрыгивай на «зелёных палках» — заходи, пока график «тихий, но уже пульсирует».</li>
          <li>Фильтруй ботов и рекламные пуши — они часто путают.</li>
          <li>Фиксируй тогда, когда другие начинают покупать.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Комиссия сервиса</h2>
        <p className="small">
          {feeConfigured().solana || feeConfigured().evm
            ? `С каждой сделки через приложение берётся ${feePercentLabel()} — она уже учтена в сумме «Вы получите» и видна до подтверждения. Комиссии сети и DEX — отдельно, как в любом кошельке.`
            : 'Комиссия сервиса сейчас не взимается. Вы платите только комиссии сети и DEX.'}
        </p>
      </section>

      <section className="card risk">
        <h2>Риски</h2>
        <p className="small">
          Мемкоины — экстремально рискованный актив: большинство падает почти до нуля, а автоматические проверки не ловят все виды скама.
          Заходите только суммой, которую готовы потерять. Приложение — инструмент для дисциплины, а не финансовый совет. Вы сами подписываете
          каждую сделку в своём кошельке; приложение не хранит ключи и не имеет доступа к вашим средствам.
        </p>
      </section>
    </div>
  );
}

function GuideStep({ n, title, auto, children }: { n: number; title: string; auto: string; children: ReactNode }) {
  return (
    <section className="card step">
      <div className="step-head">
        <span className="step-n">{n}</span>
        <div className="step-title">
          <h3>{title}</h3>
        </div>
      </div>
      {children}
      <div className="auto-note small">⚙️ В приложении: {auto}</div>
    </section>
  );
}
