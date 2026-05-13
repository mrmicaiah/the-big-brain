import { useStore } from "../state/store";
import { ChatView } from "./ChatView";

interface Props {
  projectId: string;
  repoFullName: string;
}

export function ProjectPane({ projectId, repoFullName }: Props) {
  const focusedProjectId = useStore((s) => s.focusedProjectId);
  const closeProject = useStore((s) => s.closeProject);
  const focusProject = useStore((s) => s.focusProject);
  const focused = focusedProjectId === projectId;

  return (
    <div
      onClick={() => focusProject(projectId)}
      className={`flex h-full flex-col bg-paper ${
        focused
          ? "border border-l-2 border-hairline border-l-accent"
          : "border border-hairline"
      }`}
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="truncate font-sans text-sm text-ink">{repoFullName}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeProject(projectId);
          }}
          aria-label={`Close ${repoFullName}`}
          className="px-1 text-ink/40 hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ChatView projectId={projectId} repoFullName={repoFullName} />
      </div>
    </div>
  );
}
