export function TopDock() {
  return (
    <div className="flex h-11 items-center justify-between border-b border-hairline px-3">
      <div className="flex items-center gap-2">
        {/* Project tabs will live here in Phase 2 */}
      </div>
      <button
        type="button"
        title="coming next"
        aria-label="Add project"
        className="flex h-7 w-7 items-center justify-center border border-hairline text-base leading-none text-ink/70 transition-colors hover:text-ink"
      >
        +
      </button>
    </div>
  );
}
