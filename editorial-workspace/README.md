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
  ideas, historical records and the legacy manuscript. Every result is labelled with
  its layer, so canon is never confused with an idea, a pre-redevelopment record or an
  old draft.
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

## 3. Set up The Long Picture for the redevelopment

Your manuscript lives in its own folder, separate from this application. By default
that folder is `~/TheLongPicture`. Use `--project <folder>` on any command (or set
`TLP_PROJECT`) to use another location.

```bash
npm run setup -- --author "Your Name"
```

This creates:

- the full folder layout, with an **empty manuscript**;
- **Chapter 1, "Background"**: a blank page, marked *Working draft · not approved
  canon*;
- the **redevelopment flag**: older summaries, continuity records and drafts are shown
  as historical references, not as binding canon.

It writes no manuscript text and refuses to touch an existing project.

Then bring in your reference files. You can do this from the terminal:

```bash
npm run import -- canon             "/path/to/project bible, canon, style guide, current continuity"
npm run import -- historical        "/path/to/older chapter summaries and continuity records"
npm run import -- legacy-manuscript "/path/to/older chapter drafts"
npm run import -- directives        "/path/to/redevelopment instructions"   # optional
npm run import -- ideas             "/path/to/working ideas"                # optional
```

Or do it in the app: **Canon & reference library → Add files…**, choosing which
layer the files belong to. Then start the workspace:

```bash
npm start
```

and open <http://localhost:4317>.

**About adding reference files:**

- Files are stored byte for byte and are never altered. A SHA-256 fingerprint of each
  is recorded, and the library shows *verified* for files unchanged since they were
  added.
- Nothing is ever replaced. A different file with the same name is refused and left
  alone. Run command-line imports while the workspace is stopped.
- `.md`, `.txt` and **`.docx`** files can be read and searched. Word files are
  converted in memory for display; the stored `.docx` stays exactly as it was. Other
  files, such as `.pdf`, are stored but not readable, and searches say how many files
  they couldn't read.
- **If a folder mixes categories**, for example current canon alongside old chapter
  summaries, add it all to one layer. Then open a file and use **Move to…** to
  reclassify it (canon → historical, for example). The file keeps its exact contents
  and its history, and notes that cite it follow it. Moving a file into or out of
  canon asks you to confirm.
- **Historical** files (`historical/`) and **legacy manuscript** drafts
  (`archive/legacy-manuscript/`) carry a notice that the novel is being redeveloped
  and they don't govern the new chapters. You can still read, search and cite them,
  and compare legacy drafts with new chapters in **History**.
- If you later have chapter drafts to work on (not just to archive), use
  `npm run import -- chapters <folder>`. One file per chapter, `.md`, `.txt` or `.docx`,
  with the chapter number in the file name (e.g. `07 - The Screening.docx`). They
  become working drafts; importing never approves anything.

## 4. Everyday use

| To…                          | Do this                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Read                          | Choose a chapter. **Read** mode shows the text as a book page. Scenes are listed under the chapter in the left column. |
| Write                         | Switch to **Edit** (empty chapters open there). You are editing the Markdown directly: `*italic*`, `## Scene title`, `* * *` for a scene break. |
| Paste prose                   | Paste into the editor. Text from Word, Google Docs, Pages or a web page keeps its paragraphs, italics and bold. Plain text with one line per paragraph is spaced into paragraphs. `Ctrl/⌘ Z` undoes a paste. |
| Bring in a file               | **Import file…** above the editor reads a `.md`, `.txt` or `.docx` and previews it. Add it after the draft, or replace the draft (the current text is saved as a named version first). |
| Save                          | **Save** or `Ctrl/⌘ S`. Each save is recorded in the history. Unsaved text is also kept in a recovery copy every couple of seconds. |
| Mark a milestone              | **Version…** gives the current text a name, e.g. "Draft 3 — before cutting the prologue". |
| Compare                       | **History** opens the version list. Choose *Left* and *Right* on any two entries, including approved, superseded and legacy-manuscript text. |
| Add or reclassify references  | **Canon & reference library → Add files…** to add; open a file and use **Move to…** to change its layer. |
| Go back to an earlier text    | **History → Restore…**. The current draft is saved first as "Before restoring …", so a restore can itself be undone. |
| Comment                       | Select a passage. In Read mode a **Comment** button appears; in Edit mode use **Comment** in the toolbar. Pick a type, write the note, and optionally cite a reference or suggest wording. |
| Decide on a note              | Open the note and choose **Resolve**, **Reject** or **Defer**, with an optional decision note. Replies keep the discussion and any disagreement on record. |
| Check continuity              | **Notes → Continuity** searches the reference library for a selected name or phrase. **Canon & reference library** in the left column browses and searches everything. |
| Approve                       | **Approve…**, tick the confirmation and approve. Then review **Proposed canon updates**: edit, preview and confirm each one separately. |
| Concentrate                   | **Focus** hides everything but the text (`Esc` to leave). **Night** in the lower left switches to dark mode. |
| Export                        | **Export drafts** / **Export approved** in the lower left, or `npm run export -- draft` / `npm run export -- approved`. |

## 5. Adding chapters

- **In the app:** **+ Chapter** in the left column (or **New chapter** when the
  manuscript is empty). Choose a number and title, then start with an empty page or
  from a `.md`, `.txt` or `.docx` file. Every new chapter is a working draft until you
  approve it.
- **By hand:** create `manuscript/chapters/ch12/chapter.md` in the project folder.
  The folder name gives the number. A leading `# Title` gives the title. The
  workspace records it in the history the next time it starts.
- **From files:** `npm run import -- chapters <folder>`. Existing chapter numbers are
  never replaced.

The workspace never writes chapter text for you. Approval is always a separate,
explicit step.

## 6. Working with Claude (or ChatGPT)

AI editors work like any other editor here. They read, comment and suggest; you
decide. Their notes are marked **Suggestion** and show their reasoning. A suggested
rewrite changes nothing until you click **Accept into draft…**, and the workspace
then saves your previous text as "Before AI-assisted revision". AI editors cannot
edit your chapters, change canon, approve anything or delete anything.

### A. The Claude desktop app (uses your Claude Pro subscription)

1. Install the **Claude desktop app** from <https://claude.ai/download> and sign in.
2. In the `editorial-workspace` folder, run:

   ```
   npm run connect-claude
   ```

   This adds a connector called **the-long-picture** to Claude's settings. The
   settings file is backed up first, and any other connectors are left alone.
3. **Quit Claude completely and open it again.**
4. Start a new chat and ask, for example:
   - *"Using The Long Picture workspace, read Chapter 1 and check it against the
     canon. Leave notes on anything that contradicts it."*
   - *"Review the dialogue in Chapter 2's second scene and leave notes with
     suggested rewrites."*
   - *"Look at my reply on your note about the ferry and respond."*

   The first time, Claude asks your permission before using the connector. You
   can allow it once or always.
5. Open <http://localhost:4317>. Claude's notes are in the **Notes** panel of the
   chapter.

While the Claude app is open it keeps the workspace running, so you don't also need
`npm start`.

Claude can read chapters (draft or approved), read and search the reference
library, read existing notes, add notes and reply to notes. When the references
don't establish something, it's instructed to say so rather than invent canon.

- **Privacy:** what Claude reads is sent to Anthropic as part of your conversation,
  just as if you had pasted it into Claude yourself.
- **To disconnect:** remove the `the-long-picture` entry from Claude's settings
  file (`claude_desktop_config.json`). Restore the backup if you prefer.
- **If you move the `editorial-workspace` or `TheLongPicture` folder:** run
  `npm run connect-claude` again.

### B. Copy and paste (Claude.ai, ChatGPT or any assistant)

1. Optionally select a passage, then in the **Notes** panel choose **Copy request…**.
   Pick what you want: a passage review, rewrites, a continuity check, or a review
   of the whole chapter. Add a question if you like.
   The request includes the chapter, your directives and canon, the house rules
   and a reply format. Historical and legacy files are left out.
2. Paste it into a new chat at claude.ai or chatgpt.com.
3. Copy the whole reply and choose **Paste reply…**. Each note in the reply is
   attached to the passage it quotes. A note whose quote can't be found is never
   guessed: you can attach it to the passage you asked about, or leave it out.

## 7. Backups

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

## 8. What protects the manuscript

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

## 9. Development

```bash
npm run dev         # API with auto-restart + Vite dev server on http://localhost:5173
npm test            # 75 automated tests (text model, anchoring, diff, .docx, full API over real Git, the Claude connector over MCP)
npm run typecheck
npm run build       # production UI into dist/
```

## Troubleshooting

- **"Port 4317 is already in use"** — the workspace is probably already running in
  another terminal. Otherwise start with `npm start -- --port 4318`.
- **"The chapter on disk has changed since you opened it"** — the file was edited
  elsewhere. Choose **Load the newer version**; your text is offered back as recovered
  text so you can compare and merge.
- **Claude doesn't show the connector** — quit Claude fully (not just close the
  window) and reopen it. In Claude's settings, the Developer section lists local
  connectors and any error. Check that `npm install` has been run, and re-run
  `npm run connect-claude`.
- **"No manuscript project found"** — run `npm run init-project`, or pass
  `--project` with the right folder.
