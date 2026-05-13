/**
 * Server-Sent Events response builder.
 *
 * Takes an async generator of `{ event, data }` and turns it into a streamed
 * Response with `text/event-stream`. Errors thrown by the generator are caught
 * and emitted as a final `event: error` frame before the stream closes — the
 * caller always sees a clean close.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

export function sseResponse(
  gen: AsyncGenerator<SseEvent, unknown, unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // PROD-TODO: prime the stream with a `:` comment line before the first
      // event when deployed — Cloudflare may buffer responses under 1KB and
      // delay the first delta. A leading `:padding...` line (ignored by SSE
      // clients) forces an early flush. Not needed locally via wrangler dev.
      try {
        for await (const ev of gen) {
          const frame = `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const frame = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
