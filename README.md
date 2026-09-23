# claude-code-gemini-proxy

Local protocol adapter: Claude Code (Anthropic `/v1/messages` API shape) → this proxy → Google Gemini API, using your own `GEMINI_API_KEY`.

**Scope (Phase 1 + 2 only):** text-only, single/multi-turn, system instructions, streaming and non-streaming. No tools, images, or thinking-param passthrough yet — that's Phase 3+.

The proxy does **not** execute tools, call MCP servers, or touch Claude Code's context construction. It only translates one JSON/SSE shape into another.

## Setup

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY and GEMINI_MODEL
npm run build
npm start
```

Then point Claude Code at it:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
```

## Files

| File | Responsibility |
|---|---|
| `src/server.ts` | HTTP server, `POST /v1/messages` route, request validation |
| `src/translate-request.ts` | Anthropic request → Gemini `generateContent` request |
| `src/translate-response.ts` | Gemini response → Anthropic response (non-streaming) |
| `src/stream.ts` | Gemini SSE stream → Anthropic SSE stream, chunk-by-chunk, no buffering |
| `src/gemini-client.ts` | Raw `fetch` calls to Gemini's REST API (no SDK dependency) |
| `src/types.ts` | Shared type definitions (text-only subset of both protocols) |

## Known limitations (by design, for this phase)

- **`input_tokens` in the streaming `message_start` event is reported as `0`.** Gemini only reports prompt token count mid-stream, after `message_start` has already been sent — there's no way to know it upfront without an extra non-streaming pre-call, which would defeat the point of streaming. `output_tokens` in the final `message_delta` is accurate.
- **No tool/function calling yet.** Anthropic `tools`/`tool_use` and Gemini `functionDeclarations`/`functionCall` translation is Phase 3.
- **No image/multimodal content yet.** Phase 5.
- **`GEMINI_MODEL` is a single fixed model** — every Claude model name gets routed to it. Per-model routing (e.g. haiku → flash, opus → pro) is a Phase 6 concern, not built here since it wasn't asked for.
- **Auth headers from Claude Code (`x-api-key`, `anthropic-version`) are ignored** — this is a local-only proxy; if you expose it beyond localhost, add your own auth check first.

## Verified

- `POST /v1/messages` with a missing `messages`/`max_tokens` → `400` with an Anthropic-shaped error body.
- Unknown routes → `404`.
- Request translation: multi-turn messages, `assistant`→`model` role mapping, system instruction extraction, `temperature`/`top_p`/`stop_sequences` passthrough — checked against expected Gemini request shape.
- Response translation: Gemini `finishReason` → Anthropic `stop_reason` mapping, usage field mapping — checked against expected Anthropic response shape.
- **Not verified against the real Gemini API** — this sandbox can't reach `generativelanguage.googleapis.com`, so streaming/non-streaming calls against live Gemini need to be tested on your machine with a real key before you trust it end-to-end.
