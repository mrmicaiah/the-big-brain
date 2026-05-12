# Phase 2 plan — Picker + claim

End state: open the dock's `+`, see a two-section dropdown of your GitHub repos (claimed and unclaimed), click an unclaimed one to claim it (commits a `.ceo/` scaffold and opens a placeholder pane), or click "+ New project" to create a fresh GitHub repo + claim it in one flow. Manager chat is still Phase 3 — the pane is a stub. The bottom-bar dropnote / Brainstorm / Board buttons remain inert.

When this phase is done:

- `GET /api/repos` returns the user's GitHub repos with an `isProject` flag indicating which already have a `.ceo/` row in D1
- `POST /api/projects/from-repo` is idempotent: claims a repo, scaffolds `.ceo/` if missing, returns `{ projectId, isNew }`
- `POST /api/projects/new` creates a new GitHub repo with auto-init, scaffolds `.ceo/`, claims it
- `GET /api/projects/:id` returns the D1 row for a given project (used for state rehydration)
- The frontend `+` button opens a picker dropdown anchored to itself
- Clicking a claimed repo opens a placeholder pane
- Clicking an unclaimed repo runs the claim flow, then opens a placeholder pane
- "+ New project" opens a modal (name + description + private toggle), creates the repo, opens the pane
- The top dock shows tabs for open projects; clicking a tab focuses that pane; `×` on hover closes it
- Open-project state persists across refreshes (localStorage)

Phase 2 is local-only. No deploy.

---

## Operator prerequisites — required before build starts

Two pieces of operator state must be in place. The build will not start until both are confirmed, matching the Phase 1 `database_id` pattern.

1. **Cloudflare Worker secret.** Run locally:
   ```
   wrangler secret put GITHUB_TOKEN
   ```
   Paste a classic PAT with `repo` scope (full read/write to private repos). Fine-grained PATs work too if granted appropriate per-repo or org access, but classic is simpler for a single-user setup.

2. **Local `.dev.vars`.** Add `GITHUB_TOKEN=<same-PAT>` to the existing `.dev.vars` so `wrangler dev` reads it in the local environment. The PAT value must match the secret set in step 1.

You set both up on your side; tell me when both are in place. I start the build only after that confirmation.

---

## Files

### New (Worker)

- `src/lib/github.ts` — typed GitHub API client (list repos, get repo, check path, scaffold-commit, create repo)
- `src/lib/ceoScaffold.ts` — the five `.ceo/` file contents as constants
- `src/lib/ids.ts` — `newId()` wrapping `crypto.randomUUID()` so tests can mock if ever needed
- `src/lib/router.ts` — tiny hand-rolled `(method, regex) → handler` dispatcher with named-group params
- `src/routes/repos.ts` — `GET /api/repos`
- `src/routes/projects.ts` — `POST /api/projects/from-repo`, `POST /api/projects/new`, `GET /api/projects/:id`

### New (frontend)

- `web/src/state/store.ts` — Zustand store: `openProjects`, `focusedProjectId`, `pickerOpen`, `modalOpen`, repo-list cache. Persisted to localStorage.
- `web/src/lib/api.ts` — `apiFetch(path, init?)` that injects `Authorization: Bearer ${VITE_AUTH_TOKEN}` and parses JSON / throws `ApiError`
- `web/src/lib/types.ts` — shared types: `Repo`, `Project`, `ApiError`
- `web/src/components/ProjectPicker.tsx` — the `+` dropdown
- `web/src/components/NewProjectModal.tsx` — the create-repo modal
- `web/src/components/ProjectPane.tsx` — placeholder pane chrome with header + close
- `web/src/components/Workspace.tsx` — replaces direct render of `EmptyWorkspace`; chooses empty state vs N-pane grid
- `web/src/components/ProjectTab.tsx` — single top-dock tab

### Modified

- `src/index.ts` — replace the inline 404 with router dispatch; pull route handlers from `routes/`
- `src/types.ts` — add `GITHUB_TOKEN: string`
- `.dev.vars.example` — add `GITHUB_TOKEN=<github-pat>` with a comment
- `web/src/App.tsx` — render `<Workspace />` instead of `<EmptyWorkspace />`; mount the modal
- `web/src/components/TopDock.tsx` — render tabs + wire the `+` to toggle picker
- `web/package.json` — add `zustand` dependency

### Unchanged

`wrangler.toml` does not change. `GITHUB_TOKEN` is a Worker **secret** (`wrangler secret put GITHUB_TOKEN`), not a `[vars]` entry — it doesn't belong in committed config.

---

## Environment changes

The operator runs this once before Phase 2 ships to prod:

```
wrangler secret put GITHUB_TOKEN
# paste a classic PAT with `repo` scope
```

For local dev: add `GITHUB_TOKEN=<pat>` to `.dev.vars`. The `.dev.vars.example` will show the placeholder so future-you (or me, next session) knows it's needed.

This is the only operator-side prerequisite for Phase 2.

---

## Endpoint behaviors

### `GET /api/repos`

Authenticated (`Bearer AUTH_TOKEN`). Lists the user's repos with claim status.

**Implementation:**

1. Call `GET https://api.github.com/user/repos?affiliation=owner&sort=updated&per_page=100` with `Authorization: token ${GITHUB_TOKEN}` and `User-Agent: the-big-brain`.
2. **Filter:** `repos.filter((r) => !r.fork && !r.archived)` — carry forward the v2-era pattern. Forks and archived repos don't make sense as project candidates and just clutter the picker.
3. Query D1: `SELECT id, repo_full_name FROM projects` → build `Map<repo_full_name, projectId>`.
4. Annotate each remaining repo with `isProject` and `projectId` (the latter only when claimed).

**Response shape:**

```json
{
  "repos": [
    {
      "full_name": "mrmicaiah/the-big-brain",
      "name": "the-big-brain",
      "description": "...",
      "default_branch": "main",
      "clone_url": "https://github.com/mrmicaiah/the-big-brain.git",
      "private": false,
      "updated_at": "2026-05-12T...",
      "isProject": true,
      "projectId": "<uuid>"
    },
    {
      "full_name": "mrmicaiah/something-else",
      "name": "something-else",
      "default_branch": "main",
      "clone_url": "...",
      "private": true,
      "updated_at": "2026-05-10T...",
      "isProject": false
    }
  ]
}
```

**Pagination:** v0 fetches only the first page (100 repos, sorted by `updated`). If the user has more than 100, we'll add pagination when it matters. Almost certainly not the first thing that breaks.

**Caching:** none for v0. The picker is opened rarely; the cost is tiny.

### `POST /api/projects/from-repo`

Authenticated. Idempotent claim.

**Request body:**

```json
{ "repo_full_name": "mrmicaiah/some-repo" }
```

**Three cases:**

| State | Action | Response |
|---|---|---|
| D1 row exists for this repo | None | `{ projectId, repo_full_name, isNew: false }` |
| No D1 row, `.ceo/` exists in repo | Insert D1 row only | `{ projectId, repo_full_name, isNew: false }` |
| No D1 row, no `.ceo/` in repo | Scaffold `.ceo/` (single commit) + insert D1 row | `{ projectId, repo_full_name, isNew: true }` |

`isNew` means "did we scaffold `.ceo/` this time?" — not "did we insert a D1 row." This matches the spec's idempotent-claim language.

**Implementation:**

1. `SELECT id FROM projects WHERE repo_full_name = ?` → if present, return early with `isNew: false`.
2. `GET /repos/:owner/:repo` → grab `default_branch`, `clone_url`. 404 = bail with 404.
3. `GET /repos/:owner/:repo/contents/.ceo` → 200 = `.ceo/` exists; 404 = it doesn't.
4. If `.ceo/` missing: build a single commit using the Git Data API (tree with `base_tree` + 5 blobs inline) on `default_branch`. Commit message: `Scaffold .ceo/ for The Big Brain`.
5. `INSERT INTO projects (id, repo_full_name, clone_url, default_branch) VALUES (?, ?, ?, ?)`.
6. Return `{ projectId, repo_full_name, isNew }`.

Single-commit scaffold sequence (Git Data API):
- `GET /repos/:o/:r/git/ref/heads/:branch` → head sha
- `GET /repos/:o/:r/git/commits/:headSha` → tree sha
- `POST /repos/:o/:r/git/trees` with `base_tree: <treeSha>` and 5 `tree` entries (inline `content`, mode `100644`, type `blob`) → new tree sha
- `POST /repos/:o/:r/git/commits` with `parents: [headSha]` and `tree: <newTreeSha>` → new commit sha
- `PATCH /repos/:o/:r/git/refs/heads/:branch` with `sha: <newCommitSha>` → done

Five GitHub API calls per scaffold. Acceptable — this happens once per project ever.

**Empty-file pinning:** `goal.md` and `context.md` are zero-byte by design (the manager's prompt logic treats empty as "ask the user"). Their tree entries **must** be sent with `content: ""` explicitly, **not** omitted from the tree-entry object. Omitting `content` is interpreted by GitHub as "no change" and the file won't exist. Belt-and-suspenders: assert this in `ceoScaffold.ts` with a check that every constant is a string (including `""`).

**Concurrent-claim handling:** the `repo_full_name UNIQUE` constraint catches a double-claim race at the DB level. If `INSERT` fails with a UNIQUE violation, retry the initial `SELECT` and treat as "row already exists."

### `POST /api/projects/new`

Authenticated. Creates a new GitHub repo and claims it in one flow.

**Request body:**

```json
{
  "name": "new-project",
  "description": "optional",
  "private": true
}
```

**Validation (server-side, returns 400 on failure):**

- `name`: non-empty, ≤ 100 chars, matches `/^[a-z0-9][a-z0-9._-]*$/` (lowercase letters/digits + `-`, `_`, `.`)
- `description`: ≤ 350 chars (GitHub's limit)
- `private`: boolean

**Implementation:**

1. `POST /user/repos` with `{ name, description, private, auto_init: true }` → returns repo metadata. Failure (422 = repo exists) bubbles up as 409 to client with the GitHub error message.
2. Wait briefly (one short retry on the next `GET` if 404 — GitHub sometimes takes ~1s to make the new repo's tree fetchable).
3. Same scaffold-commit path as `from-repo` (single commit, 5 files).
4. Insert D1 row.
5. Return `{ projectId, repo_full_name, isNew: true }`.

### `GET /api/projects/:id`

Authenticated. Returns the D1 row.

**Response:**

```json
{
  "id": "<uuid>",
  "repo_full_name": "mrmicaiah/the-big-brain",
  "clone_url": "https://github.com/mrmicaiah/the-big-brain.git",
  "default_branch": "main",
  "created_at": "2026-05-12T..."
}
```

**404 path matters:** if the frontend has a stale project ID in localStorage (e.g., D1 got wiped), the request 404s. The store removes the entry silently on 404. No noisy error.

---

## The `.ceo/` scaffold — file contents

Stored as exported constants in `src/lib/ceoScaffold.ts`. The scaffold-commit path imports them. Each file is committed verbatim.

### `.ceo/README.md`

```markdown
# .ceo/

This directory is the project's memory for The Big Brain.

A manager is bound to this repo through these files. They're committed to git, so the project's memory survives if the system's database is reset.

- `goal.md` — what this project is for, in your words
- `context.md` — what the manager needs to know to be useful here
- `decisions.md` — log of significant decisions, with dates
- `board.md` — current state snapshot (goal, state, next, blockers) with YAML frontmatter

The manager reads all of these at the start of every session. The manager can update them as housekeeping in its own workspace — you'll see those updates go through as commits.

The `uploads/` directory is created lazily when you drag files into the manager chat.
```

### `.ceo/goal.md`

Empty file (zero bytes). The manager's prompt logic treats empty as "ask the user what this project is for on first message."

### `.ceo/context.md`

Empty file (zero bytes). Manager treats empty as "ask for orientation if the project is non-trivial."

### `.ceo/decisions.md`

```markdown
# Decisions

<!-- The manager appends here when significant decisions get made. Format: dated entries. -->
```

### `.ceo/board.md`

```markdown
---
goal: ""
state: ""
next_move: ""
blockers: ""
updated_at: <ISO-8601 timestamp at scaffold time>
---

# Board

<!-- The manager posts here. Edit through the manager chat, not directly. -->
```

The scaffold-time `updated_at` is set to `new Date().toISOString()` at commit time. The Board aggregation (Phase 6) will filter out boards whose `goal` is empty — those are unclaimed-in-spirit even if the row exists.

`.ceo/uploads/` is not scaffolded — it's created lazily on first upload (Phase 8).

---

## Worker code organization

### `src/lib/router.ts`

Tiny dispatcher. ~30 lines, no deps.

```ts
type Handler = (
  request: Request,
  env: Env,
  params: Record<string, string>,
) => Response | Promise<Response>;

type Route = { method: string; pattern: RegExp; paramNames: string[]; handler: Handler };

export function route(method: string, path: string, handler: Handler): Route {
  // Compile "/api/projects/:id" → /^\/api\/projects\/([^\/]+)$/ + ["id"]
  ...
}

export async function dispatch(
  routes: Route[],
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  for (const r of routes) {
    if (request.method !== r.method) continue;
    const match = url.pathname.match(r.pattern);
    if (match) {
      const params = Object.fromEntries(r.paramNames.map((n, i) => [n, match[i + 1]!]));
      return r.handler(request, env, params);
    }
  }
  return null;
}
```

Returns `null` on no-match so `index.ts` can produce its own 404 (consistent shape with Phase 1).

### `src/lib/github.ts`

**Header pin.** Every GitHub API call uses **one** header builder:

```ts
function ghHeaders(env: Env, extra: Record<string, string> = {}): HeadersInit {
  return {
    "Authorization": `token ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "the-big-brain",
    ...extra,
  };
}
```

Two things to lock in here:

- **`token`, not `Bearer`.** Classic PATs authenticate with `Authorization: token <pat>`. `Bearer` works for fine-grained PATs and OAuth user tokens but is inconsistent with classic and confusing as a default — pin `token` for our case.
- **No duplication.** No function in `github.ts` constructs its own headers inline. Every fetch call goes through `ghHeaders(env)`. This avoids the bug class where one function picks up a future header change and another doesn't.

Functions (named exports), all using `ghHeaders`:

- `listUserRepos(env): Promise<GhRepo[]>`
- `getRepo(env, fullName): Promise<GhRepo | null>` (returns null on 404)
- `pathExists(env, fullName, branch, path): Promise<boolean>`
- `scaffoldCeo(env, fullName, branch, scaffoldFiles): Promise<{ commitSha: string }>` — orchestrates the 5-call sequence
- `createRepo(env, { name, description, private }): Promise<GhRepo>`

Errors throw `GitHubError` with the upstream status + body so route handlers can map to user-facing responses.

### `src/index.ts` (rewritten)

```ts
import type { Env } from "./types";
import { requireAuth } from "./lib/auth";
import { dispatch } from "./lib/router";
import { phase2Routes } from "./routes";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, version: env.GIT_SHA });
    }

    if (url.pathname.startsWith("/api/")) {
      const denied = requireAuth(request, env);
      if (denied) return denied;

      const matched = await dispatch(phase2Routes, request, env);
      if (matched) return matched;
      return json({ error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

`phase2Routes` is a single array exported from `src/routes/index.ts` aggregating the four route definitions.

---

## Frontend

### State (`web/src/state/store.ts`)

Zustand + persist middleware. localStorage key: `the-big-brain`.

```ts
type OpenProject = { projectId: string; repoFullName: string };

type Store = {
  openProjects: OpenProject[];
  focusedProjectId: string | null;
  pickerOpen: boolean;
  modalOpen: boolean;
  reposCache: { repos: Repo[]; fetchedAt: number } | null;

  openProject: (p: OpenProject) => void;
  closeProject: (id: string) => void;
  focusProject: (id: string) => void;
  setPickerOpen: (b: boolean) => void;
  setModalOpen: (b: boolean) => void;
  setReposCache: (repos: Repo[]) => void;
  invalidateReposCache: () => void;
};
```

Persisted slice: `openProjects`, `focusedProjectId`. The two `*Open` flags and the repo cache are session-only.

**Versioning.** Persist config sets `version: 1` and a `migrate` that returns `null` (i.e., drop the persisted state) for any version mismatch:

```ts
persist(
  /* store creator */,
  {
    name: "the-big-brain",
    version: 1,
    partialize: (s) => ({ openProjects: s.openProjects, focusedProjectId: s.focusedProjectId }),
    migrate: (_persisted, _fromVersion) => {
      // No partial-state lift-forward across shape changes. Bump the version
      // any time the persisted shape changes; old data is silently dropped.
      // Cheap to re-fetch — projects come back via /api/projects/:id on demand.
      return undefined;
    },
  },
)
```

Any change to the persisted shape (e.g., adding `isMinimized` later) bumps `version` to 2; old persisted state from version 1 is dropped without crashing. We never attempt partial-state lift-forward across shape changes — too brittle for the size of state we hold.

**Hydration.** For each persisted `openProject`, fire `GET /api/projects/:id` in the background:

- **404** → silently drop the entry from `openProjects`. D1 doesn't know about this project anymore (likely D1 was wiped); no toast.
- **401** → drop the persisted state entirely AND force a reload (`window.location.reload()`). A 401 here means the bundle's `VITE_AUTH_TOKEN` and the Worker's `AUTH_TOKEN` no longer agree — bundle/Worker drift, the exact failure mode that ate an hour yesterday. Loud-but-recoverable: blow away local state, reload, the user sees the empty state and a fresh fetch. The next time they try to do anything, they get a clean 401 from `apiFetch` they can act on.
- **5xx / network** → leave the entry in place but mark the pane with a small "couldn't reach" affordance (Phase 2 stub: just keep the placeholder pane visible; retry on next focus). Don't drop on transient failure.

The 401 reload only fires during initial hydration. Mid-session 401s from `apiFetch` propagate normally and are surfaced by whichever component made the call.

### `apiFetch` (`web/src/lib/api.ts`)

```ts
const TOKEN = import.meta.env.VITE_AUTH_TOKEN;

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  // Only set content-type for JSON bodies (string). FormData (Phase 8) must NOT
  // get a manual content-type — the browser sets multipart/form-data with the
  // boundary automatically. Setting it manually breaks multipart parsing.
  const isJsonBody = typeof init.body === "string";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    ...(isJsonBody ? { "content-type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}
```

### Picker (`web/src/components/ProjectPicker.tsx`)

Anchored dropdown, rendered as a sibling of the `+` button, positioned absolutely. Closes on outside click or Escape.

**Layout:**

```
┌─────────────────────────────────────┐
│ YOUR PROJECTS                       │
│ ─────────────                       │
│ │mrmicaiah/the-big-brain            │  ← hover: 1px accent left bar
│  mrmicaiah/refervo-app              │
│                                     │
│ ─────────────                       │
│ OTHER REPOS                         │
│  mrmicaiah/some-repo  Make a project│
│  mrmicaiah/another    Make a project│
│                                     │
│ ─────────────                       │
│  + New project                      │
└─────────────────────────────────────┘
```

- Width: 384px (`w-96`)
- Background: paper, hairline border, small drop shadow (modals get shadow; dropdowns are anchored UI but readability wants the lift)
- Section headers in Geist small-caps at low opacity
- Repo rows in JetBrains Mono (the full_name is code, not prose)
- Hairline rules between sections
- Loading state: a single Fraunces "Loading repos…" line at low opacity while `/api/repos` is in flight
- Error state: "Couldn't load repos. (status)" inline; click row to retry

**Click semantics:**
- Claimed repo row → `openProject`, `focusProject`, close picker
- Unclaimed repo row → `apiFetch('/api/projects/from-repo', POST)` → on success, `openProject`, `focusProject`, close picker, invalidate repos cache
- "+ New project" → close picker, open modal

### New project modal (`web/src/components/NewProjectModal.tsx`)

Centered card over a 60%-opacity paper overlay. Card has soft drop shadow (the spec allows shadows on modals).

**Fields:**
- Name (text input, monospace, auto-lowercased, dash-trimmed on blur). Inline validation message in muted Fraunces below the field.
- Description (textarea, 3 rows, Geist)
- Private (toggle styled as a hairline-bordered pill: `private` / `public`, current state filled with ink)

**Buttons:**
- "Cancel" (text button, low-opacity) → close modal
- "Create project" (primary — paper background, ink text, ink border, hover swaps to ink fill / paper text)

**Submit flow:**
- Disable form, show "Creating…" replacement for the submit button
- `apiFetch('/api/projects/new', POST)`
- On success: close modal, `openProject`, `focusProject`, invalidate repos cache
- On 409 (repo name exists): keep modal open, show error inline next to the name field

### `ProjectPane` (`web/src/components/ProjectPane.tsx`)

Phase 2 stub. Shows:

```
┌─────────────────────────────────────┐
│ mrmicaiah/the-big-brain          ×  │ ← hairline border bottom, Geist
│                                     │
│                                     │
│   Manager lands here in Phase 3.    │ ← Fraunces, low opacity, centered
│                                     │
│                                     │
└─────────────────────────────────────┘
```

- 1px accent (`#1E3A5F`) left-edge bar when this pane is `focusedProjectId`
- Hairline border on the other three edges
- Header: repo `full_name` in Geist (`text-sm`), `×` button at right
- Body: centered Fraunces phrase, `text-base`, ink at 40% opacity

### `Workspace` (`web/src/components/Workspace.tsx`)

Replaces direct render of `<EmptyWorkspace />` in `App.tsx`.

- Zero open projects → render `<EmptyWorkspace />`
- 1 → full-width pane
- 2 → two-column grid (50/50)
- 3 → two top + one full-width bottom (Tailwind: `grid-cols-2 grid-rows-2` with the third pane `col-span-2`)
- 4 → `grid-cols-2 grid-rows-2`, all panes equal
- ≥5 → **deferred to Phase 3 or later (LRU rule).** Phase 2 either caps the array at 4 (silently ignore 5th open) or simply lets the grid overflow ugly. **Recommendation:** cap at 4 with a soft warning toast; full LRU in a later phase. *(Open question — see end.)*

### Top dock tabs (`web/src/components/ProjectTab.tsx` + updated `TopDock.tsx`)

For each entry in `openProjects`:
- Tab body: project short-name (the second half of `full_name`, after the `/`)
- 1px accent left-edge bar when `projectId === focusedProjectId`
- Hover reveals a `×` button on the right of the tab
- Click anywhere on the tab body → `focusProject(id)`
- Click `×` → `closeProject(id)`

Tabs render in a horizontal row, left-aligned, hairline separator between adjacent tabs. The `+` button stays at the far right.

---

## Verification

Some of these require GitHub mutations — I'll run the read-only / shape checks myself; you run the mutating ones once on a throwaway repo you don't mind a `.ceo/` commit landing on.

| # | Check | Who runs |
|---|---|---|
| 1 | `npm install` (adds zustand) | me |
| 2 | `npm run typecheck` clean | me |
| 3 | `npm run build` clean | me |
| 4 | `npm run dev` brings up both servers (5173 + 8787) — assumes the-ceo Vite has been killed | me |
| 5 | `GET /api/repos` without auth → 401 | me |
| 6 | `GET /api/repos` with auth → 200 + a JSON `{ repos: [...] }` with `isProject` flags. `mrmicaiah/the-big-brain` should appear and (after first claim) have `isProject: true` | me |
| 7 | Open `http://localhost:5173/` — picker opens on `+` click and shows the two-section layout, project rows in monospace, hover shows the 1px accent | you |
| 8 | Click an unclaimed repo → `.ceo/` commit lands on GitHub, pane opens, repo now appears under "Your projects" on re-open of picker | you |
| 8b | **GitHub verification:** open the claimed repo's working tree on github.com and confirm all five `.ceo/` files exist (`README.md`, `goal.md`, `context.md`, `decisions.md`, `board.md`). Click into `goal.md` and `context.md` and confirm they're empty (zero bytes, not "no file content" missing). Confirm there's exactly **one** new commit titled `Scaffold .ceo/ for The Big Brain`. Don't trust just the API response — this is the integration that breaks subtly. | you |
| 9 | Click the same now-claimed repo again → returns `isNew: false`, no second commit on the repo's commit history, pane opens | you |
| 10 | Open "+ New project," create a small test repo (private, name `bb-phase2-test` or similar) → repo created on GitHub with `.ceo/` scaffolded, pane opens | you |
| 11 | Close the test repo's pane via `×` — disappears from dock and workspace | you |
| 12 | Refresh the page — surviving open panes restore from localStorage; their D1 rows are re-fetched silently | you |
| 13 | Manually delete the test repo from GitHub, refresh — the dead pane is dropped from the dock silently (no error toast) | you |
| 14 | Visual: claimed-repo rows in picker have no "Make a project" affordance; unclaimed do | you |
| 15 | Visual: empty-state still shows when no panes are open (Phase 1 behavior preserved) | you |

If 1–6 pass on my end, I'll commit + push; you run 7–15.

---

## Surprises / risks to plan for

**1. GitHub PAT scope.** Classic PATs need `repo` for full read/write access to private repos. The operator must confirm the PAT has `repo` scope. A fine-grained PAT also works if it has the right per-repo / org grants, but classic is simpler for a single-user setup. **No action — note in the operator instructions.**

**2. Repo creation propagation delay.** GitHub occasionally takes ~1s after `POST /user/repos` before the new repo's tree is queryable. The first `GET /repos/:o/:r/git/ref/heads/:branch` may 404. Plan: one retry with a 1.5s delay before bailing.

**3. The picker should distinguish "I've claimed this repo elsewhere" from "this is a new claim."** Both produce `isProject: true` on the next list, but the first claim is the visible one. The picker doesn't need to differentiate — the same affordance opens both.

**4. Default branch isn't always `main`.** The claim flow uses the repo's `default_branch` from `GET /repos/:o/:r`. New repos created via `/user/repos` with `auto_init: true` default to `main` (per the user's GitHub default-branch setting). We don't override it.

**5. Worker → GitHub egress.** Cloudflare Workers can make outbound HTTPS without special config. No `compatibility_flags` needed beyond `nodejs_compat` which we already have.

**6. localStorage versioning.** Zustand persist `version: 1` + a `migrate` that returns `undefined` (drop persisted state) for any version mismatch. Any change to the persisted shape bumps the `version`; old data is dropped silently rather than partial-lift-forwarded. See the State section for the full config.

**7. Picker outside-click handling.** Standard React pattern — attach a document-level `mousedown` listener while the picker is open; close if the click target isn't inside the picker's ref. Verified to play nice with the `+` button itself.

**8. Tab order in the dock.** I'd open tabs in insertion order (newest at the right). When focusing an existing tab via the picker, don't reorder — focus moves but position stays. Matches the spec's "click to switch/restore."

---

## Resolved decisions

**Pane count cap → soft cap at 4 with a toast.** Opening a 5th pane while 4 are already open shows a brief inline message: "4 panes max for now — close one first." No 5th pane is opened. The LRU rule (auto-minimize least-recently-touched + dock chip state) is deferred to Phase 3, where it lands alongside the manager-chat focus logic naturally.
