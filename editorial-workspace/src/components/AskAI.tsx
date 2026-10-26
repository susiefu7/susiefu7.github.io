// Ask Claude.ai, ChatGPT or another assistant by copy and paste: copy a request that
// carries the chapter, the canon and the reply format; paste the reply back as notes.

import { useEffect, useMemo, useState } from 'react';
import { parseAiReply } from '../../shared/aiReply';
import { describeMiss, findQuote } from '../../shared/quote';
import type { ChapterDocument, CommentCategory } from '../../shared/types';
import { AI_TASKS, buildAiRequest, type AiTask, type ReferenceText } from '../aiPrompt';
import { api } from '../api';
import { Modal, errorMessage, formatCount } from '../ui';

export interface Range {
  start: number;
  end: number;
}

export interface NoteToAdd extends Range {
  category: CommentCategory;
  body: string;
  reasoning: string | null;
  suggestedText: string | null;
  by: string;
}

export function AskAIModal({ doc, selection, onClose }: { doc: ChapterDocument; selection: Range | null; onClose: () => void }) {
  const passage = selection ? doc.text.slice(selection.start, selection.end) : null;
  const [task, setTask] = useState<AiTask>(passage ? 'review' : 'continuity');
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<{ copied: boolean; text: string; omitted: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setBusy(true);
    setError(null);
    try {
      const [project, files] = await Promise.all([api.project(), api.referenceFiles()]);
      const references: ReferenceText[] = [];
      for (const f of files.filter((f) => (f.layer === 'canon' || f.layer === 'directive') && f.searchable)) {
        const r = await api.referenceFile(f.path);
        references.push({ path: r.path, layer: r.layer, content: r.content });
      }
      const built = buildAiRequest({
        projectTitle: project.title,
        redevelopment: project.redevelopment,
        doc,
        task,
        instruction,
        passage,
        references,
      });
      let copied = false;
      try {
        await navigator.clipboard.writeText(built.text);
        copied = true;
      } catch {
        /* shown below for manual copying */
      }
      setState({ copied, text: built.text, omitted: built.omitted });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Ask Claude or ChatGPT" onClose={onClose} wide>
      {!state ? (
        <>
          <p className="hint">
            This copies a request containing the chapter, your directives and canon, the house rules (never invent canon; give reasons) and a reply format.
            Paste it into a new chat, then bring the reply back with <strong>Paste reply…</strong>. Older historical and legacy files are left out. The
            request is only copied to your clipboard; nothing is sent anywhere until you paste it.
          </p>
          {passage ? (
            <div className="quote" style={{ cursor: 'default' }}>
              {passage.slice(0, 400)}
              {passage.length > 400 ? '…' : ''}
            </div>
          ) : (
            <p className="hint">No passage is selected, so the request covers the whole chapter. Select text first to focus on a passage.</p>
          )}
          <label className="lbl">What should it do?</label>
          {AI_TASKS.map((t) => (
            <label key={t.id} className="check" style={{ margin: '6px 0', opacity: t.needsPassage && !passage ? 0.5 : 1 }}>
              <input type="radio" name="task" checked={task === t.id} disabled={t.needsPassage && !passage} onChange={() => setTask(t.id)} />
              <span>{t.label}</span>
            </label>
          ))}
          <label className="lbl" htmlFor="ai-instruction">
            Anything specific? (optional)
          </label>
          <textarea
            id="ai-instruction"
            className="field"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Is her grief convincing here? Does the scene drag in the middle?"
          />
          {error && <p className="anchor-flag">{error}</p>}
          <div className="row end">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={copy}>
              {busy ? 'Preparing…' : 'Copy request'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {state.copied ? 'Copied to your clipboard' : 'Select all of the text below and copy it'} ({formatCount(state.text.length)} characters). Now:
          </p>
          <ol className="hint" style={{ lineHeight: 1.7 }}>
            <li>
              Open a new chat in{' '}
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer">
                Claude
              </a>{' '}
              or{' '}
              <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">
                ChatGPT
              </a>{' '}
              and paste.
            </li>
            <li>When it has answered, copy its whole reply.</li>
            <li>
              Come back here and choose <strong>Paste reply…</strong> in the Notes panel.
            </li>
          </ol>
          {state.omitted.length > 0 && <p className="anchor-flag">Left out for length: {state.omitted.join(', ')}.</p>}
          {!state.copied && <textarea className="field" readOnly value={state.text} style={{ minHeight: 160 }} onFocus={(e) => e.target.select()} />}
          <div className="row end">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function PasteReplyModal({
  doc,
  fallback,
  busy,
  onAdd,
  onClose,
}: {
  doc: ChapterDocument;
  fallback: Range | null;
  busy: boolean;
  onAdd: (notes: NoteToAdd[]) => Promise<void>;
  onClose: () => void;
}) {
  const [reply, setReply] = useState('');
  const [by, setBy] = useState('Claude');
  const [useFallback, setUseFallback] = useState(true);

  const parsed = useMemo(
    () =>
      parseAiReply(reply).map((n) => {
        const match = n.passage ? findQuote(doc.text, n.passage) : null;
        return { ...n, match };
      }),
    [reply, doc.text],
  );
  useEffect(() => setUseFallback(true), [reply]);

  const placed = parsed.filter((n) => n.match?.ok);
  const unplaced = parsed.filter((n) => !n.match?.ok);
  const canFallback = fallback !== null && fallback.end > fallback.start;

  const build = (): NoteToAdd[] => {
    if (parsed.length === 0) {
      return canFallback && reply.trim() ? [{ ...fallback!, category: 'developmental', body: reply.trim(), reasoning: null, suggestedText: null, by }] : [];
    }
    const out: NoteToAdd[] = [];
    for (const n of parsed) {
      const range = n.match?.ok ? { start: n.match.start, end: n.match.end } : canFallback && useFallback ? fallback! : null;
      if (!range) continue;
      const body = n.match?.ok || !n.passage ? n.note : `${n.note}\n\n(The AI quoted: “${n.passage}”, which was not found in the draft.)`;
      out.push({
        ...range,
        category: n.category,
        body: body || '(no comment text)',
        reasoning: n.reasoning || null,
        // A rewrite only makes sense for the exact passage it was written for.
        suggestedText: n.match?.ok ? n.suggestedRewrite : null,
        by,
      });
    }
    return out;
  };
  const toAdd = build();

  return (
    <Modal title="Paste the AI’s reply" onClose={onClose} wide>
      <p className="hint">
        Paste the whole reply. Each NOTE block becomes an editorial note, marked as an AI suggestion, on the passage it quotes. Nothing in the chapter text
        changes; suggested rewrites wait for you to accept or reject them.
      </p>
      <div className="row">
        <label className="lbl" style={{ margin: 0 }} htmlFor="ai-by">
          Reply from
        </label>
        <select id="ai-by" className="field" style={{ width: 'auto' }} value={by} onChange={(e) => setBy(e.target.value)}>
          <option>Claude</option>
          <option>ChatGPT</option>
          <option>Other AI</option>
        </select>
      </div>
      <textarea className="field mt" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the reply here" style={{ minHeight: 180 }} autoFocus />
      {reply.trim() && (
        <div className="mt small">
          {parsed.length === 0 ? (
            canFallback ? (
              <p className="hint">No NOTE blocks were found. The whole reply will be added as one note on the passage you asked about.</p>
            ) : (
              <p className="anchor-flag">No NOTE blocks were found, and no passage was selected when you copied the request, so there is nowhere to attach it.</p>
            )
          ) : (
            <>
              <p className="hint">
                {placed.length} of {parsed.length} notes matched a passage in the draft.
              </p>
              {unplaced.map((n, i) => (
                <div key={i} className="anchor-flag">
                  Not placed: “{(n.passage || n.note).slice(0, 90)}…” — {n.passage ? describeMiss(n.match!) : 'no passage given.'}
                </div>
              ))}
              {unplaced.length > 0 && canFallback && (
                <label className="check">
                  <input type="checkbox" checked={useFallback} onChange={(e) => setUseFallback(e.target.checked)} />
                  <span>Attach those to the passage you asked about instead (without their suggested rewrites).</span>
                </label>
              )}
            </>
          )}
        </div>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || toAdd.length === 0} onClick={() => onAdd(toAdd)}>
          Add {toAdd.length || ''} note{toAdd.length === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
