import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";
import type { Repo } from "../lib/types";
import { useStore } from "../state/store";

interface ClaimResponse {
  projectId: string;
  repo_full_name: string;
  isNew: boolean;
}

const CACHE_TTL_MS = 60_000;

export function ProjectPicker() {
  const pickerOpen = useStore((s) => s.pickerOpen);
  const setPickerOpen = useStore((s) => s.setPickerOpen);
  const setModalOpen = useStore((s) => s.setModalOpen);
  const openProject = useStore((s) => s.openProject);
  const reposCache = useStore((s) => s.reposCache);
  const setReposCache = useStore((s) => s.setReposCache);
  const invalidateReposCache = useStore((s) => s.invalidateReposCache);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Also avoid closing when the click is on the dock's + button itself —
        // the + handler toggles independently. The button is OUTSIDE this ref,
        // so without guarding, clicking + would close-then-reopen. The + button
        // already handles its own toggle, so it's fine to close here and let
        // the toggle re-open.
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen, setPickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, setPickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (reposCache && Date.now() - reposCache.fetchedAt < CACHE_TTL_MS) return;
    setLoading(true);
    setError(null);
    apiFetch<{ repos: Repo[] }>("/api/repos")
      .then((data) => setReposCache(data.repos))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? `Couldn't load repos (${err.status}).`
            : "Couldn't load repos.",
        ),
      )
      .finally(() => setLoading(false));
  }, [pickerOpen, reposCache, setReposCache]);

  if (!pickerOpen) return null;

  const repos = reposCache?.repos ?? [];
  const yours = repos.filter((r) => r.isProject);
  const others = repos.filter((r) => !r.isProject);

  const handleRepoClick = async (repo: Repo) => {
    if (repo.isProject && repo.projectId) {
      openProject({ projectId: repo.projectId, repoFullName: repo.full_name });
      return;
    }
    setClaiming(repo.full_name);
    setError(null);
    try {
      const res = await apiFetch<ClaimResponse>("/api/projects/from-repo", {
        method: "POST",
        body: JSON.stringify({ repo_full_name: repo.full_name }),
      });
      invalidateReposCache();
      openProject({
        projectId: res.projectId,
        repoFullName: res.repo_full_name,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Claim failed (${err.status}).`
          : "Claim failed.",
      );
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute right-3 top-12 z-40 w-96 border border-hairline bg-paper shadow-md"
    >
      <div className="px-4 pt-3 pb-2">
        <div className="font-sans text-xs uppercase tracking-wider text-ink/50">
          Your projects
        </div>
      </div>
      <div className="border-t border-hairline">
        {loading && yours.length === 0 && (
          <div className="px-4 py-3 font-display text-sm text-ink/40">
            Loading repos…
          </div>
        )}
        {!loading && yours.length === 0 && (
          <div className="px-4 py-3 font-display text-sm text-ink/40">
            No projects yet.
          </div>
        )}
        {yours.map((r) => (
          <RepoRow
            key={r.full_name}
            repo={r}
            onClick={() => handleRepoClick(r)}
            claiming={false}
          />
        ))}
      </div>

      <div className="border-t border-hairline px-4 pt-3 pb-2">
        <div className="font-sans text-xs uppercase tracking-wider text-ink/50">
          Other repos
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto border-t border-hairline">
        {loading && others.length === 0 && (
          <div className="px-4 py-3 font-display text-sm text-ink/40">
            Loading…
          </div>
        )}
        {!loading && others.length === 0 && (
          <div className="px-4 py-3 font-display text-sm text-ink/40">
            Nothing else to claim.
          </div>
        )}
        {others.map((r) => (
          <RepoRow
            key={r.full_name}
            repo={r}
            onClick={() => handleRepoClick(r)}
            claiming={claiming === r.full_name}
            cta="Make a project"
          />
        ))}
      </div>

      {error && (
        <div className="border-t border-hairline px-4 py-2 font-sans text-xs text-ink/70">
          {error}
        </div>
      )}

      <div className="border-t border-hairline">
        <button
          type="button"
          onClick={() => {
            setPickerOpen(false);
            setModalOpen(true);
          }}
          className="flex w-full items-center border-l-2 border-l-transparent px-4 py-3 text-left font-sans text-sm text-ink hover:border-l-accent hover:bg-hairline/30"
        >
          <span className="mr-2 text-ink/60">+</span>
          New project
        </button>
      </div>
    </div>
  );
}

function RepoRow({
  repo,
  onClick,
  claiming,
  cta,
}: {
  repo: Repo;
  onClick: () => void;
  claiming: boolean;
  cta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={claiming}
      className="group flex w-full items-center justify-between border-l-2 border-l-transparent px-4 py-2 text-left hover:border-l-accent hover:bg-hairline/30 disabled:opacity-50"
    >
      <span className="truncate font-mono text-sm text-ink">
        {repo.full_name}
      </span>
      {cta && (
        <span className="ml-3 shrink-0 font-sans text-xs text-ink/50 group-hover:text-accent">
          {claiming ? "Claiming…" : `${cta} →`}
        </span>
      )}
    </button>
  );
}
