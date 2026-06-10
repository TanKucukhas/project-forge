/**
 * Generate prompt builder (Phase 8). Turns the knowledge base into project
 * outputs (concepts, GDDs, specs, agent prompts) using ONLY retrieved context.
 * Pure string building — client- AND server-safe.
 */

export type GenerateOutputType =
  | "answer"
  | "game_concept"
  | "gdd"
  | "prototype_spec"
  | "technical_spec"
  | "agent_build_prompt"
  | "evaluation_checklist";

export const GENERATE_OUTPUT_TYPES: { value: GenerateOutputType; label: string }[] = [
  { value: "answer", label: "Answer" },
  { value: "game_concept", label: "Game Concept" },
  { value: "gdd", label: "Game Design Document" },
  { value: "prototype_spec", label: "Prototype Spec" },
  { value: "technical_spec", label: "Technical Spec" },
  { value: "agent_build_prompt", label: "AI-Agent Build Prompt" },
  { value: "evaluation_checklist", label: "Evaluation Checklist" },
];

/** Map an output type to the Ask `use_for` tag so retrieval can boost docs that
 *  declared they're useful for this kind of output. */
export function outputTypeUseFor(t: GenerateOutputType): string {
  switch (t) {
    case "game_concept":
      return "concept";
    case "gdd":
      return "gdd";
    case "prototype_spec":
      return "prototype_spec";
    case "technical_spec":
      return "technical_spec";
    case "agent_build_prompt":
      return "agent_prompt";
    case "evaluation_checklist":
      return "evaluation";
    default:
      return "answer";
  }
}

/** Extra structural requirement appended for specific output types. */
function typeSpecificSections(t: GenerateOutputType): string {
  if (t === "game_concept") {
    return `
For this game concept, include these sections:
## Core Hook
## Player Fantasy
## Core Loop
## Main Mechanics
## Meaningful Choices
## Progression
## Prototype Scope
## Technical Requirements
## Risks
## Playtest Questions
## AI-Agent Build Prompt`;
  }
  return "";
}

export function buildGeneratePrompt(
  projectGoal: string,
  outputType: GenerateOutputType,
  userRequest: string,
  context: string,
): string {
  return `You are generating a project output using the user's knowledge base.

Use ONLY the provided CONTEXT as your design intelligence. You may combine ideas across sources, but do not invent unsupported expert claims.

PROJECT GOAL:
${projectGoal || "(none set)"}

OUTPUT TYPE:
${outputType}

USER REQUEST:
${userRequest}

CONTEXT:
${context.trim()}

Generate the output in Markdown.

Requirements:
- Start with a concise executive summary.
- Use source-grounded principles from the context.
- Convert principles into concrete project decisions.
- Include tradeoffs and risks.
- Include an implementation path when relevant.
- Include an evaluation checklist.
- Cite source titles inline using bracketed source names.
- If the context is insufficient, include a "Missing Knowledge" section.
- Avoid generic advice unless it is directly supported by the context.${typeSpecificSections(outputType)}`;
}
