// Continuity side panel: approval record and quick look-ups in the reference library.

import { useEffect, useState } from 'react';
import type { ApprovalRecord, ChapterDocument, SearchHit, SearchResult } from '../../shared/types';
import { api } from '../api';
import { LayerBadge, errorMessage, formatCount, formatDate } from '../ui';

interface Props {
  doc: ChapterDocument;
  selectedText: string;
  activeCommentId: string | null;
  onCite: (hit: SearchHit) => void;
  onOpenHit: (hit: SearchHit) => void;
}

export function ContinuityPanel({ doc, selectedText, activeCommentId, onCite, onOpenHit }: Props) {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.approvals(doc.meta.id).then(setApprovals, () => setApprovals([]));
  }, [doc.meta.id, doc.approval?.id]);

  const run = async (query = q) => {
    setError(null);
    try {
      setResult(await api.search(query));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const hits = result?.hits.filter((h) => !(h.layer === 'draft' && h.file.includes(`/${doc.meta.id}/`))) ?? [];

  return (
    <>
      <h4 className="nav-label" style={{ padding: 0 }}>Look up in references</h4>
      <div className="searchbar">
        <input
          className="field"
          value={q}
          placeholder="Character, place, event…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button className="btn small" onClick={() => run()} disabled={q.trim().length < 2}>
          Search
        </button>
      </div>
      {selectedText && selectedText.length < 80 && (
        <button
          className="btn ghost small mt"
          onClick={() => {
            setQ(selectedText);
            run(selectedText);
          }}
        >
          Look up “{selectedText.slice(0, 40)}”
        </button>
      )}
      {error && <p className="hint">{error}</p>}
      {result && hits.length === 0 && (
        <div className="not-found small">
          Nothing in the reference library or other chapters mentions “{result.query}”. This is <strong>not established</strong> in canon.
          {result.unsearchable.length > 0 && <> ({result.unsearchable.length} non-text file(s) could not be searched.)</>}
        </div>
      )}
      {hits.slice(0, 30).map((h) => (
        <div key={`${h.file}:${h.line}`} className="ref" style={{ cursor: 'default' }}>
          <span className="row">
            <LayerBadge layer={h.layer} short />
            <span className="muted">
              {h.file.split('/').pop()} · {h.line}
            </span>
          </span>
          <span className="ex">{h.snippet}</span>
          <span className="row mt">
            <button className="btn ghost small" onClick={() => onOpenHit(h)}>
              Open
            </button>
            {activeCommentId && h.layer !== 'draft' && (
              <button className="btn ghost small" onClick={() => onCite(h)}>
                Cite in selected note
              </button>
            )}
          </span>
        </div>
      ))}

      <h4 className="nav-label mt" style={{ padding: 0, marginTop: 24 }}>Approval record</h4>
      {approvals.length === 0 ? (
        <p className="hint">Not yet approved. Approval freezes a copy of the draft; it is always an explicit author decision.</p>
      ) : (
        [...approvals].reverse().map((a, i) => (
          <div key={a.id} className="card small">
            <div className="row">
              <strong>{i === 0 ? 'Current approval' : 'Earlier approval'}</strong>
              <span className="muted">{formatDate(a.date)}</span>
            </div>
            <div className="muted">
              {formatCount(a.wordCount)} words · commit {a.commit.slice(0, 7)}
            </div>
            {a.note && <div className="mt">{a.note}</div>}
            {a.supersededFile && <div className="muted mt">Replaced approval archived at {a.supersededFile}</div>}
          </div>
        ))
      )}
      {doc.draftMatchesApproved === false && (
        <p className="hint">The working draft now differs from the approved text. The approved text is unchanged.</p>
      )}
    </>
  );
}
