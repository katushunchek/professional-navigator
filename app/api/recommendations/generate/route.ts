import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";

export const runtime = "nodejs";

// Week-one safe stub: persists a placeholder record; AI generation is added in week two.
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("sessionId" in body) || typeof body.sessionId !== "string") {
      return jsonError("sessionId is required");
    }
    const sessionId = body.sessionId;
    const session = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (session.rowCount === 0) return jsonError("Session not found", 404);
    return NextResponse.json({
      status: "pending",
      sessionId,
      message: "Endpoint scaffold is ready. Recommendation generation will be connected to the catalog and GigaChat in week two."
    }, { status: 202 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError("Request body must be valid JSON");
    return handleError(error);
  }
}
