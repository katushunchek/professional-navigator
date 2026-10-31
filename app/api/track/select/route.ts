
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { trackSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const sessionIdSchema = z.string().uuid();

// Убираем sessionId из схемы тела запроса.
// Теперь он приходит только через X-Session-ID.
const requestBodySchema = trackSchema.omit({
  sessionId: true,
});

export async function POST(request: NextRequest) {
  try {
    // 1. Получаем идентификатор из заголовка
    const sessionId = request.headers.get("X-Session-ID");

    // 2. Заголовок отсутствует
    if (!sessionId) {
      return NextResponse.json(
        { error: "X-Session-ID header is required" },
        { status: 401 }
      );
    }

    // 3. Проверяем формат UUID
    const sessionCheck = sessionIdSchema.safeParse(sessionId);

    if (!sessionCheck.success) {
      return NextResponse.json(
        { error: "X-Session-ID must be a valid UUID" },
        { status: 400 }
      );
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
      [sessionCheck.data, trackType]
    );

    // 6. Возвращаем 200 OK
    return NextResponse.json(
      {
        sessionId: sessionCheck.data,
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

