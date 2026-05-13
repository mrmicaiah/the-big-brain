import { useCallback, useRef, useState } from "react";
import { apiFetchRaw, ApiError } from "../lib/api";
import { parseSseStream } from "../lib/sse";
import type { Segment, ToolEvent } from "../lib/types";

export interface StreamingState {
  segments: Segment[];
}

export interface UseChatStreamOpts {
  onDone: (final: { rawText: string }) => void;
}

export function useChatStream(opts: UseChatStreamOpts) {
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mirror streaming state in a ref so the async stream loop reads latest
  // without re-creating closures on every state change.
  const streamingRef = useRef<StreamingState>({ segments: [] });

  function appendText(delta: string) {
    const segs = streamingRef.current.segments;
    const last = segs[segs.length - 1];
    if (last && last.kind === "text") {
      const updated: Segment = { kind: "text", text: last.text + delta };
      streamingRef.current = { segments: [...segs.slice(0, -1), updated] };
    } else {
      streamingRef.current = {
        segments: [...segs, { kind: "text", text: delta }],
      };
    }
    setStreaming(streamingRef.current);
  }

  function appendTool(tool: ToolEvent) {
    streamingRef.current = {
      segments: [
        ...streamingRef.current.segments,
        { kind: "tool", name: tool.name, summary: tool.summary, ok: tool.ok },
      ],
    };
    setStreaming(streamingRef.current);
  }

  function concatTextOnly(): string {
    return streamingRef.current.segments
      .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
      .map((s) => s.text)
      .join("");
  }

  const send = useCallback(
    async (args: { projectId: string; chatId: string; message: string }) => {
      streamingRef.current = { segments: [] };
      setStreaming({ segments: [] });
      setError(null);

      try {
        const res = await apiFetchRaw(
          `/api/projects/${args.projectId}/manager/chat`,
          {
            method: "POST",
            body: JSON.stringify({ chatId: args.chatId, message: args.message }),
          },
        );
        if (!res.body) throw new Error("no response body");

        for await (const ev of parseSseStream(res.body)) {
          if (ev.event === "text") {
            const delta = (ev.data as { delta: string }).delta;
            appendText(delta);
          } else if (ev.event === "tool") {
            appendTool(ev.data as ToolEvent);
          } else if (ev.event === "action") {
            // Phase 3.5: silently absorb fenced action blocks (unchanged from
            // Phase 3 — they light up in Phase 4 / Phase 6).
          } else if (ev.event === "done") {
            opts.onDone({ rawText: concatTextOnly() });
            setStreaming(null);
            return;
          } else if (ev.event === "error") {
            setError((ev.data as { message: string }).message);
            setStreaming(null);
            return;
          }
        }
        // Stream ended without explicit done — treat as done
        opts.onDone({ rawText: concatTextOnly() });
        setStreaming(null);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(`HTTP ${err.status}: ${err.body.slice(0, 200)}`);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setStreaming(null);
      }
    },
    [opts],
  );

  return { streaming, error, send };
}
