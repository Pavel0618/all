import type { ReactNode } from 'react';
import type { Answer, Criterion, CriterionStatus, Verdict } from '../lib/analysis';
import { CORE_GROUPS, GROUP_LABELS, groupStatus, type SecurityGroup, type SecurityReport } from '../lib/security';

export interface ToolLink {
  label: string;
  href?: string;
  onClick?: () => void;
}

const STATUS_TEXT: Record<CriterionStatus, string> = {
  good: '✓ Сильный',
  weak: '✗ Слабый',
  unknown: '? Проверьте',
};

export function StatusBadge({ status, auto }: { status: CriterionStatus; auto?: boolean }) {
  return (
    <span className={`status status-${status}`}>
      {STATUS_TEXT[status]}
      {auto && status !== 'unknown' && <span className="status-auto"> · авто</span>}
    </span>
  );
}

export function StepCard(props: {
  n: number;
  title: string;
  quote: string;
  criterion?: Criterion;
  tools?: ToolLink[];
  question?: { text: string; value?: Answer; onChange: (a?: Answer) => void; yes?: string; no?: string };
  children?: ReactNode;
}) {
  const { n, title, quote, criterion, tools, question, children } = props;
  return (
    <section className={`card step step-${criterion?.status ?? 'unknown'}`} id={`step-${n}`}>
      <div className="step-head">
        <span className="step-n">{n}</span>
        <h3 className="step-title">{title}</h3>
        {criterion && <StatusBadge status={criterion.status} auto={criterion.auto} />}
      </div>
      <blockquote className="step-quote">{quote}</blockquote>

      {criterion && criterion.reasons.length > 0 && (
        <ul className="reasons">
          {criterion.reasons.map((r, i) => (
            <li key={i} className={r.ok === true ? 'r-ok' : r.ok === false ? 'r-bad' : 'r-info'}>
              {r.text}
            </li>
          ))}
        </ul>
      )}

      {children}

      {tools && tools.length > 0 && (
        <div className="tools-row">
          {tools.map((t) =>
            t.href?.startsWith('#') ? (
              <a key={t.label} className="btn btn-small btn-ghost" href={t.href}>
                {t.label}
              </a>
            ) : t.href ? (
              <a key={t.label} className="btn btn-small btn-ghost" href={t.href} target="_blank" rel="noreferrer">
                {t.label} ↗
              </a>
            ) : (
              <button key={t.label} className="btn btn-small btn-ghost" onClick={t.onClick}>
                {t.label}
              </button>
            ),
          )}
        </div>
      )}

      {question && (
        <div className="question">
          <div className="question-text">{question.text}</div>
          <div className="question-btns">
            <button
              className={`btn btn-small ${question.value === 'yes' ? 'btn-yes' : 'btn-ghost'}`}
              onClick={() => question.onChange(question.value === 'yes' ? undefined : 'yes')}
            >
              {question.yes ?? 'Да'}
            </button>
            <button
              className={`btn btn-small ${question.value === 'no' ? 'btn-no' : 'btn-ghost'}`}
              onClick={() => question.onChange(question.value === 'no' ? undefined : 'no')}
            >
              {question.no ?? 'Нет'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const GROUP_ICON: Record<string, string> = { ok: '✅', warn: '⚠️', danger: '⛔', unknown: '❔' };

export function SecurityList({ report, loaded }: { report?: SecurityReport; loaded: boolean }) {
  if (!loaded) return <div className="muted small">Проверяем контракт…</div>;
  if (!report) return null;
  const groups: SecurityGroup[] = [...CORE_GROUPS, 'holders'];
  return (
    <div className="sec-list">
      {groups.map((g) => {
        const st = groupStatus(report, g);
        if (g === 'holders' && st === 'unknown') return null;
        const flags = report.flags.filter((f) => f.group === g && f.severity !== 'ok');
        return (
          <div key={g} className={`sec-row sec-${st}`}>
            <span className="sec-icon">{GROUP_ICON[st]}</span>
            <div>
              <div>{GROUP_LABELS[g]}</div>
              {flags.map((f, i) => (
                <div key={i} className="muted small">
                  {f.text} <span className="src">· {f.source}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {report.rugcheckScore !== undefined && (
        <div className="muted small">RugCheck score: {report.rugcheckScore} (меньше — лучше)</div>
      )}
      {report.errors.map((e, i) => (
        <div key={i} className="muted small">
          ⚠ {e}
        </div>
      ))}
    </div>
  );
}

// Порядок критериев: хайп, инфлюенсеры, цена, контракт, нарратив → номера шагов в инструкции
const STEP_OF = [1, 2, 4, 3, 5];

const VERDICT_ICON = { go: '✅', caution: '⚠️', skip: '⏭️', danger: '⛔' } as const;

export function VerdictCard({ verdict, criteria, compact, onJump }: { verdict: Verdict; criteria: Criterion[]; compact?: boolean; onJump?: () => void }) {
  return (
    <section className={`card verdict verdict-${verdict.level} ${compact ? 'verdict-compact' : ''}`}>
      <div className="verdict-head">
        <span className="verdict-icon">{VERDICT_ICON[verdict.level]}</span>
        <div>
          <div className="verdict-title">{verdict.title}</div>
          {!compact && <div className="small">{verdict.text}</div>}
        </div>
      </div>
      <div className="dots">
        {criteria.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`dot-item dot-${c.status}`}
            onClick={() => document.getElementById(`step-${STEP_OF[i]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span className={`dot dot-${c.status}`} />
            <span className="dot-label">{c.title}</span>
          </button>
        ))}
      </div>
      {compact && onJump && (
        <button className="btn btn-primary btn-block" onClick={onJump}>
          {verdict.level === 'go' ? 'Перейти к покупке ↓' : 'Итог и покупка ↓'}
        </button>
      )}
    </section>
  );
}
