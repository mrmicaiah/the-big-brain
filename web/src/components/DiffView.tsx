interface Props {
  diffStat?: string;
  diff?: string;
  diffTruncated?: boolean;
}

/**
 * Minimal diff renderer. Stat block on top (Geist mono), unified diff body
 * below (JetBrains Mono, hairline border, no syntax highlighting in v0).
 * Truncation banner if the diff was capped.
 */
export function DiffView({ diffStat, diff, diffTruncated }: Props) {
  if (!diffStat && !diff) return null;
  return (
    <div className="mt-3">
      {diffStat && (
        <pre className="mb-2 overflow-x-auto whitespace-pre border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink">
{diffStat}
        </pre>
      )}
      {diff && (
        <pre className="max-h-96 overflow-auto whitespace-pre border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink/80">
{diff}
        </pre>
      )}
      {diffTruncated && (
        <p className="mt-1 font-sans text-xs italic text-ink/50">
          Diff truncated — review the working tree directly for the full change.
        </p>
      )}
    </div>
  );
}
