import {
  CARE_TEST_PASSWORD,
  createTodayCareHarness,
} from '../test/support/today-care-harness';
import { ulid } from 'ulid';
import { seedCareHistory } from '../test/support/care-history-fixture';

async function main() {
  const fixture = await createTodayCareHarness();
  if (process.env.CARE_HISTORY_PREVIEW === 'true') await seedCareHistory(fixture);
  // Preview-only device setup for this synthetic family, not a production grant.
  await fixture.db.recipientMember.createMany({
    data: [fixture.recipientId, fixture.emptyRecipientId].map((recipientId) => ({
      id: ulid(), householdId: fixture.householdId, recipientId,
      householdMemberId: fixture.ownerMemberId, status: 'ACTIVE', accessLevel: 'FULL',
      canActivateDevice: true,
    })),
  });
  await fixture.app.listen(13100, '127.0.0.1');
  console.log(
    JSON.stringify({
      localTestOnly: true,
      username: fixture.owner.username,
      caregiverUsername: fixture.caregiver.username,
      outsiderUsername: fixture.outsider.username,
      password: CARE_TEST_PASSWORD,
      householdId: fixture.householdId,
      recipientId: fixture.recipientId,
      emptyRecipientId: fixture.emptyRecipientId,
      url: 'http://127.0.0.1:13100/openBMB/api/v1',
    }),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await fixture.cleanup();
    process.exit(0);
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
