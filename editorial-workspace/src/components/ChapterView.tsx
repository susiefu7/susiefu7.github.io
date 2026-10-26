// The chapter workspace: read or edit the text, save, name versions, comment, approve.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanonReference, ChapterDocument, CommentCategory, EditorialComment, SearchHit } from '../../shared/types';
import { WORKING_STATUSES } from '../../shared/types';
import { countWords } from '../../shared/text';
import { ApiError, api } from '../api';
import { Modal, STATUS_LABELS, errorMessage, formatCount, formatDate, useNotify } from '../ui';
import { ApprovalDialog } from './ApprovalDialog';
import { CommentsPanel, type Composer } from './CommentsPanel';
import { ContinuityPanel } from './ContinuityPanel';
import { DiffView } from './DiffView';
import { FilePicker, type PickedFile } from './FilePicker';
import { Editor, type EditorHandle } from './Editor';
import { Reader, type ReaderSelection } from './Reader';

type Mode = 'read' | 'edit';

interface Props {
  chapterId: string;
  jump: { offset: number; nonce: number } | null;
  focus: boolean;
  onToggleFocus: () => void;
  onDoc: (doc: ChapterDocument | null) => void;
  onChaptersChanged: () => void;
  onOpenHistory: () => void;
  onOpenProposals: () => void;
  onOpenReference: (file: string, line?: number) => void;
  registerGuard: (guard: (() => Promise<boolean>) | null) => void;
}

function storedMode(): Mode {
  try {
    return localStorage.getItem('tlp.mode') === 'edit' ? 'edit' : 'read';
  } catch {
    return 'read';
  }
}

export function ChapterView(props: Props) {
  const { chapterId, onDoc, onChaptersChanged } = props;
  const notify = useNotify();
  const [doc, setDoc] = useState<ChapterDocument | null>(null);
  const [buffer, setBuffer] = useState('');
  const [mode, setModeState] = useState<Mode>(storedMode);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comments, setComments] = useState<EditorialComment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [readSel, setReadSel] = useState<ReaderSelection | null>(null);
  const [editSel, setEditSel] = useState({ start: 0, end: 0 });
  const [panel, setPanel] = useState<'notes' | 'continuity' | null>('notes');
  const [modal, setModal] = useState<'version' | 'approve' | 'recovery' | 'import' | null>(null);
  const [pendingAccept, setPendingAccept] = useState<EditorialComment | null>(null);
  const [jump, setJump] = useState<{ offset: number; nonce: number } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const editor = useRef<EditorHandle>(null);

  const dirty = doc !== null && buffer !== doc.text;

  const setMode = (m: Mode) => {
    setModeState(m);
    setReadSel(null);
    try {
      localStorage.setItem('tlp.mode', m);
    } catch {
      /* preference only */
    }
  };

  const adopt = useCallback(
    (d: ChapterDocument, opts: { replaceBuffer?: boolean } = {}) => {
      setDoc(d);
      if (opts.replaceBuffer) setBuffer(d.text);
      onDoc(d);
    },
    [onDoc],
  );

  const loadComments = useCallback(async () => {
    setComments(await api.comments(chapterId));
  }, [chapterId]);

  // Load the chapter.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setLoadError(null);
    setConflict(null);
    setComposer(null);
    setReattachId(null);
    setActiveId(null);
    setReadSel(null);
    (async () => {
      try {
        const [d, c] = await Promise.all([api.chapter(chapterId), api.comments(chapterId)]);
        if (cancelled) return;
        adopt(d, { replaceBuffer: true });
        setComments(c);
        // An empty chapter opens ready for writing (without changing the saved preference).
        if (!d.text.trim()) setModeState('edit');
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId, adopt]);

  useEffect(() => () => onDoc(null), [onDoc]);

  // Save. Resolves to the saved document, or null if nothing could be saved.
  const save = useCallback(async (): Promise<ChapterDocument | null> => {
    if (!doc) return null;
    if (buffer === doc.text) return doc;
    setSaving(true);
    try {
      const saved = await api.save(chapterId, buffer, doc.hash);
      adopt(saved);
      setConflict(null);
      await loadComments();
      onChaptersChanged();
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      notify(errorMessage(e), 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }, [doc, buffer, chapterId, adopt, loadComments, onChaptersChanged, notify]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Let the app save before navigating away.
  useEffect(() => {
    props.registerGuard(async () => (dirtyRef.current ? (await saveRef.current()) !== null : true));
    return () => props.registerGuard(null);
  }, []);

  // Recovery copy of unsaved text, every couple of seconds while typing.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      api.writeRecovery(chapterId, buffer).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
  }, [buffer, dirty, chapterId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (props.jump) setJump(props.jump);
  }, [props.jump]);

  const highlights = useMemo(
    () =>
      dirty
        ? []
        : comments
            .filter((c) => (c.status === 'open' || c.status === 'deferred') && c.anchorState !== 'detached' && c.anchor.end > c.anchor.start)
            .map((c) => ({ id: c.id, start: c.anchor.start, end: c.anchor.end })),
    [comments, dirty],
  );

  const currentSelection = (): { start: number; end: number } | null => {
    if (mode === 'read') return readSel ? { start: readSel.start, end: readSel.end } : null;
    const sel = editor.current?.selection() ?? editSel;
    return sel.end > sel.start ? sel : null;
  };

  const selectedText = (() => {
    const s = mode === 'read' ? readSel : editSel;
    return s && s.end > s.start ? buffer.slice(s.start, s.end).trim() : '';
  })();

  // ── Comment actions ──────────────────────────────────────────────────────

  const startComment = async () => {
    const sel = currentSelection();
    if (!sel) return;
    const saved = await save(); // offsets refer to the saved text
    if (!saved) return;
    setComposer({ start: sel.start, end: sel.end, quote: saved.text.slice(sel.start, sel.end) });
    setPanel('notes');
    setReadSel(null);
    window.getSelection()?.removeAllRanges();
  };

  const createComment = async (input: { category: CommentCategory; body: string; refs: CanonReference[]; suggestedText: string | null }) => {
    if (!composer || !doc) return false;
    setBusy(true);
    try {
      const c = await api.createComment(chapterId, { ...input, start: composer.start, end: composer.end, baseHash: doc.hash, role: 'author' });
      setComposer(null);
      await loadComments();
      setActiveId(c.id);
      onChaptersChanged();
      return true;
    } catch (e) {
      notify(errorMessage(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const withBusy = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateComment = (c: EditorialComment, patch: Record<string, unknown>) =>
    withBusy(async () => {
      await api.updateComment(chapterId, c.id, patch);
      await loadComments();
      onChaptersChanged();
    });

  const activate = (c: EditorialComment) => {
    setActiveId(c.id);
    if (c.anchorState === 'detached') return;
    if (mode === 'edit') editor.current?.select(c.anchor.start, c.anchor.end);
    else setJump({ offset: c.anchor.start, nonce: Date.now() });
  };

  const attachHere = async () => {
    const sel = currentSelection();
    if (!sel || !reattachId) return;
    const saved = await save();
    if (!saved) return;
    await withBusy(async () => {
      await api.reattach(chapterId, reattachId, sel.start, sel.end, saved.hash);
      setReattachId(null);
      setReadSel(null);
      await loadComments();
      notify('Note re-attached to the selected passage.');
    });
  };

  const acceptSuggestion = async (c: EditorialComment) => {
    const saved = await save();
    if (!saved) return;
    await withBusy(async () => {
      const r = await api.acceptSuggestion(chapterId, c.id, saved.hash);
      adopt(r.chapter, { replaceBuffer: true });
      await loadComments();
      onChaptersChanged();
      notify('Suggestion applied. The previous text is kept as a named version.');
    });
    setPendingAccept(null);
  };

  const cite = (hit: SearchHit) => {
    const c = comments.find((x) => x.id === activeId);
    if (!c) return;
    void updateComment(c, { refs: [...c.refs, { file: hit.file, layer: hit.layer, line: hit.line, excerpt: hit.snippet }] });
  };

  // ── Rendering ────────────────────────────────────────────────────────────

  if (loadError) return <div className="workspace"><div className="empty-state">{loadError}</div></div>;
  if (!doc) return <div className="workspace"><div className="empty-state">Opening chapter…</div></div>;

  const openCount = comments.filter((c) => c.status === 'open').length;
  const canComment = mode === 'read' ? readSel !== null : editSel.end > editSel.start;

  return (
    <div className="main">
      <div className="workspace">
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Mode">
            <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>
              Read
            </button>
            <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
              Edit
            </button>
          </div>
          <span className={`save-state${dirty ? ' dirty' : ''}`} aria-live="polite">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button className="btn" onClick={() => void save()} disabled={!dirty || saving} title="Save (Ctrl/⌘ S)">
            Save
          </button>
          <button className="btn ghost" onClick={() => setModal('version')}>
            Version…
          </button>
          <button className="btn ghost" onClick={props.onOpenHistory} title="Version history and side-by-side comparison">
            History
          </button>
          <button className="btn ghost" onClick={() => setModal('approve')}>
            Approve…
          </button>
          <span className="spacer" />
          {reattachId ? (
            <>
              <span className="small muted">Select the passage, then</span>
              <button className="btn primary small" disabled={!canComment || busy} onClick={attachHere}>
                Attach here
              </button>
              <button className="btn ghost small" onClick={() => setReattachId(null)}>
                Cancel
              </button>
            </>
          ) : (
            mode === 'edit' && (
              <button className="btn" disabled={!canComment} onClick={startComment} title="Comment on the selected passage">
                Comment
              </button>
            )
          )}
          <button className={`btn ghost${panel ? ' on' : ''}`} onClick={() => setPanel(panel ? null : 'notes')} aria-pressed={panel !== null}>
            Notes{openCount ? ` (${openCount})` : ''}
          </button>
          <button className={`btn ghost${props.focus ? ' on' : ''}`} onClick={props.onToggleFocus} title="Distraction-free (Esc to leave)">
            Focus
          </button>
        </div>

        {conflict && (
          <div className="banner">
            <span className="grow">{conflict}</span>
            <button
              className="btn small"
              onClick={async () => {
                await api.writeRecovery(chapterId, buffer);
                adopt(await api.chapter(chapterId), { replaceBuffer: true });
                setConflict(null);
                notify('Loaded the version on disk. Your text is offered back as recovered text.');
              }}
            >
              Load the newer version (keep mine in recovery)
            </button>
          </div>
        )}
        {doc.recovery && !dirty && !conflict && (
          <div className="banner">
            <span className="grow">
              Unsaved text from {formatDate(doc.recovery.savedAt)} was found for this chapter. It has not been applied.
            </span>
            <button className="btn small" onClick={() => setModal('recovery')}>
              Compare
            </button>
            <button className="btn small" onClick={() => setBuffer(doc.recovery!.text)}>
              Restore into editor
            </button>
            <button
              className="btn small ghost"
              onClick={async () => {
                await api.discardRecovery(chapterId);
                adopt(await api.chapter(chapterId));
                notify('Recovered text set aside in .recovery/discarded.');
              }}
            >
              Set aside
            </button>
          </div>
        )}
        {mode === 'edit' && doc.approval && (
          <div className="banner quiet">
            <span className="grow">
              Approved {formatDate(doc.approval.date, false)}. You are editing the working draft; the approved text is preserved separately and will not change.
            </span>
          </div>
        )}

        {mode === 'read' ? (
          <div className="scroller" onScroll={() => readSel && setReadSel(null)}>
            <Header doc={doc} editingTitle={editingTitle} setEditingTitle={setEditingTitle} onMeta={async (patch) => {
              await withBusy(async () => {
                adopt(await api.updateMeta(chapterId, patch));
                onChaptersChanged();
              });
            }} />
            <Reader
              text={buffer}
              highlights={highlights}
              activeId={activeId}
              jump={jump}
              onSelection={setReadSel}
              onHighlightClick={(ids) => {
                setActiveId(ids[0]);
                setPanel('notes');
                document.getElementById(`comment-${ids[0]}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }}
            />
            {readSel && (
              <div className="select-pop" style={{ left: readSel.x, top: readSel.y }}>
                {reattachId ? (
                  <button className="btn primary small" onMouseDown={(e) => e.preventDefault()} onClick={attachHere}>
                    Attach note here
                  </button>
                ) : (
                  <button className="btn primary small" onMouseDown={(e) => e.preventDefault()} onClick={startComment}>
                    Comment
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="edit-strip">
              <span>
                Chapter {doc.meta.number} · {doc.meta.title}
              </span>
              <span>{formatCount(countWords(buffer))} words</span>
              <DraftMark doc={doc} />
              {!buffer.trim() && <span className="muted">Type or paste prose below, or import a .md, .txt or .docx file.</span>}
              <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setModal('import')} title="Bring in prose from a .md, .txt or .docx file">
                Import file…
              </button>
            </div>
            <Editor ref={editor} value={buffer} onChange={setBuffer} onSelectionChange={setEditSel} jump={jump} />
          </>
        )}
      </div>

      {panel && (
        <aside className="panel" aria-label="Editorial panel">
          <div className="panel-tabs" role="tablist">
            <button className={panel === 'notes' ? 'on' : ''} onClick={() => setPanel('notes')} role="tab">
              Notes
            </button>
            <button className={panel === 'continuity' ? 'on' : ''} onClick={() => setPanel('continuity')} role="tab">
              Continuity
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setPanel(null)} aria-label="Close panel">
              ×
            </button>
          </div>
          <div className="panel-body">
            {panel === 'notes' ? (
              <>
                {dirty && comments.length > 0 && (
                  <p className="hint">Highlights are hidden while there are unsaved changes; save to re-check note positions.</p>
                )}
                <CommentsPanel
                  comments={comments}
                  activeId={activeId}
                  composer={composer}
                  busy={busy}
                  onActivate={activate}
                  onCreate={createComment}
                  onCancelComposer={() => setComposer(null)}
                  onUpdate={updateComment}
                  onReply={(c, body) =>
                    withBusy(async () => {
                      await api.reply(chapterId, c.id, body);
                      await loadComments();
                    })
                  }
                  onConfirmAnchor={(c) =>
                    void withBusy(async () => {
                      await api.confirmAnchor(chapterId, c.id);
                      await loadComments();
                    })
                  }
                  onStartReattach={(c) => {
                    setReattachId(c.id);
                    notify('Select the passage this note belongs to, then choose “Attach here”.');
                  }}
                  onAcceptSuggestion={setPendingAccept}
                  onOpenRef={(r) => props.onOpenReference(r.file, r.line)}
                />
              </>
            ) : (
              <ContinuityPanel
                doc={doc}
                selectedText={selectedText}
                activeCommentId={activeId}
                onCite={cite}
                onOpenHit={(h) => {
                  if (h.layer === 'draft') notify('That passage is in another chapter’s draft; open it from the chapter list.');
                  else props.onOpenReference(h.file, h.line);
                }}
              />
            )}
          </div>
        </aside>
      )}

      {modal === 'import' && (
        <ImportIntoChapterModal
          hasText={buffer.trim().length > 0}
          busy={busy}
          onClose={() => setModal(null)}
          onImport={async (file, how) => {
            const saved = await save();
            if (!saved) return;
            await withBusy(async () => {
              if (how === 'replace' && saved.text.trim()) {
                await api.createVersion(chapterId, `Before importing “${file.name}”`, 'Created automatically before the draft was replaced by an imported file.');
              }
              const next = how === 'append' && saved.text.trim() ? `${saved.text.replace(/\s*$/, '')}\n\n${file.markdown}` : file.markdown;
              adopt(await api.save(chapterId, next, saved.hash), { replaceBuffer: true });
              await loadComments();
              onChaptersChanged();
              setModal(null);
              notify(how === 'replace' && saved.text.trim() ? `Imported “${file.name}”. The previous draft is kept as a named version.` : `Imported “${file.name}”.`);
            });
          }}
        />
      )}
      {modal === 'version' && (
        <NameVersionModal
          dirty={dirty}
          onClose={() => setModal(null)}
          onCreate={async (name, note) => {
            const saved = await save();
            if (!saved) return;
            await withBusy(async () => {
              await api.createVersion(chapterId, name, note);
              notify(`Version “${name}” saved.`);
              setModal(null);
            });
          }}
        />
      )}
      {modal === 'approve' && (
        <ApprovalDialog
          doc={doc}
          dirty={dirty}
          ensureSaved={save}
          onApproved={(d) => {
            adopt(d, { replaceBuffer: true });
            onChaptersChanged();
          }}
          onReviewProposals={() => {
            setModal(null);
            props.onOpenProposals();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'recovery' && doc.recovery && (
        <Modal title="Recovered text" onClose={() => setModal(null)} wide>
          <p className="hint">Left: the saved chapter. Right: the unsaved text found on {formatDate(doc.recovery.savedAt)}.</p>
          <div style={{ maxHeight: '55vh', overflowY: 'auto', margin: '0 -18px' }}>
            <DiffView left={doc.text} right={doc.recovery.text} leftLabel="Saved chapter" rightLabel="Recovered text" />
          </div>
          <div className="row end">
            <button className="btn" onClick={() => setModal(null)}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setBuffer(doc.recovery!.text);
                setModal(null);
                setMode('edit');
              }}
            >
              Restore into editor
            </button>
          </div>
        </Modal>
      )}
      {pendingAccept && (
        <Modal title="Accept suggested wording?" onClose={() => setPendingAccept(null)}>
          <p>The passage will be replaced with:</p>
          <div className="suggestion">
            <div className="s-text">{pendingAccept.suggestedText}</div>
          </div>
          <p className="hint">
            The current draft is saved first as a named version
            {pendingAccept.role === 'ai' ? ' (“Before AI-assisted revision”)' : ''}, so this can be undone from History.
          </p>
          <div className="row end">
            <button className="btn" onClick={() => setPendingAccept(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={() => acceptSuggestion(pendingAccept)}>
              Snapshot and apply
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Header({
  doc,
  editingTitle,
  setEditingTitle,
  onMeta,
}: {
  doc: ChapterDocument;
  editingTitle: boolean;
  setEditingTitle: (v: boolean) => void;
  onMeta: (patch: { title?: string; status?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(doc.meta.title);
  useEffect(() => setTitle(doc.meta.title), [doc.meta.title]);
  const commitTitle = async () => {
    setEditingTitle(false);
    if (title.trim() && title.trim() !== doc.meta.title) await onMeta({ title: title.trim() });
    else setTitle(doc.meta.title);
  };
  return (
    <header className="chapter-head">
      <div className="chapter-kicker">Chapter {doc.meta.number}</div>
      {editingTitle ? (
        <input
          className="chapter-title field"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitTitle();
            if (e.key === 'Escape') {
              setTitle(doc.meta.title);
              setEditingTitle(false);
            }
          }}
        />
      ) : (
        <h1 className="chapter-title" onClick={() => setEditingTitle(true)} title="Rename chapter">
          {doc.meta.title}
        </h1>
      )}
      <div className="chapter-sub">
        <span>{formatCount(doc.wordCount)} words</span>
        <span>
          {doc.scenes.length} scene{doc.scenes.length === 1 ? '' : 's'}
        </span>
        <select value={doc.meta.status} onChange={(e) => onMeta({ status: e.target.value })} aria-label="Working status">
          {WORKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <DraftMark doc={doc} />
      </div>
    </header>
  );
}

/** Makes the chapter's standing unmistakable: a working draft is never canon. */
function DraftMark({ doc }: { doc: ChapterDocument }) {
  if (!doc.approval) return <span className="draft-mark">Working draft · not approved canon</span>;
  return (
    <span className={`status ${doc.draftMatchesApproved ? 'approved' : 'diverged'}`}>
      <span className="dot" />
      {doc.draftMatchesApproved ? `Approved ${formatDate(doc.approval.date, false)}` : 'Draft differs from approved text'}
    </span>
  );
}

function ImportIntoChapterModal({
  hasText,
  busy,
  onClose,
  onImport,
}: {
  hasText: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (file: PickedFile, how: 'replace' | 'append') => Promise<void>;
}) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [how, setHow] = useState<'replace' | 'append'>(hasText ? 'append' : 'replace');
  return (
    <Modal title="Import prose into this chapter" onClose={onClose} wide>
      <p className="hint">
        Choose a .md, .txt or .docx file. Word files are converted to Markdown, keeping paragraphs, italics, bold and headings. The file itself is not changed.
        The imported text becomes part of the working draft, not approved canon.
      </p>
      <FilePicker onPicked={setFile} />
      {hasText && (
        <>
          <label className="check">
            <input type="radio" name="how" checked={how === 'append'} onChange={() => setHow('append')} />
            <span>Add it after the current draft.</span>
          </label>
          <label className="check">
            <input type="radio" name="how" checked={how === 'replace'} onChange={() => setHow('replace')} />
            <span>Replace the current draft. The current text is kept as a named version first.</span>
          </label>
        </>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!file || !file.markdown.trim() || busy} onClick={() => file && onImport(file, how)}>
          Import
        </button>
      </div>
    </Modal>
  );
}

function NameVersionModal({ dirty, onClose, onCreate }: { dirty: boolean; onClose: () => void; onCreate: (name: string, note: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title="Name this version" onClose={onClose}>
      <p className="hint">A named version marks the chapter as it stands now, so you can return to it or compare against it later.</p>
      {dirty && <p className="anchor-flag">Unsaved changes will be saved first and included.</p>}
      <label className="lbl" htmlFor="v-name">Name</label>
      <input id="v-name" className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Second draft — before restructuring" onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate(name.trim(), note)} />
      <label className="lbl" htmlFor="v-note">Note (optional)</label>
      <textarea id="v-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), note)}>
          Save version
        </button>
      </div>
    </Modal>
  );
}
