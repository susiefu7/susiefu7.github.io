// Shared data model for the server, the browser client and the import scripts.
// Everything here is serialised as plain JSON inside the manuscript project.

/**
 * The six layers of material in a project. They live in separate folders and
 * are never mixed: nothing moves from one layer to another without an explicit
 * author action.
 */
export type Layer =
  | 'canon' // 1. Locked canon — imported reference files. Read-only in the app.
  | 'directive' // Author directives for the redevelopment; they outrank older material.
  | 'idea' // 2. Working ideas — author notes, explicitly NOT canon.
  | 'historical' // Summaries and continuity records from before the redevelopment. Reference only.
  | 'suggestion' // 3. Editorial suggestions — comments and proposals, never applied automatically.
  | 'draft' // 4. Draft manuscript — the working text of each chapter.
  | 'approved' // 5. Approved manuscript — copies frozen at the moment of approval.
  | 'superseded' // 6. Superseded approved versions from this redevelopment.
  | 'legacy'; // 6. Older chapter drafts from the earlier development. Never governing.

export const LAYER_LABELS: Record<Layer, string> = {
  canon: 'Locked canon',
  directive: 'Author directive',
  idea: 'Working idea — not canon',
  historical: 'Historical reference — pre-redevelopment',
  suggestion: 'Editorial suggestion',
  draft: 'Draft manuscript',
  approved: 'Approved manuscript',
  superseded: 'Superseded version',
  legacy: 'Legacy manuscript — does not govern',
};

export type WorkingStatus = 'planning' | 'drafting' | 'revising' | 'in-review';

export const WORKING_STATUSES: WorkingStatus[] = ['planning', 'drafting', 'revising', 'in-review'];

export interface ChapterMeta {
  id: string; // folder name, e.g. "ch03"
  number: number;
  title: string;
  status: WorkingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  chapterId: string;
  date: string; // ISO timestamp of the author's decision
  commit: string; // Git commit holding the approved text
  contentHash: string; // sha256 of the approved text
  approvedFile: string; // project-relative path of the frozen copy
  wordCount: number;
  note: string;
  supersededFile?: string; // where the previously approved copy was moved to
}

export interface ChapterSummary extends ChapterMeta {
  wordCount: number;
  sceneCount: number;
  approval: ApprovalRecord | null; // latest approval, if any
  draftMatchesApproved: boolean | null; // null when never approved
  openComments: number;
}

export interface Scene {
  index: number; // 1-based
  title: string; // the heading text, or the opening words of the scene
  start: number; // source offset where the scene begins
  end: number;
  wordCount: number;
}

export interface ChapterDocument {
  meta: ChapterMeta;
  text: string;
  hash: string; // sha256 of the text, used for conflict detection on save
  scenes: Scene[];
  wordCount: number;
  approval: ApprovalRecord | null;
  draftMatchesApproved: boolean | null;
  recovery: RecoveryInfo | null;
}

export interface RecoveryInfo {
  savedAt: string;
  text: string;
}

// ── Versions ────────────────────────────────────────────────────────────────

export type VersionKind = 'named' | 'pre-ai' | 'pre-restore' | 'pre-suggestion' | 'approval' | 'restore';

export interface NamedVersion {
  id: string;
  chapterId: string;
  name: string;
  note: string;
  kind: VersionKind;
  commit: string;
  contentHash: string;
  createdAt: string;
}

/** A selectable text source for comparison or restoration. */
export interface VersionEntry {
  ref: string; // "draft", "commit:<sha>", "approved", "superseded:<file>", "legacy:<file>"
  label: string;
  date: string | null;
  layer: Layer;
  kind: 'draft' | 'save' | VersionKind | 'approved' | 'superseded' | 'legacy';
  named: NamedVersion | null;
  commit: string | null;
  restorable: boolean;
}

// ── Comments ────────────────────────────────────────────────────────────────

export type CommentCategory = 'developmental' | 'character' | 'continuity' | 'pacing' | 'dialogue' | 'prose';
export const COMMENT_CATEGORIES: CommentCategory[] = [
  'developmental',
  'character',
  'continuity',
  'pacing',
  'dialogue',
  'prose',
];

export type CommentStatus = 'open' | 'resolved' | 'rejected' | 'deferred';
export const COMMENT_STATUSES: CommentStatus[] = ['open', 'resolved', 'rejected', 'deferred'];

/**
 * Where a comment's passage is, given the current draft.
 * - anchored:  the quoted text is exactly where it was.
 * - relocated: the quoted text was found unchanged, elsewhere, with matching context.
 * - uncertain: the text was edited or appears several times; the range is a best guess.
 * - detached:  the passage can no longer be found. The original quote is kept.
 */
export type AnchorState = 'anchored' | 'relocated' | 'uncertain' | 'detached';

export interface TextAnchor {
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export interface CanonReference {
  file: string; // project-relative path
  layer: Layer;
  line: number;
  excerpt: string;
}

export type ContributorRole = 'author' | 'editor' | 'ai';

export interface CommentReply {
  id: string;
  by: string;
  role: ContributorRole;
  body: string;
  createdAt: string;
}

export interface AuthorDecision {
  decision: 'accepted' | 'rejected' | 'deferred' | 'resolved';
  note: string;
  date: string;
}

export interface EditorialComment {
  id: string;
  chapterId: string;
  category: CommentCategory;
  status: CommentStatus;
  by: string;
  role: ContributorRole;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** The passage as first quoted. Never rewritten, so the original context survives revisions. */
  originalQuote: string;
  originalCommit: string | null;
  anchor: TextAnchor;
  anchorState: AnchorState;
  /** Optional replacement text proposed by an editor or AI. Applied only on explicit author acceptance. */
  suggestedText: string | null;
  reasoning: string | null;
  refs: CanonReference[];
  replies: CommentReply[];
  decision: AuthorDecision | null;
}

// ── Reference library ──────────────────────────────────────────────────────

export interface ReferenceFile {
  path: string; // project-relative, e.g. "canon/characters.md"
  name: string;
  layer: Layer;
  searchable: boolean; // false for formats the workspace cannot read (e.g. .pdf)
  converted: boolean; // true for .docx: shown and searched via a read-only conversion
  size: number;
  integrity: 'verified' | 'changed' | 'untracked' | 'n/a';
}

export interface SearchHit {
  file: string;
  layer: Layer;
  line: number;
  heading: string | null;
  snippet: string;
  inHeading: boolean;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  filesSearched: number;
  /** Files that could not be searched (e.g. .docx) — so absence of a hit is never over-claimed. */
  unsearchable: string[];
}

// ── Canon proposals ────────────────────────────────────────────────────────

export interface CanonProposal {
  id: string;
  chapterId: string;
  approvalId: string | null;
  kind: 'summary' | 'continuity';
  targetFile: string; // a canon/ path; appended to only after author confirmation
  content: string;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  appliedCommit: string | null;
  targetHashAtCreation: string | null;
}

/** While a redevelopment is active, older records are shown as historical, not binding. */
export interface Redevelopment {
  active: boolean;
  since: string | null;
  note: string;
}

export interface ProjectInfo {
  title: string;
  path: string;
  schemaVersion: number;
  authorName: string;
  aiEnabled: boolean;
  redevelopment: Redevelopment | null;
}
