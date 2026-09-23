import type { AnthropicRequest, GeminiContent, GeminiRequest, AnthropicMessage } from "./types.js";

function blockText(content: any): string {
  if (typeof content === "string") return content || "(empty)";
  if (!Array.isArray(content)) return String(content ?? "") || "(empty)";
  const texts = content
    .map((b) => {
      if (!b) return "";
      if (b.type === "text") return b.text;
      if (b.type === "tool_result") {
        const inner = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        return `[Tool result]: ${inner}`;
      }
      if (b.type === "tool_use") {
        return `[Tool call: ${b.name}]`;
      }
      return "";
    })
    .filter(Boolean);
  return texts.join("\n") || "(empty)";
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
