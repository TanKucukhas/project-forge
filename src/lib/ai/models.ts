/** Model registry — shared by client (selector) and server (routing). No server-only imports. */

export type ModelProvider = "codex" | "claude" | "gemini-cli" | "openai" | "gemini";

export type ModelOption = {
  id: string;
  label: string;
  model: string;
  provider: ModelProvider;
  tier: "Fast" | "Balanced" | "High";
  note: string;
  /** One-line picker description (Claude/Codex-style). */
  description: string;
  /** Estimated USD per 1M tokens for paid API models (prices drift — "est."). */
  cost?: { inputPerM: number; outputPerM: number };
  /** Local-CLI subscription usage weight (no $ cost; counts against your limits). */
  usageWeight?: "light" | "normal" | "heavy";
};

/** True for providers that run as a local CLI (localhost-gated, no API key). */
export function isLocalProvider(p: ModelProvider): p is "codex" | "claude" | "gemini-cli" {
  return p === "codex" || p === "claude" || p === "gemini-cli";
}

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  claude: "Claude · local CLI",
  codex: "Codex · local CLI",
  "gemini-cli": "Gemini · local CLI",
  openai: "OpenAI · API",
  gemini: "Gemini · API",
};

export const modelOptions: ModelOption[] = [
  {
    id: "claude:sonnet",
    label: "Claude Sonnet 4.6",
    model: "sonnet",
    provider: "claude",
    tier: "Balanced",
    note: "Recommended Claude default (local CLI)",
    description: "Balanced default — efficient for everyday distill & ask.",
    usageWeight: "normal",
  },
  {
    id: "claude:fable",
    label: "Claude Fable 5",
    model: "fable",
    provider: "claude",
    tier: "High",
    note: "Most capable Claude (local CLI)",
    description: "Most capable Claude — hardest, longest-running tasks · ~2× limits vs Opus.",
    usageWeight: "heavy",
  },
  {
    id: "claude:opus",
    label: "Claude Opus 4.8",
    model: "opus",
    provider: "claude",
    tier: "High",
    note: "Deeper reasoning, slower (local CLI)",
    description: "Deepest reasoning for your hardest outputs · slower.",
    usageWeight: "heavy",
  },
  {
    id: "claude:haiku",
    label: "Claude Haiku 4.5",
    model: "haiku",
    provider: "claude",
    tier: "Fast",
    note: "Fastest Claude option (local CLI)",
    description: "Fastest Claude · great for quick answers.",
    usageWeight: "light",
  },
  {
    id: "codex:gpt-5.5-codex",
    label: "GPT-5.5 Codex",
    model: "gpt-5.5-codex",
    provider: "codex",
    tier: "High",
    note: "Recommended local Codex",
    description: "Code-tuned reasoning · recommended Codex.",
    usageWeight: "normal",
  },
  {
    id: "codex:gpt-5.5",
    label: "GPT-5.5",
    model: "gpt-5.5",
    provider: "codex",
    tier: "High",
    note: "Best local Codex reasoning",
    description: "Strongest Codex reasoning · heavier.",
    usageWeight: "heavy",
  },
  {
    id: "codex:codex-mini-latest",
    label: "Codex Mini",
    model: "codex-mini-latest",
    provider: "codex",
    tier: "Fast",
    note: "Fast local Codex option",
    description: "Fast, lightweight Codex.",
    usageWeight: "light",
  },
  {
    id: "gemini-cli:gemini-2.5-pro",
    label: "Gemini 2.5 Pro (CLI)",
    model: "gemini-2.5-pro",
    provider: "gemini-cli",
    tier: "High",
    note: "Gemini CLI — local login, no API key",
    description: "Long-context reasoning via local Gemini CLI (experimental).",
    usageWeight: "normal",
  },
  {
    id: "gemini-cli:gemini-2.5-flash",
    label: "Gemini 2.5 Flash (CLI)",
    model: "gemini-2.5-flash",
    provider: "gemini-cli",
    tier: "Fast",
    note: "Gemini CLI — local login, no API key",
    description: "Fast Gemini via local CLI (experimental).",
    usageWeight: "light",
  },
  {
    id: "openai:gpt-4.1",
    label: "GPT-4.1",
    model: "gpt-4.1",
    provider: "openai",
    tier: "High",
    note: "OPENAI_API_KEY required",
    description: "Strong general model · API key required.",
    cost: { inputPerM: 2, outputPerM: 8 },
  },
  {
    id: "openai:gpt-4.1-mini",
    label: "GPT-4.1 mini",
    model: "gpt-4.1-mini",
    provider: "openai",
    tier: "Fast",
    note: "OPENAI_API_KEY required",
    description: "Cheap & fast · API key required.",
    cost: { inputPerM: 0.4, outputPerM: 1.6 },
  },
  {
    id: "gemini:gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    model: "gemini-2.5-pro",
    provider: "gemini",
    tier: "High",
    note: "GEMINI_API_KEY required",
    description: "Long-context reasoning · API key required.",
    cost: { inputPerM: 1.25, outputPerM: 10 },
  },
  {
    id: "gemini:gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    model: "gemini-2.5-flash",
    provider: "gemini",
    tier: "Fast",
    note: "GEMINI_API_KEY required",
    description: "Fast & cheap · API key required.",
    cost: { inputPerM: 0.3, outputPerM: 2.5 },
  },
];

/** Resolve a model id to its option, defaulting to Claude Sonnet. */
export function getModelOption(id: string): ModelOption {
  return modelOptions.find((o) => o.id === id) ?? modelOptions[0];
}

/** Short cost/usage hint for the picker: paid → estimated $/1M; local → usage weight. */
export function modelCostHint(o: ModelOption): string {
  if (o.cost) return `~$${o.cost.inputPerM}/$${o.cost.outputPerM} per 1M · est.`;
  switch (o.usageWeight) {
    case "light":
      return "Free · light usage";
    case "heavy":
      return "Free · heavy (~2× limits)";
    default:
      return "Free · local";
  }
}

/** Gap (ms) the queue waits after a job using this provider before the next one,
 *  to stay friendly with rate limits. Free Gemini CLI is the most limited; local
 *  CLIs least. Env-overridable. (process.env is empty on the client → defaults.) */
export function providerThrottleMs(provider: ModelProvider): number {
  if (provider === "gemini-cli") return Number(process.env.THROTTLE_GEMINI_CLI_MS) || 3000;
  if (provider === "openai" || provider === "gemini")
    return Number(process.env.THROTTLE_API_MS) || 1500;
  return Number(process.env.THROTTLE_LOCAL_MS) || 500; // claude / codex
}

/** Models grouped by provider, preserving registry order. */
export function modelsByProvider(
  options: ModelOption[],
): { provider: ModelProvider; models: ModelOption[] }[] {
  const order: ModelProvider[] = ["claude", "codex", "gemini-cli", "openai", "gemini"];
  return order
    .map((provider) => ({ provider, models: options.filter((m) => m.provider === provider) }))
    .filter((g) => g.models.length > 0);
}
