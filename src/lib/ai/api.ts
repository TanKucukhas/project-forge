import "server-only";

/**
 * Cloud API model adapters (OpenAI / Gemini) via plain fetch — no SDK deps.
 * Used when the selected model's provider is not a local CLI.
 */

const API_TIMEOUT_MS = 120_000;

async function postJson(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function runOpenAi(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const res = await postJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.25,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Read an SSE stream, feeding each `data:` payload to `extract`; accumulates and
 *  returns the full text. No abort timeout — streaming runs can be long. */
async function readSse(res: Response, extract: (data: string) => string): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const piece = extract(data);
      if (piece) out += piece;
    }
  }
  return out.trim();
}

export async function runOpenAiStream(
  model: string,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.25,
      stream: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return readSse(res, (data) => {
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const t = j.choices?.[0]?.delta?.content ?? "";
      if (t) onDelta(t);
      return t;
    } catch {
      return "";
    }
  });
}

export async function runGeminiStream(
  model: string,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return readSse(res, (data) => {
    try {
      const j = JSON.parse(data) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const t = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (t) onDelta(t);
      return t;
    } catch {
      return "";
    }
  });
}

export async function runGemini(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const res = await postJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? ""
  );
}
