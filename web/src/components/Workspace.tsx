import { useStore } from "../state/store";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { ProjectPane } from "./ProjectPane";

export function Workspace() {
  const openProjects = useStore((s) => s.openProjects);
  const n = openProjects.length;

  if (n === 0) return <EmptyWorkspace />;

  // Grid shapes from SPEC.md:
  //   1 → full     2 → 50/50    3 → 2 top + 1 full-width bottom    4 → 2×2
  let gridClass: string;
  if (n === 1) gridClass = "grid-cols-1 grid-rows-1";
  else if (n === 2) gridClass = "grid-cols-2 grid-rows-1";
  else gridClass = "grid-cols-2 grid-rows-2"; // 3 and 4

  return (
    <div className={`grid h-full gap-2 p-2 ${gridClass}`}>
      {openProjects.map((p, i) => (
        <div
          key={p.projectId}
          className={n === 3 && i === 2 ? "col-span-2" : ""}
        >
          <ProjectPane projectId={p.projectId} repoFullName={p.repoFullName} />
        </div>
      ))}
    </div>
  );
}
