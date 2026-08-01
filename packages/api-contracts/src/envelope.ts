import { z } from 'zod';

export const requestIdSchema = z.string().min(1).max(128);

export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.literal('OK'),
    message: z.string(),
    data,
    requestId: requestIdSchema,
  });

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: requestIdSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});

export interface ApiSuccess<T> {
  code: 'OK';
  message: string;
  data: T;
  requestId: string;
}

export type ApiError = z.infer<typeof apiErrorSchema>;
