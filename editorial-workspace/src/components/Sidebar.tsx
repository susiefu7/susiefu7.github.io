// Left navigation: chapters (with scenes of the open chapter) and the reference library.

import { useState } from 'react';
import type { ChapterSummary, ProjectInfo, Scene } from '../../shared/types';
import { Modal, STATUS_LABELS, formatCount } from '../ui';
import type { Route } from '../App';
import { FilePicker, type PickedFile } from './FilePicker';

interface Props {
  project: ProjectInfo | null;
  chapters: ChapterSummary[];
  route: Route;
  scenes: Scene[];
  pendingProposals: number;
  theme: 'day' | 'night';
  onNavigate: (route: Route) => void;
  onScene: (scene: Scene) => void;
  onCreateChapter: (title: string, number: number, file: PickedFile | null) => Promise<void>;
  onToggleTheme: () => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
}

export function Sidebar({ project, chapters, route, scenes, pendingProposals, theme, onNavigate, onScene, onCreateChapter, onToggleTheme, creating, setCreating }: Props) {
  const activeChapter = route.view === 'chapter' || route.view === 'history' ? route.chapterId : null;

  return (
    <nav className="sidebar" aria-label="Manuscript">
      <div className="sidebar-head">
        <h1 className="wordmark">{project?.title ?? 'The Long Picture'}</h1>
        <div className="wordmark-sub">Editorial workspace</div>
        {project?.redevelopment?.active && (
          <div className="redev" title={project.redevelopment.note}>
            Redevelopment in progress
          </div>
        )}
      </div>
      <div className="sidebar-scroll">
        <div className="nav-section">
          <div className="nav-label">
            <span>Manuscript</span>
            <button className="btn ghost small" onClick={() => setCreating(true)} title="Add a chapter">
              + Chapter
            </button>
          </div>
          {chapters.length === 0 && <p className="hint" style={{ padding: '0 10px' }}>The manuscript is empty. Add a chapter to begin.</p>}
          {chapters.map((c) => (
            <div key={c.id}>
              <button
                className={`nav-item${activeChapter === c.id ? ' active' : ''}`}
                onClick={() => onNavigate({ view: 'chapter', chapterId: c.id })}
                aria-current={activeChapter === c.id ? 'page' : undefined}
              >
                <span className="ch-num">{c.number}</span>
                <span className="ch-body">
                  <span className="ch-title">{c.title}</span>
                  <span className="ch-meta">
                    <span>{formatCount(c.wordCount)} w</span>
                    {c.approval ? (
                      <span className={`status ${c.draftMatchesApproved ? 'approved' : 'diverged'}`}>
                        <span className="dot" />
                        {c.draftMatchesApproved ? 'Approved' : 'Approved · draft differs'}
                      </span>
                    ) : (
                      <span>{STATUS_LABELS[c.status] ?? c.status}</span>
                    )}
                    {c.openComments > 0 && <span title="Open editorial notes">· {c.openComments} note{c.openComments === 1 ? '' : 's'}</span>}
                  </span>
                </span>
              </button>
              {activeChapter === c.id && route.view === 'chapter' && scenes.length > 1 && (
                <ul className="scene-list" aria-label="Scenes">
                  {scenes.map((s) => (
                    <li key={s.index}>
                      <button onClick={() => onScene(s)} title={`${s.title} — ${formatCount(s.wordCount)} words`}>
                        {s.index}. {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-label">
            <span>References</span>
          </div>
          <button className={`nav-item${route.view === 'library' ? ' active' : ''}`} onClick={() => onNavigate({ view: 'library', file: null, line: null, query: null })}>
            <span className="ch-body">
              <span className="ch-title">Canon & reference library</span>
              <span className="ch-meta">Canon · historical · legacy manuscript</span>
            </span>
          </button>
          <button className={`nav-item${route.view === 'proposals' ? ' active' : ''}`} onClick={() => onNavigate({ view: 'proposals' })}>
            <span className="ch-body">
              <span className="ch-title">Proposed canon updates</span>
              <span className="ch-meta">{pendingProposals ? `${pendingProposals} awaiting your decision` : 'None pending'}</span>
            </span>
          </button>
        </div>
      </div>
      <div className="sidebar-foot">
        <a className="btn ghost small" href="/api/export?which=draft" download>
          Export drafts
        </a>
        <a className="btn ghost small" href="/api/export?which=approved" download>
          Export approved
        </a>
        <button className="btn ghost small" onClick={onToggleTheme} style={{ marginLeft: 'auto' }}>
          {theme === 'night' ? 'Day' : 'Night'}
        </button>
      </div>

      {creating && (
        <NewChapterModal
          next={Math.max(0, ...chapters.map((c) => c.number)) + 1}
          taken={new Set(chapters.map((c) => c.number))}
          onClose={() => setCreating(false)}
          onCreate={async (t, n, f) => {
            await onCreateChapter(t, n, f);
            setCreating(false);
          }}
        />
      )}
    </nav>
  );
}

function NewChapterModal({
  next,
  taken,
  onClose,
  onCreate,
}: {
  next: number;
  taken: Set<number>;
  onClose: () => void;
  onCreate: (title: string, number: number, file: PickedFile | null) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState(String(next));
  const [fromFile, setFromFile] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const n = Number(number);
  const clash = taken.has(n);
  const ready = title.trim() && n > 0 && !clash && (!fromFile || file);
  const pick = (f: PickedFile | null) => {
    setFile(f);
    const heading = f && /^#\s+(.+)$/m.exec(f.markdown)?.[1].replace(/[*_]/g, '').trim();
    if (heading && !title.trim()) setTitle(heading);
  };
  return (
    <Modal title="New chapter" onClose={onClose} wide={fromFile}>
      <p className="hint">New chapters are working drafts. Nothing becomes approved canon until you approve it.</p>
      <label className="lbl" htmlFor="nc-num">Number</label>
      <input id="nc-num" className="field" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} />
      {clash && <p className="hint">Chapter {n} already exists.</p>}
      <label className="lbl" htmlFor="nc-title">Title</label>
      <input id="nc-title" className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ready && onCreate(title.trim(), n, file)} />
      <label className="check">
        <input type="radio" name="start" checked={!fromFile} onChange={() => (setFromFile(false), setFile(null))} />
        <span>Start with an empty page (you can type or paste prose straight in).</span>
      </label>
      <label className="check">
        <input type="radio" name="start" checked={fromFile} onChange={() => setFromFile(true)} />
        <span>Start from a .md, .txt or .docx file.</span>
      </label>
      {fromFile && <FilePicker onPicked={pick} />}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!ready} onClick={() => onCreate(title.trim(), n, file)}>
          Create chapter
        </button>
      </div>
    </Modal>
  );
}
