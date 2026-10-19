import { z } from "zod";

export const trackSchema = z.object({
  sessionId: z.string().uuid(),
  trackType: z.enum(["explore", "interests", "known_direction"])
});

export const diagnosticSchema = z.object({
  sessionId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().min(1).max(100),
    answer: z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(100))])
  })).min(1).max(100)
});

export const reflectionSchema = z.object({
  sessionId: z.string().uuid(),
  recommendationId: z.string().uuid().optional(),
  rating: z.enum(["useful", "unsure", "not_useful"]),
  comment: z.string().max(1000).optional()
});
