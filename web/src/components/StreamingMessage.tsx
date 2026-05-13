import type { Segment } from "../lib/types";
import { DispatchCard } from "./DispatchCard";

interface Props {
  segments: Segment[];
  projectId: string;
  chatId: string;
}

/**
 * The in-progress assistant message during a stream. Renders segments in
 * order: text segments as flowing paragraphs (respecting whitespace), tool
 * segments as hairline-bordered inline status lines, action segments as
 * inline DispatchCard components. Animated ink caret sits at the end of
 * the last segment until `done` lands.
 */
export function StreamingMessage({ segments, projectId, chatId }: Props) {
  const lastIdx = segments.length - 1;
  return (
    <div className="border-b border-hairline px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-xs uppercase tracking-widest text-ink/60">
          Manager
        </span>
        <span className="font-sans text-xs italic text-ink/40">streaming…</span>
      </div>
      <div className="font-sans text-sm leading-relaxed text-ink">
        {segments.length === 0 && <Caret />}
        {segments.map((s, i) => {
          const isLast = i === lastIdx;
          if (s.kind === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {s.text}
                {isLast && <Caret />}
              </div>
            );
          }
          if (s.kind === "tool") {
            return (
              <div
                key={i}
                className="my-3 flex items-center gap-3 text-xs text-ink/50"
              >
                <div className="h-px flex-1 bg-hairline" />
                <span className="font-mono italic">{s.summary}</span>
                <div className="h-px flex-1 bg-hairline" />
                {isLast && <Caret />}
              </div>
            );
          }
          // action segment
          if (s.actionType === "dispatch_claude_code") {
            return (
              <DispatchCard
                key={i}
                projectId={projectId}
                chatId={chatId}
                messageId={s.messageId}
                fenceIndex={s.fenceIndex}
                summary={s.fields.summary || s.fields.prompt?.split("\n")[0] || "Dispatch worker"}
                prompt={s.fields.prompt ?? ""}
              />
            );
          }
          // Other action types absorbed silently
          return null;
        })}
      </div>
    </div>
  );
}

function Caret() {
  return (
    <span
      className="ml-1 inline-block h-3 w-[2px] animate-pulse bg-ink/60 align-middle"
      aria-hidden="true"
    />
  );
}
