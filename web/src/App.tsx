import { useEffect } from "react";
import { TopDock } from "./components/TopDock";
import { Workspace } from "./components/Workspace";
import { BottomBar } from "./components/BottomBar";
import { ProjectPicker } from "./components/ProjectPicker";
import { NewProjectModal } from "./components/NewProjectModal";
import { Toast } from "./components/Toast";
import { useStore } from "./state/store";
import { apiFetch, ApiError } from "./lib/api";

const PERSIST_KEY = "the-big-brain";

export default function App() {
  // On mount: verify each persisted open project still has a D1 row.
  //   404 → drop the entry silently (D1 was probably wiped)
  //   401 → bundle/Worker drift; clear local state and reload (loud-but-recoverable)
  //   other → leave the entry; let user retry by clicking the pane
  useEffect(() => {
    const state = useStore.getState();
    if (state.openProjects.length === 0) return;
    let reloadTriggered = false;
    state.openProjects.forEach((p) => {
      apiFetch(`/api/projects/${p.projectId}`).catch((err) => {
        if (reloadTriggered) return;
        if (err instanceof ApiError && err.status === 404) {
          useStore.getState().closeProject(p.projectId);
        } else if (err instanceof ApiError && err.status === 401) {
          reloadTriggered = true;
          localStorage.removeItem(PERSIST_KEY);
          window.location.reload();
        }
      });
    });
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <TopDock />
      <main className="flex-1 overflow-hidden">
        <Workspace />
      </main>
      <BottomBar />
      <ProjectPicker />
      <NewProjectModal />
      <Toast />
    </div>
  );
}
