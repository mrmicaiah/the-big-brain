// Run a Claude Code job in a workspace, streaming output events back through
// the WebSocket as they arrive from the SDK. On completion, capture the diff
// and send the terminal `completed` (or `failed`) message.
//
// SDK message handling is intentionally permissive: we duck-type fields the
// SDK emits and translate them into our three output kinds (text, tool_use,
// tool_result). The SDK's exact type definitions vary across versions; this
// stays compatible by only reading fields we explicitly need.

import { query } from "@anthropic-ai/claude-code";
import type WebSocket from "ws";
import { captureDiff, ensureWorkspace } from "./workspace.js";
import type { AgentConfig } from "./config.js";
import { log } from "./log.js";

interface JobMessage {
  jobId: string;
  repoName: string;
  cloneUrl: string | null;
  prompt: string;
  projectId: string;
  chatId: string;
}

interface AgentMessage {
  // Outgoing message shapes mirror the protocol agreed with AgentHub.
  // Defined here to avoid coupling to the Worker package.
  type: "output" | "completed" | "failed";
  jobId: string;
  // ... varies by type
  [key: string]: unknown;
}

function send(ws: WebSocket, msg: AgentMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log.warn(`ws send failed for job ${msg.jobId}:`, (err as Error).message);
  }
}

export async function runJob(
  job: JobMessage,
  ws: WebSocket,
  config: AgentConfig,
): Promise<void> {
  log.info(`job ${job.jobId} starting — repo ${job.repoName}, project ${job.projectId}`);

  // ── 1. Workspace ────────────────────────────────────────────────────
  let workspacePath: string;
  try {
    const ws_ = ensureWorkspace(config.reposDir, job.repoName, job.cloneUrl);
    workspacePath = ws_.path;
    if (ws_.isFresh) {
      send(ws, {
        type: "output",
        jobId: job.jobId,
        kind: "text",
        payload: `(cloned ${job.repoName} fresh)\n`,
      });
    }
  } catch (err) {
    log.error(`workspace failure for job ${job.jobId}:`, err);
    send(ws, {
      type: "failed",
      jobId: job.jobId,
      error: (err as Error).message,
      stage: "workspace",
    });
    return;
  }

  // ── 2. Run Claude Code ──────────────────────────────────────────────
  let finalText = "";
  let executionFailed: string | null = null;

  try {
    // SECURITY NOTE: permissionMode "bypassPermissions" skips Claude Code's
    // per-tool-call user confirmation. This is INTENTIONAL for The Big Brain:
    //   1. The user approved this entire dispatch by clicking "Run Claude Code →"
    //      in the frontend before this code runs.
    //   2. The agent runs on the user's own machine; the user owns the FS.
    //   3. The agent does `git reset` after capturing diffs, so changes stay
    //      unstaged — user reviews with git before pushing.
    // Tightening this (per-call confirmation) would break the "click once to
    // dispatch a worker" contract. Don't change without rethinking the UX.
    for await (const message of query({
      prompt: job.prompt,
      options: {
        cwd: workspacePath,
        permissionMode: "bypassPermissions",
      },
    }) as AsyncIterable<unknown>) {
      const m = message as { type?: string } & Record<string, unknown>;

      if (m.type === "assistant") {
        // m.message.content: Array<{ type: "text" | "tool_use", ... }>
        const inner = (m.message as { content?: unknown[] } | undefined)?.content ?? [];
        for (const block of inner) {
          const b = block as { type?: string } & Record<string, unknown>;
          if (b.type === "text") {
            const text = typeof b.text === "string" ? b.text : "";
            if (text) {
              send(ws, { type: "output", jobId: job.jobId, kind: "text", payload: text });
              finalText += text;
            }
          } else if (b.type === "tool_use") {
            send(ws, {
              type: "output",
              jobId: job.jobId,
              kind: "tool_use",
              payload: JSON.stringify({ name: b.name, input: b.input }),
            });
          }
        }
      } else if (m.type === "user") {
        // tool_result messages
        const inner = (m.message as { content?: unknown[] } | undefined)?.content ?? [];
        for (const block of inner) {
          const b = block as { type?: string } & Record<string, unknown>;
          if (b.type === "tool_result") {
            send(ws, {
              type: "output",
              jobId: job.jobId,
              kind: "tool_result",
              payload: JSON.stringify({
                tool_use_id: b.tool_use_id,
                content: b.content,
              }),
            });
          }
        }
      } else if (m.type === "result") {
        // Terminal SDK event. subtype === "success" means clean exit; anything
        // else (error_max_turns, error_during_execution, etc.) is a failure.
        const subtype = typeof m.subtype === "string" ? m.subtype : "unknown";
        const resultText = typeof m.result === "string" ? m.result : "";
        if (subtype === "success") {
          if (resultText) finalText = resultText;
        } else {
          executionFailed = `Claude Code returned ${subtype}`;
        }
      }
      // m.type === "system": ignored. Carries init metadata not useful here.
    }
  } catch (err) {
    log.error(`execution failure for job ${job.jobId}:`, err);
    send(ws, {
      type: "failed",
      jobId: job.jobId,
      error: (err as Error).message,
      stage: "execution",
    });
    return;
  }

  if (executionFailed) {
    send(ws, {
      type: "failed",
      jobId: job.jobId,
      error: executionFailed,
      stage: "execution",
    });
    return;
  }

  // ── 3. Capture diff ─────────────────────────────────────────────────
  let diff;
  try {
    diff = captureDiff(workspacePath);
  } catch (err) {
    log.error(`diff capture failure for job ${job.jobId}:`, err);
    send(ws, {
      type: "failed",
      jobId: job.jobId,
      error: `diff capture failed: ${(err as Error).message}`,
      stage: "diff",
    });
    return;
  }

  const summary =
    finalText.trim().length > 0
      ? truncateSummary(finalText)
      : diff.stat
        ? "Worker completed."
        : "Worker completed with no changes.";

  send(ws, {
    type: "completed",
    jobId: job.jobId,
    diffStat: diff.stat,
    diff: diff.diff,
    diffTruncated: diff.truncated,
    summary,
  });

  log.info(`job ${job.jobId} completed cleanly`);
}

/**
 * Take the model's free-form final text and produce a short summary suitable
 * for the panel headline and for the manager's next-turn context. We don't want
 * a 2000-character essay — one paragraph at most, with the first hard newline
 * or sentence boundary as a cutoff if needed.
 */
function truncateSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 600) return trimmed;
  const firstParagraph = trimmed.split(/\n\s*\n/)[0];
  if (firstParagraph.length <= 600) return firstParagraph;
  return firstParagraph.slice(0, 597).trimEnd() + "…";
}
