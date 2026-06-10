import "server-only";
import { getModelOption, isLocalProvider, type ModelOption } from "./models";
import { normalizeCliModel, runLocalAi } from "./local-ai";
import { runOpenAi, runGemini, runOpenAiStream, runGeminiStream } from "./api";

export { getModelOption, isLocalProvider, modelOptions } from "./models";
export type { ModelOption, ModelProvider } from "./models";
export { isLocalRequestHost } from "./local-ai";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transient errors worth retrying: rate limits, quota exhaustion, overload. */
function isRetryable(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /\b(429|503|529)\b/.test(m) ||
    m.includes("rate limit") ||
    m.includes("ratelimit") ||
    m.includes("quota") ||
    m.includes("exhausted") ||
    m.includes("capacity") ||
    m.includes("overloaded") ||
    m.includes("too many requests") ||
    m.includes("temporarily")
  );
}

/**
 * Retry a model call with exponential backoff + jitter on transient/rate-limit
 * errors. Non-retryable errors throw immediately. Tunable via MODEL_RETRY_MAX /
 * MODEL_RETRY_BASE_MS. This is what makes a 100–200 source batch survive the
 * provider throttling partway through instead of failing those jobs.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const max = Number(process.env.MODEL_RETRY_MAX) || 4;
  const base = Number(process.env.MODEL_RETRY_BASE_MS) || 2000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= max; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastErr = error;
      if (attempt === max || !isRetryable(error)) throw error;
      const wait = Math.min(base * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Run a prompt through whichever model the id resolves to (with rate-limit
 * retry/backoff). Local providers (codex/claude/gemini-cli) MUST be guarded by
 * isLocalRequestHost upstream; this function assumes the caller enforced that.
 */
export async function runModel(modelId: string, prompt: string): Promise<{ output: string; model: ModelOption }> {
  const model = getModelOption(modelId);

  const output = await withRetry(async () => {
    if (isLocalProvider(model.provider)) {
      return runLocalAi(model.provider, prompt, normalizeCliModel(model.model));
    }
    if (model.provider === "openai") return runOpenAi(model.model, prompt);
    return runGemini(model.model, prompt);
  });

  return { output: output || "", model };
}

/**
 * Streaming variant: `onDelta` is called with text fragments as they arrive.
 * Claude (stdout) and OpenAI/Gemini (SSE) stream token-by-token; Codex returns
 * its final message via a file, so it emits once at the end (still works, just
 * not incremental). Same localhost guarantee as runModel — caller enforces it.
 */
export async function runModelStream(
  modelId: string,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<{ output: string; model: ModelOption }> {
  const model = getModelOption(modelId);

  let output: string;
  if (isLocalProvider(model.provider)) {
    if (model.provider === "codex") {
      // Codex: no incremental stream — run normally, then emit the whole message.
      output = await runLocalAi("codex", prompt, normalizeCliModel(model.model));
      if (output) onDelta(output);
    } else {
      // Claude + Gemini CLIs stream stdout incrementally.
      output = await runLocalAi(model.provider, prompt, normalizeCliModel(model.model), onDelta);
    }
  } else if (model.provider === "openai") {
    output = await runOpenAiStream(model.model, prompt, onDelta);
  } else {
    output = await runGeminiStream(model.model, prompt, onDelta);
  }

  return { output: output || "", model };
}
