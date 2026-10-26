// Proposed canon updates arising from chapter approvals. Each needs separate confirmation.

import { useCallback, useEffect, useState } from 'react';
import type { CanonProposal } from '../../shared/types';
import { api } from '../api';
import { LayerBadge, Modal, errorMessage, formatDate, useNotify } from '../ui';

export function ProposalsView({ onChanged }: { onChanged: () => void }) {
  const notify = useNotify();
  const [proposals, setProposals] = useState<CanonProposal[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api.proposals(), api.proposalTargets()]);
    setProposals(p);
    setTargets(t);
  }, []);

  useEffect(() => {
    load().catch((e) => notify(errorMessage(e), 'error'));
  }, [load, notify]);

  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');

  return (
    <div className="workspace">
      <div className="scroller">
        <div className="page">
          <h2>Proposed canon updates</h2>
          <p className="hint">
            Approving a chapter drafts a summary and a continuity update. They change nothing until you edit, preview and confirm each one. Rejected and
            applied proposals stay on record.
          </p>
          {pending.length === 0 && <p className="hint mt">No proposals are waiting for review.</p>}
          {pending.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              targets={targets}
              onChanged={async () => {
                await load();
                onChanged();
              }}
            />
          ))}
          {decided.length > 0 && (
            <div className="mt" style={{ marginTop: 30 }}>
              <button className="btn ghost small" onClick={() => setShowDecided(!showDecided)}>
                {showDecided ? 'Hide' : 'Show'} {decided.length} decided proposal{decided.length === 1 ? '' : 's'}
              </button>
              {showDecided &&
                decided.map((p) => (
                  <div key={p.id} className="card closed mt">
                    <div className="card-head">
                      <span className="cat">{p.kind}</span>
                      <span>· {p.chapterId}</span>
                      <span>· {p.status === 'applied' ? `Applied to ${p.targetFile}` : 'Rejected'}</span>
                      <span className="who">{formatDate(p.decidedAt)}</span>
                    </div>
                    <div className="preview mt">{p.content}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, targets, onChanged }: { proposal: CanonProposal; targets: string[]; onChanged: () => Promise<void> }) {
  const notify = useNotify();
  const [content, setContent] = useState(proposal.content);
  const [target, setTarget] = useState(proposal.targetFile);
  const [preview, setPreview] = useState<{ current: string | null; currentHash: string | null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const edited = content !== proposal.content || target !== proposal.targetFile;
  const targetOptions = targets.includes(proposal.targetFile) ? targets : [proposal.targetFile, ...targets];

  const saveEdits = async () => {
    await api.updateProposal(proposal.id, { content, targetFile: target });
    await onChanged();
  };

  const openPreview = async () => {
    setBusy(true);
    try {
      if (edited) await saveEdits();
      const p = await api.previewProposal(proposal.id);
      setPreview({ current: p.current, currentHash: p.currentHash });
      setConfirmed(false);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await api.applyProposal(proposal.id, preview.currentHash);
      notify(`Canon updated: ${target}`);
      setPreview(null);
      await onChanged();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const tail = preview?.current ? preview.current.replace(/\s*$/, '').split('\n').slice(-12).join('\n') : '';

  return (
    <div className="card mt" style={{ padding: '16px 18px' }}>
      <div className="card-head">
        <span className="cat">{proposal.kind === 'summary' ? 'Chapter summary' : 'Continuity'}</span>
        <span>· {proposal.chapterId}</span>
        <LayerBadge layer="suggestion" short />
        <span className="who">{formatDate(proposal.createdAt)}</span>
      </div>
      <label className="lbl">Append to canon file</label>
      <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
        {targetOptions.map((t) => (
          <option key={t} value={t}>
            {t}
            {targets.includes(t) ? '' : ' (new file)'}
          </option>
        ))}
      </select>
      <label className="lbl">Proposed text — edit before confirming</label>
      <textarea className="field" value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: 180, fontFamily: 'var(--serif)' }} />
      {/\[Author to/.test(content) && <p className="hint">Placeholders in [square brackets] are still unwritten.</p>}
      <div className="row end mt">
        <button
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.rejectProposal(proposal.id);
              await onChanged();
            } catch (e) {
              notify(errorMessage(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Reject
        </button>
        {edited && (
          <button className="btn" disabled={busy} onClick={() => saveEdits().catch((e) => notify(errorMessage(e), 'error'))}>
            Save edits
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={openPreview}>
          Preview & confirm…
        </button>
      </div>

      {preview && (
        <Modal title="Confirm canon update" onClose={() => setPreview(null)} wide>
          <p className="hint">
            The highlighted text will be appended to <code>{target}</code>
            {preview.current === null ? ' (a new file)' : ''}. Existing canon text is not altered.
          </p>
          <div className="preview">
            {tail && <span className="existing">{preview.current!.length > tail.length ? '…\n' : ''}{tail}{'\n\n'}</span>}
            <span className="incoming">{content.trim()}</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I confirm this text becomes locked canon in {target}.</span>
          </label>
          <div className="row end">
            <button className="btn" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!confirmed || busy} onClick={apply}>
              Update canon
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
