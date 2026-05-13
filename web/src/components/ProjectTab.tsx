import { useState } from "react";
import { useStore } from "../state/store";

interface Props {
  projectId: string;
  repoFullName: string;
}

export function ProjectTab({ projectId, repoFullName }: Props) {
  const focusedProjectId = useStore((s) => s.focusedProjectId);
  const focusProject = useStore((s) => s.focusProject);
  const closeProject = useStore((s) => s.closeProject);
  const focused = focusedProjectId === projectId;
  const [hovering, setHovering] = useState(false);

  // Short name = the part after "/" (e.g., "the-big-brain" from "mrmicaiah/the-big-brain")
  const shortName = repoFullName.split("/")[1] ?? repoFullName;

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => focusProject(projectId)}
      className={`flex h-11 cursor-pointer items-center gap-2 border-l-2 px-3 ${
        focused
          ? "border-l-accent text-ink"
          : "border-l-transparent text-ink/60 hover:text-ink"
      }`}
    >
      <span className="font-sans text-sm">{shortName}</span>
      {hovering && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeProject(projectId);
          }}
          aria-label={`Close ${repoFullName}`}
          className="text-ink/40 hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  );
}
