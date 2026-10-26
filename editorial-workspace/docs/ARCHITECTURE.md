# Architecture

## Starting point

The repository this was built in (`susiefu7.github.io`) is a personal portfolio site.
It does not contain the manuscript or the reference documents (master canon,
characters, relationships, Hollywood world, ensemble, architecture, style,
continuity, chapter summaries, chapter briefs). So the workspace is built
to **import** those files unaltered when they're available, and it was developed and
tested against a small, clearly labelled sample project (`sample-project/`). The
sample contains no facts about *The Long Picture*.

## The simplest reliable design

```
┌──────────────── browser (React + TypeScript) ────────────────┐
│ Sidebar │ Chapter view (Read / Edit) │ Notes & Continuity    │
│         │ History & compare · Reference library · Proposals │
└───────────────────────────┬──────────────────────────────────┘
                            │ JSON over http://127.0.0.1:4317
┌───────────────────────────┴──────────────────────────────────┐
│ Node.js server (Express, TypeScript run directly with tsx)   │
│ chapters · versions · comments · approvals · reference · AI* │
│ one write lock · atomic file writes · path confinement       │
└───────────────────────────┬──────────────────────────────────┘
                            │ plain files + system `git`
┌───────────────────────────┴──────────────────────────────────┐
│ Manuscript project folder — its own Git repository           │
│ Markdown chapters · Markdown canon · JSON editorial metadata │
└──────────────────────────────────────────────────────────────┘
```
\* the AI module is defined but switched off.

**Why this shape:**

- **Files and Git, no database.** The manuscript stays readable, diffable and
  exportable with ordinary tools. Git gives reliable history, integrity checking and
  single-file backups (`git bundle`) for free. The system `git` binary is used
  directly; there is no Git library dependency.
- **Application and manuscript are separate.** The app could be deleted, replaced or
  rewritten, and the project folder would be complete on its own. The project is
  always its own repository, even when placed inside another one.
- **Few dependencies.** Runtime: `express`, `diff`, `marked`, `tsx`, and the Literata
  font (bundled locally). The UI uses React with no state, routing or editor
  frameworks. The editor is a native `<textarea>`, which handles 8,000-word chapters
  without lag and never reformats the author's text.
- **Server as gatekeeper.** Every rule that protects the manuscript is enforced by
  the server, not just the UI. A buggy client, or a future AI integration, can't get
  around them.

## Project layout and the six layers

| Layer (the brief's numbering)  | Location                         | Written by                                     |
| ------------------------------ | -------------------------------- | ---------------------------------------------- |
| 1. Locked canon                | `canon/`                         | Importer; afterwards only `applyProposal()`    |
| — Author directives            | `directives/`                    | Importer / the author by hand                  |
| 2. Working ideas               | `working-ideas/`                 | Importer / the author by hand                  |
| 3. Editorial suggestions       | `editorial/comments/`, `editorial/proposals/` | The workspace                       |
| 4. Draft manuscript            | `manuscript/chapters/chNN/chapter.md` (+ `chapter.json`) | Editor saves, restores, accepted suggestions |
| 5. Approved manuscript         | `approved/chNN.md`               | `approveChapter()` only                        |
| 6. Superseded versions         | `archive/superseded/chNN/`, Git history | `approveChapter()` (create-only)        |
| 6. Legacy approved chapters    | `archive/legacy/`                | Importer only; never governing                 |

Other files:

```
project.json                       title, author, schema version
editorial/versions/chNN.json       named versions → Git commits
editorial/approvals/chNN.json      approval decisions (date, commit, hash, note)
editorial/canon-manifest.json      SHA-256 of each imported canon/legacy file, plus confirmed updates
.recovery/                         unsaved editor text (ignored by Git)
```

**Order of authority** (used when assembling context for an AI editor, and stated in
its ground rules): author directives → locked canon → approved chapters. Drafts and
working ideas are not established fact. Legacy text is excluded unless explicitly
requested.

## Data model

All types are in `shared/types.ts`. The main records:

```jsonc
// manuscript/chapters/ch03/chapter.json
{ "id": "ch03", "number": 3, "title": "The Sale", "status": "drafting",
  "createdAt": "…", "updatedAt": "…" }

// editorial/versions/ch03.json — one entry per named version
{ "id": "v_…", "chapterId": "ch03", "name": "Draft 2", "note": "",
  "kind": "named" | "pre-ai" | "pre-suggestion" | "pre-restore" | "approval",
  "commit": "<git sha>", "contentHash": "<sha256>", "createdAt": "…" }

// editorial/comments/ch03.json — one entry per note; never deleted
{ "id": "c_…", "category": "continuity", "status": "open|resolved|rejected|deferred",
  "by": "Author", "role": "author|editor|ai", "body": "…",
  "originalQuote": "the passage as first quoted (never rewritten)",
  "originalCommit": "<sha>",
  "anchor": { "start": 120, "end": 168, "exact": "…", "prefix": "…", "suffix": "…" },
  "anchorState": "anchored|relocated|uncertain|detached",
  "suggestedText": null, "reasoning": null,
  "refs": [{ "file": "canon/characters.md", "layer": "canon", "line": 14, "excerpt": "…" }],
  "replies": [{ "by": "…", "role": "…", "body": "…", "createdAt": "…" }],
  "decision": { "decision": "rejected", "note": "Keeping the line.", "date": "…" } }

// editorial/approvals/ch03.json
{ "id": "a_…", "date": "…", "commit": "<sha>", "contentHash": "<sha256>",
  "approvedFile": "approved/ch03.md", "wordCount": 6120, "note": "…",
  "supersededFile": "archive/superseded/ch03/2026-10-26-approved.md" }

// editorial/proposals/p_….json
{ "id": "p_…", "chapterId": "ch03", "kind": "summary|continuity",
  "targetFile": "canon/chapter-summaries.md", "content": "…",
  "status": "pending|applied|rejected", "appliedCommit": null }
```

## How the guarantees are enforced

| Guarantee | Mechanism |
| --- | --- |
| A crash can't truncate a file | `atomicWrite`: write a temporary file, `fsync`, rename |
| No lost updates | Every save, restore, comment, approval and suggestion sends the SHA-256 of the text it saw; mismatch → HTTP 409, nothing written |
| No interleaved writes | One in-process mutex around all mutations |
| Full history | Each mutation is committed; edits made outside the app are committed on start-up |
| Restore is reversible | `restoreVersion` labels the current draft "Before restoring …" first |
| AI and editor suggestions are snapshotted | `acceptSuggestion` creates a `pre-ai` / `pre-suggestion` version, refuses if the passage position is uncertain or the text no longer matches |
| Approved text is never overwritten | Previous approved file is copied create-only (`wx`) into `archive/superseded/` and verified before `approved/` is replaced |
| Canon is read-only | No route writes reference files. Proposals append only to `canon/*.md|txt`, need `confirm: true` and the target's hash from a fresh preview |
| Reads are confined | All paths resolve inside the project; the reference endpoint serves only library folders; version refs are validated |
| Only the author's browser can write | Bound to 127.0.0.1; `Host` header must be localhost (DNS rebinding); writes require an `X-Workspace` header (forces a CORS pre-flight that is never granted) |

## Comment anchoring across revisions

A note stores the quoted text with 48 characters of context on each side, plus its
offsets. After every save, restore or accepted suggestion, `reanchor()`
(`shared/anchor.ts`) tries, in order:

1. **Same place, same words** → `anchored`.
2. **Same words elsewhere**, chosen by best context match → `relocated`. If several
   matches are equally plausible → `uncertain`.
3. **Edited passage:** locate its opening and closing words, or its surrounding
   context → `uncertain`, with the best-guess range.
4. **Not found** → `detached`. The original quote stays visible.

Flags are sticky. A later save never quietly clears an `uncertain` or `detached`
flag; only the author can, with **Position is right** or **Re-attach to a selection**.
In the reading view, every rendered text span carries its source offset, so a
selection maps to exact characters in the Markdown even across italics and scene
headings.

## Version comparison

`shared/diff.ts` aligns paragraphs first, using the `diff` package's array diff. It
pairs removed and added paragraphs that are recognisably the same paragraph (at least
35% of words shared), then diffs each pair word by word. A revised sentence therefore
appears as a change inside that paragraph, not as a deleted block next to an
inserted one. Unchanged stretches collapse, and the view can step from change to
change.

## API

All under `/api`. Mutations need `X-Workspace: 1`.

| Method & path | Purpose |
| --- | --- |
| `GET /project` | Title, path, AI availability |
| `GET /chapters` · `POST /chapters` | List with word counts and status · create |
| `GET/PUT /chapters/:id` | Read · save `{text, baseHash}` |
| `PATCH /chapters/:id/meta` | Title, working status |
| `PUT /chapters/:id/recovery` · `POST …/recovery/discard` | Recovery copy |
| `GET /chapters/:id/versions` · `POST …/versions` | Version list · name a version |
| `GET /chapters/:id/text?ref=` | Text of `draft`, `commit:<sha>`, `approved`, `superseded:<file>`, `legacy:<file>` |
| `POST /chapters/:id/restore` | `{ref, baseHash}` |
| `GET/POST /chapters/:id/comments`, `PATCH …/:cid`, `POST …/:cid/replies`, `…/confirm-anchor`, `…/reattach`, `…/accept-suggestion` | Editorial notes |
| `GET …/approvals` · `POST …/approve` | `{baseHash, note, confirm: true}` |
| `GET /proposals`, `GET /proposals/targets`, `GET …/:pid/preview`, `PATCH …/:pid`, `POST …/:pid/reject`, `POST …/:pid/apply` | Canon proposals |
| `GET /reference`, `GET /reference/file?path=`, `GET /search?q=&layers=` | Library |
| `GET /export?which=draft|approved` | Whole manuscript as Markdown |

## Source map

```
shared/   types.ts · text.ts (words, scenes, offset-preserving tokenizer) · anchor.ts · diff.ts
server/   project.ts (layout, layers) · fsutil.ts · git.ts · chapters.ts · versions.ts
          comments.ts · commentStore.ts · approvals.ts · reference.ts · importer.ts
          export.ts · app.ts (HTTP) · index.ts · ai/{types,context,index}.ts
src/      App.tsx · api.ts · ui.tsx · markdown.ts · styles.css
          components/ Sidebar · ChapterView · Reader · Editor · CommentsPanel
                      ContinuityPanel · ReferencePicker · HistoryView · DiffView
                      LibraryView · ProposalsView · ApprovalDialog
scripts/  init-project · import · backup · export · demo · dev
tests/    text · anchor · diff · workspace (end-to-end over HTTP and real Git)
```

## Future AI editor

The seam is `server/ai/`:

- `types.ts` defines `EditorialAssistant`: `reviewPassage`, `suggestRewrite`,
  `checkContinuity`, `compareScenes`. Each returns `AISuggestion`s carrying a
  category, a range, the observation, **mandatory reasoning**, an optional
  replacement text and cited sources.
- `context.ts` builds the context in order of authority, labels every excerpt with its
  layer, excludes legacy text by default, and attaches ground rules: propose, never
  decide; say when a fact isn't established; cite sources.
- `index.ts` returns the active provider. Today that's `none`, so the workspace runs
  fully without AI.

To add a provider: implement the interface, return it from `getAssistant()`, and add
routes that store each suggestion through `createComment()` with `role: "ai"`. The
existing UI already shows AI notes as *Suggestion*, with their reasoning, and their
wording reaches the draft only through **Accept into draft…**. That path snapshots
the chapter as "Before AI-assisted revision" first. Comparing two scenes and
reviewing dialogue, pacing or psychology are the same pattern with a different
`focus`.

## Deliberately not in this version

- Real-time collaboration and user accounts. Contributors are named on each note;
  there is one local author.
- Rich-text (WYSIWYG) editing. The text stays Markdown so it remains portable.
- Writing to working ideas or directives from the app. Edit those files in any
  text editor; the workspace records the change on its next start.
- Reading `.docx` or `.pdf` reference files. They're stored and listed; convert them
  to Markdown to make them searchable.
- Any AI provider (see above).
