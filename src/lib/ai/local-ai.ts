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

const LOCAL_TIMEOUT_MS = 120_000;

export type LocalProvider = "codex" | "claude";

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

export function runClaude(prompt: string, model: string | null): Promise<string> {
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

  return collectProcessOutput(child, prompt, LOCAL_TIMEOUT_MS, async (stdout) => stdout.trim());
}

export function runLocalAi(
  provider: LocalProvider,
  prompt: string,
  model: string | null,
): Promise<string> {
  return provider === "codex" ? runCodex(prompt, model) : runClaude(prompt, model);
}

function collectProcessOutput(
  child: ChildProcessWithoutNullStreams,
  stdin: string,
  timeoutMs: number,
  readFinalOutput: (stdout: string) => Promise<string>,
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
      stdout += chunk.toString("utf8");
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
