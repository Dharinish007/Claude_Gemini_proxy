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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateContent(body: GeminiRequest, retries = 2): Promise<GeminiResponse> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}/${model()}:generateContent?key=${apiKey()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as GeminiResponse;
    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      console.log(`[GEMINI RETRY] Status ${res.status}, retrying in ${(attempt + 1) * 2}s...`);
      await sleep((attempt + 1) * 2000);
      continue;
    }
    throw new GeminiApiError(res.status, text);
  }
  throw new Error("Failed after retries");
}

/** Returns the raw fetch Response for the SSE stream; caller reads res.body. */
export async function streamGenerateContent(body: GeminiRequest, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}/${model()}:streamGenerateContent?alt=sse&key=${apiKey()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok && res.body) return res;
    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      console.log(`[GEMINI RETRY] Status ${res.status}, retrying stream in ${(attempt + 1) * 2}s...`);
      await sleep((attempt + 1) * 2000);
      continue;
    }
    throw new GeminiApiError(res.status, text);
  }
  throw new Error("Failed after retries");
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

