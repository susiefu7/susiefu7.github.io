// Explicit author approval of a chapter.

import { useState } from 'react';
import type { CanonProposal, ChapterDocument } from '../../shared/types';
import { api } from '../api';
import { Modal, errorMessage, formatCount, formatDate } from '../ui';

interface Props {
  doc: ChapterDocument;
  dirty: boolean;
  ensureSaved: () => Promise<ChapterDocument | null>;
  onApproved: (doc: ChapterDocument) => void;
  onReviewProposals: () => void;
  onClose: () => void;
}

export function ApprovalDialog({ doc, dirty, ensureSaved, onApproved, onReviewProposals, onClose }: Props) {
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<CanonProposal[] | null>(null);
  const previous = doc.approval;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await ensureSaved();
      if (!saved) throw new Error('The draft could not be saved, so it was not approved.');
      const result = await api.approve(saved.meta.id, saved.hash, note);
      setProposals(result.proposals);
      onApproved(await api.chapter(saved.meta.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (proposals) {
    return (
      <Modal title="Chapter approved" onClose={onClose}>
        <p>
          Chapter {doc.meta.number}, <em>{doc.meta.title}</em>, is approved. A frozen copy is kept in <code>approved/{doc.meta.id}.md</code>; later edits
          to the draft will not change it.
        </p>
        <p className="hint">
          {proposals.length} proposed canon updates (chapter summary and continuity) have been drafted for your review.{' '}
          <strong>Nothing in canon has changed.</strong> Each update needs your separate confirmation.
        </p>
        <div className="row end">
          <button className="btn" onClick={onClose}>
            Later
          </button>
          <button className="btn primary" onClick={onReviewProposals}>
            Review proposed updates
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Approve Chapter ${doc.meta.number}`} onClose={onClose}>
      <p>
        <em>{doc.meta.title}</em> · {formatCount(doc.wordCount)} words · {doc.scenes.length} scenes
      </p>
      {previous && (
        <p className="hint">
          Previously approved {formatDate(previous.date, false)}. That approved text will be moved to <code>archive/superseded/</code>, not overwritten.
        </p>
      )}
      {dirty && <p className="anchor-flag">You have unsaved changes. They will be saved first and included in the approved text.</p>}
      <label className="lbl" htmlFor="approval-note">
        Decision note (optional)
      </label>
      <textarea id="approval-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved after the third structural pass." />
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>
          I approve this text as the current approved version of Chapter {doc.meta.number}. The decision and today’s date will be recorded.
        </span>
      </label>
      {error && <p className="anchor-flag">{error}</p>}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!confirmed || busy} onClick={approve}>
          {busy ? 'Approving…' : 'Approve chapter'}
        </button>
      </div>
    </Modal>
  );
}
