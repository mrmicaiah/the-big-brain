import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";
import type { JobSnapshot, DiffSummary } from "../lib/types";
import { useJobStream } from "../hooks/useJobStream";
import { DiffView } from "./DiffView";

interface Props {
  projectId: string;
  chatId: string;
  messageId: string;
  fenceIndex: number;
  summary: string;
  prompt: string;
  /** If known at render time (history reload), pre-populated. Otherwise null
   *  for a freshly-streamed action that hasn't been dispatched yet. */
  existingJob?: JobSnapshot | null;
}

/**
 * One dispatch action card. Five states (per docs/phase-4-plan.md):
 *   - Idle: button shown, no job yet. Click → POST /dispatch-claude-code.
 *   - Queued: waiting for agent
 *   - Running: live output preview
 *   - Succeeded: diff stat + expandable diff
 *   - Failed: error + stage
 */
export function DispatchCard({
  projectId,
  chatId,
  messageId,
  fenceIndex,
  summary,
  prompt,
  existingJob = null,
}: Props) {
  const [jobId, setJobId] = useState<string | null>(existingJob?.id ?? null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  // Stream live state for the job (whether existing or freshly dispatched)
  const stream = useJobStream(jobId);

  // Reflect a passed-in existingJob into stream state if we don't have a live
  // connection yet (e.g., terminal job from history).
  const status: "idle" | "queued" | "running" | "succeeded" | "failed" =
    !jobId
      ? "idle"
      : stream.terminal
        ? stream.terminal.status
        : stream.snapshot
          ? (stream.snapshot.status as "queued" | "running" | "succeeded" | "failed")
          : existingJob
            ? (existingJob.status as "queued" | "running" | "succeeded" | "failed")
            : "queued";

  // For history-loaded terminals, parse diff_summary from the snapshot if the
  // stream didn't fire `terminal` (it WILL if the DO replays — see
  // AgentHubDO.handleSubscribe — but we belt-and-suspenders parse the snapshot).
  const diff: DiffSummary | null = (() => {
    if (stream.terminal) {
      const { status: _s, ...rest } = stream.terminal;
      void _s;
      return rest as DiffSummary;
    }
    const src = stream.snapshot ?? existingJob;
    if (!src?.diff_summary) return null;
    try {
      return JSON.parse(src.diff_summary) as DiffSummary;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (existingJob?.id) setJobId(existingJob.id);
  }, [existingJob?.id]);

  const onRun = async () => {
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await apiFetch<{ jobId: string }>(
        `/api/projects/${projectId}/dispatch-claude-code`,
        {
          method: "POST",
          body: JSON.stringify({
            chatId,
            messageId,
            fenceIndex,
            summary,
            prompt,
          }),
        },
      );
      setJobId(res.jobId);
    } catch (err) {
      setDispatchError(
        err instanceof ApiError
          ? `Dispatch failed (${err.status}).`
          : err instanceof Error
            ? err.message
            : "Dispatch failed.",
      );
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="my-4 border border-hairline bg-paper">
      <div className="border-b border-hairline px-4 py-3">
        <div className="mb-1 flex items-center gap-2 font-sans text-xs uppercase tracking-wider text-ink/50">
          <span>Dispatch worker</span>
          <StatusBadge status={status} />
        </div>
        <p className="font-display text-base text-ink">{summary}</p>
        <button
          type="button"
          onClick={() => setShowPrompt((b) => !b)}
          className="mt-1 font-sans text-xs text-ink/50 hover:text-ink"
        >
          {showPrompt ? "hide prompt" : "show prompt"}
        </button>
        {showPrompt && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink/80">
{prompt}
          </pre>
        )}
      </div>

      {status === "idle" && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={onRun}
            disabled={dispatching}
            className="border border-ink bg-paper px-4 py-2 font-sans text-sm text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
          >
            {dispatching ? "Dispatching…" : "Run Claude Code →"}
          </button>
          {dispatchError && (
            <p className="mt-2 font-sans text-xs text-ink">{dispatchError}</p>
          )}
        </div>
      )}

      {status === "queued" && (
        <div className="px-4 py-3 font-display text-sm text-ink/50">
          Queued — waiting for agent.
        </div>
      )}

      {status === "running" && (
        <div className="px-4 py-3">
          <p className="mb-2 font-display text-sm text-ink/60">Running…</p>
          {stream.outputs.length > 0 && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink/70">
{stream.outputs.slice(-10).map((o) => `[${o.kind}] ${o.payload}`).join("\n")}
            </pre>
          )}
        </div>
      )}

      {status === "succeeded" && diff && "diffStat" in diff && (
        <div className="px-4 py-3">
          <p className="font-display text-sm text-ink">
            {(diff as { summary?: string }).summary || "Worker completed."}
          </p>
          <DiffView
            diffStat={(diff as { diffStat?: string }).diffStat}
            diff={(diff as { diff?: string }).diff}
            diffTruncated={(diff as { diffTruncated?: boolean }).diffTruncated}
          />
        </div>
      )}

      {status === "failed" && diff && "error" in diff && (
        <div className="px-4 py-3">
          <p className="font-display text-sm text-ink">
            Failed at stage <strong>{(diff as { stage?: string }).stage ?? "?"}</strong>
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink/80">
{(diff as { error?: string }).error ?? "?"}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status[0]!.toUpperCase() + status.slice(1);
  return (
    <span className="border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink/60">
      {label}
    </span>
  );
}
