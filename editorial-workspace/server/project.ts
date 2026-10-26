// The manuscript project: a plain folder (and its own Git repository) that holds the
// novel, the reference library and all editorial metadata. The application code
// lives elsewhere; deleting the application leaves the manuscript intact.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Layer, ProjectInfo } from '../shared/types.ts';
import { HttpError, Mutex, exists, nowIso, readJson, resolveInside, writeJson } from './fsutil.ts';
import { Git } from './git.ts';

export const SCHEMA_VERSION = 1;

/** Folder for each layer of material. See docs/ARCHITECTURE.md. */
export const LAYER_DIRS: Partial<Record<Layer, string>> = {
  canon: 'canon',
  directive: 'directives',
  idea: 'working-ideas',
  approved: 'approved',
  superseded: 'archive/superseded',
  legacy: 'archive/legacy',
};

/** Order of authority used when assembling context (e.g. for a future AI editor). */
export const AUTHORITY_ORDER: Layer[] = ['directive', 'canon', 'approved'];

export const CHAPTERS_DIR = 'manuscript/chapters';
export const EDITORIAL_DIR = 'editorial';
export const RECOVERY_DIR = '.recovery';

const CHAPTER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface ProjectFile {
  title: string;
  schemaVersion: number;
  authorName: string;
  createdAt: string;
}

export class Project {
  readonly git: Git;
  /** Every mutation runs inside this lock. */
  readonly lock = new Mutex();

  private constructor(
    readonly root: string,
    private config: ProjectFile,
  ) {
    this.git = new Git(root);
  }

  static async open(root: string): Promise<Project> {
    const abs = path.resolve(root);
    const configPath = path.join(abs, 'project.json');
    if (!(await exists(configPath))) {
      throw new Error(
        `No manuscript project found at ${abs}.\nCreate one with:  npm run init-project -- "${abs}"`,
      );
    }
    const config = await readJson<ProjectFile>(configPath, null as unknown as ProjectFile);
    if (config.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`This project uses a newer format (v${config.schemaVersion}). Please update the application.`);
    }
    const project = new Project(abs, config);
    if (!(await project.git.isRepo())) await project.git.init();
    await project.git.ensureIdentity();
    await project.commitExternalChanges();
    return project;
  }

  /** Create the folder layout for a new, empty project. Refuses to touch an existing project. */
  static async init(root: string, title: string, authorName = 'Author'): Promise<Project> {
    const abs = path.resolve(root);
    if (await exists(path.join(abs, 'project.json'))) {
      throw new Error(`A project already exists at ${abs}; nothing was changed.`);
    }
    for (const dir of [
      ...Object.values(LAYER_DIRS),
      CHAPTERS_DIR,
      `${EDITORIAL_DIR}/comments`,
      `${EDITORIAL_DIR}/versions`,
      `${EDITORIAL_DIR}/approvals`,
      `${EDITORIAL_DIR}/proposals`,
    ]) {
      await fs.mkdir(path.join(abs, dir), { recursive: true });
      const keep = path.join(abs, dir, '.gitkeep');
      if (!(await exists(keep))) await fs.writeFile(keep, '');
    }
    const config: ProjectFile = { title, schemaVersion: SCHEMA_VERSION, authorName, createdAt: nowIso() };
    await writeJson(path.join(abs, 'project.json'), config);
    if (!(await exists(path.join(abs, '.gitignore')))) {
      await fs.writeFile(path.join(abs, '.gitignore'), `${RECOVERY_DIR}/\n*.tmp-*\n.DS_Store\n`);
    }
    if (!(await exists(path.join(abs, 'README.md')))) {
      await fs.writeFile(path.join(abs, 'README.md'), PROJECT_README(title));
    }
    const git = new Git(abs);
    if (!(await git.isRepo())) await git.init();
    await git.ensureIdentity();
    await git.commit(['.'], `Create project: ${title}`);
    return Project.open(abs);
  }

  info(aiEnabled: boolean): ProjectInfo {
    return {
      title: this.config.title,
      path: this.root,
      schemaVersion: this.config.schemaVersion,
      authorName: this.config.authorName,
      aiEnabled,
    };
  }

  get authorName(): string {
    return this.config.authorName;
  }

  abs(rel: string): string {
    return resolveInside(this.root, rel);
  }

  assertChapterId(id: string): void {
    if (!CHAPTER_ID.test(id)) throw new HttpError(400, `Invalid chapter id: ${id}`);
  }

  chapterDir(id: string): string {
    this.assertChapterId(id);
    return `${CHAPTERS_DIR}/${id}`;
  }
  chapterText(id: string): string {
    return `${this.chapterDir(id)}/chapter.md`;
  }
  chapterMeta(id: string): string {
    return `${this.chapterDir(id)}/chapter.json`;
  }
  commentsFile(id: string): string {
    this.assertChapterId(id);
    return `${EDITORIAL_DIR}/comments/${id}.json`;
  }
  versionsFile(id: string): string {
    this.assertChapterId(id);
    return `${EDITORIAL_DIR}/versions/${id}.json`;
  }
  approvalsFile(id: string): string {
    this.assertChapterId(id);
    return `${EDITORIAL_DIR}/approvals/${id}.json`;
  }
  approvedText(id: string): string {
    this.assertChapterId(id);
    return `approved/${id}.md`;
  }
  supersededDir(id: string): string {
    this.assertChapterId(id);
    return `archive/superseded/${id}`;
  }
  recoveryFile(id: string): string {
    this.assertChapterId(id);
    return `${RECOVERY_DIR}/${id}.json`;
  }
  get proposalsDir(): string {
    return `${EDITORIAL_DIR}/proposals`;
  }
  get manifestFile(): string {
    return `${EDITORIAL_DIR}/canon-manifest.json`;
  }

  /** Which layer a project-relative path belongs to. */
  layerOf(rel: string): Layer | null {
    const norm = rel.split(path.sep).join('/');
    if (norm.startsWith(`${CHAPTERS_DIR}/`)) return 'draft';
    if (norm.startsWith(`${EDITORIAL_DIR}/`)) return 'suggestion';
    // Longest folder first, so archive/legacy wins over archive.
    const entries = Object.entries(LAYER_DIRS).sort((a, b) => b[1]!.length - a[1]!.length);
    for (const [layer, dir] of entries) if (norm.startsWith(`${dir}/`)) return layer as Layer;
    return null;
  }

  /**
   * Anything edited outside the app (in another editor, by a sync tool) is committed
   * on startup, so it is part of the recorded history before the app touches it.
   */
  private async commitExternalChanges(): Promise<void> {
    const dirty = await this.git.dirtyPaths(['.']);
    if (dirty.length > 0) {
      await this.git.commit(['.'], `Record changes made outside the workspace (${dirty.length} file${dirty.length === 1 ? '' : 's'})`);
    }
  }
}

const PROJECT_README = (title: string) => `# ${title}

This folder is a manuscript project for The Long Picture — Editorial Workspace.
Everything here is plain Markdown or JSON and is versioned with Git, so it remains
readable and complete without the application.

| Folder                | Layer                    | Who writes to it                                    |
| --------------------- | ------------------------ | --------------------------------------------------- |
| canon/                | Locked canon             | Import only. Changed only by author-confirmed proposals. |
| directives/           | Author directives        | The author, by hand. Outranks canon and legacy text. |
| working-ideas/        | Working ideas (not canon)| The author, by hand.                                |
| manuscript/chapters/  | Draft manuscript         | The workspace editor.                               |
| approved/             | Approved manuscript      | Only the explicit "Approve chapter" action.         |
| archive/superseded/   | Superseded approved text | Moved here when a chapter is re-approved.           |
| archive/legacy/       | Earlier approved chapters| Import only. Never governs new drafts.              |
| editorial/            | Comments, versions, approvals, proposals | The workspace.                     |

Full version history: \`git log\` in this folder.
`;
