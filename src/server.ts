import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AnthropicRequest } from "./types.js";
import { toGeminiRequest } from "./translate-request.js";
import { toAnthropicResponse } from "./translate-response.js";
import { generateContent, streamGenerateContent, countTokens, GeminiApiError } from "./gemini-client.js";
import { pipeGeminiStreamToAnthropic } from "./stream.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : "api_error", message } }));
}

async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  let body: AnthropicRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return sendError(res, 400, "Invalid JSON body");
  }

  body.max_tokens = body.max_tokens || 4096;
  if (!body.messages?.length) {
    return sendError(res, 400, "Request must include 'messages'");
  }

  const geminiReq = toGeminiRequest(body);

  try {
    if (body.stream) {
      const geminiRes = await streamGenerateContent(geminiReq);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      });
      // NOTE: input_tokens in message_start is not yet known at this point
      // (Gemini reports it mid-stream). Reported as 0 — see README limitations.
      await pipeGeminiStreamToAnthropic(geminiRes, res, body.model, 0);
    } else {
      const geminiRes = await generateContent(geminiReq);
      const anthropicRes = toAnthropicResponse(geminiRes, body.model);
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(anthropicRes));
    }
  } catch (err) {
    if (err instanceof GeminiApiError) {
      const isRateLimit = err.status === 429;
      if (!res.headersSent) {
        res.writeHead(err.status, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          ...(isRateLimit ? { "retry-after": "5" } : {}),
        });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: isRateLimit ? "rate_limit_error" : "api_error",
              message: err.message,
            },
          })
        );
        return;
      }
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    if (!res.headersSent) sendError(res, 502, message);
    else res.end();
  }
}

async function handleCountTokens(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const geminiReq = toGeminiRequest(body);
    const total = await countTokens(geminiReq);
    res.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ input_tokens: total }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to count tokens";
    sendError(res, 500, message);
  }
}

function handleModels(res: ServerResponse, modelId?: string) {
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  if (modelId) {
    res.end(
      JSON.stringify({
        type: "model",
        id: modelId,
        display_name: modelId,
        created_at: "2026-01-01T00:00:00Z",
      })
    );
    return;
  }
  res.end(
    JSON.stringify({
      data: [
        { type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5", created_at: "2026-01-01T00:00:00Z" },
        { type: "model", id: "claude-3-7-sonnet-20250219", display_name: "Claude 3.7 Sonnet", created_at: "2025-02-19T00:00:00Z" },
        { type: "model", id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet", created_at: "2024-10-22T00:00:00Z" },
        { type: "model", id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku", created_at: "2024-10-22T00:00:00Z" },
      ],
      has_more: false,
      first_id: "claude-sonnet-5",
      last_id: "claude-3-5-haiku-20241022",
    })
  );
}

const server = createServer((req, res) => {
  console.log(`[PROXY REQUEST] ${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS, HEAD",
      "access-control-allow-headers": "*",
    });
    res.end();
    return;
  }

  const pathname = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname : "";

  if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/" || pathname === "/health" || pathname === "/api/hello")) {
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    res.end("OK");
    return;
  }

  if (req.method === "GET" && (pathname === "/v1/models" || pathname.startsWith("/v1/models/"))) {
    const modelId = pathname === "/v1/models" ? undefined : pathname.slice("/v1/models/".length);
    handleModels(res, modelId);
    return;
  }

  if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
    handleCountTokens(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/v1/messages") {
    handleMessages(req, res);
    return;
  }

  sendError(res, 404, `Not found: ${req.method} ${pathname}`);
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Claude Code -> Gemini proxy listening on http://localhost:${port}`);
});

