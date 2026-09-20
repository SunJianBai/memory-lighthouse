import { ulid } from 'ulid';
import { CARE_WORKFLOW_CONTENT_CIPHER } from '../../src/modules/care-workflow/care-workflow.constants';
import type { CareWorkflowContentCipher } from '../../src/modules/care-workflow/ports/content-cipher.port';
import type { createTodayCareHarness } from './today-care-harness';

/** Synthetic history inside the explicitly isolated iteration database only. */
export async function seedCareHistory(
  fixture: Awaited<ReturnType<typeof createTodayCareHarness>>,
) {
  const cipher = fixture.app.get<CareWorkflowContentCipher>(
    CARE_WORKFLOW_CONTENT_CIPHER,
  );
  const eventIds: string[] = [];
  // Equal timestamps exercise the ID tie breaker; two rows sit outside the date window.
  for (let index = 0; index < 67; index++) {
    const id = ulid();
    const content = cipher.encrypt(
      JSON.stringify([`历史记录 ${index + 1}`, '隔离测试记录']),
    );
    if (index < 65) eventIds.push(id);
    await fixture.db.careEvent.create({
      data: {
        id,
        householdId: fixture.householdId,
        recipientId: fixture.recipientId,
        type: 'ROUTINE_CONFIRMED',
        severity: 'INFO',
        sourceType: 'FAMILY',
        titleCiphertext: new Uint8Array(content.ciphertext),
        summaryCiphertext: new Uint8Array(),
        contentNonce: new Uint8Array(content.nonce),
        encryptionKeyId: content.encryptionKeyId,
        dedupeKey: `history-${id}`,
        occurredAt: new Date(
          index < 65
            ? '2026-08-31T16:00:00Z'
            : index === 65
              ? '2026-08-31T15:59:59.999Z'
              : '2026-09-01T16:00:00Z',
        ),
      },
    });
  }
  const oldOccurrenceId = ulid();
  await fixture.db.routineOccurrence.create({
    data: {
      id: oldOccurrenceId,
      householdId: fixture.householdId,
      recipientId: fixture.recipientId,
      routineId: fixture.review.routineId,
      scheduleId: fixture.review.scheduleId,
      status: 'NEEDS_FAMILY_REVIEW',
      scheduledAtUtc: new Date('2026-08-31T16:00:00Z'),
      scheduledLocalDate: new Date('2026-09-01T00:00:00Z'),
    },
  });
  return { eventIds, oldOccurrenceId };
}
