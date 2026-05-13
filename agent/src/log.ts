// Minimal structured logger. Stays out of the way; the agent runs in a
// PowerShell window the user keeps open, so output should be readable
// at a glance, not pretty.

function ts(): string {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

function fmt(level: string, parts: unknown[]): string {
  const head = `[${ts()}] ${level}`;
  const tail = parts
    .map((p) => {
      if (p instanceof Error) return `${p.message}${p.stack ? `\n${p.stack}` : ""}`;
      if (typeof p === "string") return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
  return `${head} ${tail}`;
}

export const log = {
  info(...parts: unknown[]): void {
    console.log(fmt("info ", parts));
  },
  warn(...parts: unknown[]): void {
    console.warn(fmt("warn ", parts));
  },
  error(...parts: unknown[]): void {
    console.error(fmt("error", parts));
  },
};
