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

function fallbackModels(): string[] {
  const primary = model();
  const candidates = [
    primary,
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
  ];
  return Array.from(new Set(candidates));
}

export class GeminiApiError extends Error {
  status: number;
  data: string;
  constructor(status: number, message: string) {
    super(`Gemini error ${status}: ${message}`);
    this.name = "GeminiApiError";
    this.status = status;
    this.data = message;
  }
}

export async function generateContent(body: GeminiRequest): Promise<GeminiResponse> {
  const models = fallbackModels();
  let lastError: Error | null = null;

  for (const m of models) {
    try {
      const res = await fetch(`${BASE}/${m}:generateContent?key=${apiKey()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (m !== models[0]) console.log(`[GEMINI FALLBACK] Responded using ${m}`);
        return (await res.json()) as GeminiResponse;
      }
      const text = await res.text();
      if (res.status === 429 || res.status === 503) {
        console.warn(`[GEMINI 429] Model ${m} rate-limited. Trying fallback...`);
        lastError = new GeminiApiError(res.status, text);
        continue;
      }
      throw new GeminiApiError(res.status, text);
    } catch (e) {
      if (e instanceof GeminiApiError && (e.status === 429 || e.status === 503)) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("All model fallbacks exhausted");
}

/** Returns the raw fetch Response for the SSE stream; caller reads res.body. */
export async function streamGenerateContent(body: GeminiRequest): Promise<Response> {
  const models = fallbackModels();
  let lastError: Error | null = null;

  for (const m of models) {
    try {
      const res = await fetch(`${BASE}/${m}:streamGenerateContent?alt=sse&key=${apiKey()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && res.body) {
        if (m !== models[0]) console.log(`[GEMINI FALLBACK] Streaming using ${m}`);
        return res;
      }
      const text = await res.text();
      if (res.status === 429 || res.status === 503) {
        console.warn(`[GEMINI 429] Model ${m} rate-limited. Trying fallback...`);
        lastError = new GeminiApiError(res.status, text);
        continue;
      }
      throw new GeminiApiError(res.status, text);
    } catch (e) {
      if (e instanceof GeminiApiError && (e.status === 429 || e.status === 503)) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("All model fallbacks exhausted");
}

export async function countTokens(body: GeminiRequest): Promise<number> {
  for (const m of fallbackModels()) {
    try {
      const res = await fetch(`${BASE}/${m}:countTokens?key=${apiKey()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: body.contents }),
      });
      if (res.ok) {
        const data = (await res.json()) as { totalTokens?: number };
        if (typeof data.totalTokens === "number") return data.totalTokens;
      }
    } catch {}
  }
  const chars = body.contents.reduce((sum, c) => sum + c.parts.reduce((s, p) => s + (p.text?.length || 0), 0), 0);
  return Math.max(1, Math.ceil(chars / 4));
}

