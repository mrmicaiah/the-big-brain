# Phase 3.5 plan — Manager read tools

End state: the manager can list a directory in its repo, read a single file, or read a small batch of files in parallel — through Anthropic's native tool use. Reads happen as part of a single user turn: the model emits a `tool_use` block, the Worker fetches via GitHub, returns a `tool_result`, the model continues with the data in context. No user confirmation; reads are safe. Writes (commits via `dispatch_claude_code`, `post_to_board`, `update_ceo_file`) still go through fenced action blocks with user signoff — the bright line stays put.

Same tool implementations get reused by Phase 7's BrainstormDO. We're getting it right once.

When this phase is done:

- The manager has three tools available: `list_repo_files`, `read_repo_file`, `read_repo_files`
- A tool call against GitHub completes within the same user turn, transparently to the user
- The user sees a small inline status line per tool call ("Read src/lib/router.ts (1.2 KB)") between the manager's text segments while streaming
- Refused-with-reason behavior on oversized files, binary content, missing paths, and over-cap batch requests
- Fenced action blocks (`dispatch_claude_code` etc.) continue to flow through the existing `ActionParser` — unchanged

Phase 3.5 is local-only. No deploy.

---

## Operator prerequisites

**None new.** `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` are already in place from Phase 2 and Phase 3.

---

## Files

### New

- `src/lib/toolDefinitions.ts` — Anthropic-shaped tool schemas for the three read tools. Exported individually and as `repoReadToolDefinitions` (an array). Shared between `ManagerDO` (Phase 3.5) and `BrainstormDO` (Phase 7).
- `src/lib/repoReadTools.ts` — implementations: `listRepoFiles(env, repo, branch, input)`, `readRepoFile(env, repo, branch, input)`, `readRepoFiles(env, repo, branch, input)`. Pure functions of `(env, repoFullName, branch, input)`; no DO coupling so the brains can use them later.

### Modified

- `src/lib/chat.ts` — refactor `streamChatTurn` to support a tool-use loop. New optional `tools` + `executeTool` params; when present, the function loops the Anthropic call until `stop_reason !== "tool_use"`. Existing `ActionParser` continues to run on text deltas — fenced action blocks are an orthogonal mechanism.
- `src/lib/sse.ts` — no changes to the function; document the new `tool` event in the JSDoc.
- `src/lib/claude.ts` — extend `streamClaude` signature to accept `tools`. Yield `text` deltas as before plus structured `tool_use_start` / `tool_use_delta` events so `chat.ts` can build the round's tool calls.
- `src/durable-objects/manager.ts` — pass `tools` + `executeTool` into `streamChatTurn`. `executeTool` dispatches to `repoReadTools` functions, threading through the project's `repoFullName` + `defaultBranch`.
- `prompts/manager.md` — one-line clarification near "What you have": when you need to see a file, use the `read_repo_file` tool; don't ask the user to paste. (Anthropic's tool API itself describes the tools to the model via the schema — we don't repeat the schemas in prose.)
- `web/src/lib/types.ts` — add `ToolEvent` and a `Segment` type (`{ kind: "text" } | { kind: "tool" }`).
- `web/src/hooks/useChatStream.ts` — handle `tool` events; the streaming state becomes an ordered `Segment[]` instead of a flat text string.
- `web/src/components/StreamingMessage.tsx` — render segments in order: text runs as paragraphs, tool runs as a hairline-bordered inline status line.
- `web/src/components/MessageItem.tsx` — no change to behavior; assistant messages in history continue to render the persisted final text only.

### Unchanged

- `wrangler.toml` — no binding changes
- `D1 schema` — no migration. Tool round-trips stay in DO memory for the current turn only; only the final assistant text persists. See §"Persistence" below for the explicit tradeoff.

---

## Tool schemas

These ship verbatim from `src/lib/toolDefinitions.ts`. The schemas are how the model discovers what the tools do — no prose duplication in the manager prompt.

```ts
export const listRepoFilesTool = {
  name: "list_repo_files",
  description:
    "List immediate children of a directory in this project's repo. Returns " +
    "an array of entries with name, type ('file' or 'dir'), and size (for files). " +
    "Use this to discover what's where before fetching specific files. Pass an " +
    "empty path or '.' to list the repo root.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory path relative to the repo root. Empty string or '.' lists " +
          "the root. Examples: 'src', 'src/lib', 'web/src/components'.",
      },
    },
    required: [],
  },
} as const;

export const readRepoFileTool = {
  name: "read_repo_file",
  description:
    "Read the full contents of one file from this project's repo. Returns the " +
    "file as UTF-8 text. Refuses files over 256 KB or files that can't be decoded " +
    "as text. Prefer this when you need exact content; if you just need to know " +
    "what files exist, use list_repo_files.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the repo root. Required.",
      },
    },
    required: ["path"],
  },
} as const;

export const readRepoFilesTool = {
  name: "read_repo_files",
  description:
    "Read multiple files in one call (parallel). Returns an array of " +
    "{ path, content?, error?, size? } objects in the same order as the input. " +
    "Caps at 10 paths per call. Use when you need to look at a small set of " +
    "related files together (e.g., 'check the route, the handler, and the type').",
  input_schema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "File paths relative to the repo root. Up to 10.",
      },
    },
    required: ["paths"],
  },
} as const;

export const repoReadToolDefinitions = [
  listRepoFilesTool,
  readRepoFileTool,
  readRepoFilesTool,
] as const;
```

### Why three tools, not one

Could have a single `read_repo` with a discriminated union. Three is cleaner because the model sees three differently-described affordances. It picks based on intent: discover (list), focused fetch (read), batch fetch (read_files). The descriptions guide the model's choice; one mega-tool with a switch would force the model to read documentation just to decide.

---

## Tool implementations

`src/lib/repoReadTools.ts` exports three functions. Each returns `{ content: string | Array<{type:"text",text:string}>, is_error?: boolean }` — the exact shape Anthropic expects for `tool_result.content`.

### `listRepoFiles({ path = "" })`

1. Normalize `path` (strip leading `/`, treat `"."` as `""`).
2. `GET /repos/:o/:r/contents/<path>?ref=<branch>` (or just `/repos/:o/:r/contents?ref=<branch>` for root).
3. If 404 → return `{ content: "Directory not found: <path>", is_error: true }`.
4. Map entries to `{ name, type, size? }` (only `file` and `dir` types; symlinks/submodules are noted but not traversed).
5. Sort: dirs first alphabetically, then files alphabetically.
6. Return `content` as a JSON-string summary the model can read directly:

```
src/
src/lib/
src/routes/
src/durable-objects/
package.json (797 B)
tsconfig.json (408 B)
wrangler.toml (576 B)
README.md (1.6 KB)
SPEC.md (32 KB)
```

A one-line-per-entry text rendering is friendlier to the model than a deeply nested JSON tree. The model can parse it intuitively.

### `readRepoFile({ path })`

1. Reject empty path → `{ content: "Path is required.", is_error: true }`.
2. `GET /repos/:o/:r/contents/<path>?ref=<branch>`.
3. 404 → `{ content: "File not found: <path>", is_error: true }`.
4. The response includes `size`. If `size > 256 * 1024` → `{ content: "File too large (X KB) — reads are capped at 256 KB. Ask the user to share what's relevant.", is_error: true }`. (Polite refusal — the manager's prompt covers asking the user when it can't help itself.)
5. Decode base64 → UTF-8. If decode throws (binary file) → `{ content: "File <path> is not text (couldn't decode as UTF-8).", is_error: true }`.
6. Return `{ content: "<file path>\n\n<file contents>" }`. Embedding the path in the result helps the model when it does parallel reads.

### `readRepoFiles({ paths })`

1. Validate: non-empty array, length ≤ 10 → otherwise `{ content: "Pass between 1 and 10 paths.", is_error: true }`.
2. `Promise.all(paths.map((p) => readRepoFile({ path: p })))` (with internal error capture per path).
3. Assemble:

```
=== src/lib/router.ts ===
<contents>

=== src/lib/github.ts ===
<contents>

=== src/lib/missing.ts ===
ERROR: File not found
```

4. Return as one `text` block. The model has all paths in one read.

### File size cap (`MAX_FILE_BYTES = 256 * 1024`)

256 KB covers virtually every source file. Anything bigger is probably a build artifact, a dump, a binary, or generated code the manager shouldn't be wading through anyway. Refusing politely keeps tokens reasonable.

### Batch cap (`MAX_BATCH_FILES = 10`)

Ten is enough for "show me the chain of files touching X" without enabling a model-driven slurp of an entire directory.

---

## `chat.ts` refactor — the tool-use loop

The new shape (pseudocode; real code does proper streaming-event handling):

```ts
export async function* streamChatTurn(opts: ChatTurnOpts): AsyncGenerator<SseEvent, ChatTurnRecord, unknown> {
  const parser = new ActionParser(KNOWN_ACTIONS);
  let messages = opts.history;
  let totalRaw = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.create({
      model: MODEL_ID,
      system: opts.system,
      messages,
      tools: opts.tools,
      stream: true,
    });

    const toolUses: AccumulatedToolUse[] = [];
    let textInRound = "";
    let stopReason: string | null = null;

    for await (const ev of stream) {
      // text_delta → run through ActionParser → yield event:text / event:action
      // tool_use start/delta → accumulate
      // message_delta with stop_reason → record
    }
    for (const ev of parser.finish()) yield mapped(ev);

    totalRaw += textInRound;

    if (stopReason !== "tool_use" || toolUses.length === 0) break;

    // Reconstruct assistant message with tool_use blocks
    messages = [...messages, { role: "assistant", content: buildAssistantContent(textInRound, toolUses) }];

    // Execute each tool, emit a `tool` SSE event per execution, collect tool_results
    const toolResults: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      const result = await opts.executeTool!(tu.name, tu.input);
      yield { event: "tool", data: { id: tu.id, name: tu.name, input: tu.input, ok: !result.is_error, summary: summarize(tu.name, tu.input, result) } };
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result.content, is_error: result.is_error });
    }
    messages = [...messages, { role: "user", content: toolResults }];
  }

  yield { event: "done", data: {} };
  return { rawAssistantText: totalRaw };
}
```

**Tool round-trip cap (`MAX_TOOL_ROUNDS = 5`).** Anthropic models don't typically loop unnecessarily, but a hard cap means a misbehaving prompt or runaway pattern can't burn through tokens indefinitely. Five round-trips is plenty for "list, read three files, summarize."

**ActionParser persistence across rounds.** One parser instance for the whole turn. Each round's text completes cleanly when the model decides to call tools (so `finish()` is safe to call at round boundaries; mode resets to text, buffer drains). Fenced action blocks split across tool round-trips don't happen in normal model output.

---

## SSE protocol — new event

Adding one event type to the protocol from SPEC.md:

```
event: tool
data: {
  "id": "toolu_01ABC...",
  "name": "read_repo_file",
  "input": { "path": "src/lib/router.ts" },
  "ok": true,
  "summary": "Read src/lib/router.ts (1.2 KB)"
}
```

- Fires **after** the tool completes (one event per execution, not start+end)
- `summary` is for UI display only — the actual `tool_result` content goes back to Anthropic unchanged
- On error: `ok: false` and `summary` describes the failure ("File too large: 412 KB")

`text`, `action`, `done`, `error` events all unchanged.

I'll update SPEC.md §"Streaming protocol" to document the new event in the same Phase 3.5 commit (it's a protocol addition, not Phase-3.5-only behavior — future phases will continue to use it for brain tools).

---

## Frontend — segmented streaming message

The streaming-state shape changes from a flat string to an ordered list of segments:

```ts
type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean };

interface StreamingState {
  segments: Segment[];
}
```

Reducer:
- `text` event → if last segment is `text`, append delta to its text; else push new `text` segment
- `tool` event → push new `tool` segment
- `done` → finalize, hand off to `ChatView.onDone`

`StreamingMessage` renders segments in order. Text segments render as flowing paragraphs (whitespace-pre-wrap). Tool segments render as a small hairline-bordered inline divider:

```
─────── Read src/lib/router.ts (1.2 KB) ───────
```

- Centered horizontally, full-width hairline rules left/right of the label
- Label in JetBrains Mono, low opacity (`text-ink/50`), text-xs
- `tool.ok === false` renders the same shape but in `text-ink` (no special color — keeps editorial restraint; the prose around it will explain)

The animated caret bar stays at the very end of the message until `done`.

---

## Persistence — only the final assistant text

When a tool-use round-trip completes within a single user turn, the manager's full exchange (text + tool_use + tool_result + text + …) lives in DO memory for that turn. **Only the concatenated final assistant text is persisted to `messages.content` in D1.**

**Why not persist the full structured exchange:**

- Anthropic's API requires `tool_use` blocks to be matched with `tool_result` blocks in the messages array of the next request. If we persisted the full structure, history reads on subsequent turns would need to send the entire prior tool round-trips back to the model.
- That's correct but expensive (token-wise) and requires a schema change (`content_blocks JSON` column or similar) — not justified for v0.
- The accepted tradeoff: the model loses its previously-read file contents across user turns. On the next user message, if it needs `src/lib/router.ts` again, it calls `read_repo_file` again. One extra GitHub call. Acceptable.

**What history reload shows:** the manager's final prose only. Tool calls from the previous turn are not visible. The status lines that appeared inline during streaming are not persisted.

When this becomes a problem (chat gets long, model re-fetches the same file 10 times across the conversation), we'll add a `content_blocks` column and proper structured persistence. Not now.

---

## `prompts/manager.md` change

A single addition near the "What you have" section:

```markdown
- **The repo.** You have read access to its code, structure, README, and commit history. You know what's there. **Use the `read_repo_file` and `list_repo_files` tools when you need to look at something — don't ask the user to paste. The tools are GET-only and safe to call without checking first.**
```

The bolded portion is the only new text. Tells the model the affordance exists and to use it freely rather than route through the user.

---

## Verification

Steps 1–9 are mine. Steps 10–13 are yours (the visual + behavioral checks).

| # | Check | Who |
|---|---|---|
| 1 | `npm install` (no new deps) | me |
| 2 | `npm run typecheck` clean | me |
| 3 | `npm run build` clean | me |
| 4 | `npm run dev` brings up wrangler (Vite may or may not, depending on 5173) | me |
| 5 | `POST /api/projects/<id>/manager/chat` with `{ chatId, message: "list the contents of src/lib" }`. Expect the SSE stream to include: text → `tool` event with `name: "list_repo_files"` and `ok: true` → text. Capture raw bytes | me |
| 6 | Same project, `{ message: "what does src/lib/router.ts do? read it." }`. Expect: text → `tool` event for `read_repo_file` → final text mentions specific exports from router.ts (proves the read actually happened) | me |
| 7 | `{ message: "compare auth.ts, ids.ts, and chat.ts in src/lib — what's the smallest one?" }`. Expect: `tool` event for `read_repo_files` with 3 paths → text comparing sizes / content | me |
| 8 | Edge: `{ message: "read package-lock.json" }` — the file is >100 KB. Expect: `tool` event with `ok: false`, summary mentioning size; manager's response handles the refusal gracefully | me |
| 9 | Edge: `{ message: "read foo/does/not/exist.ts" }`. Expect: `tool` event with `ok: false`, summary "File not found"; manager explains | me |
| 10 | Open `http://localhost:5173/` (kill PID 23080 first). Open the manager chat. Ask "what files are in src/routes/" — see the inline status line ("Read directory…" or similar) followed by the manager's text response | you |
| 11 | Ask the manager to compare two files. Watch multiple status lines stream in order | you |
| 12 | Refresh. History shows only the manager's text — no status lines (persistence by design) | you |
| 13 | Verify a `dispatch_claude_code` fenced block still parses correctly (e.g., ask "draft a dispatch to add a comment to package.json" — the action parser should still emit `event: action`, frontend still silently absorbs it). Confirms tools and fenced actions coexist | you |

If 1–9 pass on my end, single commit + push; you run 10–13.

---

## Resolved decisions

**1. Three tools, not one.** Distinct named affordances; the model picks intent-first.

**2. Tools live in their own file (`repoReadTools.ts`), schemas in their own file (`toolDefinitions.ts`).** Both shared with Phase 7's BrainstormDO. Same implementation; brains import the same modules.

**3. Don't persist structured tool round-trips.** Only final assistant text lands in D1. Manager re-fetches if needed across user turns. Schema migration deferred to whenever this hurts.

**4. One `tool` event per execution, not start+end.** Smaller frontend reducer; tool calls are fast enough that the "running…" state isn't worth the protocol cost.

**5. Tools execute without user confirmation.** Reads are GET-only and idempotent; the bright line covers writes, not reads.

**6. `read_repo_files` returns one concatenated text block, not structured JSON.** The model parses prose well; structured JSON is cognitive overhead for both the model and any human reading the SSE.

**7. ActionParser stays.** Fenced action blocks (`dispatch_claude_code`, `post_to_board`, `update_ceo_file`) continue to flow through the existing path. Tool use is orthogonal. We'll revisit a possible migration of those to Anthropic tools when the dust settles after Phase 6.

---

## Surprises / things to flag

**1. Tokens-per-request goes up slightly.** Each Anthropic call now ships the three tool schemas (~600 tokens). v0 acceptable.

**2. Tool round-trips add latency to the user-perceived response.** A single user turn could include 2–4 GitHub API round-trips before the final text starts streaming. The inline status lines mitigate this — user sees activity, not silence.

**3. Tool execution errors should not crash the turn.** Every tool call in `executeTool` is wrapped in try/catch; failures become `is_error: true` `tool_result` blocks. The model handles the error in its next text segment.

**4. Anthropic SDK's streaming events for tool_use are slightly fiddly.** `content_block_start` carries the tool name and id; `content_block_delta` with `input_json_delta` streams the JSON input piece-by-piece (because input can be large). We accumulate then `JSON.parse` at `content_block_stop`. Documenting because the first time this misbehaves the error will look like "unexpected token in JSON."

**5. The `prompts/manager.md` edit is the smallest possible change.** Tools are described to the model via the API's `tools` parameter — schemas + descriptions. We don't repeat them in prose. The one-line prompt addition is just permission ("use them freely") and a steer away from pasting.
