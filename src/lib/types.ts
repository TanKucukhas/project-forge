/** Shared domain types for ProjectForge. */

export type SourceType =
  | "youtube"
  | "article"
  | "website"
  | "markdown"
  | "pdf"
  | "note";

export type OutputType =
  | "learning-doc"
  | "game-concept"
  | "startup-concept"
  | "side-project"
  | "prd"
  | "tech-spec"
  | "claude-prompt"
  | "codex-plan"
  | "cursor-plan"
  | "master-brief";

/** What the center content area is showing. Driven by the top nav + clicks. */
export type CenterMode =
  | "learn"
  | "analyze"
  | "chat"
  | "dashboard"
  | "projects"
  | "global-settings";

export const OUTPUT_GENERATORS: { type: OutputType; label: string; blurb: string }[] = [
  { type: "master-brief", label: "Master Project Brief", blurb: "20-section build-ready spec" },
  { type: "game-concept", label: "Game Concept", blurb: "Playable game idea + build plan" },
  { type: "startup-concept", label: "Startup Concept", blurb: "Founder-grade idea + MVP" },
  { type: "side-project", label: "Side Project", blurb: "Weekend-buildable project" },
  { type: "prd", label: "PRD", blurb: "Features, flows, user stories" },
  { type: "tech-spec", label: "Technical Spec", blurb: "Architecture, stack, data model" },
  { type: "claude-prompt", label: "Claude Build Prompt", blurb: "Full agent prompt" },
  { type: "codex-plan", label: "Codex Task Plan", blurb: "Implementation steps" },
  { type: "cursor-plan", label: "Cursor Plan", blurb: "Cursor-ready task file" },
];
