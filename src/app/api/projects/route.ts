import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createProject,
  listProjects,
  getProject,
  updateProjectGoal,
  updateProjectSettings,
} from "@/lib/db/queries";
import { DEFAULT_MODEL_USAGE_POLICY, DEFAULT_TRANSCRIPT_LANGUAGE } from "@/lib/settings";

export const runtime = "nodejs";

/** GET /api/projects → all projects (newest active first). */
export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

const ModelUsagePolicy = z.enum([
  "local_only",
  "confirm_paid_each_time",
  "paid_allowed_for_manual_actions",
]);

const TranscriptLanguage = z.string().regex(/^[a-z]{0,5}$/);

const SettingsSchema = z
  .object({
    modelUsagePolicy: ModelUsagePolicy.default(DEFAULT_MODEL_USAGE_POLICY),
    transcriptLanguage: TranscriptLanguage.default(DEFAULT_TRANSCRIPT_LANGUAGE),
    learnInstructions: z.string().max(20_000).default(""),
  })
  .default({
    modelUsagePolicy: DEFAULT_MODEL_USAGE_POLICY,
    transcriptLanguage: DEFAULT_TRANSCRIPT_LANGUAGE,
    learnInstructions: "",
  });

// Name + Goal + Model usage are the only creation-time inputs. Goal must be
// specific enough to actually steer distillation, hence the 40-char floor.
const CreateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  goal: z.string().trim().min(40).max(5000),
  settings: SettingsSchema,
});

/** POST /api/projects → create a project with a goal + model-usage policy. */
export async function POST(request: NextRequest) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide { title (≥2), goal (≥40), settings.modelUsagePolicy }." },
      { status: 400 },
    );
  }
  const { id } = await createProject(parsed.data);
  return NextResponse.json({ project: getProject(id) }, { status: 201 });
}

const PatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(2).max(200).optional(),
  goal: z.string().trim().min(40).max(5000).optional(),
  settings: z
    .object({
      modelUsagePolicy: ModelUsagePolicy.optional(),
      transcriptLanguage: TranscriptLanguage.optional(),
      learnInstructions: z.string().max(20_000).optional(),
    })
    .optional(),
});

/** PATCH /api/projects → edit a project's title/goal/settings. */
export async function PATCH(request: NextRequest) {
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });
  const { id, settings, ...patch } = parsed.data;
  if (!getProject(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (patch.title !== undefined || patch.goal !== undefined) updateProjectGoal(id, patch);
  if (settings) updateProjectSettings(id, settings);
  return NextResponse.json({ project: getProject(id) });
}
