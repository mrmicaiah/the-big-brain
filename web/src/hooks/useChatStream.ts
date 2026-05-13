import { useCallback, useRef, useState } from "react";
import { apiFetchRaw, ApiError } from "../lib/api";
import { parseSseStream } from "../lib/sse";
import type { ParsedAction } from "../lib/types";

export interface StreamingState {
  text: string;
  actions: ParsedAction[];
}

export interface UseChatStreamOpts {
  onDone: (final: { rawText: string; actions: ParsedAction[] }) => void;
}

export function useChatStream(opts: UseChatStreamOpts) {
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mirror streaming state in a ref so the SSE loop can read latest without
  // re-creating the closure on every state change.
  const streamingRef = useRef<StreamingState>({ text: "", actions: [] });

  const send = useCallback(
    async (args: { projectId: string; chatId: string; message: string }) => {
      streamingRef.current = { text: "", actions: [] };
      setStreaming({ text: "", actions: [] });
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
            streamingRef.current = {
              ...streamingRef.current,
              text: streamingRef.current.text + delta,
            };
            setStreaming(streamingRef.current);
          } else if (ev.event === "action") {
            const action = ev.data as ParsedAction;
            streamingRef.current = {
              ...streamingRef.current,
              actions: [...streamingRef.current.actions, action],
            };
            setStreaming(streamingRef.current);
          } else if (ev.event === "done") {
            opts.onDone({
              rawText: streamingRef.current.text,
              actions: streamingRef.current.actions,
            });
            setStreaming(null);
            return;
          } else if (ev.event === "error") {
            const message = (ev.data as { message: string }).message;
            setError(message);
            setStreaming(null);
            return;
          }
        }
        // Stream ended without an explicit done — treat as done with what we have
        opts.onDone({
          rawText: streamingRef.current.text,
          actions: streamingRef.current.actions,
        });
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
