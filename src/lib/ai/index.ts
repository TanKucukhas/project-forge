import "server-only";
import { getModelOption, isLocalProvider, type ModelOption } from "./models";
import { normalizeCliModel, runLocalAi } from "./local-ai";
import { runOpenAi, runGemini } from "./api";

export { getModelOption, isLocalProvider, modelOptions } from "./models";
export type { ModelOption, ModelProvider } from "./models";
export { isLocalRequestHost } from "./local-ai";

/**
 * Run a prompt through whichever model the id resolves to.
 * Local providers (codex/claude) MUST be guarded by isLocalRequestHost upstream;
 * this function assumes the caller has already enforced that.
 */
export async function runModel(modelId: string, prompt: string): Promise<{ output: string; model: ModelOption }> {
  const model = getModelOption(modelId);

  let output: string;
  if (isLocalProvider(model.provider)) {
    output = await runLocalAi(model.provider, prompt, normalizeCliModel(model.model));
  } else if (model.provider === "openai") {
    output = await runOpenAi(model.model, prompt);
  } else {
    output = await runGemini(model.model, prompt);
  }

  return { output: output || "", model };
}
