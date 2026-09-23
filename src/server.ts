import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AnthropicRequest } from "./types.js";
import { toGeminiRequest } from "./translate-request.js";
import { toAnthropicResponse } from "./translate-response.js";
import { generateContent, streamGenerateContent } from "./gemini-client.js";
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
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "api_error", message } }));
}

async function handleMessages(req: IncomingMessage, res: ServerResponse) {
  let body: AnthropicRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return sendError(res, 400, "Invalid JSON body");
  }
  if (!body.messages?.length || !body.max_tokens) {
    return sendError(res, 400, "Request must include 'messages' and 'max_tokens'");
  }

  const geminiReq = toGeminiRequest(body);

  try {
    if (body.stream) {
      const geminiRes = await streamGenerateContent(geminiReq);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      // NOTE: input_tokens in message_start is not yet known at this point
      // (Gemini reports it mid-stream). Reported as 0 — see README limitations.
      await pipeGeminiStreamToAnthropic(geminiRes, res, body.model, 0);
    } else {
      const geminiRes = await generateContent(geminiReq);
      const anthropicRes = toAnthropicResponse(geminiRes, body.model);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(anthropicRes));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (!res.headersSent) sendError(res, 502, message);
    else res.end();
  }
}

const server = createServer((req, res) => {
  console.log(`[PROXY REQUEST] ${req.method} ${req.url}`);
  const pathname = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname : "";
  if (req.method === "POST" && pathname === "/v1/messages") {
    handleMessages(req, res);
    return;
  }
  sendError(res, 404, "Not found");
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Claude Code -> Gemini proxy listening on http://localhost:${port}`);
});
