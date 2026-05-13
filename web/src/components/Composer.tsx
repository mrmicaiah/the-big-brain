import { useState, useRef, useEffect } from "react";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function Composer({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to 8 lines
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-hairline px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={disabled ? "Streaming…" : "Message the manager. Enter to send, Shift+Enter for newline."}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none border border-hairline bg-paper px-3 py-2 font-sans text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="border border-ink bg-paper px-4 py-2 font-sans text-sm text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
