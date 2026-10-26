// Side-by-side comparison of two texts, aligned paragraph by paragraph.

import { useEffect, useMemo, useRef, useState } from 'react';
import { compareTexts, type DiffRow, type DiffSegment } from '../../shared/diff';
import { formatCount } from '../ui';

function Segments({ segments }: { segments: DiffSegment[] | null }) {
  if (!segments) return <span className="placeholder">— not present —</span>;
  return (
    <>
      {segments.map((s, i) => (
        <span key={i} className={s.type === 'same' ? undefined : s.type}>
          {s.text}
        </span>
      ))}
    </>
  );
}

type Item = { row: DiffRow; index: number } | { gap: number; from: number };

export function DiffView({ left, right, leftLabel, rightLabel }: { left: string; right: string; leftLabel: string; rightLabel: string }) {
  const result = useMemo(() => compareTexts(left, right), [left, right]);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(-1);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(new Set());
    setCurrent(-1);
  }, [left, right]);

  const changeIndexes = useMemo(() => result.rows.flatMap((r, i) => (r.kind === 'same' ? [] : [i])), [result]);

  const items = useMemo(() => {
    const out: Item[] = [];
    const rows = result.rows;
    for (let i = 0; i < rows.length; i++) {
      if (!onlyChanges || rows[i].kind !== 'same') {
        out.push({ row: rows[i], index: i });
        continue;
      }
      // Collapse runs of unchanged paragraphs, keeping one of context either side.
      let j = i;
      while (j < rows.length && rows[j].kind === 'same') j++;
      const run = j - i;
      const keepBefore = i > 0 ? 1 : 0;
      const keepAfter = j < rows.length ? 1 : 0;
      if (run <= keepBefore + keepAfter + 1 || expanded.has(i)) {
        for (let k = i; k < j; k++) out.push({ row: rows[k], index: k });
      } else {
        if (keepBefore) out.push({ row: rows[i], index: i });
        out.push({ gap: run - keepBefore - keepAfter, from: i });
        if (keepAfter) out.push({ row: rows[j - 1], index: j - 1 });
      }
      i = j - 1;
    }
    return out;
  }, [result, onlyChanges, expanded]);

  const goTo = (n: number) => {
    if (changeIndexes.length === 0) return;
    const next = (n + changeIndexes.length) % changeIndexes.length;
    setCurrent(next);
    container.current?.querySelector(`[data-row="${changeIndexes[next]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const { stats } = result;
  return (
    <div ref={container}>
      <div className="diff-stats" style={{ padding: '0 18px' }}>
        {result.identical ? (
          <span>The two texts are identical.</span>
        ) : (
          <>
            <span>
              <span className="ins" style={{ background: 'var(--ins-bg)', color: 'var(--ins-ink)', padding: '0 4px', borderRadius: 2 }}>
                +{formatCount(stats.wordsAdded)}
              </span>{' '}
              <span style={{ background: 'var(--del-bg)', color: 'var(--del-ink)', padding: '0 4px', borderRadius: 2 }}>−{formatCount(stats.wordsRemoved)}</span> words
            </span>
            <span>
              {stats.paragraphsChanged} changed · {stats.paragraphsAdded} added · {stats.paragraphsRemoved} removed paragraphs
            </span>
            <span className="row" style={{ marginLeft: 'auto' }}>
              <button className="btn small" onClick={() => goTo(current - 1)}>
                ↑ Previous
              </button>
              <button className="btn small" onClick={() => goTo(current + 1)}>
                Next change ↓
              </button>
              <label className="row small">
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Changes only
              </label>
            </span>
          </>
        )}
      </div>
      <div className="diff">
        <div className="diff-row" style={{ fontFamily: 'var(--sans)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          <div>{leftLabel}</div>
          <div>{rightLabel}</div>
        </div>
        {items.map((item) =>
          'gap' in item ? (
            <div key={`gap-${item.from}`} className="diff-gap">
              <button onClick={() => setExpanded(new Set([...expanded, item.from]))}>
                {item.gap} unchanged paragraph{item.gap === 1 ? '' : 's'}
              </button>
            </div>
          ) : (
            <div
              key={item.index}
              data-row={item.index}
              className={`diff-row ${item.row.kind}${changeIndexes[current] === item.index ? ' current' : ''}`}
            >
              <div>
                <Segments segments={item.row.left} />
              </div>
              <div>
                <Segments segments={item.row.right} />
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
