import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Repo } from "../lib/types";

export type OpenProject = { projectId: string; repoFullName: string };

export const MAX_PANES = 4;

interface PersistedSlice {
  openProjects: OpenProject[];
  focusedProjectId: string | null;
}

interface Store extends PersistedSlice {
  pickerOpen: boolean;
  modalOpen: boolean;
  reposCache: { repos: Repo[]; fetchedAt: number } | null;
  toast: string | null;

  openProject: (p: OpenProject) => void;
  closeProject: (id: string) => void;
  focusProject: (id: string) => void;
  setPickerOpen: (b: boolean) => void;
  setModalOpen: (b: boolean) => void;
  setReposCache: (repos: Repo[]) => void;
  invalidateReposCache: () => void;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      openProjects: [],
      focusedProjectId: null,
      pickerOpen: false,
      modalOpen: false,
      reposCache: null,
      toast: null,

      openProject: (p) => {
        const { openProjects } = get();
        const already = openProjects.find((op) => op.projectId === p.projectId);
        if (already) {
          set({ focusedProjectId: p.projectId, pickerOpen: false });
          return;
        }
        if (openProjects.length >= MAX_PANES) {
          set({
            toast: `${MAX_PANES} panes max for now — close one first.`,
            pickerOpen: false,
          });
          setTimeout(() => {
            if (get().toast) set({ toast: null });
          }, 3000);
          return;
        }
        set({
          openProjects: [...openProjects, p],
          focusedProjectId: p.projectId,
          pickerOpen: false,
        });
      },

      closeProject: (id) => {
        const { openProjects, focusedProjectId } = get();
        const remaining = openProjects.filter((p) => p.projectId !== id);
        const newFocus =
          focusedProjectId === id
            ? remaining[remaining.length - 1]?.projectId ?? null
            : focusedProjectId;
        set({ openProjects: remaining, focusedProjectId: newFocus });
      },

      focusProject: (id) => set({ focusedProjectId: id }),
      setPickerOpen: (b) => set({ pickerOpen: b }),
      setModalOpen: (b) => set({ modalOpen: b }),
      setReposCache: (repos) =>
        set({ reposCache: { repos, fetchedAt: Date.now() } }),
      invalidateReposCache: () => set({ reposCache: null }),

      showToast: (message) => {
        set({ toast: message });
        setTimeout(() => {
          if (get().toast === message) set({ toast: null });
        }, 3000);
      },
      clearToast: () => set({ toast: null }),
    }),
    {
      name: "the-big-brain",
      version: 1,
      // Only persist what survives a refresh meaningfully. UI flags and the
      // repos cache stay session-local.
      partialize: (s): PersistedSlice => ({
        openProjects: s.openProjects,
        focusedProjectId: s.focusedProjectId,
      }),
      // Any persisted-shape change bumps `version` and old data is dropped.
      // We never partial-lift-forward across shape changes — too brittle for
      // the size of state we hold, and the data is cheap to refetch.
      migrate: (_persisted, _fromVersion): PersistedSlice => ({
        openProjects: [],
        focusedProjectId: null,
      }),
    },
  ),
);
