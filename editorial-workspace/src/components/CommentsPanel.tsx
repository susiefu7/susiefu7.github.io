// Editorial notes for the open chapter.

import { useMemo, useState } from 'react';
import type { CanonReference, CommentCategory, CommentStatus, EditorialComment } from '../../shared/types';
import { COMMENT_CATEGORIES, COMMENT_STATUSES } from '../../shared/types';
import { LayerBadge, formatDate } from '../ui';
import { ReferencePicker } from './ReferencePicker';

export interface Composer {
  start: number;
  end: number;
  quote: string;
}

interface Props {
  comments: EditorialComment[];
  activeId: string | null;
  composer: Composer | null;
  busy: boolean;
  onActivate: (c: EditorialComment) => void;
  onCreate: (input: { category: CommentCategory; body: string; refs: CanonReference[]; suggestedText: string | null }) => Promise<boolean>;
  onCancelComposer: () => void;
  onUpdate: (c: EditorialComment, patch: Record<string, unknown>) => Promise<void>;
  onReply: (c: EditorialComment, body: string) => Promise<void>;
  onConfirmAnchor: (c: EditorialComment) => void;
  onStartReattach: (c: EditorialComment) => void;
  onAcceptSuggestion: (c: EditorialComment) => void;
  onOpenRef: (ref: CanonReference) => void;
}

const ANCHOR_TEXT: Record<string, string> = {
  relocated: 'The passage moved during revision; this note followed it.',
  uncertain: 'The passage was edited since this note was written, so its position is uncertain. Check it still applies.',
  detached: 'The original passage can no longer be found in the draft. The quote above is what it referred to.',
};

const DECISION_FOR: Record<CommentStatus, 'accepted' | 'rejected' | 'deferred' | 'resolved' | null> = {
  open: null,
  resolved: 'resolved',
  rejected: 'rejected',
  deferred: 'deferred',
};

export function CommentsPanel(props: Props) {
  const { comments, composer } = props;
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | CommentStatus>('open');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CommentCategory>('all');

  const visible = useMemo(
    () =>
      comments
        .filter((c) => (statusFilter === 'all' ? true : statusFilter === 'open' ? c.status === 'open' : c.status === statusFilter))
        .filter((c) => categoryFilter === 'all' || c.category === categoryFilter)
        .sort((a, b) => a.anchor.start - b.anchor.start),
    [comments, statusFilter, categoryFilter],
  );
  const flagged = comments.filter((c) => c.status === 'open' && (c.anchorState === 'uncertain' || c.anchorState === 'detached')).length;

  return (
    <>
      {composer && <NewComment {...props} composer={composer} />}
      <div className="filters">
        <select className="field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as never)} aria-label="Filter by status">
          <option value="open">Open</option>
          <option value="all">All notes</option>
          {COMMENT_STATUSES.filter((s) => s !== 'open').map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </select>
        <select className="field" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as never)} aria-label="Filter by type">
          <option value="all">All types</option>
          {COMMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {cap(c)}
            </option>
          ))}
        </select>
      </div>
      {flagged > 0 && (
        <p className="anchor-flag">
          {flagged} open note{flagged === 1 ? '' : 's'} need{flagged === 1 ? 's' : ''} checking: the passage changed after the note was written.
        </p>
      )}
      {visible.length === 0 && !composer && (
        <p className="hint">
          {comments.length === 0
            ? 'No editorial notes yet. Select a passage in the text and choose “Comment”.'
            : 'No notes match these filters.'}
        </p>
      )}
      {visible.map((c) => (
        <CommentCard key={c.id} comment={c} {...props} />
      ))}
    </>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ');
}

function NewComment({ composer, busy, onCreate, onCancelComposer }: Props & { composer: Composer }) {
  const [category, setCategory] = useState<CommentCategory>('developmental');
  const [body, setBody] = useState('');
  const [refs, setRefs] = useState<CanonReference[]>([]);
  const [suggest, setSuggest] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  return (
    <div className="card active">
      <div className="card-head">
        <span className="cat">New note</span>
      </div>
      <div className="quote">{composer.quote}</div>
      <label className="lbl" htmlFor="new-cat">Type</label>
      <select id="new-cat" className="field" value={category} onChange={(e) => setCategory(e.target.value as CommentCategory)}>
        {COMMENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {cap(c)}
          </option>
        ))}
      </select>
      <label className="lbl" htmlFor="new-body">Note</label>
      <textarea id="new-body" className="field" autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should be considered here?" />
      {suggest !== null ? (
        <>
          <label className="lbl" htmlFor="new-suggest">Suggested replacement (applied only if accepted)</label>
          <textarea id="new-suggest" className="field" value={suggest} onChange={(e) => setSuggest(e.target.value)} style={{ fontFamily: 'var(--serif)' }} />
        </>
      ) : null}
      {refs.map((r, i) => (
        <div key={i} className="ref">
          <span className="row">
            <LayerBadge layer={r.layer} short /> <span className="muted">{r.file.split('/').pop()} · line {r.line}</span>
            <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setRefs(refs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </span>
          <span className="ex">{r.excerpt}</span>
        </div>
      ))}
      {picking && (
        <ReferencePicker
          onPick={(r) => {
            setRefs([...refs, r]);
            setPicking(false);
          }}
        />
      )}
      <div className="row mt">
        <button className="btn ghost small" onClick={() => setPicking(!picking)}>
          {picking ? 'Close search' : 'Cite reference'}
        </button>
        {suggest === null && (
          <button className="btn ghost small" onClick={() => setSuggest(composer.quote)}>
            Suggest wording
          </button>
        )}
      </div>
      <div className="row end mt">
        <button className="btn" onClick={onCancelComposer}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!body.trim() || busy}
          onClick={async () => {
            const ok = await onCreate({ category, body, refs, suggestedText: suggest !== null && suggest !== composer.quote ? suggest : null });
            if (ok) setBody('');
          }}
        >
          Add note
        </button>
      </div>
    </div>
  );
}

function CommentCard({
  comment: c,
  activeId,
  busy,
  onActivate,
  onUpdate,
  onReply,
  onConfirmAnchor,
  onStartReattach,
  onAcceptSuggestion,
  onOpenRef,
}: Props & { comment: EditorialComment }) {
  const [reply, setReply] = useState('');
  const [deciding, setDeciding] = useState<CommentStatus | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [picking, setPicking] = useState(false);
  const active = activeId === c.id;
  const closed = c.status !== 'open';
  const quoteChanged = c.anchor.exact !== c.originalQuote;

  return (
    <div className={`card${active ? ' active' : ''}${closed ? ' closed' : ''}`} id={`comment-${c.id}`} onClick={() => !active && onActivate(c)}>
      <div className="card-head">
        <span className="cat">{c.category}</span>
        <span>· {cap(c.status)}</span>
        {c.role === 'ai' && <LayerBadge layer="suggestion" short />}
        <span className="who" title={formatDate(c.createdAt)}>
          {c.by} · {formatDate(c.createdAt, false)}
        </span>
      </div>
      <div
        className={`quote${c.anchorState === 'detached' ? ' lost' : ''}`}
        title="Show in text"
        onClick={(e) => {
          e.stopPropagation();
          onActivate(c);
        }}
      >
        {c.originalQuote}
      </div>
      {quoteChanged && c.anchorState !== 'detached' && active && (
        <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
          Now reads: <span style={{ fontFamily: 'var(--serif)' }}>“{c.anchor.exact.slice(0, 220)}”</span>
        </div>
      )}
      {c.anchorState !== 'anchored' && (
        <div className="anchor-flag">
          {ANCHOR_TEXT[c.anchorState]}
          {active && (
            <div className="row mt">
              {c.anchorState !== 'detached' && (
                <button className="btn small" disabled={busy} onClick={() => onConfirmAnchor(c)}>
                  Position is right
                </button>
              )}
              <button className="btn small" disabled={busy} onClick={() => onStartReattach(c)}>
                Re-attach to a selection…
              </button>
            </div>
          )}
        </div>
      )}
      <div className="card-body">{c.body}</div>
      {c.reasoning && (
        <div className="hint mt">
          <strong>Reasoning:</strong> {c.reasoning}
        </div>
      )}
      {c.suggestedText !== null && (
        <div className="suggestion">
          <div className="s-label">Suggested wording · not applied</div>
          <div className="s-text">{c.suggestedText}</div>
          {active && c.status === 'open' && (
            <div className="row end">
              <button className="btn small" disabled={busy || c.anchorState === 'uncertain' || c.anchorState === 'detached'} onClick={() => onAcceptSuggestion(c)}>
                Accept into draft…
              </button>
            </div>
          )}
        </div>
      )}
      {c.refs.map((r, i) => (
        <button key={i} className="ref" onClick={(e) => (e.stopPropagation(), onOpenRef(r))}>
          <span className="row">
            <LayerBadge layer={r.layer} short /> <span className="muted">{r.file.split('/').pop()} · line {r.line}</span>
          </span>
          <span className="ex">{r.excerpt}</span>
        </button>
      ))}
      {c.replies.map((r) => (
        <div key={r.id} className="reply">
          <div className="who">
            {r.by} · {formatDate(r.createdAt)}
          </div>
          <div className="card-body">{r.body}</div>
        </div>
      ))}
      {c.decision && (
        <div className="decision">
          <strong>Author decision — {c.decision.decision}</strong> · {formatDate(c.decision.date, false)}
          {c.decision.note && <div className="card-body">{c.decision.note}</div>}
        </div>
      )}

      {active && (
        <div className="mt">
          {picking && (
            <ReferencePicker
              onPick={async (r) => {
                await onUpdate(c, { refs: [...c.refs, r] });
                setPicking(false);
              }}
            />
          )}
          <textarea className="field mt" placeholder="Reply, or record a disagreement…" value={reply} onChange={(e) => setReply(e.target.value)} style={{ minHeight: 50 }} />
          <div className="row mt">
            <button className="btn ghost small" onClick={() => setPicking(!picking)}>
              {picking ? 'Close search' : 'Cite reference'}
            </button>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className="btn small"
              disabled={!reply.trim() || busy}
              onClick={async () => {
                await onReply(c, reply);
                setReply('');
              }}
            >
              Reply
            </button>
          </div>
          {deciding ? (
            <div className="mt">
              <label className="lbl">Author decision: {cap(deciding)} — note (optional)</label>
              <textarea className="field" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} style={{ minHeight: 50 }} />
              <div className="row end mt">
                <button className="btn small" onClick={() => setDeciding(null)}>
                  Cancel
                </button>
                <button
                  className="btn primary small"
                  disabled={busy}
                  onClick={async () => {
                    const decision = DECISION_FOR[deciding];
                    await onUpdate(c, { status: deciding, decision: decision ? { decision, note: decisionNote } : null });
                    setDeciding(null);
                    setDecisionNote('');
                  }}
                >
                  Record decision
                </button>
              </div>
            </div>
          ) : (
            <div className="row mt">
              {c.status === 'open' ? (
                <>
                  <button className="btn small" onClick={() => setDeciding('resolved')}>
                    Resolve
                  </button>
                  <button className="btn small" onClick={() => setDeciding('rejected')}>
                    Reject
                  </button>
                  <button className="btn small" onClick={() => setDeciding('deferred')}>
                    Defer
                  </button>
                </>
              ) : (
                <button className="btn small" disabled={busy} onClick={() => onUpdate(c, { status: 'open' })}>
                  Reopen
                </button>
              )}
              <select
                className="field"
                style={{ width: 'auto', marginLeft: 'auto', fontSize: 12, padding: '3px 6px' }}
                value={c.category}
                aria-label="Change type"
                onChange={(e) => onUpdate(c, { category: e.target.value })}
              >
                {COMMENT_CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {cap(k)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
