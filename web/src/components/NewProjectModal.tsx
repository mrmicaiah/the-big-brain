import { useState } from "react";
import { apiFetch, ApiError } from "../lib/api";
import { useStore } from "../state/store";

interface NewProjectResponse {
  projectId: string;
  repo_full_name: string;
  isNew: boolean;
}

export function NewProjectModal() {
  const modalOpen = useStore((s) => s.modalOpen);
  const setModalOpen = useStore((s) => s.setModalOpen);
  const openProject = useStore((s) => s.openProject);
  const invalidateReposCache = useStore((s) => s.invalidateReposCache);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!modalOpen) return null;

  const close = () => {
    setModalOpen(false);
    setName("");
    setDescription("");
    setIsPrivate(true);
    setError(null);
  };

  const submit = async () => {
    const trimmed = name.trim().replace(/^-+|-+$/g, "");
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<NewProjectResponse>("/api/projects/new", {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          description: description.trim(),
          private: isPrivate,
        }),
      });
      invalidateReposCache();
      openProject({
        projectId: res.projectId,
        repoFullName: res.repo_full_name,
      });
      close();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError(`A repo named "${trimmed}" already exists in your account.`);
        } else if (err.status === 400) {
          setError("Invalid input. Names: lowercase, [a-z0-9._-], ≤100 chars.");
        } else {
          setError(`Failed (${err.status}). Try again.`);
        }
      } else {
        setError("Network error. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) close();
      }}
    >
      <div className="w-[420px] border border-hairline bg-paper p-6 shadow-lg">
        <h2 className="mb-5 font-display text-2xl text-ink">New project</h2>

        <label className="mb-1 block font-sans text-xs uppercase tracking-wider text-ink/60">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="my-project"
          autoFocus
          disabled={submitting}
          className="mb-4 w-full border border-hairline bg-paper px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none disabled:opacity-50"
        />

        <label className="mb-1 block font-sans text-xs uppercase tracking-wider text-ink/60">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="optional"
          rows={3}
          disabled={submitting}
          className="mb-4 w-full resize-none border border-hairline bg-paper px-3 py-2 font-sans text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none disabled:opacity-50"
        />

        <div className="mb-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPrivate(true)}
            disabled={submitting}
            className={`border border-hairline px-3 py-1 font-sans text-xs uppercase tracking-wider ${
              isPrivate ? "bg-ink text-paper" : "bg-paper text-ink/60"
            } disabled:opacity-50`}
          >
            Private
          </button>
          <button
            type="button"
            onClick={() => setIsPrivate(false)}
            disabled={submitting}
            className={`border border-hairline px-3 py-1 font-sans text-xs uppercase tracking-wider ${
              !isPrivate ? "bg-ink text-paper" : "bg-paper text-ink/60"
            } disabled:opacity-50`}
          >
            Public
          </button>
        </div>

        {error && (
          <div className="mb-4 border border-hairline bg-paper px-3 py-2 font-sans text-xs text-ink">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="px-3 py-2 font-sans text-sm text-ink/60 hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="border border-ink bg-paper px-4 py-2 font-sans text-sm text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
