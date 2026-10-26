// Search the reference library and pick a passage to cite in an editorial note.

import { useState } from 'react';
import type { CanonReference, SearchResult } from '../../shared/types';
import { api } from '../api';
import { LayerBadge, errorMessage } from '../ui';

export function ReferencePicker({ onPick, initialQuery = '' }: { onPick: (ref: CanonReference) => void; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      setResult(await api.search(q, ['canon', 'directive', 'approved', 'idea', 'legacy', 'superseded']));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="mt">
      <div className="searchbar">
        <input
          className="field"
          placeholder="Search canon & references…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), run())}
        />
        <button className="btn small" type="button" onClick={run} disabled={q.trim().length < 2}>
          Search
        </button>
      </div>
      {error && <p className="hint">{error}</p>}
      {result && result.hits.length === 0 && (
        <p className="hint">
          Nothing in the reference files mentions “{result.query}”. It is not established in canon.
        </p>
      )}
      {result?.hits.slice(0, 12).map((h) => (
        <button
          key={`${h.file}:${h.line}`}
          type="button"
          className="ref"
          onClick={() => onPick({ file: h.file, layer: h.layer, line: h.line, excerpt: h.snippet })}
        >
          <span className="row">
            <LayerBadge layer={h.layer} short />
            <span className="muted">
              {h.file.split('/').pop()} · line {h.line}
            </span>
          </span>
          <span className="ex">{h.snippet}</span>
        </button>
      ))}
    </div>
  );
}
