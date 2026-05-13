# Phase 4 plan — Workers

End state: manager emits `dispatch_claude_code` fenced block → renders as a "Run Claude Code →" card in chat → user clicks → Worker writes a job row and tells the local agent → agent clones the repo (if needed) and runs the Claude Code SDK against it → output streams back into the card → on completion, the diff renders inline. The agent runs as a long-lived Node process on the user's machine with a persistent WebSocket to the Worker; it reconnects automatically if dropped. The user's working tree is left dirty (staged-then-reset) so they review and push manually — workers never push.

When this phase is done:

- `AgentHubDO` (singleton) exists with WebSocket connect, dispatch, and SSE subscribe handlers
- `/api/agent/ws` accepts the agent's WebSocket upgrade behind `Bearer AGENT_TOKEN` (separate from `AUTH_TOKEN`)
- `/api/projects/:id/dispatch-claude-code` creates a job row, dispatches it (or queues if agent offline), returns `{ jobId }`
- `/api/jobs/:id` returns a job snapshot
- `/api/jobs/:id/stream` SSE-streams live output for an in-flight job, or replays + closes for a terminal job
- The local `agent/` directory exists with the Node WebSocket client, Claude Code SDK executor, and workspace/diff helpers — lifted forward from `mrmicaiah/the-ceo/agent/`
- Frontend renders `dispatch_claude_code` action blocks as inline `DispatchCard` components — both during streaming and on history reload
- A `message_id` column on `execution_jobs` links each job to the assistant message that proposed it, so history reload renders cards in the right state

Phase 4 stays local-only. No deploy. Real Claude Code SDK runs against real cloned repos on the user's machine — this phase spends real Anthropic tokens on verification.

---

## Operator prerequisites — required before build starts

Three pieces. Same gating pattern as prior phases — confirm all three before I start.

1. **Cloudflare Worker secret:**
   ```
   wrangler secret put AGENT_TOKEN
   ```
   Generate a long random value (e.g., `openssl rand -hex 32`). This is the bearer the agent presents on the WebSocket handshake. **Distinct from `AUTH_TOKEN`** — the agent uses its own token so leaking either doesn't cross-compromise.

2. **Local `.dev.vars`** — keep the four existing lines, **append** a fifth:
   ```
   AGENT_TOKEN=<same-value-as-the-secret>
   ```

3. **Local `agent/.env`** (created from the committed `agent/.env.example`) — populate with:
   ```
   AGENT_TOKEN=<same value again>
   WORKER_URL=ws://localhost:8787/api/agent/ws
   REPOS_DIR=C:\Users\mrmic\Projects
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   `ANTHROPIC_API_KEY` can be the same key as the Worker — the agent passes it to the Claude Code SDK at runtime. `REPOS_DIR` is where the agent will `git clone` projects on first dispatch.

Build does not start until all three are confirmed.

---

## Files

### New (Worker)

- `src/durable-objects/agent-hub.ts` — `AgentHubDO` (singleton). Maintains the agent WebSocket connection; routes job dispatches over it; broadcasts output frames to SSE subscribers; persists output + diff_summary to D1 on terminal events.
- `src/routes/dispatch.ts` — `POST /api/projects/:id/dispatch-claude-code`. Validates payload, creates `execution_jobs` row (status `queued`), hands off to the DO, returns `{ jobId }`.
- `src/routes/jobs.ts` — `GET /api/jobs/:id` (snapshot from D1) and `GET /api/jobs/:id/stream` (forwarded to AgentHubDO for SSE).
- `src/routes/agent.ts` — `GET /api/agent/ws` (forwarded to AgentHubDO for the WebSocket upgrade). The Worker checks `Bearer AGENT_TOKEN` before the upgrade reaches the DO so a leaked-but-revoked token rejects at the Worker layer.
- `src/db/migrations/001_jobs_message_id.sql` — `ALTER TABLE execution_jobs ADD COLUMN message_id TEXT;` + index `idx_jobs_message ON execution_jobs(message_id)`. Phase 4's first formal schema change since the original `schema.sql`.
- `src/lib/jobsRender.ts` — small helper for formatting `diff_summary` as the structured JSON shape `{ summary, diffStat, diff, diffTruncated }` (success) or `{ error, stage }` (failure). Pure functions; both DO and route handlers use them.

### Modified (Worker)

- `wrangler.toml` — `[[durable_objects.bindings]] name = "AGENT_HUB_DO" class_name = "AgentHubDO"` and a `[[migrations]] tag = "v2" new_classes = ["AgentHubDO"]` block (v2 because v1 was ManagerDO). No edit to the v1 block.
- `src/types.ts` — add `AGENT_HUB_DO: DurableObjectNamespace` and `AGENT_TOKEN: string` to `Env`.
- `src/index.ts` — export `{ AgentHubDO }` alongside `{ ManagerDO }`.
- `src/routes/index.ts` — add four routes (`dispatch-claude-code`, `jobs/:id`, `jobs/:id/stream`, `agent/ws`).
- `src/durable-objects/manager.ts` — pre-generate the assistant `messageId` before the streaming turn begins, emit it as a new `event: message_start` SSE frame so the frontend can attach in-flight dispatches to it; persist the assistant row using that same id.
- `.dev.vars.example` — add `AGENT_TOKEN=replace-me` line with a comment.

### New (agent — lift forward from `mrmicaiah/the-ceo/agent/`)

Lifted verbatim from the v2 build with the rename + a couple of cosmetic adjustments:

- `agent/package.json` — name becomes `the-big-brain-agent`; deps unchanged (`@anthropic-ai/claude-code`, `dotenv`, `ws`); scripts: `dev` (tsx watch), `start` (tsx), `build` (tsc), `typecheck`.
- `agent/tsconfig.json` — verbatim
- `agent/.gitignore` — verbatim
- `agent/.env.example` — verbatim shape, default `WORKER_URL` switched to `ws://localhost:8787/api/agent/ws` since Phase 4 is local-only
- `agent/README.md` — references updated from "The CEO" → "The Big Brain"; "ceo-agent" → "the-big-brain-agent"
- `agent/src/index.ts` — verbatim
- `agent/src/config.ts` — verbatim (already requires `WORKER_URL`, `AGENT_TOKEN`, `REPOS_DIR`, `ANTHROPIC_API_KEY`)
- `agent/src/log.ts` — verbatim
- `agent/src/agent.ts` — verbatim. The reconnect loop, heartbeat (30s), and `Bearer ${agentToken}` upgrade header all carry forward unchanged.
- `agent/src/workspace.ts` — verbatim. Clones on first dispatch (option A as you asked). `git diff --cached --stat` + `git diff --cached` after `git add -A`, then `git reset` — leaves working tree dirty.
- `agent/src/executor.ts` — verbatim. Uses `query()` from `@anthropic-ai/claude-code` with `permissionMode: "bypassPermissions"` (the user already approved via the dispatch click; this is the contract).

### New (frontend)

- `web/src/components/DispatchCard.tsx` — one inline card for one dispatch fence. Shows summary + collapsible prompt. Button states: "Run Claude Code →" (idle) / "Queued" (queued) / "Running…" (running) / final diff stat + summary (succeeded) / error pane (failed). Connects to its `JobStream` once dispatched.
- `web/src/components/DiffView.tsx` — minimal diff renderer. Stat block on top (Geist mono), unified diff body below (JetBrains Mono, hairline border, no syntax highlighting in v0). Truncation banner if the diff was capped.
- `web/src/components/MessageItem.tsx` — **rewritten**. Splits assistant content into text + action parts; renders text inline, action parts as DispatchCard components.
- `web/src/lib/messageParts.ts` — `splitMessageIntoParts(content): Part[]` — small regex-based splitter for the persisted raw text. Returns `{ kind: "text", text } | { kind: "action", type, fields, raw }` parts in order.
- `web/src/hooks/useJobStream.ts` — SSE subscriber for `/api/jobs/:id/stream`. Yields `{ snapshot, outputs, terminal }` state.
- `web/src/lib/types.ts` — `JobSnapshot`, `JobOutputFrame`, `DiffSummary` types.

### Modified (frontend)

- `web/src/hooks/useChatStream.ts` — collect action events during streaming as a third segment kind, expose them on the streaming state so `StreamingMessage` can render in-flight DispatchCards. Also handle the new `message_start` event (carries assistant `messageId`).
- `web/src/components/StreamingMessage.tsx` — render action segments as DispatchCard components inline between text segments.
- `web/src/components/ChatView.tsx` — when fetching history, also fetch jobs for the chat (one round trip: `/api/chats/:id/jobs`) so cards on historical messages render with their actual state.
- `web/src/components/MessageList.tsx` — pass jobs-by-messageId down to MessageItem.

### Modified (`prompts/manager.md`)

**No change needed.** The existing prompt already documents `dispatch_claude_code` with the right tone — composition discipline, when not to dispatch, queueing semantics. Phase 3's "render nothing visible for actions" wasn't a softening of the prompt itself, just a frontend deferral. The prompt was forward-correct from the start.

Recording the no-op explicitly here so future-us doesn't go hunting for a hidden softening.

---

## Wrangler config changes

```toml
[[durable_objects.bindings]]
name = "AGENT_HUB_DO"
class_name = "AgentHubDO"

# New migration. Don't edit the v1 block — once a tag is shipped, it's
# immutable; new changes go in new tags.
[[migrations]]
tag = "v2"
new_classes = ["AgentHubDO"]
```

Markdown text rule and ManagerDO binding are unchanged.

---

## Dispatch protocol — wire format

The protocol is what the v2 agent already speaks. Pinning it here so future edits don't drift.

### Worker → Agent (job dispatch over WebSocket)

```json
{
  "type": "job",
  "jobId": "<uuid>",
  "repoName": "<repo>",
  "cloneUrl": "https://github.com/<owner>/<repo>.git",
  "prompt": "<full multi-line prompt>",
  "projectId": "<uuid>",
  "chatId": "<uuid>"
}
```

`repoName` is the trailing segment of `repo_full_name` (the directory name on disk). `cloneUrl` is the HTTPS URL — the agent will pass it to `git clone` if `<REPOS_DIR>/<repoName>` doesn't already exist.

### Agent → Worker

Connection lifecycle:

```json
{ "type": "ready", "agentVersion": "0.1.0" }
{ "type": "heartbeat" }
```

Per-job output (streamed as the SDK produces messages):

```json
{ "type": "output", "jobId": "<uuid>", "kind": "text", "payload": "<text>" }
{ "type": "output", "jobId": "<uuid>", "kind": "tool_use", "payload": "<JSON: { name, input }>" }
{ "type": "output", "jobId": "<uuid>", "kind": "tool_result", "payload": "<JSON: { tool_use_id, content }>" }
```

Job terminal:

```json
{ "type": "completed", "jobId": "<uuid>", "diffStat": "<git diff --stat>", "diff": "<unified diff>", "diffTruncated": <bool>, "summary": "<short text>" }
{ "type": "failed", "jobId": "<uuid>", "error": "<message>", "stage": "workspace" | "execution" | "diff" }
```

### Persisted shape in D1

`execution_jobs.output_stream` is the concatenated text of all `output` frames (one frame per line, prefixed with the kind: `text: ...`, `tool_use: ...`, `tool_result: ...`). Cheap to render later; no parsing on history reload.

`execution_jobs.diff_summary` is JSON:
- Success: `{ "summary": "...", "diffStat": "...", "diff": "...", "diffTruncated": <bool> }`
- Failure: `{ "error": "...", "stage": "..." }`

---

## AgentHubDO design

### State

```ts
class AgentHubDO {
  private agentSocket: WebSocket | null = null;
  private subscribers: Map<jobId, Set<{ controller, encoder, cleanup }>>;
}
```

Hibernation API (`state.acceptWebSocket`) intentionally skipped for v0 — the singleton stays warm while the agent is connected, which is the common case. If the DO evicts mid-job, the WebSocket dies, agent reconnects, job state lives in D1.

### `GET /connect` — agent WebSocket upgrade

1. Reject if `request.headers.get("upgrade") !== "websocket"`.
2. Worker has already validated the `Bearer AGENT_TOKEN` header — the DO trusts the request reached it.
3. Create `new WebSocketPair()`; `server.accept()`; close any prior `agentSocket` (single-agent-at-a-time).
4. Hook `message` / `close` / `error` handlers.
5. On `close`, set `agentSocket = null`; live subscribers see no more output. When the agent eventually reconnects, queued jobs flush.
6. Return `new Response(null, { status: 101, webSocket: client })`.

### Message handlers (from agent)

- `ready` → `agentSocket` is now active. Query `execution_jobs WHERE status = 'queued' ORDER BY created_at ASC`; send each as a `job` message, mark status `running`.
- `heartbeat` → no-op (could update a `last_seen` timestamp if useful later).
- `output` → append to in-memory `outputChunks[jobId]`, broadcast to subscribers, do NOT write to D1 per-frame (too many writes for streaming).
- `completed` / `failed` →
  1. `UPDATE execution_jobs SET status = ?, output_stream = ?, diff_summary = ?, completed_at = datetime('now') WHERE id = ?`
  2. Broadcast a final SSE frame (`event: terminal, data: { snapshot }`) to subscribers
  3. Close subscriber streams
  4. Free `outputChunks[jobId]` and `subscribers.get(jobId)`
  5. Check D1 for the next `queued` job and dispatch if agent connected

### `POST /dispatch` — Worker hands off a job

Body: `{ jobId, projectId, chatId, repoName, cloneUrl, prompt }`.

- If `agentSocket !== null`: send `job` message over the WebSocket, update status to `running`.
- If `agentSocket === null`: leave status as `queued`. Job sits in D1 until the agent reconnects.

Returns `{ ok: true, dispatched: <bool> }`.

### `GET /subscribe?jobId=...` — SSE stream

1. Query D1 for the job row (404 if missing).
2. Build a `ReadableStream` with SSE response headers.
3. First frame: `event: snapshot, data: { ...row, output_stream: <existing> }`.
4. If `status` is terminal (`succeeded` / `failed`): replay any frames not in the snapshot, send `event: terminal`, close.
5. If `status` is `queued` or `running`: register the controller in `subscribers.get(jobId)`. Live `output` frames from the agent → `event: output` frames to the client. Terminal → final `event: terminal`, close.
6. On stream cancel: unregister the controller. If the job is still running, that's fine — the agent doesn't notice.

### Per-project serialization

Spec calls for "one Claude Code job per project at a time." Phase 4 v0 enforces this lightly:

- When `POST /dispatch` arrives, check D1: `SELECT 1 FROM execution_jobs WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1`.
- If found, the new job's status stays `queued` and we *don't* send to the agent — even if agent is connected — until the prior job for that project lands a terminal state. The manager can dispatch in series; the system keeps order.
- Across projects: parallelism is fine in principle but the v0 agent doesn't truly parallel-execute (it `void runJob(...)` without queue management). For v0 we keep global FIFO too — simpler, single user.

Cleanup: when a terminal frame arrives, look up the next `queued` job globally and send it to the agent.

---

## Frontend rendering

### Streaming-time

The streaming-state `Segment[]` grows a third kind:

```ts
type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean }
  | { kind: "action"; messageId: string; fenceIndex: number; type: "dispatch_claude_code"; fields: { project, summary, prompt }; raw: string };
```

The `message_start` SSE event lands the assistant's `messageId` in the hook state; each subsequent `action` event becomes an `action` segment carrying `(messageId, fenceIndex, fields)`. `StreamingMessage` renders text segments as paragraphs, tool segments as hairline dividers (Phase 3.5 behavior), and action segments as `<DispatchCard messageId fenceIndex fields jobId={null} />` — clicking "Run Claude Code →" dispatches.

### History reload

`MessageItem` parses `assistant.content` with `splitMessageIntoParts`. For each `action` part of type `dispatch_claude_code`, look up the job by `(message_id, fence_index)` and render with that snapshot. Cards without a backing job render with the "Run Claude Code →" button still active — the user can dispatch retroactively, which is the spec's user-confirmation contract.

### `DispatchCard` states

| State | Render |
|---|---|
| **Idle** (no job yet) | Card with summary at top; collapsed "show prompt" disclosure below; primary button "Run Claude Code →" |
| **Queued** | Same shape; button replaced with "Queued — waiting for agent" in low-opacity Fraunces |
| **Running** | Same shape; rolling output preview (last ~3 lines, monospace, ink/50); secondary stop button skipped for v0 |
| **Succeeded** | Summary line in Fraunces; collapsed diff stat below; expandable diff body (JetBrains Mono); "Job completed" footer with timestamp |
| **Failed** | Summary line in Fraunces ink (no red — editorial restraint); error message; stage label (workspace/execution/diff) |

Hairline border on the card; no shadow; paper background; sits inline within the message content area at full width minus a small left indent so it visually nests under the assistant's prose.

### `useJobStream` hook

Mirrors `useChatStream`'s pattern: open `apiFetchRaw(/api/jobs/:id/stream)`, iterate `parseSseStream`, dispatch on event name (`snapshot`, `output`, `terminal`). Internal state holds the snapshot plus accumulated output lines. Returns `{ snapshot, outputs, terminal, error }`.

---

## Schema migration

`src/db/schema.sql` stays the canonical "fresh install" SQL. Incremental changes live in `src/db/migrations/` from this phase forward:

```sql
-- src/db/migrations/001_jobs_message_id.sql
ALTER TABLE execution_jobs ADD COLUMN message_id TEXT;
ALTER TABLE execution_jobs ADD COLUMN fence_index INTEGER;
CREATE INDEX IF NOT EXISTS idx_jobs_message ON execution_jobs(message_id, fence_index);
```

Also update `src/db/schema.sql` so a fresh-installed system has the column from day one (keeps the two files in sync for the operator's convenience). Add two new npm scripts:

```
"db:migrate:local":  "wrangler d1 migrations apply DB --local",
"db:migrate:remote": "wrangler d1 migrations apply DB --remote"
```

Wrangler's built-in migrations runner (configured via `migrations_dir` already in wrangler.toml) handles the bookkeeping. I'll apply the migration once locally as part of build.

---

## Verification

Phase 4 verification is *two-sided* — server-side checks I can run alone, plus end-to-end with the real agent + real Claude Code SDK that need the operator running the agent process.

### Server-side (mine, no agent required)

| # | Check |
|---|---|
| 1 | `npm install` clean (adds nothing — agent deps live under `agent/package.json` which isn't a workspace member for v0) |
| 2 | `npm run typecheck` clean (Worker + web) |
| 3 | `npm run build` clean (frontend bundle) |
| 4 | `wrangler deploy --dry-run --outdir=.tmp` bundles the Worker with the new DO class; grep the bundle for `AgentHubDO` to confirm the class actually shipped |
| 5 | `npm run db:migrate:local` applies the migration; `wrangler d1 execute DB --local --command="PRAGMA table_info(execution_jobs)"` confirms `message_id` + `fence_index` columns exist |
| 6 | `npm run dev`; `curl /api/agent/ws` without Bearer → 401, with wrong Bearer → 401 |
| 7 | `curl /api/projects/<id>/dispatch-claude-code` without auth → 401; with auth and valid payload, with no agent connected → returns `{ jobId }`, D1 row exists with status `queued` |
| 8 | `curl /api/jobs/<jobId>` returns the snapshot; `curl /api/jobs/<jobId>/stream` returns SSE with at least an initial `snapshot` event |

### Agent-side (mine, by running the agent locally)

| # | Check |
|---|---|
| 9 | `cd agent && npm install` clean |
| 10 | `npm run typecheck` (in `agent/`) clean |
| 11 | Start agent: `cd agent && npm run dev`. Logs show `connected` and `ready` against `ws://localhost:8787/api/agent/ws`. The queued job from step 7 (if not yet flushed) gets sent as a `job` message and runs |
| 12 | Watch the agent's stdout while step 11 runs: confirm output frames flow back over the WebSocket and into D1 (`SELECT status, length(output_stream), diff_summary FROM execution_jobs WHERE id = ?` shows non-null values once terminal) |

### End-to-end (yours, in the browser)

| # | Check |
|---|---|
| 13 | Kill PID-on-5173 if needed; open `http://localhost:5173/`; manager pane for `mrmicaiah/the-big-brain` mounts with the chat from Phase 3.5 |
| 14 | Prompt the manager with a small task that will trigger dispatch: e.g., "Add a one-line trailing comment to the bottom of `src/types.ts` saying `// dispatched by phase 4 verification`. Use `dispatch_claude_code` for this." Manager emits a dispatch fence; `DispatchCard` renders inline |
| 15 | Click "Run Claude Code →". Card transitions to **Queued** → **Running**, output streams in. Agent stdout shows the job ID and the SDK's text/tool_use frames |
| 16 | Job completes; card shows the diff stat + expandable diff. Open the local repo at `C:\Users\mrmic\Projects\the-big-brain` — `git status` shows the modified `src/types.ts` with the new comment line, **unstaged** (agent did `git reset` after capturing the diff). You decide to commit-and-push or `git restore` to drop |
| 17 | Refresh the browser. The historical assistant message renders with the same `DispatchCard` still showing the succeeded state and diff — `(message_id, fence_index)` link works |
| 18 | Stop the agent (`Ctrl+C` in its terminal); ask the manager for another small dispatch and click Run. Card shows **Queued — waiting for agent**. Restart the agent; queued job flushes and runs |

The Phase 4 verification surface is much larger than prior phases because we're testing a real distributed system (Worker ↔ DO ↔ WebSocket ↔ local agent ↔ SDK ↔ git). I'll do 1–12; you do 13–18 with me coordinating.

---

## What's NOT in scope for Phase 4

- **No remote deploy.** Phase 4 is still local-only. Deploy is its own ticket after we've watched a few real jobs land and feel good about it.
- **No per-job cancellation UI.** Stop-this-job is deferred. The agent can be killed (Ctrl+C) which will leave the job stuck in `running` — manual cleanup via D1 if needed.
- **No retry-on-failure.** Failed jobs stay failed; the user re-asks the manager if they want another attempt.
- **No `post_to_board` / `update_ceo_file` action handlers.** Those are Phase 6 — same fenced-block parser, different action types.
- **No worker-result fold-in.** The manager's `manager_seen_at` slot stays empty for Phase 4. After a job lands, the manager's next response doesn't automatically reference it; the user has to bring it up. **Hmm — actually this might be a Phase 4 deliverable.** *See "Open question" below.*

---

## Open question I'd like a call on before I build

**Should the manager auto-see job results on its next turn?**

The spec's `manager_seen_at` semantics say: when ManagerDO builds a prompt, query terminal jobs with `manager_seen_at IS NULL`, fold each summary + diff stat into the system prompt as "Recent worker results you haven't reviewed," then mark those rows seen.

Phase 4 has all the ingredients (terminal job rows with diff_summary). The fold-in is 30 lines of code in ManagerDO. Two options:

1. **Fold in Phase 4.** End state is more complete — after a job completes, the user's next message to the manager surfaces "I see the worker landed: <summary>. ..." conversationally. Matches the spec's intent fully.
2. **Defer to Phase 4.5.** Phase 4 ships the dispatch + execute + render loop, and the manager's awareness lands as a small follow-up. Smaller blast radius, cleaner test boundary.

I'd lean (1) — it's cheap and the spec is pretty explicit. But it adds a code path in ManagerDO and one verification step. Your call. If you want (2), I'll write `manager_seen_at` as a known-deferred TODO in the plan and skip the wiring.

---

## Surprises / things to flag

**1. The `[[migrations]]` v2 tag is the first time we're stacking DO migrations.** Order matters and v1 is now immutable. If something about ManagerDO ever needs migrating, it goes in v3 (rename_class / delete_class), not edited into v1. Calling out so future-us doesn't get tempted.

**2. Agent reconnect on Worker restart.** Every time I save a Worker file during dev, wrangler reloads, which kills the WebSocket and the agent reconnects. Agent's 3s backoff is fine for dev. Worth knowing because the agent's terminal will show "disconnected → reconnecting → connected" every time the Worker hot-reloads.

**3. Token cost of e2e verification.** Step 15 spends real Anthropic tokens on a real Claude Code run. For "add a one-line comment" the cost is small (~$0.01) but not zero. Worth budgeting.

**4. Per-project serialization at the Worker layer.** The v2 agent does NOT serialize jobs locally — `executor.ts` runs `void runJob(...)` without awaiting. We enforce per-project serialization at the AgentHubDO by holding back dispatches in `queued` until the prior project job lands terminal. Cleaner contract than relying on the agent.

**5. `permissionMode: "bypassPermissions"` in the executor.** This skips the SDK's per-tool-call user confirmation. Acceptable for v0 because:
   - The user already approved the dispatch by clicking "Run Claude Code →"
   - The agent runs locally; the user owns the machine
   - Worker writes touch the user's repos but stay unstaged (agent does `git reset`); user reviews before pushing
   Calling out so we don't lose the reasoning the first time someone tightens up agent permissions.

**6. `output_stream` is in-memory during the job, persisted on terminal.** A user who refreshes mid-job and re-subscribes to `/api/jobs/:id/stream` will see the snapshot (no output_stream yet) plus any *new* frames from the live agent — they'll miss the chunk that arrived between the original subscribe and the refresh. Acceptable v0 (the diff at the end is what matters). Real fix is per-frame D1 writes; not worth it now.

**7. Diff size cap is `200 KB` in the agent (`workspace.ts` MAX_DIFF_BYTES).** Larger diffs truncate with `diffTruncated: true`. Card UI handles the flag with a "diff truncated — review the working tree directly" footer. Carrying forward the v2 behavior unchanged.

---

## What I'll preserve verbatim from `mrmicaiah/the-ceo/agent/`

Lifting forward without rewriting:

- The WebSocket reconnect loop (`agent.ts` lines 41–50, 62–129)
- The Claude Code SDK message handling for `assistant` / `user` / `result` types (`executor.ts` lines 78–139)
- The diff capture flow: `git add -A` → diff --cached --stat / --cached → `git reset` (`workspace.ts` lines 70–84)
- The "fresh clone on first dispatch" semantics (`workspace.ts` lines 37–53)
- The terminal `{ type: "completed" | "failed", ... }` message shapes
- The 600-character `truncateSummary` heuristic (`executor.ts` lines 201–207)

Adjustments only:
- Package name → `the-big-brain-agent`
- README references → "The Big Brain"
- `.env.example` `WORKER_URL` default → `ws://localhost:8787/api/agent/ws`

The agent is the most-tested piece of v2 code we have. Lifting it whole keeps risk concentrated in the new Worker code.
