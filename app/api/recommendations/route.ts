import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { requireExistingSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireExistingSession(request);
    if ("error" in session) {
      return session.error;
    }

    const saved = await query(
      `SELECT
         id,
         session_id,
         summary,
         hypotheses,
         trial_ids,
         next_step,
         pathways,
         model_name,
         created_at
       FROM recommendations
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.sessionId]
    );

    if (saved.rowCount === 0) {
      return jsonError("Recommendation not found for this session", 404);
    }

    const row = saved.rows[0];
    const trialIds = (row.trial_ids as string[]) ?? [];
    const trials =
      trialIds.length === 0
        ? []
        : (
            await query(
              `SELECT
                 id,
                 title,
                 LEFT(COALESCE(description, ''), 220) AS description,
                 format,
                 duration_minutes,
                 municipality,
                 cost,
                 profession_id,
                 source_url
               FROM professional_trials
               WHERE id = ANY($1::uuid[])`,
              [trialIds]
            )
          ).rows;

    return NextResponse.json({
      status: "saved",
      recommendationId: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      hypotheses: row.hypotheses,
      trials,
      nextStep: row.next_step,
      nextStepOptions: row.pathways,
      model: row.model_name,
      createdAt: row.created_at,
    });
  } catch (error) {
    return handleError(error);
  }
}
