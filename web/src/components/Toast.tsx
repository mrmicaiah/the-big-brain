import { useStore } from "../state/store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
      <div className="border border-hairline bg-paper px-4 py-2 font-sans text-sm text-ink shadow-md">
        {toast}
      </div>
    </div>
  );
}
