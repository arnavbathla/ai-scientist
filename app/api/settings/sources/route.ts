import { NextResponse } from "next/server";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { SOURCE_REGISTRY, DEFAULT_SOURCE_CONFIG } from "@/lib/sources";

export const dynamic = "force-dynamic";

/**
 * Source configuration is held per-run (in ResearchRun.sourceConfig). This
 * endpoint reports the global registry + defaults that the new-run form
 * will start from.
 */
export const GET = withApiErrors(async () => {
  await requireUserId();
  const sources = Object.entries(SOURCE_REGISTRY).map(([id, def]) => ({
    id,
    label: def.label,
    description: def.description,
    defaultEnabled: DEFAULT_SOURCE_CONFIG[id as keyof typeof DEFAULT_SOURCE_CONFIG]?.enabled ?? false,
    defaultMaxResults:
      DEFAULT_SOURCE_CONFIG[id as keyof typeof DEFAULT_SOURCE_CONFIG]?.maxResults ?? 10,
  }));
  return NextResponse.json({ sources });
});

export const PATCH = withApiErrors(async () => {
  await requireUserId();
  return NextResponse.json({
    ok: true,
    message: "Source configuration is set per run when you create one — defaults are read-only here.",
  });
});
