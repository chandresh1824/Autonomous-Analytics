import type OpenAI from "openai";
import { z, ZodError, ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LLMError } from "../../core/exceptions";
import { getLogger } from "../../core/logging";
import { ChatModel } from "./client";

const logger = getLogger("services.llm.structuredOutput");

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

const JSON_BLOCK_RE = /\{[\s\S]*\}/;

// Substrings LM Studio / llama.cpp-style backends use when the prompt no
// longer fits the model's loaded context window (e.g. "n_keep: 4164 >=
// n_ctx: 4096"), and the OpenAI-compatible error code some other backends use
// for the same situation.
const CONTEXT_LENGTH_MARKERS = ["context length", "n_ctx", "context_length_exceeded", "context size"];
// LM Studio's own generic message when the model's native worker process
// dies mid-generation, or gets swapped out from under an in-flight request -
// both observed transient in practice, resolved by a bare retry.
// LM Studio engine failures that a retry (after LM Studio reloads the model)
// can recover from: "predict request failed" / "predict stream returned an
// error" when the engine process stops answering, and the GPU backend's
// "ErrorDeviceLost" (Vulkan) when the driver drops the model - usually GPU
// memory pressure from several models being swapped in and out.
const MODEL_CRASH_MARKERS = [
  "model has crashed",
  "model reloaded",
  "predict request failed",
  "predict stream returned an error",
  "errordevicelost",
  "device lost",
];
// Public - reused by callers outside this module that invoke the chat model
// directly rather than through `generateStructured` (see DeepAgent's
// orchestrator retry, which needs the exact same transient-error detection).
export const TRANSIENT_ERROR_MARKERS = [...CONTEXT_LENGTH_MARKERS, ...MODEL_CRASH_MARKERS];

// Raw model output is echoed back into the conversation on a retry so the
// model can see and fix its own mistake; cap it so a rambling/oversized
// response doesn't blow up the prompt on the next attempt.
const MAX_ECHOED_RESPONSE_CHARS = 2000;
// A "context size exceeded"-style error from a local server (LM Studio /
// llama.cpp) has repeatedly proven transient in practice - retried a couple
// of times before treating it as a genuine too-large-prompt failure.
const TRANSIENT_CONTEXT_ERROR_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ainvokeWithTransientRetry(
  chatModel: ChatModel,
  messages: ChatMessage[],
  extra: Partial<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming> = {}
): Promise<OpenAI.Chat.ChatCompletionMessage> {
  for (let attempt = 0; attempt <= TRANSIENT_CONTEXT_ERROR_RETRIES; attempt++) {
    try {
      const response = await chatModel.client.chat.completions.create({
        model: chatModel.model,
        temperature: 0.1,
        messages,
        ...extra,
      });
      return response.choices[0].message;
    } catch (exc) {
      const text = String((exc as Error)?.message ?? exc).toLowerCase();
      const isContextError = CONTEXT_LENGTH_MARKERS.some((m) => text.includes(m));
      const isCrashError = MODEL_CRASH_MARKERS.some((m) => text.includes(m));
      if (!isContextError && !isCrashError) throw exc;
      if (attempt >= TRANSIENT_CONTEXT_ERROR_RETRIES) {
        if (isContextError) {
          throw new LLMError(
            "The prompt sent to the LLM was too large for the model's loaded context window. " +
              "Try loading the model in LM Studio with a larger context length, or shorten the " +
              "input (e.g. generate the semantic model for fewer tables, or fewer columns, at a time)."
          );
        }
        throw new LLMError(
          "The local model in LM Studio crashed or was reloaded while generating a response - " +
            "this is LM Studio's own native model process (memory pressure, a driver fault, or a " +
            "manual/automatic model reload) rather than a bug in this app. Try the question again, " +
            "or check LM Studio's server logs if it keeps happening."
        );
      }
      logger.warning("llm_transient_error_retry", { attempt, error: String((exc as Error)?.message ?? exc) });
      // An engine crash needs LM Studio to reload the model first, so back
      // off for seconds rather than milliseconds.
      await sleep((isCrashError ? 4000 : 500) * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

function extractJson(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^`+/, "").replace(/`+$/, "");
    if (trimmed.toLowerCase().startsWith("json")) {
      trimmed = trimmed.slice(4);
    }
  }
  const match = JSON_BLOCK_RE.exec(trimmed);
  return match ? match[0] : trimmed;
}

function messageText(message: OpenAI.Chat.ChatCompletionMessage): string {
  const content = message.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

/**
 * Ask the chat model for JSON conforming to `schema`, validating and
 * retrying on failure.
 *
 * The JSON Schema is embedded in the system prompt (so this works against
 * any OpenAI-compatible endpoint, including test fakes), and `response_format`
 * is additionally bound onto the request so providers that support
 * grammar-constrained decoding (LM Studio's `json_schema` response format)
 * use it.
 */
export async function generateStructured<T>(
  chatModel: ChatModel,
  options: { systemPrompt: string; userPrompt: string; schema: ZodType<T, any, any>; maxRetries?: number }
): Promise<T> {
  const { systemPrompt, userPrompt, schema, maxRetries = 2 } = options;
  // Cast to break TS's recursive structural check on deeply-nested/recursive
  // schemas (e.g. the semantic model's FilterGroup) - `zodToJsonSchema` only
  // needs the schema's runtime shape, not its exact generic type.
  const jsonSchema = zodToJsonSchema(schema as any, "response");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `${systemPrompt}\n\n` +
        "You must respond with ONLY a single valid JSON object. No prose, no markdown fences.\n" +
        `The JSON must conform to this JSON Schema:\n${JSON.stringify(jsonSchema, null, 2)}`,
    },
    { role: "user", content: userPrompt },
  ];

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await ainvokeWithTransientRetry(chatModel, messages, {
      response_format: { type: "json_schema", json_schema: { name: "response", schema: jsonSchema as Record<string, unknown> } } as any,
    });
    const raw = messageText(response);
    try {
      const candidate = extractJson(raw);
      const data = JSON.parse(candidate);
      return schema.parse(data);
    } catch (exc) {
      lastError = exc;
      const errorText = exc instanceof ZodError ? exc.message : String(exc);
      logger.warning("structured_output_retry", { attempt, error: errorText });
      const echoedRaw = raw.length <= MAX_ECHOED_RESPONSE_CHARS ? raw : `${raw.slice(0, MAX_ECHOED_RESPONSE_CHARS)} …(truncated)`;
      messages.push({ role: "assistant", content: echoedRaw });
      messages.push({
        role: "user",
        content: `That response was invalid JSON or did not match the schema: ${errorText}. Reply again with ONLY the corrected JSON object.`,
      });
    }
  }
  throw new Error(`LLM failed to produce valid structured output after ${maxRetries + 1} attempts: ${String(lastError)}`);
}

// Re-exported for convenience so call sites don't need a separate zod import
// purely to declare an inline object schema.
export { z };
