import type { ServerResponse } from "node:http";
import type { GeminiResponse } from "./types.js";

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: "end_turn",
  MAX_TOKENS: "max_tokens",
  SAFETY: "stop_sequence",
  RECITATION: "stop_sequence",
};

function sendEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Reads Gemini's SSE stream and re-emits it as Anthropic-shaped SSE events,
 * writing each delta the moment it arrives (no full-response buffering).
 */
export async function pipeGeminiStreamToAnthropic(
  geminiRes: Response,
  res: ServerResponse,
  model: string,
  inputTokens: number
) {
  const msgId = `msg_${crypto.randomUUID()}`;

  sendEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });
  sendEvent(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });

  let outputTokens = 0;
  let stopReason = "end_turn";
  let buffer = "";

  const reader = geminiRes.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? ""; // last (possibly incomplete) chunk stays in buffer

    for (const raw of events) {
      const line = raw.split(/\r?\n/).find((l) => l.startsWith("data: "));
      if (!line) continue;
      const json = line.slice("data: ".length).trim();
      if (!json) continue;

      let chunk: GeminiResponse;
      try {
        chunk = JSON.parse(json);
      } catch {
        continue; // malformed/partial chunk, skip
      }

      const candidate = chunk.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text).join("") ?? "";
      if (text) {
        sendEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        });
      }
      if (candidate?.finishReason) {
        stopReason = FINISH_REASON_MAP[candidate.finishReason] ?? "end_turn";
      }
      if (chunk.usageMetadata?.candidatesTokenCount) {
        outputTokens = chunk.usageMetadata.candidatesTokenCount;
      }
    }
  }

  sendEvent(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sendEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sendEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}
