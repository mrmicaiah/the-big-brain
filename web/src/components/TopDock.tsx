import { useStore } from "../state/store";
import { ProjectTab } from "./ProjectTab";

export function TopDock() {
  const openProjects = useStore((s) => s.openProjects);
  const pickerOpen = useStore((s) => s.pickerOpen);
  const setPickerOpen = useStore((s) => s.setPickerOpen);

  return (
    <div className="relative flex h-11 items-center justify-between border-b border-hairline px-3">
      <div className="flex h-full items-center">
        {openProjects.map((p) => (
          <ProjectTab
            key={p.projectId}
            projectId={p.projectId}
            repoFullName={p.repoFullName}
          />
        ))}
      </div>
      <button
        type="button"
        title={pickerOpen ? "close picker" : "open project picker"}
        aria-label="Add project"
        onClick={() => setPickerOpen(!pickerOpen)}
        className="flex h-7 w-7 items-center justify-center border border-hairline text-base leading-none text-ink/70 transition-colors hover:text-ink"
      >
        +
      </button>
    </div>
  );
}
