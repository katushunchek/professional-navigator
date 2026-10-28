
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { reflectionSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const sessionIdSchema = z.string().uuid();
const bodySchema = reflectionSchema.omit({ sessionId: true });

export async function POST(request: NextRequest) {
  try {
    const sessionId = request.headers.get("X-Session-ID");

    if (!sessionId) {
      return jsonError("X-Session-ID header is required", 401);
    }

    const sessionCheck = sessionIdSchema.safeParse(sessionId);

    if (!sessionCheck.success) {
      return jsonError("X-Session-ID must be a valid UUID", 400);
    }

    const parsed = bodySchema.safeParse(await request.json());

    if (!parsed.success) {
      return handleError(parsed.error);
    }

    const { recommendationId, rating, comment } = parsed.data;
    const validSessionId = sessionCheck.data;

    const session = await query(
      "SELECT id FROM sessions WHERE id = $1",
      [validSessionId]
    );

    if (session.rowCount === 0) {
      return jsonError("Session not found", 404);
    }

    // Рекомендация должна принадлежать текущей сессии.
    if (recommendationId) {
      const recommendation = await query(
        `SELECT id
         FROM recommendations
         WHERE id = $1 AND session_id = $2`,
        [recommendationId, validSessionId]
      );

      if (recommendation.rowCount === 0) {
        return jsonError("Recommendation not found for this session", 404);
      }
    }

    const result = await query(
      `INSERT INTO reflections
       (session_id, recommendation_id, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id, created_at`,
      [
        validSessionId,
        recommendationId ?? null,
        rating,
        comment ?? null,
      ]
    );

    return NextResponse.json(
      {
        ...result.rows[0],
        status: "saved",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Request body must be valid JSON");
    }

    return handleError(error);
  }
}
