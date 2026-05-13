interface Props {
  text: string;
}

/**
 * The in-progress assistant message during a stream. Pulses with a soft
 * ink-marker animation (per SPEC.md visual language). Pulse stops when
 * the parent swaps this for a regular MessageItem on `done`.
 */
export function StreamingMessage({ text }: Props) {
  return (
    <div className="border-b border-hairline px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-xs uppercase tracking-widest text-ink/60">
          Manager
        </span>
        <span className="font-sans text-xs text-ink/40 italic">streaming…</span>
      </div>
      <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
        {text}
        <span
          className="ml-1 inline-block h-3 w-[2px] animate-pulse bg-ink/60 align-middle"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
