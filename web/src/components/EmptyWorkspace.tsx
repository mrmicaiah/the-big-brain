export function EmptyWorkspace() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-display text-3xl text-ink/60">No projects.</p>
      <p className="font-display text-base text-ink/40">
        Open a project from the dock above to start.
      </p>
    </div>
  );
}
