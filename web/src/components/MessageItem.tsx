interface Props {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

/**
 * Render a single message. No bubbles. Speaker label in Fraunces small-caps;
 * body in Geist, natural paragraphs. Hairline rule below.
 *
 * Action fenced blocks in assistant content (raw text persisted from the
 * stream) are stripped for display — they parsed into structured action
 * events at stream time and Phase 3 doesn't render those.
 */
export function MessageItem({ role, content, createdAt }: Props) {
  const displayName = role === "user" ? "You" : "Manager";
  const visibleText = role === "assistant" ? stripActionFences(content) : content;
  const time = createdAt ? formatTime(createdAt) : "";

  return (
    <div className="border-b border-hairline px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-xs uppercase tracking-widest text-ink/60">
          {displayName}
        </span>
        {time && (
          <span className="font-sans text-xs text-ink/40">{time}</span>
        )}
      </div>
      <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
        {visibleText}
      </div>
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

/**
 * Strip ```<known_action>...``` blocks from raw persisted assistant text.
 * Phase 3 doesn't render action affordances; later phases will replace the
 * stripped regions with inline UI.
 */
function stripActionFences(raw: string): string {
  // Match opening fence with a known-action keyword (lowercase underscore) +
  // body + closing fence. Conservative: ANY ```<word>...``` is stripped here
  // since the parser already validated which words are real actions during
  // streaming. Plain markdown code fences (```typescript) would also be
  // affected — accepted v0 tradeoff; manager rarely writes those inline.
  return raw
    .replace(/\n```[a-z_][a-z0-9_]*\n[\s\S]*?\n```(?=\n|$)/g, "")
    .trim();
}
