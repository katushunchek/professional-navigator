
import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { trackSchema } from "@/lib/schemas";
import { readSessionId } from "@/lib/session";

export const runtime = "nodejs";

const requestBodySchema = trackSchema.omit({
  sessionId: true,
});

export async function POST(request: NextRequest) {
  try {
    const header = readSessionId(request);
    if ("error" in header) {
      return header.error;
    }

    // 4. Проверяем тело запроса
    const parsed = requestBodySchema.safeParse(
      await request.json()
    );

    if (!parsed.success) {
      return handleError(parsed.error);
    }

    const { trackType } = parsed.data;

    // 5. Создаём сессию или обновляем существующую
    await query(
      `
      INSERT INTO sessions (
        id,
        track_type,
        created_at,
        updated_at
      )
      VALUES ($1, $2, now(), now())
      ON CONFLICT (id)
      DO UPDATE SET
        track_type = EXCLUDED.track_type,
        updated_at = now()
      `,
      [header.sessionId, trackType]
    );

    return NextResponse.json(
      {
        sessionId: header.sessionId,
        trackType,
        status: "selected"
      },
      { status: 200 }
    );

  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Request body must be valid JSON");
    }

    return handleError(error);
  }
}

