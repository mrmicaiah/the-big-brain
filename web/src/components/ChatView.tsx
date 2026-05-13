import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../lib/api";
import type { Message } from "../lib/types";
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

export function ChatView({ projectId, repoFullName: _repoFullName }: Props) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Hook setup: when a stream completes, append the assistant message locally.
  // Server has already persisted; this is the optimistic mirror.
  const onDone = useCallback(
    (final: { rawText: string }) => {
      const assistantMessage: Message = {
        id: `local-${Date.now()}`,
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

  // Resolve chat + load history
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
        const history = await apiFetch<ListMessagesResponse>(
          `/api/chats/${resolved.chatId}/messages`,
        );
        if (cancelled) return;
        setMessages(history.messages);
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
    // Optimistic user message
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
          streamingText={streaming?.text ?? null}
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
