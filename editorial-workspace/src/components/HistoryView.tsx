// Version history for one chapter: compare any two versions side by side, restore safely.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChapterDocument, VersionEntry } from '../../shared/types';
import { api } from '../api';
import { LayerBadge, Modal, errorMessage, formatDate, useNotify } from '../ui';
import { DiffView } from './DiffView';

const KIND_NOTE: Record<string, string> = {
  named: 'Named version',
  'pre-ai': 'Snapshot before AI-assisted revision',
  'pre-suggestion': 'Snapshot before accepting a suggestion',
  'pre-restore': 'Snapshot before a restore',
  approval: 'Approval',
  save: 'Save',
};

interface Props {
  chapterId: string;
  onBack: () => void;
  onRestored: (doc: ChapterDocument) => void;
}

export function HistoryView({ chapterId, onBack, onRestored }: Props) {
  const notify = useNotify();
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [doc, setDoc] = useState<ChapterDocument | null>(null);
  const [leftRef, setLeftRef] = useState<string>('');
  const [rightRef, setRightRef] = useState<string>('draft');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [showSaves, setShowSaves] = useState(true);
  const [restoring, setRestoring] = useState<VersionEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [v, d] = await Promise.all([api.versions(chapterId), api.chapter(chapterId)]);
    setVersions(v);
    setDoc(d);
    setTexts({});
    // Default: the most recent version before the current draft vs. the current draft.
    const defaultLeft = v.find((e) => e.ref !== 'draft' && e.kind !== 'save' && e.layer === 'draft') ?? v.find((e) => e.ref !== 'draft' && e.commit !== v[1]?.commit) ?? v[1];
    setLeftRef((current) => (current && v.some((e) => e.ref === current) ? current : defaultLeft?.ref ?? 'draft'));
  }, [chapterId]);

  useEffect(() => {
    load().catch((e) => notify(errorMessage(e), 'error'));
  }, [load, notify]);

  const fetchText = useCallback(
    async (ref: string) => {
      if (!ref || texts[ref] !== undefined) return;
      try {
        const { text } = await api.versionText(chapterId, ref);
        setTexts((t) => ({ ...t, [ref]: text }));
      } catch (e) {
        notify(errorMessage(e), 'error');
      }
    },
    [chapterId, texts, notify],
  );

  useEffect(() => {
    void fetchText(leftRef);
    void fetchText(rightRef);
  }, [leftRef, rightRef, fetchText]);

  const byRef = useMemo(() => new Map(versions.map((v) => [v.ref + (v.named?.id ?? ''), v])), [versions]);
  const labelOf = (ref: string) => versions.find((v) => v.ref === ref)?.label ?? ref;
  const visible = versions.filter((v) => showSaves || v.kind !== 'save');

  const restore = async (entry: VersionEntry) => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await api.restore(chapterId, entry.ref, doc.hash);
      notify(`Restored “${entry.label}”. The previous draft is kept as “${r.safetyVersion.name}”.`);
      setRestoring(null);
      onRestored(r.chapter);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const options = (
    <>
      {versions.map((v) => (
        <option key={v.ref + (v.named?.id ?? '')} value={v.ref}>
          {v.label}
          {v.date ? ` — ${formatDate(v.date)}` : ''}
        </option>
      ))}
    </>
  );

  return (
    <div className="workspace">
      <div className="toolbar">
        <button className="btn ghost" onClick={onBack}>
          ← Back to chapter
        </button>
        <strong style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 16 }}>
          History{doc ? ` — Chapter ${doc.meta.number}: ${doc.meta.title}` : ''}
        </strong>
        <span className="spacer" />
        <label className="row small muted">
          <input type="checkbox" checked={showSaves} onChange={(e) => setShowSaves(e.target.checked)} /> Show every save
        </label>
      </div>
      <div className="history">
        <div className="versions" aria-label="Versions">
          <p className="hint" style={{ marginTop: 0 }}>
            Choose a version for each side of the comparison. Nothing is ever deleted from this list.
          </p>
          {visible.map((v) => {
            const key = v.ref + (v.named?.id ?? '');
            const cls = ['version', v.kind === 'save' && 'save', leftRef === v.ref && 'sel-left', rightRef === v.ref && 'sel-right'].filter(Boolean).join(' ');
            return (
              <div key={key} className={cls} onClick={() => setLeftRef(v.ref)} title={byRef.get(key)?.named?.note || undefined}>
                <div className="v-label">{v.label}</div>
                <div className="v-meta">
                  {v.layer !== 'draft' ? <LayerBadge layer={v.layer} short /> : v.kind !== 'draft' && <span>{KIND_NOTE[v.kind] ?? v.kind}</span>}
                  {v.date && <span>{formatDate(v.date)}</span>}
                  {v.commit && <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{v.commit.slice(0, 7)}</span>}
                </div>
                {v.named?.note && <div className="small muted">{v.named.note}</div>}
                <div className="v-actions">
                  <button className="btn small" onClick={(e) => (e.stopPropagation(), setLeftRef(v.ref))}>
                    Left
                  </button>
                  <button className="btn small" onClick={(e) => (e.stopPropagation(), setRightRef(v.ref))}>
                    Right
                  </button>
                  {v.restorable && (
                    <button className="btn small ghost" onClick={(e) => (e.stopPropagation(), setRestoring(v))}>
                      Restore…
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="compare">
          <div className="compare-head">
            <div className="compare-cols">
              <select className="field" value={leftRef} onChange={(e) => setLeftRef(e.target.value)} aria-label="Left version">
                {options}
              </select>
              <select className="field" value={rightRef} onChange={(e) => setRightRef(e.target.value)} aria-label="Right version">
                {options}
              </select>
            </div>
            <div className="row mt">
              <button className="btn small ghost" onClick={() => (setLeftRef(rightRef), setRightRef(leftRef))}>
                ⇄ Swap sides
              </button>
            </div>
          </div>
          {texts[leftRef] !== undefined && texts[rightRef] !== undefined ? (
            <div style={{ paddingTop: 10 }}>
              <DiffView left={texts[leftRef]} right={texts[rightRef]} leftLabel={labelOf(leftRef)} rightLabel={labelOf(rightRef)} />
            </div>
          ) : (
            <p className="hint" style={{ padding: 18 }}>
              Loading…
            </p>
          )}
        </div>
      </div>

      {restoring && (
        <Modal title="Restore this version?" onClose={() => setRestoring(null)}>
          <p>
            “{restoring.label}” will become the working draft.
          </p>
          <p className="hint">
            Nothing is lost: the current draft is first saved as a named version (“Before restoring …”), and the restore is recorded as a new version.
            {restoring.layer === 'legacy' && ' This is legacy text from the earlier development; restoring it does not make it canon.'} Approved text is not affected.
          </p>
          <div className="row end">
            <button className="btn" onClick={() => setRestoring(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={() => restore(restoring)}>
              Restore as working draft
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
