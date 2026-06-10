"use client";

/**
 * Clean learned-document view for the preview modal (Phase 10 + Phase 3 metadata
 * discipline). Renders frontmatter as a card-like metadata header — entities
 * grouped by importance, authors not duplicated as people, tags shown readable —
 * then the Markdown body, then a collapsed technical section.
 */
import { ChevronRight, AlertTriangle } from "lucide-react";
import type { DocResponse } from "@/lib/api";
import { tagLabel } from "@/lib/taxonomy";
import { STALE_HINT, STALE_LABEL, type Staleness } from "@/lib/staleness";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";

// ── Tolerant frontmatter accessors (values are `unknown`) ──
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
/** Pull display names from an array of either strings or {name} objects. */
const nameArr = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) =>
      typeof a === "string"
        ? a.trim()
        : a && typeof a === "object"
          ? str((a as Record<string, unknown>).name) ?? ""
          : "",
    )
    .filter(Boolean);
};

/** A labeled cell in the metadata card grid. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

/** A wrapped row of badges with a left label. */
function BadgeRow({
  label,
  items,
  variant = "outline",
  className,
}: {
  label: string;
  items: string[];
  variant?: "default" | "secondary" | "outline";
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {items.map((t) => (
          <Badge key={t} variant={variant} className={`font-normal ${className ?? ""}`}>
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function LearnedDocView({ doc, staleness }: { doc: DocResponse; staleness: Staleness }) {
  const fm = doc.frontmatter;
  const category = str(fm.category);
  const originalCategory = str(fm.original_category);
  const relevance = str(fm.relevance);
  const utility = str(fm.utility);
  const tags = strArr(fm.tags).map(tagLabel);
  const authors = nameArr(fm.authors);
  // Importance-tiered entities, with backward-compat fallback to v2 flat fields.
  const primaryGames = strArr(fm.primary_games);
  const secondaryGames = strArr(fm.secondary_games);
  const mentionedGames = strArr(fm.mentioned_games).length
    ? strArr(fm.mentioned_games)
    : strArr(fm.referenced_games);
  const people = nameArr(fm.referenced_people);
  const primaryStudios = strArr(fm.primary_studios);
  const mentionedStudios = strArr(fm.mentioned_studios).length
    ? strArr(fm.mentioned_studios)
    : strArr(fm.referenced_studios);
  const useFor = strArr(fm.use_for);
  const whyKeep = str(fm.why_keep);
  const whyNot = str(fm.why_not);
  const model = str(fm.model);
  const distilledAt = str(fm.distilled_at);
  const needsReview = fm.needs_entity_review === true;
  const reviewNotes = strArr(fm.entity_review_notes);

  return (
    <div className="space-y-4">
      {/* Card-like metadata header */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {category && (
            <Cell label="Category">
              {category}
              {originalCategory && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (orig: {originalCategory})
                </span>
              )}
            </Cell>
          )}
          {relevance && <Cell label="Relevance">{relevance}/100</Cell>}
          {utility && <Cell label="Utility" >{utility}</Cell>}
          {authors.length > 0 && <Cell label="Author">{authors.join(", ")}</Cell>}
          {primaryGames.length > 0 && <Cell label="Primary game">{primaryGames.join(", ")}</Cell>}
          {(model || distilledAt) && (
            <Cell label="Distilled">
              <span className="font-normal text-muted-foreground">
                {model ?? "—"}
                {distilledAt ? ` · ${distilledAt.slice(0, 10)}` : ""}
              </span>
            </Cell>
          )}
        </div>

        {staleness !== "fresh" && (
          <Badge
            variant="outline"
            className="border-amber-500/50 font-normal text-amber-600"
            title={STALE_HINT[staleness]}
          >
            ⚠ {STALE_LABEL[staleness]}
          </Badge>
        )}

        <div className="space-y-1.5">
          <BadgeRow label="Tags" items={tags} />
          {/* Games by importance: primary emphasized, mentioned muted. */}
          <BadgeRow label="Games" items={primaryGames} variant="default" />
          <BadgeRow label="· secondary" items={secondaryGames} variant="secondary" />
          <BadgeRow label="· mentioned" items={mentionedGames} className="text-muted-foreground" />
          <BadgeRow label="People" items={people} />
          <BadgeRow label="Studios" items={primaryStudios} variant="secondary" />
          <BadgeRow label="· mentioned" items={mentionedStudios} className="text-muted-foreground" />
          <BadgeRow label="Use for" items={useFor} variant="secondary" />
        </div>

        {whyKeep && <p className="text-xs text-muted-foreground">Keep: {whyKeep}</p>}
        {whyNot && <p className="text-xs text-muted-foreground">Limits: {whyNot}</p>}

        {needsReview && (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5" /> Entities flagged for review
            </div>
            {reviewNotes.length > 0 && (
              <ul className="ml-4 list-disc space-y-0.5">
                {reviewNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <Markdown>{doc.body}</Markdown>

      {/* Technical metadata (collapsed) */}
      <details className="group rounded-md border bg-muted/20">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          Technical metadata
        </summary>
        <div className="space-y-1 px-3 pb-3 font-mono text-[11px] text-muted-foreground">
          {(
            [
              ["sourceId", str(fm.sourceId)],
              ["instruction_hash", str(fm.instruction_hash)],
              ["goal_hash", str(fm.goal_hash)],
              ["goal_version", str(fm.goal_version)],
              ["learn_schema_version", str(fm.learn_schema_version)],
              ["parse_status", str(fm.parse_status)],
              ["url", str(fm.url)],
              ["createdAt", str(fm.createdAt)],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2 break-all">
                <span className="shrink-0 text-foreground/60">{k}:</span>
                <span>{v}</span>
              </div>
            ))}
        </div>
      </details>
    </div>
  );
}
