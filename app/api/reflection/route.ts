import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { reflectionSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed = reflectionSchema.safeParse(await request.json());
    if (!parsed.success) return handleError(parsed.error);
    const { sessionId, recommendationId, rating, comment } = parsed.data;
    const session = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (session.rowCount === 0) return jsonError("Session not found", 404);
    const result = await query(
      `INSERT INTO reflections (session_id, recommendation_id, rating, comment, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id, created_at`,
      [sessionId, recommendationId ?? null, rating, comment ?? null]
    );
    return NextResponse.json({ ...result.rows[0], status: "saved" }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError("Request body must be valid JSON");
    return handleError(error);
  }
}
