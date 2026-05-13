# The Big Brain — local agent

The local execution worker for The Big Brain. Listens for jobs over a persistent
WebSocket to the Cloudflare Worker, runs Claude Code against the project's repo
on this machine, and streams output back so the user (and the project's manager)
see what happened in real time.

The Worker decides what to run. This process runs it.

## Setup (one-time)

### 1. Generate `AGENT_TOKEN`

```powershell
[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
```

Use that string as `AGENT_TOKEN` in all three places below.

### 2. Set it on the Worker

```bash
npx wrangler secret put AGENT_TOKEN
# paste the value
```

### 3. Set it in `.dev.vars` at the repo root (for local Worker dev)

```
AGENT_TOKEN=<same value>
```

### 4. Configure this agent

```bash
cp agent/.env.example agent/.env
```

Then edit `agent/.env`:

- `AGENT_TOKEN` — same value as above
- `WORKER_URL` — `ws://localhost:8787/api/agent/ws` for local, `wss://<your-worker-domain>/api/agent/ws` for prod
- `REPOS_DIR` — absolute path where repos live (e.g., `C:\Users\you\Projects`)
- `ANTHROPIC_API_KEY` — same key the Worker uses; the Claude Code SDK reads this from `process.env`

### 5. Install + run

```bash
cd agent
npm install
npm run dev
```

Leave the window open. The agent connects, sends `ready`, and waits for jobs.

## What the agent does

When a job arrives over the WebSocket:

1. **Ensure workspace.** If `<REPOS_DIR>/<repo>` exists, use it. If not, `git clone` it from the project's `clone_url`. If neither works, fail the job in the `workspace` stage.
2. **Run Claude Code** via `@anthropic-ai/claude-code` with `cwd` set to the workspace and `permissionMode: "bypassPermissions"` (the user approved the dispatch via the UI; the agent has no human at the terminal to approve individual tool calls).
3. **Stream events** back: every `text` chunk, every `tool_use`, every `tool_result` is forwarded as an `output` message. The Worker fans these out to any SSE listener subscribed to the job.
4. **Capture diff.** Stage everything (`git add -A`), capture `git diff --cached --stat` + `git diff --cached`, then `git reset` to unstage. The agent reports `completed` with the diff stat, full diff (capped at 200 KB), Claude's final summary, and a `diffTruncated` flag.
5. **The user pushes.** The agent never pushes to GitHub. Diffs land in the local working tree and the user reviews + pushes manually with their normal tooling.

## What the agent does NOT do

- Push to GitHub
- Touch any repo other than the one named by the job
- Run jobs without a WebSocket session (the Worker queues offline jobs and flushes on the next `ready`)
- Persist anything (logs go to stdout; state lives on the Worker side in D1)

## Reconnect behavior

If the WebSocket drops, the agent waits 3 seconds and reconnects. The Worker's
`AgentHubDO` accepts the newer connection and closes any older one with code
`1000: new agent connected`. Running two agent processes against the same
Worker will cause them to fight each other in this loop — don't.

## Stopping the agent

**Press `Ctrl+C` in the PowerShell window.** That cleanly stops both `npm` and
its `tsx` child process. Closing the window without `Ctrl+C` (or stopping the
npm wrapper from outside) can leave the `tsx`/`node` child running in the
background; if you then start a fresh agent, the orphaned one will keep
reconnecting and the two will ping-pong each other off the WebSocket via the
newer-wins logic. If that happens, kill any lingering `node` processes with
`tsx` in their command line via Task Manager or:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*agent*tsx*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Auth model

- The agent presents `Authorization: Bearer <AGENT_TOKEN>` on the upgrade.
- The Worker validates `AGENT_TOKEN` BEFORE forwarding to `AgentHubDO`.
- `AGENT_TOKEN` is distinct from `AUTH_TOKEN` (which gates the user-facing
  `/api/*` calls). `/api/agent/ws` is exempt from the user gate.

## Troubleshooting

**`401 Unauthorized` on connect.** `AGENT_TOKEN` doesn't match between `agent/.env` and the Worker's secret (or `.dev.vars` for local). Regenerate, set in all three places, restart.

**Job fails in `workspace` stage.** The repo directory doesn't exist at `<REPOS_DIR>/<repo>` and the project has no `clone_url`. Either create the directory + run `git init` first, or claim a GitHub repo via the picker so `clone_url` gets populated.

**Job fails in `execution` stage.** Usually the Claude Code SDK errored. Check the agent log for the underlying message. Common causes: invalid `ANTHROPIC_API_KEY`, hitting Claude's token cap, or the prompt asking for something Claude Code can't do.

**Job fails in `diff` stage.** `git diff` errored — usually a corrupt working tree. The Claude Code run succeeded but the diff capture didn't. The changes are still in the working tree on disk; recover with normal git tools.
