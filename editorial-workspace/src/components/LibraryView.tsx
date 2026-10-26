// Read-only reference library: canon, directives, ideas and archives, with search.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, ReferenceFile, SearchResult } from '../../shared/types';
import { api } from '../api';
import { renderReference } from '../markdown';
import { LayerBadge, errorMessage } from '../ui';

const GROUPS: { layer: Layer; title: string; note: string }[] = [
  { layer: 'canon', title: 'Locked canon', note: 'Imported reference documents. Read-only; changed only by confirmed proposals.' },
  { layer: 'directive', title: 'Author directives', note: 'Current instructions for the redevelopment. These outrank canon and legacy text.' },
  { layer: 'idea', title: 'Working ideas', note: 'Unapproved ideas. Not canon.' },
  { layer: 'approved', title: 'Approved chapters', note: 'Frozen copies made at approval.' },
  { layer: 'superseded', title: 'Superseded approvals', note: 'Earlier approved text, replaced by a later approval.' },
  { layer: 'legacy', title: 'Legacy archive', note: 'Chapters approved in the earlier development. Kept for reference; they do not govern the redeveloped draft.' },
];

const LAYER_EXPLAIN: Partial<Record<Layer, string>> = {
  canon: 'Locked canon. This file is read-only in the workspace.',
  directive: 'Author directive. Where it conflicts with older material, this governs.',
  idea: 'Working idea — not canon. Nothing here is established.',
  approved: 'Approved manuscript text (frozen copy).',
  superseded: 'Superseded — an earlier approval replaced by a later one.',
  legacy: 'Legacy archive — from the earlier development. Does not govern the redeveloped chapters.',
};

interface Props {
  file: string | null;
  line: number | null;
  query: string | null;
  onOpen: (file: string | null, line?: number, query?: string) => void;
  onOpenChapter: (chapterId: string) => void;
}

function highlight(snippet: string, query: string) {
  const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).toLowerCase()).filter(Boolean);
  if (!terms.length) return snippet;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return snippet.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function LibraryView({ file, line, query, onOpen, onOpenChapter }: Props) {
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [content, setContent] = useState<{ path: string; layer: Layer; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(query ?? '');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [layerFilter, setLayerFilter] = useState<'all' | Layer | 'draft'>('all');
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.referenceFiles().then(setFiles, (e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    setError(null);
    if (!file) {
      setContent(null);
      return;
    }
    api.referenceFile(file).then(setContent, (e) => {
      setContent(null);
      setError(errorMessage(e));
    });
  }, [file]);

  useEffect(() => {
    if (!query) {
      setResult(null);
      return;
    }
    setQ(query);
    api.search(query).then(setResult, (e) => setError(errorMessage(e)));
  }, [query]);

  const blocks = useMemo(() => (content ? renderReference(content.content) : []), [content]);

  // Scroll to a cited line.
  useEffect(() => {
    if (!line || !body.current || !blocks.length) return;
    let target: Element | null = null;
    for (const el of body.current.querySelectorAll<HTMLElement>('[data-line]')) {
      if (Number(el.dataset.line) <= line) target = el;
      else break;
    }
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.remove('flash');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('flash');
    }
  }, [line, blocks]);

  const hits = result?.hits.filter((h) => layerFilter === 'all' || h.layer === layerFilter) ?? [];
  const layersInResult = [...new Set(result?.hits.map((h) => h.layer) ?? [])];

  return (
    <div className="workspace">
      <div className="library">
        <nav className="library-files" aria-label="Reference files">
          {GROUPS.map((g) => {
            const list = files.filter((f) => f.layer === g.layer);
            if (list.length === 0 && g.layer !== 'canon') return null;
            return (
              <div key={g.layer} className="layer-group">
                <h4>
                  <LayerBadge layer={g.layer} short />
                </h4>
                <div className="layer-note">{g.note}</div>
                {list.length === 0 && <div className="layer-note">No files yet. See “Importing your reference files” in the README.</div>}
                {list.map((f) => (
                  <button key={f.path} className={`file-item${file === f.path ? ' active' : ''}`} onClick={() => onOpen(f.path)} title={f.path}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path.split('/').slice(g.layer === 'superseded' ? 2 : 1).join('/')}</span>
                    {f.integrity === 'changed' && (
                      <span className="integrity changed" title="This file differs from the version recorded at import">
                        changed
                      </span>
                    )}
                    {!f.searchable && <span className="integrity" title="Stored, but not a text file the workspace can display or search">not text</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="doc">
          <div className="doc-head">
            <form
              className="searchbar"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim().length >= 2) onOpen(null, undefined, q.trim());
              }}
            >
              <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search everything — e.g. Tomas, "harbour wall", logbook storm' aria-label="Search references" />
              <button className="btn" type="submit" disabled={q.trim().length < 2}>
                Search
              </button>
            </form>
          </div>

          {error && <p className="banner">{error}</p>}

          {result && !file ? (
            <div className="hits">
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted small">
                  {result.hits.length} result{result.hits.length === 1 ? '' : 's'} for “{result.query}” across {result.filesSearched} files
                </span>
                {layersInResult.length > 1 && (
                  <select className="field" style={{ width: 'auto', marginLeft: 'auto', fontSize: 12, padding: '3px 6px' }} value={layerFilter} onChange={(e) => setLayerFilter(e.target.value as never)}>
                    <option value="all">All layers</option>
                    {layersInResult.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {result.hits.length === 0 && (
                <div className="not-found">
                  <strong>No reference found.</strong> Nothing in canon, directives, working ideas, approved or legacy text, or the chapter drafts mentions “{result.query}”.
                  That means it is <em>not established</em> — it should be treated as undecided, not inferred.
                  {result.unsearchable.length > 0 && (
                    <div className="small mt">
                      {result.unsearchable.length} stored file(s) are not plain text and could not be searched: {result.unsearchable.join(', ')}.
                    </div>
                  )}
                </div>
              )}
              {hits.map((h) => (
                <button
                  key={`${h.file}:${h.line}`}
                  className="hit"
                  onClick={() => {
                    if (h.layer === 'draft') onOpenChapter(h.file.split('/')[2]);
                    else onOpen(h.file, h.line, result.query);
                  }}
                >
                  <span className="hit-file">
                    <LayerBadge layer={h.layer} short />
                    <span>{h.file}</span>
                    <span>· line {h.line}</span>
                    {h.heading && !h.inHeading && <span>· {h.heading}</span>}
                  </span>
                  <div className="hit-snippet">{highlight(h.snippet, result.query)}</div>
                </button>
              ))}
            </div>
          ) : content ? (
            <div className="doc-body" ref={body}>
              <div className="layer-banner">
                <LayerBadge layer={content.layer} />
                <span>{LAYER_EXPLAIN[content.layer]}</span>
              </div>
              <div className="small muted" style={{ fontFamily: 'var(--sans)', marginBottom: 14 }}>
                {content.path}
                {result && (
                  <>
                    {' · '}
                    <button className="btn ghost small" onClick={() => onOpen(null, undefined, result.query)}>
                      ← Back to results
                    </button>
                  </>
                )}
              </div>
              {blocks.map((b, i) => (
                <div key={i} className="doc-block" data-line={b.line} dangerouslySetInnerHTML={{ __html: b.html }} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              The reference library holds the canon, the author’s directives, working ideas and the archives. Choose a file, or search across all of them.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
