"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useSettingsStatus } from "@/lib/api";
import { TRANSCRIPT_LANGUAGE_OPTIONS } from "@/lib/settings";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function ls(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function StatusRow({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : (
        <XCircle className="size-4 text-muted-foreground" />
      )}
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

/** Global, machine-wide preferences (persisted in localStorage) + integration status. */
export function GlobalSettings() {
  const { data: status } = useSettingsStatus();
  const [defaultLang, setDefaultLang] = useState(() => ls("pf.defaultTranscriptLanguage", "en"));
  const [autoLoad, setAutoLoad] = useState(() => ls("pf.channelAutoLoad", "true") !== "false");
  const [popularCount, setPopularCount] = useState(() => Number(ls("pf.popularCount", "200")) || 200);

  function setLS(key: string, value: string) {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <h2 className="text-lg font-semibold">Global settings</h2>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Language</h3>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Default transcript language for new projects</label>
          <Select
            value={defaultLang || "auto"}
            onValueChange={(v) => {
              const lang = v === "auto" ? "" : v;
              setDefaultLang(lang);
              setLS("pf.defaultTranscriptLanguage", lang);
            }}
          >
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSCRIPT_LANGUAGE_OPTIONS.map((l) => (
                <SelectItem key={l.value || "auto"} value={l.value || "auto"}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">API keys &amp; integrations</h3>
        <p className="text-xs text-muted-foreground">
          Set in <code className="rounded bg-muted px-1">.env</code> (then restart). Local Claude/Codex
          CLIs need no key — they use your existing login.
        </p>
        <div className="space-y-1.5 rounded-md border p-3">
          <StatusRow ok={!!status?.openai} label="OpenAI" note="OPENAI_API_KEY" />
          <StatusRow ok={!!status?.gemini} label="Gemini" note="GEMINI_API_KEY" />
          <StatusRow ok={!!status?.claudeCli} label="Claude CLI" note="local login" />
          <StatusRow ok={!!status?.codexCli} label="Codex CLI" note="local login" />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Preferences</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoLoad}
            onChange={(e) => {
              setAutoLoad(e.target.checked);
              setLS("pf.channelAutoLoad", String(e.target.checked));
            }}
            className="size-4 accent-primary"
          />
          Auto-load more channel videos on scroll
        </label>
        <label className="flex items-center gap-2 text-sm">
          Popular videos to fetch
          <Input
            type="number"
            min={1}
            max={200}
            value={popularCount}
            onChange={(e) => {
              const v = Math.max(1, Math.min(200, Number(e.target.value) || 200));
              setPopularCount(v);
              setLS("pf.popularCount", String(v));
            }}
            className="h-8 w-24"
          />
          <span className="text-xs text-muted-foreground">(YouTube caps at 200)</span>
        </label>
      </section>
    </div>
  );
}
