// Application shell: routing, chapter list, theme, focus mode, notifications.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChapterDocument, ChapterSummary, ProjectInfo, Scene } from '../shared/types';
import { api } from './api';
import { ChapterView } from './components/ChapterView';
import { HistoryView } from './components/HistoryView';
import { LibraryView } from './components/LibraryView';
import { ProposalsView } from './components/ProposalsView';
import { Sidebar } from './components/Sidebar';
import { NotifyContext, errorMessage, type Notify } from './ui';

export type Route =
  | { view: 'home' }
  | { view: 'chapter'; chapterId: string }
  | { view: 'history'; chapterId: string }
  | { view: 'library'; file: string | null; line: number | null; query: string | null }
  | { view: 'proposals' };

function parseHash(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(qs);
  const [view, id] = path.split('/');
  if (view === 'chapter' && id) return { view: 'chapter', chapterId: id };
  if (view === 'history' && id) return { view: 'history', chapterId: id };
  if (view === 'library') {
    return { view: 'library', file: params.get('file'), line: params.has('line') ? Number(params.get('line')) : null, query: params.get('q') };
  }
  if (view === 'proposals') return { view: 'proposals' };
  return { view: 'home' };
}

function toHash(route: Route): string {
  switch (route.view) {
    case 'chapter':
    case 'history':
      return `#/${route.view}/${route.chapterId}`;
    case 'library': {
      const p = new URLSearchParams();
      if (route.file) p.set('file', route.file);
      if (route.line) p.set('line', String(route.line));
      if (route.query) p.set('q', route.query);
      const qs = p.toString();
      return `#/library${qs ? `?${qs}` : ''}`;
    }
    case 'proposals':
      return '#/proposals';
    default:
      return '#/';
  }
}

function storedTheme(): 'day' | 'night' {
  try {
    const t = localStorage.getItem('tlp.theme');
    if (t === 'day' || t === 'night') return t;
  } catch {
    /* fall through */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [pendingProposals, setPendingProposals] = useState(0);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [doc, setDoc] = useState<ChapterDocument | null>(null);
  const [jump, setJump] = useState<{ offset: number; nonce: number } | null>(null);
  const [focus, setFocus] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [theme, setTheme] = useState<'day' | 'night'>(storedTheme);
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'error' } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const toastTimer = useRef<number>();

  const notify: Notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 9000 : 4500);
  }, []);

  const refreshChapters = useCallback(async () => {
    try {
      const [list, proposals] = await Promise.all([api.chapters(), api.proposals()]);
      setChapters(list);
      setPendingProposals(proposals.filter((p) => p.status === 'pending').length);
      return list;
    } catch (e) {
      notify(errorMessage(e), 'error');
      return [];
    }
  }, [notify]);

  useEffect(() => {
    api.project().then(setProject, (e) => setFatal(errorMessage(e)));
    refreshChapters().then((list) => {
      if (parseHash(window.location.hash).view === 'home' && list[0]) {
        navigateNow({ view: 'chapter', chapterId: list[0].id });
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('tlp.theme', theme);
    } catch {
      /* preference only */
    }
  }, [theme]);

  useEffect(() => {
    document.title = project ? `${project.title} — Editorial Workspace` : 'The Long Picture — Editorial Workspace';
  }, [project]);

  const navigateNow = (next: Route) => {
    setJump(null); // a scene jump belongs to the chapter it was made in
    setNavOpen(false);
    setRoute(next);
    const hash = toHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  };

  // Unsaved text is saved before leaving a chapter; if that fails, we stay.
  const navigate = useCallback(async (next: Route) => {
    if (guard.current && !(await guard.current())) {
      notify('Your changes could not be saved, so the chapter was kept open.', 'error');
      return;
    }
    navigateNow(next);
  }, [notify]);

  useEffect(() => {
    const onPop = async () => {
      const next = parseHash(window.location.hash);
      if (guard.current && !(await guard.current())) {
        window.history.pushState(null, '', toHash(route));
        return;
      }
      setJump(null);
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focus && !document.querySelector('.modal')) setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const registerGuard = useCallback((g: (() => Promise<boolean>) | null) => {
    guard.current = g;
  }, []);

  const onScene = (scene: Scene) => setJump({ offset: scene.start, nonce: Date.now() });

  if (fatal) {
    return (
      <div className="empty-state">
        <p>The workspace server could not be reached.</p>
        <p className="small">{fatal}</p>
        <p className="small">Start it with <code>npm start</code> and reload this page.</p>
      </div>
    );
  }

  return (
    <NotifyContext.Provider value={notify}>
      <div className={`shell${focus ? ' focus' : ''}${navOpen ? ' nav-open' : ''}`}>
        <button className="btn nav-toggle" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen}>
          {navOpen ? 'Close' : 'Chapters'}
        </button>
        <Sidebar
          project={project}
          chapters={chapters}
          route={route}
          scenes={doc && route.view === 'chapter' && doc.meta.id === route.chapterId ? doc.scenes : []}
          pendingProposals={pendingProposals}
          theme={theme}
          onNavigate={navigate}
          onScene={onScene}
          onToggleTheme={() => setTheme(theme === 'night' ? 'day' : 'night')}
          creating={creatingChapter}
          setCreating={setCreatingChapter}
          onCreateChapter={async (title, number, file) => {
            try {
              const created = await api.createChapter(title, number, file?.markdown, file?.name);
              await refreshChapters();
              await navigate({ view: 'chapter', chapterId: created.meta.id });
            } catch (e) {
              notify(errorMessage(e), 'error');
            }
          }}
        />
        {route.view === 'chapter' && (
          <ChapterView
            key={route.chapterId}
            chapterId={route.chapterId}
            jump={jump}
            focus={focus}
            onToggleFocus={() => setFocus(!focus)}
            onDoc={setDoc}
            onChaptersChanged={refreshChapters}
            onOpenHistory={() => navigate({ view: 'history', chapterId: route.chapterId })}
            onOpenProposals={() => navigate({ view: 'proposals' })}
            onOpenReference={(file, line) => navigate({ view: 'library', file, line: line ?? null, query: null })}
            registerGuard={registerGuard}
          />
        )}
        {route.view === 'history' && (
          <HistoryView
            key={route.chapterId}
            chapterId={route.chapterId}
            onBack={() => navigate({ view: 'chapter', chapterId: route.chapterId })}
            onRestored={() => {
              void refreshChapters();
              void navigate({ view: 'chapter', chapterId: route.chapterId });
            }}
          />
        )}
        {route.view === 'library' && (
          <LibraryView
            redevelopment={project?.redevelopment ?? null}
            file={route.file}
            line={route.line}
            query={route.query}
            onOpen={(file, line, query) => navigate({ view: 'library', file, line: line ?? null, query: query ?? null })}
            onOpenChapter={(chapterId) => navigate({ view: 'chapter', chapterId })}
          />
        )}
        {route.view === 'proposals' && <ProposalsView onChanged={refreshChapters} />}
        {route.view === 'home' && (
          <div className="workspace">
            {chapters.length === 0 ? (
              <div className="empty-state">
                <p>The manuscript is empty.</p>
                <p className="small">
                  Create a chapter to begin drafting. Type or paste prose into it, or start from a .md, .txt or .docx file. The reference library is
                  available in the meantime.
                </p>
                <button className="btn primary" onClick={() => setCreatingChapter(true)}>
                  New chapter
                </button>
              </div>
            ) : (
              <div className="empty-state">Choose a chapter.</div>
            )}
          </div>
        )}
      </div>
      {toast && (
        <div className={`toast${toast.kind === 'error' ? ' error' : ''}`} role="status">
          {toast.message}
        </div>
      )}
    </NotifyContext.Provider>
  );
}
