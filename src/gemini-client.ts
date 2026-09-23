import type { GeminiRequest, GeminiResponse } from "./types.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

function model(): string {
  const m = process.env.GEMINI_MODEL;
  if (!m) throw new Error("GEMINI_MODEL is not set");
  return m;
}

export async function generateContent(body: GeminiRequest): Promise<GeminiResponse> {
  const res = await fetch(`${BASE}/${model()}:generateContent?key=${apiKey()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GeminiResponse;
}

/** Returns the raw fetch Response for the SSE stream; caller reads res.body. */
export async function streamGenerateContent(body: GeminiRequest): Promise<Response> {
  const res = await fetch(`${BASE}/${model()}:streamGenerateContent?alt=sse&key=${apiKey()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  }
  return res;
}

export async function countTokens(body: GeminiRequest): Promise<number> {
  try {
    const res = await fetch(`${BASE}/${model()}:countTokens?key=${apiKey()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: body.contents }),
    });
    if (res.ok) {
      const data = (await res.json()) as { totalTokens?: number };
      if (typeof data.totalTokens === "number") return data.totalTokens;
    }
  } catch {}
  const chars = body.contents.reduce((sum, c) => sum + c.parts.reduce((s, p) => s + (p.text?.length || 0), 0), 0);
  return Math.max(1, Math.ceil(chars / 4));
}

