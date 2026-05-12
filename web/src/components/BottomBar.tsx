export function BottomBar() {
  return (
    <div className="flex h-[52px] items-center gap-3 border-t border-hairline px-3">
      <div className="flex flex-1 items-center gap-2 border border-hairline px-3 py-1.5">
        <input
          type="text"
          placeholder="drop a note…"
          disabled
          className="flex-1 bg-transparent text-sm italic text-ink placeholder:text-ink/40 focus:outline-none disabled:cursor-default"
        />
        <button
          type="button"
          disabled
          aria-label="Recent drops"
          className="text-ink/40 disabled:cursor-default"
        >
          ^
        </button>
      </div>
      <button
        type="button"
        disabled
        className="border border-hairline px-3 py-1.5 text-xs uppercase tracking-wider text-ink/60 disabled:cursor-default"
      >
        Brainstorm Room
      </button>
      <button
        type="button"
        disabled
        className="border border-hairline px-3 py-1.5 text-xs uppercase tracking-wider text-ink/60 disabled:cursor-default"
      >
        Board
      </button>
    </div>
  );
}
