import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiUpgradeRoute } from './api-upgrade-route.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const settled = {
  mode: 'hybrid', pending: 'no', upstream: '127.0.0.1:13101',
  currentApp: 'git-aaaaaaaaaaaa', currentApi: 'git-bbbbbbbbbbbb',
  migrationsDigest: digest, securityEpoch: '2',
};
test('identical Prisma tree and security epoch select fast deployment', () => {
  assert.equal(apiUpgradeRoute(digest, '2', settled), 'fast');
});
test('Prisma change or newer security boundary selects the full upgrade', () => {
  assert.equal(apiUpgradeRoute(`sha256:${'b'.repeat(64)}`, '2', settled), 'upgrade');
  assert.equal(apiUpgradeRoute(digest, '3', settled), 'upgrade');
});
test('bad or pending state is rejected, never routed to upgrade', () => {
  for (const state of [null, {}, { ...settled, pending: 'yes' },
    { ...settled, mode: 'docker' }, { ...settled, upstream: '127.0.0.1:13100' },
    { ...settled, currentApp: '../unknown' }, { ...settled, currentApi: 'none' },
    { ...settled, migrationsDigest: '' }, { ...settled, securityEpoch: '0' }]) {
    assert.throws(() => apiUpgradeRoute(digest, '2', state));
  }
});
test('invalid candidate or security downgrade fails closed', () => {
  assert.throws(() => apiUpgradeRoute(digest, '1', settled), /downgrade/);
  assert.throws(() => apiUpgradeRoute('bad', '2', settled));
  assert.throws(() => apiUpgradeRoute(digest, '02', settled));
});

test('router accepts the real artifact-tool tree-digest contract', () => {
  const root = new URL('../../', import.meta.url);
  const actual = execFileSync(process.execPath, [
    fileURLToPath(new URL('infra/production/hybrid/api/artifact-tool.mjs', root)),
    'tree-digest', '--root', fileURLToPath(new URL('apps/server-api/prisma', root)),
  ], { encoding: 'utf8' }).trim();
  assert.match(actual, /^sha256:[0-9a-f]{64}$/);
  assert.equal(apiUpgradeRoute(actual, '2', { ...settled, migrationsDigest: actual }), 'fast');
  assert.throws(() => apiUpgradeRoute(actual.slice(7), '2', settled));
});
