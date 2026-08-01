import { z } from 'zod';

export const realtimeEventTypes = [
  'device.presence.changed',
  'activation.claimed',
  'activation.approved',
  'routine.occurrence.due',
  'care-event.created',
  'family-task.created',
  'family-task.updated',
  'remote-session.invited',
  'remote-session.cancelled',
  'remote-session.accepted',
  'remote-session.ended',
  'remote-session.policy-revoked',
  'consent.revoked',
  'device.revoked',
] as const;

export const realtimeEventTypeSchema = z.enum(realtimeEventTypes);

export const realtimeEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: realtimeEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});

export type RealtimeEventType = z.infer<typeof realtimeEventTypeSchema>;
export type RealtimeEventEnvelope = z.infer<
  typeof realtimeEventEnvelopeSchema
>;
