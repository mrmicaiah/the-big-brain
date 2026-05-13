import { useEffect, useRef } from "react";
import type { Message, Segment } from "../lib/types";
import { MessageItem } from "./MessageItem";
import { StreamingMessage } from "./StreamingMessage";

interface Props {
  messages: Message[];
  streamingSegments: Segment[] | null;
}

export function MessageList({ messages, streamingSegments }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // Track whether the user is "following" — within 100px of the bottom.
  const onScroll = () => {
    const c = containerRef.current;
    if (!c) return;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    followRef.current = dist < 100;
  };

  useEffect(() => {
    if (!followRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length, streamingSegments]);

  return (
    <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto">
      {messages.length === 0 && streamingSegments === null && (
        <div className="flex h-full items-center justify-center">
          <p className="font-display text-base text-ink/40">
            No messages yet. Say hello.
          </p>
        </div>
      )}
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          role={m.role === "user" ? "user" : "assistant"}
          content={m.content}
          createdAt={m.created_at}
        />
      ))}
      {streamingSegments !== null && (
        <StreamingMessage segments={streamingSegments} />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
