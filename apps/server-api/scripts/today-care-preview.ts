import {
  CARE_TEST_PASSWORD,
  createTodayCareHarness,
} from '../test/support/today-care-harness';

async function main() {
  const fixture = await createTodayCareHarness();
  await fixture.app.listen(13100, '127.0.0.1');
  console.log(
    JSON.stringify({
      localTestOnly: true,
      username: fixture.owner.username,
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
