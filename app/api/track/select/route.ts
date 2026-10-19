import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { trackSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed = trackSchema.safeParse(await request.json());
    if (!parsed.success) return handleError(parsed.error);
    const { sessionId, trackType } = parsed.data;

    await query(
      `INSERT INTO sessions (id, track_type, created_at, updated_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (id) DO UPDATE SET track_type = EXCLUDED.track_type, updated_at = now()`,
      [sessionId, trackType]
    );
    return NextResponse.json({ sessionId, trackType, status: "selected" }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError("Request body must be valid JSON");
    return handleError(error);
  }
}
