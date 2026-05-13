import { splitMessageIntoParts } from "../lib/messageParts";
import type { JobSnapshot } from "../lib/types";
import { DispatchCard } from "./DispatchCard";

interface Props {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  projectId: string;
  chatId: string;
  /** Jobs for this chat keyed by message_id → fence_index. Used to render
   *  historical DispatchCards with their actual job state. */
  jobsByMessage?: Map<string, Map<number, JobSnapshot>>;
}

/**
 * Render a single message. No bubbles. Speaker label in Fraunces small-caps;
 * body in Geist, natural paragraphs. Hairline rule below.
 *
 * Assistant content is split into parts by splitMessageIntoParts — text parts
 * render inline; action parts (dispatch_claude_code, etc.) render as
 * DispatchCard components matched against jobsByMessage.
 */
export function MessageItem({
  id,
  role,
  content,
  createdAt,
  projectId,
  chatId,
  jobsByMessage,
}: Props) {
  const displayName = role === "user" ? "You" : "Manager";
  const time = createdAt ? formatTime(createdAt) : "";

  // User messages are plain text; no fence parsing.
  if (role === "user") {
    return (
      <Frame name={displayName} time={time}>
        <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
          {content}
        </div>
      </Frame>
    );
  }

  const parts = splitMessageIntoParts(content);
  const jobsForThisMessage = jobsByMessage?.get(id);

  return (
    <Frame name={displayName} time={time}>
      <div className="font-sans text-sm leading-relaxed text-ink">
        {parts.map((p, i) => {
          if (p.kind === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {p.text}
              </div>
            );
          }
          if (p.actionType === "dispatch_claude_code") {
            const existingJob = jobsForThisMessage?.get(p.fenceIndex) ?? null;
            return (
              <DispatchCard
                key={i}
                projectId={projectId}
                chatId={chatId}
                messageId={id}
                fenceIndex={p.fenceIndex}
                summary={p.fields.summary || p.fields.prompt?.split("\n")[0] || "Dispatch worker"}
                prompt={p.fields.prompt ?? ""}
                existingJob={existingJob}
              />
            );
          }
          // Other action types (post_to_board, update_ceo_file, etc.) absorbed
          // silently until their owning phases light them up.
          return null;
        })}
      </div>
    </Frame>
  );
}

function Frame({
  name,
  time,
  children,
}: {
  name: string;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-hairline px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-xs uppercase tracking-widest text-ink/60">
          {name}
        </span>
        {time && <span className="font-sans text-xs text-ink/40">{time}</span>}
      </div>
      {children}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
