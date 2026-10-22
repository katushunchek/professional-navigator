
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";

export const runtime = "nodejs";

// Пока это заглушка: подключение GigaChat будет позже.
export async function POST(request: NextRequest) {
  try {
    const sessionId = request.headers.get("X-Session-ID");

    if (!sessionId) {
      return jsonError("X-Session-ID header is required", 401);
    }

    if (!z.string().uuid().safeParse(sessionId).success) {
      return jsonError("X-Session-ID must be a valid UUID", 400);
    }

    const session = await query(
      "SELECT id FROM sessions WHERE id = $1",
      [sessionId]
    );

    if (session.rowCount === 0) {
      return jsonError("Session not found", 404);
    }

    return NextResponse.json(
      {
        status: "pending",
        sessionId,
        message:
          "Endpoint scaffold is ready. Recommendation generation will be connected to the catalog and GigaChat in week two.",
      },
      { status: 202 }
    );
  } catch (error) {
    return handleError(error);
  }
}
