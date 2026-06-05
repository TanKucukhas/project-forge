/** Model registry — shared by client (selector) and server (routing). No server-only imports. */

export type ModelProvider = "codex" | "claude" | "openai" | "gemini";

export type ModelOption = {
  id: string;
  label: string;
  model: string;
  provider: ModelProvider;
  tier: "Fast" | "Balanced" | "High";
  note: string;
};

/** True for providers that run as a local CLI (localhost-gated, no API key). */
export function isLocalProvider(p: ModelProvider): p is "codex" | "claude" {
  return p === "codex" || p === "claude";
}

export const modelOptions: ModelOption[] = [
  {
    id: "claude:sonnet",
    label: "Claude Sonnet",
    model: "sonnet",
    provider: "claude",
    tier: "Balanced",
    note: "Recommended Claude default (local CLI)",
  },
  {
    id: "claude:opus",
    label: "Claude Opus",
    model: "opus",
    provider: "claude",
    tier: "High",
    note: "Deeper reasoning, slower (local CLI)",
  },
  {
    id: "claude:haiku",
    label: "Claude Haiku",
    model: "haiku",
    provider: "claude",
    tier: "Fast",
    note: "Fastest Claude option (local CLI)",
  },
  {
    id: "codex:gpt-5.5-codex",
    label: "Codex GPT-5.5 Codex",
    model: "gpt-5.5-codex",
    provider: "codex",
    tier: "High",
    note: "Recommended local Codex",
  },
  {
    id: "codex:gpt-5.5",
    label: "Codex GPT-5.5",
    model: "gpt-5.5",
    provider: "codex",
    tier: "High",
    note: "Best local Codex reasoning",
  },
  {
    id: "codex:codex-mini-latest",
    label: "Codex Mini",
    model: "codex-mini-latest",
    provider: "codex",
    tier: "Fast",
    note: "Fast local Codex option",
  },
  {
    id: "openai:gpt-4.1",
    label: "OpenAI GPT-4.1",
    model: "gpt-4.1",
    provider: "openai",
    tier: "High",
    note: "OPENAI_API_KEY required",
  },
  {
    id: "openai:gpt-4.1-mini",
    label: "OpenAI GPT-4.1 Mini",
    model: "gpt-4.1-mini",
    provider: "openai",
    tier: "Fast",
    note: "OPENAI_API_KEY required",
  },
  {
    id: "gemini:gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    model: "gemini-2.5-pro",
    provider: "gemini",
    tier: "High",
    note: "GEMINI_API_KEY required",
  },
  {
    id: "gemini:gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    model: "gemini-2.5-flash",
    provider: "gemini",
    tier: "Fast",
    note: "GEMINI_API_KEY required",
  },
];

/** Resolve a model id to its option, defaulting to Claude Sonnet. */
export function getModelOption(id: string): ModelOption {
  return modelOptions.find((o) => o.id === id) ?? modelOptions[0];
}
