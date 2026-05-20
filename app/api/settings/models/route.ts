import { NextResponse } from "next/server";
import { requireUserId, withApiErrors } from "@/lib/auth/session";
import { ModelRouter } from "@/lib/models/router";

export const dynamic = "force-dynamic";

/**
 * Settings — Models.
 *
 * Today the model layer is fully driven by env (`ANTHROPIC_API_KEY`,
 * `ANTHROPIC_MODEL`). PATCH is intentionally a no-op that surfaces guidance to
 * the user, because writing API keys to the database would be a regression in
 * security.
 */
export const GET = withApiErrors(async () => {
  await requireUserId();
  return NextResponse.json({
    providers: {
      anthropic: {
        label: "Anthropic",
        configured: ModelRouter.status().anthropic.configured,
        model: ModelRouter.status().anthropic.model,
        purposes: [
          "supervisorPlanning",
          "literatureSynthesis",
          "hypothesisGeneration",
          "hypothesisCritique",
          "claimVerification",
          "debateJudge",
          "hypothesisEvolution",
          "completionAssessment",
          "finalReport",
        ],
      },
    },
  });
});

export const PATCH = withApiErrors(async () => {
  await requireUserId();
  return NextResponse.json(
    {
      ok: true,
      message:
        "Model provider configuration is read from environment variables (.env). Restart the worker after changing them.",
    },
    { status: 200 },
  );
});
