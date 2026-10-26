# The Long Picture — Editorial Workspace

A private, local-first workspace for writing and editing a long literary novel with
editorial collaborators, human or AI. It runs on your own computer in your browser.
There is no cloud service, account or API key.

- **Manuscript:** chapters are plain Markdown files. Read and edit them in a quiet,
  book-like view, scene by scene.
- **History:** every save is recorded with Git. You can name versions, compare any two
  side by side (word-level insertions and deletions) and restore earlier text
  without losing the current text.
- **Editorial notes:** select a passage and attach a developmental, character,
  continuity, pacing, dialogue or prose note. Notes can be discussed, resolved,
  rejected or deferred, and they record your final decision. They follow their
  passage through revisions, and are flagged when the passage changes.
- **Canon & reference library:** read and search the canon, your directives, working
  ideas and the legacy archive. Every result is labelled with its layer, so canon is
  never confused with an idea or a superseded draft.
- **Approval:** you approve a chapter explicitly. The approved text is frozen
  separately and is never overwritten. Proposed summary and continuity updates are
  drafted for you, and canon changes only after a separate confirmation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, the data model and
the plan for AI integration.

---

## 1. Install

You need:

- **Node.js 20 or later** — <https://nodejs.org> (the LTS installer is fine)
- **Git** — macOS: run `git --version` in Terminal and accept the prompt to install the
  developer tools. Windows: <https://git-scm.com>.

Then, in a terminal, from this folder (`editorial-workspace/`):

```bash
npm install
```

## 2. Try it with the sample project

```bash
npm run demo
```

Open <http://localhost:4317>. The demo uses invented sample material from
`sample-project/` (not your novel), copied into `.demo-project/`. Delete that folder
to start the demo afresh. Press `Ctrl+C` in the terminal to stop.

## 3. Set up your manuscript project

Your manuscript lives in its own folder, separate from this application. By default
that folder is `~/TheLongPicture`. Use `--project <folder>` on any command (or set
`TLP_PROJECT`) to use another location.

```bash
# Create the project folder and its version history
npm run init-project -- --title "The Long Picture" --author "Your Name"

# Import your existing documents (copied unaltered; your originals are only read)
npm run import -- canon       "/path/to/master canon, characters, style, briefs …"
npm run import -- directives  "/path/to/current redevelopment instructions"   # optional
npm run import -- ideas       "/path/to/working ideas"                          # optional
npm run import -- legacy      "/path/to/previously approved chapters"
npm run import -- chapters    "/path/to/current chapter drafts"

# Start the workspace
npm start
```

Then open <http://localhost:4317>.

**About the import:**

- Files are copied byte for byte, and a SHA-256 fingerprint of each is recorded. The
  library shows *verified* for files unchanged since import, and *changed* if one
  was later altered outside an author-confirmed update.
- Nothing in the project is ever overwritten. If a file with the same name but
  different content already exists, the importer lists it and leaves it alone.
- Run imports while the workspace is stopped.
- Text files (`.md`, `.markdown`, `.txt`) can be read and searched. Other files, such as
  `.docx` or `.pdf`, are stored but can't be displayed or searched. Searches tell you
  how many files they skipped, so "no results" is never claimed for files that
  weren't read. To convert Word files: `pandoc file.docx -t gfm -o file.md`.
- **Chapter drafts:** one file per chapter, with the chapter number in the file name
  (e.g. `07 - The Screening.md`). A leading `# Title` line becomes the chapter title.
- **Legacy chapters** go to `archive/legacy/`. You can read and search them and
  compare them with the new drafts, but they are always labelled as not governing.
  The rule is "newer author instructions override", so put those instructions in
  `directives/`.

## 4. Everyday use

| To…                          | Do this                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Read                          | Choose a chapter. **Read** mode shows the text as a book page. Scenes are listed under the chapter in the left column. |
| Write                         | Switch to **Edit**. You are editing the Markdown directly: `*italic*`, `## Scene title`, `* * *` for a scene break. |
| Save                          | **Save** or `Ctrl/⌘ S`. Each save is recorded in the history. Unsaved text is also kept in a recovery copy every couple of seconds. |
| Mark a milestone              | **Version…** gives the current text a name, e.g. "Draft 3 — before cutting the prologue". |
| Compare                       | **History** opens the version list. Choose *Left* and *Right* on any two entries, including approved, superseded and legacy text. |
| Go back to an earlier text    | **History → Restore…**. The current draft is saved first as "Before restoring …", so a restore can itself be undone. |
| Comment                       | Select a passage. In Read mode a **Comment** button appears; in Edit mode use **Comment** in the toolbar. Pick a type, write the note, and optionally cite a reference or suggest wording. |
| Decide on a note              | Open the note and choose **Resolve**, **Reject** or **Defer**, with an optional decision note. Replies keep the discussion and any disagreement on record. |
| Check continuity              | **Notes → Continuity** searches the reference library for a selected name or phrase. **Canon & reference library** in the left column browses and searches everything. |
| Approve                       | **Approve…**, tick the confirmation and approve. Then review **Proposed canon updates**: edit, preview and confirm each one separately. |
| Concentrate                   | **Focus** hides everything but the text (`Esc` to leave). **Night** in the lower left switches to dark mode. |
| Export                        | **Export drafts** / **Export approved** in the lower left, or `npm run export -- draft` / `npm run export -- approved`. |

## 5. Adding chapters

- **In the app:** **+ Chapter** in the left column. Choose a number and title.
- **By hand:** create `manuscript/chapters/ch12/chapter.md` in the project folder.
  The folder name gives the number. A leading `# Title` gives the title. The
  workspace records it in the history the next time it starts.
- **From files:** `npm run import -- chapters <folder>`. Existing chapter numbers are
  never replaced.

## 6. Backups

The project folder holds everything: text, notes, versions, approvals. Its full
history is in the hidden `.git` folder inside it. Keep more than one copy:

1. **Single-file backup:** writes a verified Git bundle containing the complete history.

   ```bash
   npm run backup                       # into ../TheLongPicture-backups/
   npm run backup -- "/Volumes/USB/Backups"
   ```

   Restore with: `git clone TheLongPicture-2026-10-26-13-14.bundle TheLongPicture`

2. **Ordinary backup software** (Time Machine, File History, an external drive) works
   too. Back up the whole folder, including the hidden `.git` folder.

3. **Optional private remote:** create a *private* repository on GitHub, GitLab or
   similar, then in the project folder run `git remote add origin <url>` and
   `git push -u origin HEAD`. Run `git push` whenever you want an off-site copy. The
   workspace itself never pushes anything anywhere.

Avoid putting the project in a folder that a sync service (Dropbox, iCloud Drive,
OneDrive) rewrites while the workspace is running. The workspace refuses to save
over a file that changed underneath it, but sync conflicts are still best avoided.

## 7. What protects the manuscript

- **No silent overwrites.** Each save carries a fingerprint of the text it was based
  on. If the file changed meanwhile (another window, another editor), the save is
  refused and your text is kept in recovery.
- **Everything is history.** Every save, restore, note, approval and canon update is
  a Git commit. Nothing the workspace does deletes a commit.
- **Restores, suggestions and approvals snapshot first.** Before a restore, and
  before accepting any suggested wording (including from an AI editor), the current
  draft is saved as a named version.
- **Approved text is frozen.** `approved/chNN.md` is written only by an explicit
  approval. A later approval first moves the earlier text to `archive/superseded/`.
- **Canon is read-only.** The app has no way to edit reference files. Canon changes
  only by appending an author-confirmed proposal, after a preview, and only if the
  file is unchanged since that preview.
- **Nothing is promoted silently.** Notes, suggestions and proposals never alter the
  draft or canon by themselves. Each change is a separate, explicit author action.
- **Unsaved text survives.** A recovery copy is kept while you type. If it's found
  later you're offered *Compare*, *Restore into editor* or *Set aside*. Setting it
  aside moves it to `.recovery/discarded/` rather than deleting it.
- **Local only.** The server listens only on `127.0.0.1` and rejects requests from
  other websites.

## 8. Development

```bash
npm run dev         # API with auto-restart + Vite dev server on http://localhost:5173
npm test            # 45 automated tests (text model, anchoring, diff, full API over real Git)
npm run typecheck
npm run build       # production UI into dist/
```

## Troubleshooting

- **"Port 4317 is already in use"** — the workspace is probably already running in
  another terminal. Otherwise start with `npm start -- --port 4318`.
- **"The chapter on disk has changed since you opened it"** — the file was edited
  elsewhere. Choose **Load the newer version**; your text is offered back as recovered
  text so you can compare and merge.
- **"No manuscript project found"** — run `npm run init-project`, or pass
  `--project` with the right folder.
