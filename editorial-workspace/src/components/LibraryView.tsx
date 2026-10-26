// Reference library: canon, directives, ideas, historical records and archives, with
// search. Files are read-only here; they can be added (never replaced) and moved
// between layers with the author's confirmation.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, Redevelopment, ReferenceFile, SearchResult } from '../../shared/types';
import { api, type ImportReport } from '../api';
import { renderReference } from '../markdown';
import { LayerBadge, Modal, errorMessage, useNotify } from '../ui';

const GROUPS: { layer: Layer; title: string; note: string }[] = [
  { layer: 'canon', title: 'Locked canon', note: 'Imported reference documents. Read-only; changed only by confirmed proposals.' },
  { layer: 'directive', title: 'Author directives', note: 'Current instructions for the redevelopment. These outrank canon and legacy text.' },
  { layer: 'idea', title: 'Working ideas', note: 'Unapproved ideas. Not canon.' },
  { layer: 'historical', title: 'Historical reference', note: 'Chapter summaries and continuity records from before the redevelopment. Kept for reference; not binding.' },
  { layer: 'approved', title: 'Approved chapters', note: 'Frozen copies made at approval.' },
  { layer: 'superseded', title: 'Superseded approvals', note: 'Earlier approved text, replaced by a later approval.' },
  { layer: 'legacy', title: 'Legacy manuscript', note: 'Older chapter drafts from before the redevelopment. Kept for reference and comparison; they never govern the new chapters.' },
];

/** Where a file can be added or moved to, with what that means. */
const DESTINATIONS: { layer: Layer; label: string; meaning: string }[] = [
  { layer: 'canon', label: 'Locked canon', meaning: 'Project bible, canon, style guide, current continuity. Binding.' },
  { layer: 'historical', label: 'Historical reference', meaning: 'Older chapter summaries and continuity records. Reference only, not binding.' },
  { layer: 'legacy', label: 'Legacy manuscript', meaning: 'Older chapter drafts. Never govern the redeveloped chapters.' },
  { layer: 'directive', label: 'Author directives', meaning: 'Current instructions for the redevelopment. Outrank older material.' },
  { layer: 'idea', label: 'Working ideas', meaning: 'Unapproved ideas. Not canon.' },
];
const MOVABLE = new Set<Layer>(DESTINATIONS.map((d) => d.layer));

const LAYER_EXPLAIN: Partial<Record<Layer, string>> = {
  canon: 'Locked canon. This file is read-only in the workspace.',
  directive: 'Author directive. Where it conflicts with older material, this governs.',
  idea: 'Working idea — not canon. Nothing here is established.',
  historical: 'Historical reference — recorded before the redevelopment. Useful context, not binding.',
  approved: 'Approved manuscript text (frozen copy).',
  superseded: 'Superseded — an earlier approval replaced by a later one.',
  legacy: 'Legacy manuscript — an older draft from the earlier development. Does not govern the redeveloped chapters.',
};

interface Props {
  redevelopment: Redevelopment | null;
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

export function LibraryView({ redevelopment, file, line, query, onOpen, onOpenChapter }: Props) {
  const notify = useNotify();
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [content, setContent] = useState<{ path: string; layer: Layer; content: string; converted: boolean; warnings: string[] } | null>(null);
  const [dialog, setDialog] = useState<'add' | 'move' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(query ?? '');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [layerFilter, setLayerFilter] = useState<'all' | Layer | 'draft'>('all');
  const body = useRef<HTMLDivElement>(null);

  const loadFiles = useCallback(() => api.referenceFiles().then(setFiles, (e) => setError(errorMessage(e))), []);
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn" onClick={() => setDialog('add')}>
              Add files…
            </button>
          </div>
          {redevelopment?.active && <div className="redev-note">{redevelopment.note}</div>}
          {GROUPS.map((g) => {
            const list = files.filter((f) => f.layer === g.layer);
            if (list.length === 0 && g.layer !== 'canon') return null;
            return (
              <div key={g.layer} className="layer-group">
                <h4>
                  <LayerBadge layer={g.layer} short />
                </h4>
                <div className="layer-note">{g.note}</div>
                {list.length === 0 && <div className="layer-note">No files yet — use “Add files…”.</div>}
                {list.map((f) => (
                  <button key={f.path} className={`file-item${file === f.path ? ' active' : ''}`} onClick={() => onOpen(f.path)} title={f.path}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path.split('/').slice(g.layer === 'superseded' || g.layer === 'legacy' ? 2 : 1).join('/')}</span>
                    {f.integrity === 'changed' && (
                      <span className="integrity changed" title="This file differs from the version recorded at import">
                        changed
                      </span>
                    )}
                    {f.converted && <span className="integrity" title="Word file: shown and searched through a read-only conversion">Word</span>}
                    {!f.searchable && <span className="integrity" title="Stored, but the workspace can only display .md, .txt and .docx files">not readable</span>}
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
              <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search everything — a name, a place, or "an exact phrase"' aria-label="Search references" />
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
                <LayerBadge layer={content.layer} short />
                <span>
                  {LAYER_EXPLAIN[content.layer]}
                  {redevelopment?.active && (content.layer === 'historical' || content.layer === 'legacy') && (
                    <span className="block mt">The novel is being redeveloped; where this differs from the directives, canon or new chapters, it no longer applies.</span>
                  )}
                </span>
              </div>
              {content.converted && (
                <div className="hint" style={{ fontFamily: 'var(--sans)', marginBottom: 12 }}>
                  Converted from Word for reading. The original .docx is stored unchanged.
                  {content.warnings.length > 0 && ` ${content.warnings.join(' ')}`}
                </div>
              )}
              <div className="small muted row" style={{ fontFamily: 'var(--sans)', marginBottom: 14 }}>
                {content.path}
                {MOVABLE.has(content.layer) && (
                  <button className="btn ghost small" onClick={() => setDialog('move')}>
                    Move to…
                  </button>
                )}
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
              {files.length === 0
                ? 'The reference library is empty. Use “Add files…” to bring in the project bible, canon, style guide and continuity files, older chapter summaries, and older drafts.'
                : 'The reference library holds the canon, the author’s directives, working ideas, historical records and the archives. Choose a file, or search across all of them.'}
            </div>
          )}
        </div>
      </div>
      {dialog === 'add' && (
        <AddFilesModal
          onClose={() => setDialog(null)}
          onDone={async () => {
            await loadFiles();
          }}
        />
      )}
      {dialog === 'move' && content && (
        <MoveFileModal
          path={content.path}
          from={content.layer}
          onClose={() => setDialog(null)}
          onMoved={async (moved) => {
            setDialog(null);
            await loadFiles();
            notify(`Moved to ${moved.path}.`);
            onOpen(moved.path);
          }}
        />
      )}
    </div>
  );
}

function AddFilesModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [layer, setLayer] = useState<Layer>('canon');
  const [selected, setSelected] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ name: string; outcome: string; ok: boolean }[]>([]);

  const upload = async () => {
    setBusy(true);
    const entries: typeof log = [];
    for (const f of selected) {
      try {
        const report: ImportReport = await api.uploadReference(layer, f.name, await f.arrayBuffer());
        entries.push(
          report.copied.length
            ? { name: f.name, outcome: `added as ${report.copied[0]}`, ok: true }
            : { name: f.name, outcome: 'already in the library (identical) — skipped', ok: true },
        );
      } catch (e) {
        entries.push({ name: f.name, outcome: errorMessage(e), ok: false });
      }
      setLog([...entries]);
    }
    await onDone();
    setSelected([]);
    setBusy(false);
  };

  return (
    <Modal title="Add files to the reference library" onClose={onClose} wide>
      <p className="hint">
        Files are stored exactly as they are and are never altered. A file with the same name but different contents is refused rather than replaced. .md,
        .txt and .docx files can be read and searched; other files are stored only.
      </p>
      <label className="lbl">These files are…</label>
      {DESTINATIONS.map((d) => (
        <label key={d.layer} className="check" style={{ margin: '6px 0' }}>
          <input type="radio" name="dest" checked={layer === d.layer} onChange={() => setLayer(d.layer)} />
          <span>
            <strong>{d.label}</strong> — {d.meaning}
          </span>
        </label>
      ))}
      <label className="lbl">Files</label>
      <input className="field" type="file" multiple onChange={(e) => setSelected([...(e.target.files ?? [])])} aria-label="Files to add" />
      {log.length > 0 && (
        <div className="preview mt" style={{ fontFamily: 'var(--sans)', fontSize: 12.5 }}>
          {log.map((l) => (
            <div key={l.name} style={{ color: l.ok ? undefined : 'var(--del-ink)' }}>
              {l.ok ? '✓' : '✗'} {l.name}: {l.outcome}
            </div>
          ))}
        </div>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          {log.length ? 'Done' : 'Cancel'}
        </button>
        <button className="btn primary" disabled={!selected.length || busy} onClick={upload}>
          {busy ? 'Adding…' : `Add ${selected.length || ''} file${selected.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}

function MoveFileModal({ path, from, onClose, onMoved }: { path: string; from: Layer; onClose: () => void; onMoved: (r: { path: string }) => Promise<void> }) {
  const notify = useNotify();
  const options = DESTINATIONS.filter((d) => d.layer !== from);
  const [to, setTo] = useState<Layer>(options[0].layer);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const consequence =
    to === 'canon'
      ? 'This file will become locked canon.'
      : from === 'canon'
        ? 'This file will no longer count as canon.'
        : 'This changes how the file is labelled and weighed.';
  return (
    <Modal title="Move to another layer" onClose={onClose}>
      <p className="hint">
        <code>{path}</code> keeps its exact contents and history; only its classification changes. Editorial notes that cite it follow it.
      </p>
      {options.map((d) => (
        <label key={d.layer} className="check" style={{ margin: '6px 0' }}>
          <input type="radio" name="to" checked={to === d.layer} onChange={() => (setTo(d.layer), setConfirmed(false))} />
          <span>
            <strong>{d.label}</strong> — {d.meaning}
          </span>
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{consequence} I confirm this decision.</span>
      </label>
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!confirmed || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onMoved(await api.moveReference(path, to));
            } catch (e) {
              notify(errorMessage(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Move file
        </button>
      </div>
    </Modal>
  );
}
