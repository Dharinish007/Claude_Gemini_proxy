import type { AnthropicResponse, GeminiResponse } from "./types.js";

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: "end_turn",
  MAX_TOKENS: "max_tokens",
  SAFETY: "stop_sequence",
  RECITATION: "stop_sequence",
};

export function toAnthropicResponse(gemini: GeminiResponse, model: string): AnthropicResponse {
  const candidate = gemini.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join("") ?? "";
  const stopReason = FINISH_REASON_MAP[candidate?.finishReason ?? ""] ?? "end_turn";

  return {
    id: `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: gemini.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: gemini.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
