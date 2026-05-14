import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";
import type { Message, JobSnapshot } from "../lib/types";
import { useChatStream } from "../hooks/useChatStream";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

interface Props {
  projectId: string;
  repoFullName: string;
}

interface ManagerChatResolveResponse {
  chatId: string;
  projectId: string;
  created: boolean;
}

interface ListMessagesResponse {
  messages: Message[];
}

interface ListJobsResponse {
  jobs: JobSnapshot[];
}

export function ChatView({ projectId, repoFullName: _repoFullName }: Props) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Build a lookup Map: messageId → Map<fenceIndex, JobSnapshot>
  const jobsByMessage = useMemo(() => {
    const out = new Map<string, Map<number, JobSnapshot>>();
    for (const j of jobs) {
      if (!j.message_id || j.fence_index === null) continue;
      let inner = out.get(j.message_id);
      if (!inner) {
        inner = new Map();
        out.set(j.message_id, inner);
      }
      inner.set(j.fence_index, j);
    }
    return out;
  }, [jobs]);

  const onDone = useCallback(
    (final: { rawText: string; messageId: string | null }) => {
      const assistantMessage: Message = {
        id: final.messageId ?? `local-${Date.now()}`,
        role: "assistant",
        brain: null,
        content: final.rawText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    },
    [],
  );
  const streamOpts = useMemo(() => ({ onDone }), [onDone]);
  const { streaming, error: streamError, send } = useChatStream(streamOpts);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResolveError(null);
    (async () => {
      try {
        const resolved = await apiFetch<ManagerChatResolveResponse>(
          `/api/projects/${projectId}/manager-chat`,
        );
        if (cancelled) return;
        setChatId(resolved.chatId);
        const [history, jobsRes] = await Promise.all([
          apiFetch<ListMessagesResponse>(
            `/api/chats/${resolved.chatId}/messages`,
          ),
          apiFetch<ListJobsResponse>(`/api/chats/${resolved.chatId}/jobs`),
        ]);
        if (cancelled) return;
        setMessages(history.messages);
        setJobs(jobsRes.jobs);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setResolveError(`Couldn't load chat (${err.status}).`);
        } else {
          setResolveError("Couldn't load chat.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const onSend = (message: string) => {
    if (!chatId) return;
    const userMessage: Message = {
      id: `local-user-${Date.now()}`,
      role: "user",
      brain: null,
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    void send({ projectId, chatId, message });
  };

  // DIAGNOSTIC: remove after Bug 3 is resolved
  console.log(
    "[ChatView] render, streaming?",
    streaming === null ? "null" : `segs=${streaming.segments.length}`,
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-display text-base text-ink/40">Loading chat…</p>
      </div>
    );
  }

  if (resolveError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="font-sans text-sm text-ink/70">{resolveError}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <MessageList
          messages={messages}
          streamingSegments={streaming?.segments ?? null}
          projectId={projectId}
          chatId={chatId ?? ""}
          jobsByMessage={jobsByMessage}
        />
      </div>
      {streamError && (
        <div className="border-t border-hairline px-4 py-2 font-sans text-xs text-ink">
          {streamError}
        </div>
      )}
      <Composer onSend={onSend} disabled={streaming !== null} />
    </div>
  );
}
