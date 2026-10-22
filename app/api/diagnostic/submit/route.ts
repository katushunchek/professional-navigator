
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { pool, query } from "@/lib/db";
import { handleError, jsonError } from "@/lib/http";
import { diagnosticSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const sessionIdSchema = z.string().uuid();

// sessionId теперь передаётся через HTTP-заголовок,
// поэтому убираем его из схемы JSON-запроса.
const requestBodySchema = diagnosticSchema.omit({
  sessionId: true,
});

export async function POST(request: NextRequest) {
  try {
    // 1. Проверяем наличие X-Session-ID
    const sessionId = request.headers.get("X-Session-ID");

    if (!sessionId) {
      return jsonError("X-Session-ID header is required", 401);
    }

    // 2. Проверяем формат UUID
    const sessionCheck = sessionIdSchema.safeParse(sessionId);

    if (!sessionCheck.success) {
      return jsonError("X-Session-ID must be a valid UUID", 400);
    }

    // 3. Валидируем ответы диагностики
    const parsed = requestBodySchema.safeParse(
      await request.json()
    );

    if (!parsed.success) {
      return handleError(parsed.error);
    }

    const { answers } = parsed.data;
    const validSessionId = sessionCheck.data;

    // 4. Проверяем существование сессии
    const session = await query(
      "SELECT id FROM sessions WHERE id = $1",
      [validSessionId]
    );

    if (session.rowCount === 0) {
      return jsonError(
        "Session not found. Select a track first.",
        404
      );
    }

    // 5. Сохраняем диагностику и ответы в транзакции
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO diagnostics (session_id, submitted_at)
         VALUES ($1, now())
         RETURNING id`,
        [validSessionId]
      );

      const diagnosticId = result.rows[0].id as string;

      for (const item of answers) {
        await client.query(
          `INSERT INTO diagnostic_answers
           (diagnostic_id, question_id, answer)
           VALUES ($1, $2, $3::jsonb)`,
          [
            diagnosticId,
            item.questionId,
            JSON.stringify(item.answer),
          ]
        );
      }

      await client.query("COMMIT");

      return NextResponse.json(
        {
          diagnosticId,
          savedAnswers: answers.length,
          status: "submitted",
        },
        { status: 201 }
      );

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;

    } finally {
      client.release();
    }

  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Request body must be valid JSON");
    }

    return handleError(error);
  }
}
