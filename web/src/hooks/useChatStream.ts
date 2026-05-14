import { useCallback, useRef, useState } from "react";
import { apiFetchRaw, ApiError } from "../lib/api";
import { parseSseStream } from "../lib/sse";
import type { Segment, ToolEvent } from "../lib/types";

export interface StreamingState {
  segments: Segment[];
  messageId: string | null;
}

export interface UseChatStreamOpts {
  onDone: (final: { rawText: string; messageId: string | null }) => void;
}

/**
 * SSE consumer for the manager chat stream. Maintains segmented streaming
 * state (text + tool + action). Emits the assistant's pre-generated
 * messageId on `message_start`; this lets in-flight dispatch fences render
 * as cards keyed to the (eventually-persisted) message id.
 */
export function useChatStream(opts: UseChatStreamOpts) {
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamingRef = useRef<StreamingState>({ segments: [], messageId: null });
  const fenceCounterRef = useRef(0);

  // Every setStreaming call below passes `{ ...streamingRef.current }`, not the
  // ref's value directly. React's setState bail-out uses Object.is on the new
  // vs. prior state — across async iterations of the SSE consumer, passing the
  // ref reference can leave the bail-out thinking nothing changed, suppressing
  // re-renders in prod (events buffer up; cards don't appear until the stream
  // closes). Spread → fresh object → guaranteed re-render. One shallow copy
  // per event is cheap; the bug if you skip it is invisible streaming.

  function appendText(delta: string) {
    // DIAGNOSTIC: remove after Bug 3 is resolved
    console.log(
      "[useChatStream] appendText",
      delta.slice(0, 20),
      "segs now",
      streamingRef.current.segments.length,
    );
    const segs = streamingRef.current.segments;
    const last = segs[segs.length - 1];
    if (last && last.kind === "text") {
      const updated: Segment = { kind: "text", text: last.text + delta };
      streamingRef.current = {
        ...streamingRef.current,
        segments: [...segs.slice(0, -1), updated],
      };
    } else {
      streamingRef.current = {
        ...streamingRef.current,
        segments: [...segs, { kind: "text", text: delta }],
      };
    }
    setStreaming({ ...streamingRef.current });
    // DIAGNOSTIC: remove after Bug 3 is resolved
    console.log(
      "[useChatStream] setStreaming fired with segments=",
      streamingRef.current.segments.length,
    );
  }

  function appendTool(tool: ToolEvent) {
    streamingRef.current = {
      ...streamingRef.current,
      segments: [
        ...streamingRef.current.segments,
        { kind: "tool", name: tool.name, summary: tool.summary, ok: tool.ok },
      ],
    };
    setStreaming({ ...streamingRef.current });
  }

  function appendAction(action: {
    type: string;
    fields: Record<string, string>;
    raw: string;
  }) {
    const messageId = streamingRef.current.messageId;
    if (!messageId) return; // shouldn't happen — message_start fires first
    streamingRef.current = {
      ...streamingRef.current,
      segments: [
        ...streamingRef.current.segments,
        {
          kind: "action",
          messageId,
          fenceIndex: fenceCounterRef.current++,
          actionType: action.type,
          fields: action.fields,
          raw: action.raw,
        },
      ],
    };
    setStreaming({ ...streamingRef.current });
  }

  function concatTextOnly(): string {
    return streamingRef.current.segments
      .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text")
      .map((s) => s.text)
      .join("");
  }

  const send = useCallback(
    async (args: { projectId: string; chatId: string; message: string }) => {
      streamingRef.current = { segments: [], messageId: null };
      fenceCounterRef.current = 0;
      setStreaming({ segments: [], messageId: null });
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
          if (ev.event === "message_start") {
            const data = ev.data as { messageId: string };
            streamingRef.current = {
              ...streamingRef.current,
              messageId: data.messageId,
            };
            setStreaming({ ...streamingRef.current });
          } else if (ev.event === "text") {
            appendText((ev.data as { delta: string }).delta);
          } else if (ev.event === "tool") {
            appendTool(ev.data as ToolEvent);
          } else if (ev.event === "action") {
            appendAction(
              ev.data as { type: string; fields: Record<string, string>; raw: string },
            );
          } else if (ev.event === "done") {
            opts.onDone({
              rawText: concatTextOnly(),
              messageId: streamingRef.current.messageId,
            });
            setStreaming(null);
            return;
          } else if (ev.event === "error") {
            setError((ev.data as { message: string }).message);
            setStreaming(null);
            return;
          }
        }
        opts.onDone({
          rawText: concatTextOnly(),
          messageId: streamingRef.current.messageId,
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
