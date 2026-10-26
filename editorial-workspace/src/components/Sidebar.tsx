// Left navigation: chapters (with scenes of the open chapter) and the reference library.

import { useState } from 'react';
import type { ChapterSummary, ProjectInfo, Scene } from '../../shared/types';
import { Modal, STATUS_LABELS, formatCount } from '../ui';
import type { Route } from '../App';

interface Props {
  project: ProjectInfo | null;
  chapters: ChapterSummary[];
  route: Route;
  scenes: Scene[];
  pendingProposals: number;
  theme: 'day' | 'night';
  onNavigate: (route: Route) => void;
  onScene: (scene: Scene) => void;
  onCreateChapter: (title: string, number?: number) => Promise<void>;
  onToggleTheme: () => void;
}

export function Sidebar({ project, chapters, route, scenes, pendingProposals, theme, onNavigate, onScene, onCreateChapter, onToggleTheme }: Props) {
  const [creating, setCreating] = useState(false);
  const activeChapter = route.view === 'chapter' || route.view === 'history' ? route.chapterId : null;

  return (
    <nav className="sidebar" aria-label="Manuscript">
      <div className="sidebar-head">
        <h1 className="wordmark">{project?.title ?? 'The Long Picture'}</h1>
        <div className="wordmark-sub">Editorial workspace</div>
      </div>
      <div className="sidebar-scroll">
        <div className="nav-section">
          <div className="nav-label">
            <span>Manuscript</span>
            <button className="btn ghost small" onClick={() => setCreating(true)} title="Add a chapter">
              + Chapter
            </button>
          </div>
          {chapters.length === 0 && <p className="hint" style={{ padding: '0 10px' }}>No chapters yet.</p>}
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
              <span className="ch-meta">Canon · directives · ideas · archive</span>
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

      {creating && <NewChapterModal next={Math.max(0, ...chapters.map((c) => c.number)) + 1} onClose={() => setCreating(false)} onCreate={async (t, n) => {
        await onCreateChapter(t, n);
        setCreating(false);
      }} />}
    </nav>
  );
}

function NewChapterModal({ next, onClose, onCreate }: { next: number; onClose: () => void; onCreate: (title: string, number?: number) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState(String(next));
  const n = Number(number);
  return (
    <Modal title="New chapter" onClose={onClose}>
      <label className="lbl" htmlFor="nc-num">Number</label>
      <input id="nc-num" className="field" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} />
      <label className="lbl" htmlFor="nc-title">Title</label>
      <input id="nc-title" className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && onCreate(title.trim(), n)} />
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!title.trim() || !(n > 0)} onClick={() => onCreate(title.trim(), n)}>
          Create chapter
        </button>
      </div>
    </Modal>
  );
}
