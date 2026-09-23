import type { AnthropicRequest, GeminiContent, GeminiRequest, AnthropicMessage } from "./types.js";

function blockText(content: AnthropicMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function systemText(system: AnthropicRequest["system"]): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function toGeminiRequest(req: AnthropicRequest): GeminiRequest {
  const contents: GeminiContent[] = req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: blockText(m.content) }],
  }));

  const sys = systemText(req.system);

  const generationConfig: GeminiRequest["generationConfig"] = {
    maxOutputTokens: req.max_tokens,
  };
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.top_p !== undefined) generationConfig.topP = req.top_p;
  if (req.stop_sequences?.length) generationConfig.stopSequences = req.stop_sequences;

  return {
    contents,
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    generationConfig,
  };
}
