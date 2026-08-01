import { z } from 'zod';

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, '必须是有效的 ULID');

export type Ulid = z.infer<typeof ulidSchema>;
