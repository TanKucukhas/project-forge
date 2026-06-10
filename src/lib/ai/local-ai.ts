import "server-only";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Local CLI model adapters (Codex / Claude).
 *
 * Both run the locally-installed, already-authenticated CLI as a child process
 * and pipe the prompt in via stdin. No network, no API key — uses the login you
 * already have. MUST only be invoked from localhost-gated routes (see
 * isLocalRequestHost) and from the Node.js runtime (child_process is unavailable
 * on Edge).
 */

// Local CLI generations can be slow — the richer distill prompt (taxonomy +
// structured metadata + multi-section summary) makes a long transcript take
// minutes. Default 5 min; override with LOCAL_AI_TIMEOUT_MS (ms) for big sources.
const LOCAL_TIMEOUT_MS = Number(process.env.LOCAL_AI_TIMEOUT_MS) || 300_000;

export type LocalProvider = "codex" | "claude" | "gemini-cli";

/** Validate a CLI model name to prevent argument injection. Returns null for "default". */
export function normalizeCliModel(model: string | undefined): string | null {
  const trimmed = model?.trim() ?? "";
  if (!trimmed || trimmed === "default") return null;
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(trimmed)) {
    throw new Error(
      "Model names may only contain letters, numbers, dots, underscores, colons, and hyphens.",
    );
  }
  return trimmed;
}

/** True only for localhost hosts — local CLI execution is never exposed to the network. */
export function isLocalRequestHost(host: string): boolean {
  return (
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    host.startsWith("[::1]:") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]"
  );
}

export function runCodex(prompt: string, model: string | null): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const codexPath = process.env.CODEX_CLI_PATH ?? "codex";
    const outputFile = join(tmpdir(), `projectforge-codex-${randomUUID()}.txt`);
    const args = [
      "-a",
      "never",
      ...(model ? ["-m", model] : []),
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-last-message",
      outputFile,
      "-",
    ];

    const child = spawn(codexPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    collectProcessOutput(child, prompt, LOCAL_TIMEOUT_MS, async (stdout) => {
      const finalMessage = await readFile(outputFile, "utf8").catch(() => "");
      await rm(outputFile, { force: true }).catch(() => undefined);
      return finalMessage.trim() || stdout.trim();
    })
      .then(resolve)
      .catch(async (error) => {
        await rm(outputFile, { force: true }).catch(() => undefined);
        reject(error);
      });
  });
}

export function runClaude(
  prompt: string,
  model: string | null,
  onDelta?: (text: string) => void,
): Promise<string> {
  const claudePath = process.env.CLAUDE_CLI_PATH ?? "claude";
  const args = [
    "-p",
    // NOTE: the archive used "dontAsk", which is NOT a valid mode on the current
    // Claude CLI (choices: acceptEdits|auto|bypassPermissions|default). For
    // headless text synthesis we use bypassPermissions so a tool prompt can never
    // hang the spawned process.
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "text",
    ...(model ? ["--model", model] : []),
  ];

  const child = spawn(claudePath, args, {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return collectProcessOutput(child, prompt, LOCAL_TIMEOUT_MS, async (stdout) => stdout.trim(), onDelta);
}

/**
 * Google's Gemini CLI in non-interactive mode: `gemini -p "<prompt>" -m <model>`.
 * Uses your local Gemini login (no API key). The prompt is passed as an argv
 * value (shell:false → no interpolation); stdin is left empty. stdout streams,
 * so onDelta forwards chunks like Claude. Experimental — output may include CLI
 * preamble lines depending on version.
 */
export function runGeminiCli(
  prompt: string,
  model: string | null,
  onDelta?: (text: string) => void,
): Promise<string> {
  const geminiPath = process.env.GEMINI_CLI_PATH ?? "gemini";
  // --skip-trust: required for headless runs in an untrusted dir.
  const args = ["--skip-trust", "-p", prompt, ...(model ? ["-m", model] : [])];

  const child = spawn(geminiPath, args, {
    // Run in a neutral tmp dir so the CLI doesn't ingest the project's files as
    // context (it auto-scans its working directory). Our prompt is self-contained.
    cwd: tmpdir(),
    env: { ...process.env, NO_COLOR: "1" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Prompt is already in argv — don't also pipe it to stdin (it would append).
  return collectProcessOutput(child, "", LOCAL_TIMEOUT_MS, async (stdout) => stdout.trim(), onDelta);
}

export function runLocalAi(
  provider: LocalProvider,
  prompt: string,
  model: string | null,
  onDelta?: (text: string) => void,
): Promise<string> {
  // Codex returns its final message via a file, so it can't stream incrementally;
  // Claude + Gemini CLIs stream stdout, so we forward chunks via onDelta.
  if (provider === "codex") return runCodex(prompt, model);
  if (provider === "gemini-cli") return runGeminiCli(prompt, model, onDelta);
  return runClaude(prompt, model, onDelta);
}

function collectProcessOutput(
  child: ChildProcessWithoutNullStreams,
  stdin: string,
  timeoutMs: number,
  readFinalOutput: (stdout: string) => Promise<string>,
  onData?: (text: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onData?.(text); // forward for streaming UIs
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? new Error(
              `Could not find the CLI binary. Set CODEX_CLI_PATH / CLAUDE_CLI_PATH or add it to PATH. (${error.message})`,
            )
          : error,
      );
    });

    child.on("close", async (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("The local model command timed out before returning a response."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `The local model command exited with code ${code}.`));
        return;
      }
      resolve(await readFinalOutput(stdout));
    });

    child.stdin.end(stdin);
  });
}
