# The Big Brain

A thinking partner for one person and their projects.

This document is the complete specification. It describes the system as it should exist when built. There is no "prior version" to migrate from. Build to this.

---

## What it is

The Big Brain is a single-user system that organizes how you think across multiple coding and creative projects.

It has three surfaces:

1. **Project Managers** — one chat per project, deeply embedded in that project's repo. Where work happens.
2. **The Board** — a glance view of every active project's current state. Where you orient.
3. **The Brainstorm Room** — a thinking space with two voices (Brain 1 and Brain 2) that see across everything. Where you wander.

A persistent **dropnote box** is available everywhere for ambient capture.

Projects are GitHub repos. The system is a layer over GitHub: the repo is the source of truth for the project's memory; the system's database holds only what's needed to run the conversation.

---

## The three surfaces

### 1. Project Manager Chat

The primary work surface. One manager per project.

A **project** is a GitHub repo that has been "claimed" — meaning a `.ceo/` directory has been committed to it. Without `.ceo/`, the repo is just a repo. With it, the repo is a project, and a manager is bound to it.

The manager:

- Reads the `.ceo/` directory contents on every session start as part of its system prompt
- Can read the rest of the repo (file structure, README, source files) via GitHub's API when needed
- Accepts user messages and file uploads (text, images, PDFs, spreadsheets) in the chat
- Drafts Claude Code prompts and dispatches workers when execution is needed
- Reviews worker results and reports back to the user
- Posts to the Board on its own judgment, at end of session, or via manual user trigger
- Writes to its own `.ceo/` files as housekeeping in its own workspace

The manager is functional, not a named character. Its voice is direct, practical, repo-aware, low-ego — the voice of a good thoughtful senior engineer who has read the file you were about to ask about.

The manager's full system prompt is in [`prompts/manager.md`](prompts/manager.md).

### 2. The Board

A glance surface. Pop-out drawer from the bottom of the screen.

For each active project, the Board shows:

- **Goal** — one sentence in a strong phrase
- **What's next** — one strong phrase
- (Click to expand: last activity timestamp, current state, last action, blockers, freeform note)

Updated by each project's manager. Three triggers:

- **Behavior** — the manager decides when. The system tells the manager: "you post to the Board regularly and at end of session." The manager uses judgment about when.
- **Manual per-project** — a button in the project's chat to "post current state to the board now."
- **Manual global** — a button in the Board itself to "ask all managers to post fresh."

The Board is read by you (primary user), the Brainstorm Room's two brains (when they need cross-project context), and by other managers if relevant.

#### The `.ceo/board.md` file format

Each project's board entry is stored in `.ceo/board.md` with YAML frontmatter:

```markdown
---
goal: <one sentence>
state: <one or two sentences>
next_move: <one strong phrase>
blockers: <list, or empty string if none>
updated_at: <ISO 8601 timestamp>
---

# Board

<freeform manager note, if any — human-readable prose, optional>
```

The Worker's `/api/board` aggregation parses the YAML frontmatter for the glance view. The body is read-only narrative for humans; it doesn't affect the aggregation.

When the manager emits `post_to_board`, the Worker constructs this file format from the structured fields and commits it. Round-tripping (manager reads board.md on session start, sees the structured fields in its context) preserves the data shape.

### 3. The Brainstorm Room

The thinking space. Separate full surface (not a project pane).

Two AI voices in conversation with you:

- **Brain 1** leads. Logical, analytical, primary responder.
- **Brain 2** chimes in. Emotional, intuitive, perceptive. Responds when prompted ("what does Brain 2 think?") or when the conversation pulls for an emotional/intuitive reading.

The brains can talk to each other in front of you. You can direct messages to either.

The brains have **full read access** to:

- All of your repos (file trees, file contents, READMEs, commit history)
- All chats across all project managers
- All dropnotes (read and archive privileges)
- The Board

The brains **can propose** creating new projects. When wandering through ideas, if something hardens into a real project, Brain 1 or Brain 2 can say "this should be its own project — want me to spin one up?" The user confirms. The brains then either claim an existing repo or create a new one, scaffold its `.ceo/` directory, and set up the manager.

The brains **cannot**:

- Push code to existing repos (only workers do that, dispatched by managers, under user confirmation)
- Dispatch workers themselves
- Make destructive changes to anything

Brain 1's system prompt: [`prompts/brain-1.md`](prompts/brain-1.md)
Brain 2's system prompt: [`prompts/brain-2.md`](prompts/brain-2.md)

The Brainstorm Room is for thinking, wandering, cross-cutting conversation. **It is not where you ask about specific project issues.** Those go to the project's manager.

#### Two-brain orchestration

The BrainstormDO orchestrates which brain speaks on each turn:

1. **User message arrives.** Call Brain 1 first.
2. **Brain 1 responds.** Stream Brain 1's reply to the client (prefixed with `event: speaker, data: {"brain": "brain1"}`).
3. **Parse Brain 1's response for a `tag_brain_2` fenced block.** If present, fire a Brain 2 call with Brain 1's full reply + the `why` field as additional context. Stream Brain 2's reply (prefixed with `event: speaker, data: {"brain": "brain2"}`).
4. **If the user explicitly addresses Brain 2** (the BrainstormDO parses for "Brain 2," "what does Brain 2 think," or similar lightweight heuristics on the user's message): skip Brain 1, call Brain 2 only.
5. **Brain 2 can tag Brain 1 back** via a `tag_brain_1` fenced block. Symmetric mechanism. The DO can run a few back-and-forths but caps at a safe limit (3 brain calls per user turn) to avoid loops.

Tag block format:

````
```tag_brain_2
why: <short reason — what Brain 2 might want to weigh in on>
```
````

The DO parses these out before persisting the message (so the user doesn't see the raw tag block in chat history — they see the labeled brain replies, that's it).

#### Brainstorm message persistence

Each brain reply is a separate row in `messages` with `role = 'assistant'` and `brain = 'brain1'` or `brain = 'brain2'`. User messages have `brain = NULL`. The chat history is read back in `created_at` order; the frontend renders each row labeled by speaker.

### The dropnote box (cross-surface)

A persistent text-only input at the bottom-left of the app. Always visible. Type a thought, press Enter, the thought is captured and the input clears.

- Single-line input. Does not grow when typing.
- Visible feedback on capture (placeholder flashes "captured" for a beat).
- A small expand chevron to peek at recent drops (most recent 5–10, with timestamps).
- The brains read all dropnotes and archive them on their own judgment.

The dropnote is independent of any project. It's ambient capture — for thoughts that don't yet belong to a project.

---

## The bright line

**The user is the only one who changes state on their work.**

Specifically:

- Managers and brains can think, brainstorm, research, draft, review, recommend.
- They can read anything.
- They cannot push code, commit, rename projects, or take irreversible actions without an explicit user click on a confirm-affordance.

**Two narrow exceptions:**

1. Managers write to their own `.ceo/` files as housekeeping in their own workspace. This is not state change to user code — it's the manager maintaining its own memory.
2. The brains and managers can propose state changes (create a project, dispatch a worker, post to the board) via inline affordances. The affordance is the user's signoff.

Workers are the only path to code changes in user repos. Workers always require user confirmation to dispatch.

---

## Architecture

### Stack

- **Cloudflare Workers** — single Worker, routes `/api/*` and serves the SPA assets
- **Durable Objects** — one per project (ManagerDO), one for the brain pair (BrainstormDO), one for the agent connection (AgentHubDO)
- **D1** — operational state (chat sessions, messages, dropnotes, projects-as-chat-plumbing rows, worker job state)
- **Local agent** — a Node process on the user's machine, persistent websocket to the AgentHubDO, executes Claude Code workers locally and streams output back
- **Frontend** — Vite + React + TypeScript + Tailwind v3. SPA, single bundle, ships from the same Worker.
- **GitHub API** — for repo list, file reads, file writes (`.ceo/` directory commits on claim)

### Cloudflare bindings

Pin these names from day one:

- `DB` — D1 database binding
- `MANAGER_DO` — ManagerDO Durable Object namespace
- `BRAINSTORM_DO` — BrainstormDO Durable Object namespace
- `AGENT_HUB_DO` — AgentHubDO Durable Object namespace
- `ASSETS` — static assets binding (modern `[assets]` block in wrangler.toml, with `not_found_handling = "single-page-application"` for client routing)

### Data model

#### What lives in GitHub (durable, source of truth)

Each claimed repo has a `.ceo/` directory at the root:

```
.ceo/
  README.md      — explains what this directory is
  goal.md        — what this project is for, user's words
  context.md     — what the manager needs to know to be useful here
  decisions.md   — log of significant decisions with dates
  board.md       — current state snapshot (goal, state, next, blockers) with YAML frontmatter
  uploads/       — files the user has dropped in the manager chat
                   (created lazily on first upload)
```

These files are committed to git. The manager reads them on every session. If the system's database is wiped, the project's memory survives because it's in the repo.

#### What lives in D1 (operational, ephemeral)

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                  -- UUID, internal
  repo_full_name TEXT NOT NULL UNIQUE,  -- e.g., "mrmicaiah/the-big-brain"
  clone_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,                  -- UUID
  surface TEXT NOT NULL,                -- 'manager' | 'brainstorm'
  project_id TEXT,                      -- NULL for brainstorm; FK for manager
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,                  -- UUID
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'user' | 'assistant' | 'system'
  brain TEXT,                           -- 'brain1' | 'brain2' | NULL (NULL for manager surfaces and user messages)
  content TEXT NOT NULL,
  attachments TEXT,                     -- JSON array of attachment metadata (paths, types)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dropnotes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE execution_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,                 -- queued | running | succeeded | failed
  output_stream TEXT,
  diff_summary TEXT,                    -- JSON: { summary, diffStat, diff } or { error, stage }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  manager_seen_at TEXT                  -- when the manager last folded this result into context
);

CREATE INDEX idx_projects_repo_full_name ON projects(repo_full_name);
CREATE INDEX idx_chats_project ON chats(project_id);
CREATE INDEX idx_chats_surface ON chats(surface);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX idx_dropnotes_unarchived ON dropnotes(archived_at, created_at);
CREATE INDEX idx_jobs_manager_unseen ON execution_jobs(project_id, status, manager_seen_at);
```

That's the whole schema. If D1 is wiped, projects-as-repos still exist on GitHub and can be re-claimed; only chat histories and dropnotes are lost.

### Durable Objects

#### ManagerDO

One per project. **Addressed by `idFromName(repo_full_name)`** — using the GitHub repo's full name as the natural key. Survives D1 wipes: if D1 is reset and the same repo is re-claimed, the same DO instance is reached.

Handles:
- `POST /chat` — streamed chat turn with the manager (system prompt = MANAGER_PROMPT + project context from `.ceo/`)
- `GET /manager-chat` — idempotent resolve: find or create the canonical manager chat for this project, return `{ chatId, projectId, created }`
- `POST /board-post` — write `.ceo/board.md` via GitHub API; returns the commit sha
- `POST /ceo-update` — write to one of the `.ceo/` files (goal, context, decisions); returns the commit sha

Internal storage: 60-second TTL cache of the four `.ceo/` content files (goal.md, context.md, decisions.md, board.md). On cache miss, fetch via a single GitHub API call (either `git/trees/<sha>?recursive=1` on the `.ceo/` tree, or the directory listing endpoint — implementation choice, just one round-trip). Cache invalidated on any `board-post` or `ceo-update`.

#### BrainstormDO

Singleton (addressed by `idFromName("singleton")`).

Handles:
- `POST /chat` — streamed chat turn with the brains, orchestrating Brain 1 / Brain 2 per the protocol above
- `GET /resolve` — idempotent resolve: find or create the canonical Brainstorm Room chat, return `{ chatId, created }`

Each brain call builds its system prompt from `prompts/brain-1.md` or `prompts/brain-2.md` plus a context block including:
- The Board's current state (read from each project's `.ceo/board.md` via cached fetch)
- All recent dropnotes (last 50, unarchived)
- The Brainstorm Room's chat history

The DO does NOT have read access to specific project chats by default. Read access is fetched on-demand when the brains explicitly request it via a tool call (see "Brain tools" below).

#### AgentHubDO

Singleton. Manages the persistent websocket connection to the local Node agent.

Handles:
- `WS /connect` — agent connects and stays connected
- `POST /dispatch` — Worker sends a job to the agent; if no agent is connected, queue it; flush queue on next connect
- `GET /subscribe/:jobId` — SSE stream of a running job's output to the frontend

Forwards job execution to the agent, persists output stream + final diff summary to D1's `execution_jobs` table.

### The local agent

A Node process running on the user's machine. Persistent websocket to AgentHubDO via `wss://<worker-domain>/api/agent/ws` with `Authorization: Bearer ${AGENT_TOKEN}`.

On receiving a job dispatch:
1. Clones the project repo to `<REPOS_DIR>/<repo-name>` if it isn't already there (uses `clone_url` from the job payload)
2. Invokes Claude Code SDK with the prompt against that repo
3. Streams stdout/stderr to the websocket
4. On completion: runs `git diff --stat`, runs `git diff`, sends a summary back

Agent code lives in [`agent/`](agent/). For Phase 4, this code can be lifted forward from the existing `mrmicaiah/the-ceo` repo's `agent/` directory — the protocol is unchanged.

### Frontend

Vite + React + TypeScript + Tailwind v3. Single bundle.

#### Layout

```
+---------------------------------------------------------------+
| [Project A] [Project B •] [Project C]              [+]        |  top dock
+---------------------------------------------------------------+
|                                                                |
|                                                                |
|        WORKSPACE — project panes (1/2/3/4 grid)                |
|                                                                |
|                                                                |
+--------------------------------+-------------------------------+
| [drop a note...]      [^]      | [Brainstorm Room]  [Board]    |  bottom bar
+--------------------------------+-------------------------------+
```

- **Top dock**: project tabs. Active pane gets 1px accent left-edge bar. Minimized projects show as muted chips with a notification dot when there's activity. Click a tab to switch/restore. Hover reveals × to close from dock. `+` button at right opens the project picker.
- **Workspace**: edge-to-edge. Pane grid morphs with count: 1 pane = full-width; 2 panes = side-by-side; 3 panes = 2 top + 1 full-width bottom; 4 panes = 2×2. Beyond 4 panes: opening a 5th auto-minimizes the least-recently-touched visible pane (LRU rule).
- **Bottom-left**: dropnote box. Single-line, persistent, text-only. Stays small while typing. Small `^` chevron to peek at recent drops.
- **Bottom-right**: two buttons. "Brainstorm Room" takes over the workspace as a full surface. "Board" pops up as a drawer from the bottom.

No left rail. No right rail. No CEO surface.

#### Project picker (the `+` button)

A small dropdown:

```
YOUR PROJECTS
─────────────
mrmicaiah/the-big-brain
mrmicaiah/refervo-app

OTHER REPOS
─────────────
mrmicaiah/some-other-repo    Make this a project →
mrmicaiah/another            Make this a project →
...

─────────────
+ New project
```

- **Your projects**: repos with `.ceo/` directories (= D1 project rows exist). Click to open.
- **Other repos**: user's GitHub repos without `.ceo/`. Each has a "Make this a project →" affordance.
- **+ New project**: opens a small modal (name + description + private toggle) → creates a new GitHub repo + claims it.

Claiming = create D1 row + commit `.ceo/` scaffold to repo + open as a new project pane. The claim endpoint is idempotent: if the repo already has `.ceo/` (e.g., D1 was wiped but the repo is intact), skip the scaffold, upsert the D1 row, return `{ projectId, isNew: false }`.

#### Visual language

- Background: warm paper (`#F8F5EE` ink-tone), 4% grain overlay
- Ink: near-black (`#1C1A17`)
- Accent: ink-blue (`#1E3A5F`)
- Divider: warm gray hairline (`#E5DFD2`)
- Display font: Fraunces (serif, slight quirk)
- Body font: Geist (sans)
- Mono font: JetBrains Mono
- No bubbles in chat. Speaker labels in Fraunces, body text in Geist, paragraphs of correspondence.
- 1px accent left-edge bars for active states (tabs, list items, panes)
- Hairline 1px rules separate sections
- Streaming responses pulse with a soft ink-marker animation
- No purple gradients. No card shadows except for modals. Editorial restraint throughout.

### Endpoints

```
GET  /health                              — open, no auth, returns { ok: true, version: <commit-sha> }

# Auth: Bearer AUTH_TOKEN required for everything else except /api/agent/ws
GET  /api/repos                           — list user's GitHub repos with isProject flag
POST /api/projects/from-repo              — claim a repo as a project (scaffold .ceo/; idempotent)
POST /api/projects/new                    — create new repo + claim
GET  /api/projects/:id                    — single project row

GET  /api/projects/:id/manager-chat       — resolve canonical manager chat
POST /api/projects/:id/manager/chat       — streamed chat turn with manager
POST /api/projects/:id/board-post         — manual board post trigger
POST /api/projects/:id/dispatch-claude-code  — dispatch worker

GET  /api/brainstorm/resolve              — resolve canonical brainstorm chat
POST /api/brainstorm/chat                 — streamed chat turn (DO orchestrates brains)

GET  /api/board                           — read all .ceo/board.md files, aggregate

POST /api/dropnotes                       — capture a dropnote
GET  /api/dropnotes                       — list unarchived dropnotes
POST /api/dropnotes/:id/archive           — archive a dropnote (brain-callable)

POST /api/uploads                         — upload a file to .ceo/uploads/ in a project's repo
GET  /api/jobs/:id                        — snapshot of a worker job
GET  /api/jobs/:id/stream                 — SSE stream of a running job

WS   /api/agent/ws                        — local agent connection (Bearer AGENT_TOKEN)
```

### Streaming protocol

All chat endpoints stream Server-Sent Events:

```
event: text
data: {"delta": "..."}

event: action
data: {"type": "dispatch_claude_code", "...": "..."}

event: done
data: {}

event: error
data: {"message": "..."}
```

#### Action parsing under streaming

The Worker streams text deltas as they arrive from the Anthropic API. When a delta contains the opening of a fenced action block (e.g., ```` ```dispatch_claude_code ````, ```` ```post_to_board ````, ```` ```tag_brain_2 ````, etc.), the Worker:

1. Stops emitting `event: text` deltas.
2. Buffers all subsequent deltas until the closing ```` ``` ```` of that fenced block.
3. Parses the buffered content into a structured action object.
4. Emits a single `event: action` with the structured object.
5. Resumes streaming `event: text` deltas for any content after the fence close.

The frontend renders text deltas as streaming prose and renders action events as inline affordances. The raw fenced blocks are never shown to the user — they're machine instructions, not content.

#### Speaker events (Brainstorm Room only)

For the Brainstorm Room, an additional event identifies which brain is speaking:

```
event: speaker
data: {"brain": "brain1"}
```

The frontend renders subsequent text events as that brain's speech until the next speaker event. The BrainstormDO emits the speaker event before each brain call's stream begins.

### Brain tools

When the brains need information beyond what's in their context block (Board, dropnotes, brainstorm history), they can call tools that fetch on-demand:

- `read_project_briefing(repo_full_name)` — fetches the `.ceo/` files for a specific project
- `read_repo_file(repo_full_name, path)` — fetches a specific file from a repo
- `list_repo_files(repo_full_name)` — fetches the file tree of a repo
- `read_project_chat(project_id, last_n_messages)` — fetches recent messages from a project's manager chat
- `propose_new_project(name, description, fromRepo?)` — emits a fenced block that renders as a confirm-affordance for the user
- `archive_dropnote(dropnote_id)` — marks a dropnote as archived

These are Claude tool definitions, surfaced as fenced blocks the brains can emit. The Worker handles them and either fetches the data (read tools), renders a confirm-affordance (`propose_new_project`), or executes the write (`archive_dropnote` — brains have permission to archive dropnotes without user confirmation; archiving is reversible and low-stakes).

### Manager tools

- `dispatch_claude_code(summary, prompt)` — emits a fenced block that renders as a "Run Claude Code →" affordance
- `post_to_board(goal, state, next_move, blockers, note?)` — commits an update to `.ceo/board.md`
- `update_ceo_file(file, content)` — commits an update to one of the `.ceo/` files (goal, context, decisions). Housekeeping in the manager's own workspace.
- `request_file_upload(prompt)` — surfaces a prompt to the user asking for a file (used when the manager wants context it doesn't have)

#### `manager_seen_at` semantics

When the ManagerDO builds a chat prompt for a turn, it queries terminal job rows for this project that the manager hasn't reviewed yet:

```sql
SELECT * FROM execution_jobs
WHERE project_id = ?
  AND status IN ('succeeded', 'failed')
  AND manager_seen_at IS NULL
ORDER BY completed_at ASC;
```

For each result, the DO folds the job's summary + diff into the system prompt as "Recent worker results you haven't reviewed." Then it sets `manager_seen_at = datetime('now')` for those rows. Next turn, those jobs are not re-folded — only newer terminal jobs.

---

## Environment

Required environment variables on the Worker (set as Cloudflare secrets):

- `ANTHROPIC_API_KEY` — for all Claude model calls (managers + brains)
- `AUTH_TOKEN` — Bearer token validated on every `/api/*` request
- `GITHUB_TOKEN` — Personal Access Token (classic, `repo` scope) for listing/reading/writing user repos
- `AGENT_TOKEN` — separate Bearer for the local agent's websocket connection

Required on the frontend at build time (in `web/.env`):

- `VITE_AUTH_TOKEN` — must match the Worker's `AUTH_TOKEN`

Required on the local agent (in `agent/.env`):

- `AGENT_TOKEN` — must match the Worker's `AGENT_TOKEN`
- `WORKER_URL` — the deployed Worker's URL
- `REPOS_DIR` — local directory where the agent clones repos (e.g., `C:\Users\mrmic\Projects`)
- `ANTHROPIC_API_KEY` — for the Claude Code SDK

**Model ID:** all Claude model calls use `claude-opus-4-5`. Pin this as a single exported constant `MODEL_ID` in `src/lib/claude.ts` so a future change is one line.

**Local dev:**
- Vite dev server on `http://localhost:5173`, proxies `/api/*` and `/health` to the Worker.
- Wrangler dev on `http://localhost:8787` (serves the Worker with `.dev.vars` for local secrets).
- Run both with `npm run dev` at the root (concurrently).
- In prod: the Worker serves both `/api/*` and the built SPA bundle via the `[assets]` binding.

---

## Build order

The system should be built in phases. Each phase ships a working state.

**Phase 1: Foundation**
- Cloudflare Worker scaffold + D1 schema applied
- Auth gate on `/api/*`
- `/health` endpoint returning `{ ok: true, version: <commit-sha> }`
- Frontend scaffold (Vite + React + Tailwind v3, design language applied)
- The app loads, shows empty state, no functionality yet

**Phase 2: Picker + claim**
- `/api/repos` (GitHub list)
- `/api/projects/from-repo` (claim + scaffold `.ceo/`; idempotent)
- `/api/projects/new` (create + claim)
- Frontend picker (two-section dropdown + new project modal)
- Clicking a repo claims it and opens a placeholder pane

**Phase 3: Manager chat**
- ManagerDO with system prompt + `.ceo/` reading
- `/api/projects/:id/manager-chat` and `/api/projects/:id/manager/chat`
- Frontend project pane with chat view, streaming, composer
- Manager can hold a conversation about its project

**Phase 4: Workers**
- AgentHubDO + agent websocket
- `dispatch_claude_code` action support + inline affordance
- The agent runs locally and executes worker jobs (lift forward from `mrmicaiah/the-ceo/agent/`)
- The full loop: user asks for code work → manager drafts prompt → user clicks Run → worker executes → diff streams back → manager comments on result

**Phase 5: Dropnotes**
- `/api/dropnotes` endpoints (create, list, archive)
- DropnoteBox component
- Persistent capture working

**Phase 6: The Board**
- `/api/board` aggregation (parses YAML frontmatter from each `.ceo/board.md`)
- BoardDrawer pop-out from bottom-right
- `post_to_board` manager tool
- Manual trigger buttons

**Phase 7: Brainstorm Room**
- BrainstormDO with two-brain orchestration (tag block protocol)
- `/api/brainstorm/*` endpoints
- Frontend BrainstormRoom full-surface component
- Brain tools for cross-project access
- `propose_new_project` flow

**Phase 8: File upload**
- `/api/uploads` endpoint (commits to `.ceo/uploads/` in repo)
- File picker in manager composer
- Multi-modal Claude API calls including attachments

Each phase requires the previous phases. Don't skip ahead.

---

## What's NOT in scope (initial build)

- Mobile layout (desktop-first; mobile is a separate design problem)
- Multi-user / accounts (single-user system; auth is a static token)
- Public sharing (everything is private)
- Search across chats / repos / dropnotes (out for first build; add when needed)
- Manager-to-manager handoffs (not part of the v3 design; the brains are the cross-project layer)
- Manager personality / naming (managers are functional, not named characters)
- Wrap-chat reports / status pings (not part of the v3 design; the Board replaces this)
- Long-term memory beyond `.ceo/` files (sufficient for v0)
- Token-cost optimization (acceptable for v0)
- Cookie-based session auth (the static `VITE_AUTH_TOKEN` in the bundle is accepted v0 tradeoff; revisit if URL ever goes public)

---

## Known limitations

Things we've consciously decided not to fix in v0. Recorded here so we don't lose track of them when they bite.

- **Repo rename / default-branch rename invalidates DO state.** The ManagerDO is addressed by `idFromName(repo_full_name)`. If the user renames a claimed repo on GitHub, subsequent requests hit a fresh DO with no chat history and no cached `.ceo/` files; the old DO is orphaned. Same shape for default-branch renames — the cached `defaultBranch` in DO storage goes stale and `.ceo/` reads on the wrong branch start failing. Workaround when this bites: re-claim the renamed repo (creates a fresh manager chat) or undo the rename. Real fix would be a redirect/migration path, deferred.

---

## Repo layout

```
the-big-brain/
├── README.md
├── SPEC.md                    — this document
├── prompts/
│   ├── manager.md
│   ├── brain-1.md
│   └── brain-2.md
├── src/                       — Cloudflare Worker
│   ├── index.ts               — entry, routing
│   ├── types.ts
│   ├── lib/
│   │   ├── github.ts
│   │   ├── claude.ts          — Anthropic API client, MODEL_ID constant
│   │   ├── chat.ts            — streaming chat primitive + action parser
│   │   └── ceoScaffold.ts     — .ceo/ starter file contents
│   ├── durable-objects/
│   │   ├── manager.ts
│   │   ├── brainstorm.ts
│   │   └── agent-hub.ts
│   └── db/
│       ├── schema.sql
│       └── migrations/
├── web/                       — frontend (Vite + React)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── .env.example
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/        — UI components
│       ├── state/             — store + persistence
│       ├── lib/               — api client, utilities
│       └── types.ts
├── agent/                     — local Node agent (Phase 4)
│   ├── README.md
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── agent.ts
│       ├── executor.ts
│       └── workspace.ts
├── wrangler.toml
└── package.json               — root, workspace config for src + web
```

---

## Principles

**One person.** This is a single-user system. No multi-tenancy. No accounts. No invitations.

**The repo is the project.** No project can exist without a repo. The repo's `.ceo/` directory is the project's memory.

**The user is the executor.** Everything in the system reads, drafts, recommends. The user clicks. Workers (the only path to user-data writes) require user confirmation.

**Two minds in the playground.** The Brainstorm Room is a thinking space, not a project tool. You go there to wander, brainstorm, see patterns across your work, capture loose ideas. You go to a manager when you need to do project work.

**Ambient capture.** The dropnote box is always there. Thought → enter → captured. No friction.

**Editorial restraint.** The design language is paper, ink, hairlines, Fraunces, no bubbles, no purple gradients. The product should feel like a quiet, well-made tool, not a startup landing page.

**Don't apologize for limits.** "I can't do that without you" is the contract, not a failure mode.

---

## A note on building this

This spec is the bible. Build to it. If something feels off in the spec, ask before deviating. If something genuinely needs to change, change the spec first, then the code.

Don't build in stages that leave the system half-broken. Each phase should land a usable state.

Don't pile features without a working foundation. Phases exist in order for a reason.

The user is the principal. The principal is one person. The system serves them, not the other way around.
