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
      // Prime the stream with an SSE comment line so Cloudflare's edge doesn't
      // buffer the response. Clients ignore any line starting with ":" per the
      // SSE spec (https://html.spec.whatwg.org/multipage/server-sent-events.html
      // #event-stream-interpretation). Without this, small responses (under
      // ~1KB) get held by Cloudflare's chunked-encoding heuristics — every
      // text-delta and action event arrives in one batch at the end of the
      // response rather than streaming live. Locally via wrangler dev the
      // buffering doesn't happen; this line is the cheap fix for prod.
      controller.enqueue(encoder.encode(":keep-alive\n\n"));
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
