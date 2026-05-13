/**
 * Parse an SSE byte stream into an async iterator of typed events.
 *
 * SSE event format (per the W3C spec):
 *   event: <name>\n
 *   data: <json>\n
 *   \n         (blank line terminates the event)
 *
 * We read the underlying stream in chunks, decode to text, accumulate in a
 * buffer, and slice on \n\n boundaries.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
      }
    }
    // Flush any trailing block (rare — server should always terminate with \n\n)
    if (buffer.trim()) {
      const parsed = parseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | null {
  let eventName = "message";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment line
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLine += line.slice("data:".length).trim();
    }
  }
  if (!dataLine) return null;
  try {
    return { event: eventName, data: JSON.parse(dataLine) };
  } catch {
    return { event: eventName, data: dataLine };
  }
}
