import { z } from 'zod';

import { ulidSchema } from './identifiers.js';

export const activationChallengeSchema = z.object({
  challengeId: ulidSchema,
  publicId: z.string().min(4).max(32),
  dynamicCode: z.string().min(6).max(16),
  qrPayload: z.string().url().or(z.string().startsWith('memory-lighthouse://')),
  expiresAt: z.string().datetime({ offset: true }),
});

export type ActivationChallenge = z.infer<typeof activationChallengeSchema>;
