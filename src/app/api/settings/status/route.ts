import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** GET /api/settings/status → which integrations are configured (booleans only,
 *  never the secret values). API keys are set via .env; this just reports presence. */
export async function GET() {
  return NextResponse.json({
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    claudeCli: Boolean(process.env.CLAUDE_CLI_PATH) || true, // defaults to `claude` on PATH
    codexCli: Boolean(process.env.CODEX_CLI_PATH) || true, // defaults to `codex` on PATH
  });
}
