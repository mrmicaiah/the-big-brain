import { useEffect, useRef, useState } from "react";
import { apiFetchRaw, ApiError } from "../lib/api";
import { parseSseStream } from "../lib/sse";
import type {
  JobSnapshot,
  JobOutputFrame,
  DiffSummary,
} from "../lib/types";

export interface JobStreamState {
  snapshot: JobSnapshot | null;
  outputs: JobOutputFrame[];
  terminal: ({ status: "succeeded" | "failed" } & DiffSummary) | null;
  error: string | null;
  loading: boolean;
}

/**
 * SSE subscriber for a single job. Opens GET /api/jobs/:id/stream and consumes
 * `snapshot` / `output` / `terminal` events. Cleans up on unmount or jobId
 * change. Live jobs accumulate output frames; terminal jobs receive their
 * final state and close.
 */
export function useJobStream(jobId: string | null): JobStreamState {
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [outputs, setOutputs] = useState<JobOutputFrame[]>([]);
  const [terminal, setTerminal] =
    useState<({ status: "succeeded" | "failed" } & DiffSummary) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId) {
      setSnapshot(null);
      setOutputs([]);
      setTerminal(null);
      setError(null);
      setLoading(false);
      return;
    }
    setSnapshot(null);
    setOutputs([]);
    setTerminal(null);
    setError(null);
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await apiFetchRaw(`/api/jobs/${jobId}/stream`, {
          signal: ctrl.signal,
        });
        if (!res.body) throw new Error("no response body");
        for await (const ev of parseSseStream(res.body)) {
          if (ctrl.signal.aborted) return;
          if (ev.event === "snapshot") {
            setSnapshot(ev.data as JobSnapshot);
          } else if (ev.event === "output") {
            setOutputs((prev) => [...prev, ev.data as JobOutputFrame]);
          } else if (ev.event === "terminal") {
            setTerminal(ev.data as { status: "succeeded" | "failed" } & DiffSummary);
            setLoading(false);
            return;
          }
        }
        setLoading(false);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError) {
          setError(`HTTP ${err.status}: ${err.body.slice(0, 200)}`);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setLoading(false);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [jobId]);

  return { snapshot, outputs, terminal, error, loading };
}
