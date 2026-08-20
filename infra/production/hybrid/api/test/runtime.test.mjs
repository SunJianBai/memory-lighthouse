import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  NATIVE_API_SOURCE_KEYS,
  computeTreeDigest,
  createManifest,
  deriveApiEnvironment,
  inspectTarGzip,
  parseRawEnv,
  serializeRawEnvironment,
  verifyReleaseTree,
  verifySha256Sidecar,
} from '../runtime-lib.mjs';

const sourceSha = '0123456789abcdef0123456789abcdef01234567';
const migrationsDigest = `sha256:${'a'.repeat(64)}`;

async function fixture() {
  return mkdtemp(join(tmpdir(), 'openbmb-native-api-test-'));
}

function writeField(block, offset, length, value) {
  const data = Buffer.from(value);
  data.copy(block, offset, 0, Math.min(data.length, length));
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function tarEntry(path, data = Buffer.alloc(0), type = '0') {
  const block = Buffer.alloc(512);
  writeField(block, 0, 100, path);
  writeField(block, 100, 8, octal(type === '5' ? 0o755 : 0o644, 8));
  writeField(block, 108, 8, octal(0, 8));
  writeField(block, 116, 8, octal(0, 8));
  writeField(block, 124, 12, octal(data.length, 12));
  writeField(block, 136, 12, octal(0, 12));
  block.fill(0x20, 148, 156);
  block[156] = type.charCodeAt(0);
  writeField(block, 257, 6, 'ustar\0');
  writeField(block, 263, 2, '00');
  let checksum = 0;
  for (const byte of block) checksum += byte;
  writeField(block, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([block, data, padding]);
}

function tar(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const next = Buffer.byteLength(body) + String(length).length + 1;
    if (next === length) return Buffer.from(`${length} ${body}`);
    length = next;
  }
}

test('raw env parsing and derived environment match the production Compose model', () => {
  const infra = parseRawEnv(`
OPENBMB_DOMAIN=sun227454.online
MYSQL_USER=openbmb
MYSQL_PASSWORD=abcdefghijklmnopqrstuvwxyz_123456
MYSQL_DATABASE=openbmb
REDIS_APP_PASSWORD=abcdefghijklmnopqrstuvwxyz_654321
REDIS_LIVEKIT_PASSWORD=livekit_redis_root_must_not_leak
MINIO_APP_SECRET_KEY=abcdefghijklmnopqrstuvwxyz_111111
MINIO_ROOT_USER=openbmb-root
MINIO_ROOT_PASSWORD=minio_root_must_not_leak
MINIO_KMS_SECRET_KEY=key-name:kms_material_must_not_leak
LIVEKIT_API_SECRET=abcdefghijklmnopqrstuvwxyz_222222
MYSQL_ROOT_PASSWORD=must_not_leak_123456789
`);
  const api = parseRawEnv(`
SMTP_HOST=smtp.qq.com
AUTH_ACCESS_TOKEN_SECRET=api-secret
MINICPM_MODEL=openbmb/MiniCPM-o-4_5
MINICPM_SYSTEM_PROMPT=已审核的生产提示词
`);
  const environment = deriveApiEnvironment(infra, api, 'green');
  assert.equal(environment.PORT, '13102');
  assert.equal(environment.HOST, '127.0.0.1');
  assert.equal(environment.PUBLIC_APP_URL, 'https://sun227454.online/openBMB');
  assert.equal(environment.OBJECT_STORAGE_ENDPOINT, 'https://sun227454.online');
  assert.match(environment.DATABASE_URL, /@127\.0\.0\.1:13306\/openbmb$/);
  assert.equal(environment.SMTP_HOST, 'smtp.qq.com');
  assert.equal(environment.MINICPM_MODEL, 'openbmb/MiniCPM-o-4_5');
  assert.equal(environment.MINICPM_SYSTEM_PROMPT, '已审核的生产提示词');
  assert.equal(environment.MYSQL_ROOT_PASSWORD, undefined);
  assert.equal(environment.REDIS_LIVEKIT_PASSWORD, undefined);
  assert.equal(environment.MINIO_ROOT_PASSWORD, undefined);
  assert.equal(environment.MINIO_KMS_SECRET_KEY, undefined);
  assert.equal(environment.ENABLE_DEVELOPMENT_CONTENT_INSPECTION, 'false');
  const rendered = serializeRawEnvironment(environment);
  for (const forbidden of [
    'MYSQL_ROOT_PASSWORD',
    'MYSQL_PASSWORD',
    'REDIS_APP_PASSWORD',
    'REDIS_LIVEKIT_PASSWORD',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'MINIO_KMS_SECRET_KEY',
    'MINIO_APP_SECRET_KEY',
  ]) {
    assert.doesNotMatch(rendered, new RegExp(`^${forbidden}=`, 'm'));
  }
  assert.doesNotMatch(rendered, /must_not_leak|kms_material/);
});

test('native environment rejects unreviewed api.env keys and MinIO root identity reuse', () => {
  const infra = parseRawEnv(`
OPENBMB_DOMAIN=sun227454.online
MYSQL_PASSWORD=abcdefghijklmnopqrstuvwxyz_123456
REDIS_APP_PASSWORD=abcdefghijklmnopqrstuvwxyz_654321
MINIO_APP_SECRET_KEY=abcdefghijklmnopqrstuvwxyz_111111
MINIO_ROOT_USER=openbmb-root
MINIO_APP_ACCESS_KEY=openbmb-api
LIVEKIT_API_SECRET=abcdefghijklmnopqrstuvwxyz_222222
`);
  assert.throws(
    () => deriveApiEnvironment(infra, { MYSQL_ROOT_PASSWORD: 'forbidden' }, 'blue'),
    /not approved/,
  );
  assert.throws(
    () =>
      deriveApiEnvironment(
        { ...infra, MINIO_APP_ACCESS_KEY: 'openbmb-root' },
        { SMTP_HOST: 'smtp.qq.com' },
        'blue',
      ),
    /must not reuse/,
  );
  for (const [applicationKey, privilegedKey] of [
    ['MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD'],
    ['REDIS_APP_PASSWORD', 'REDIS_LIVEKIT_PASSWORD'],
    ['MINIO_APP_SECRET_KEY', 'MINIO_ROOT_PASSWORD'],
  ]) {
    assert.throws(
      () =>
        deriveApiEnvironment(
          { ...infra, [privilegedKey]: infra[applicationKey] },
          { SMTP_HOST: 'smtp.qq.com' },
          'blue',
        ),
      new RegExp(`${applicationKey} must not reuse ${privilegedKey}`),
    );
  }
});

test('native source allowlist exactly tracks api.env and excludes infrastructure root keys', async () => {
  const example = parseRawEnv(
    await readFile(new URL('../../../env/api.env.example', import.meta.url), 'utf8'),
    'api.env.example',
  );
  assert.deepEqual(
    [...NATIVE_API_SOURCE_KEYS].sort(),
    Object.keys(example).sort(),
    'every api.env setting must receive an explicit native-runtime review',
  );
  for (const forbidden of [
    'MYSQL_ROOT_PASSWORD',
    'REDIS_LIVEKIT_PASSWORD',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'MINIO_KMS_SECRET_KEY',
  ]) {
    assert.equal(NATIVE_API_SOURCE_KEYS.includes(forbidden), false);
  }
});

test('raw env rejects duplicates and shell-like non-assignments', () => {
  assert.throws(() => parseRawEnv('A=one\nA=two\n'), /more than once/);
  assert.throws(() => parseRawEnv('export A=one\n'), /not a raw KEY=VALUE/);
});

test('manifest verifies the exact payload and detects mutation', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'apps/server-api/dist'), { recursive: true });
    await mkdir(join(root, 'node_modules/example'), { recursive: true });
    await mkdir(join(root, 'node_modules/example-thing'), { recursive: true });
    await writeFile(join(root, 'apps/server-api/dist/main.js'), 'console.log("ok")\n');
    await writeFile(join(root, 'apps/server-api/package.json'), '{"type":"commonjs"}\n');
    await writeFile(join(root, 'node_modules/example/index.js'), 'module.exports = 1\n');
    await writeFile(join(root, 'node_modules/example/LICENSE'), 'fixture license\n');
    await writeFile(join(root, 'node_modules/example-thing/index.js'), 'module.exports = 2\n');
    const manifest = await createManifest(root, {
      sourceSha,
      releaseId: `git-${sourceSha.slice(0, 12)}`,
      nodeVersion: '22.19.0',
      securityEpoch: 1,
      migrationsDigest,
    });
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.equal((await verifyReleaseTree(root)).sourceSha, sourceSha);
    await writeFile(join(root, 'apps/server-api/dist/main.js'), 'tampered\n');
    await assert.rejects(verifyReleaseTree(root), /size mismatch|digest mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migration digest is deterministic and content-sensitive', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, '20260801_init'), { recursive: true });
    await writeFile(join(root, 'migration_lock.toml'), 'provider = "mysql"\n');
    await writeFile(join(root, '20260801_init/migration.sql'), 'SELECT 1;\n');
    const first = await computeTreeDigest(root);
    const second = await computeTreeDigest(root);
    assert.equal(first, second);
    await writeFile(join(root, '20260801_init/migration.sql'), 'SELECT 2;\n');
    assert.notEqual(await computeTreeDigest(root), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('streaming tar validator accepts regular payload and strict sidecar', async () => {
  const root = await fixture();
  try {
    const archive = join(root, 'api.tar.gz');
    const content = gzipSync(
      tar([
        tarEntry('payload/', Buffer.alloc(0), '5'),
        tarEntry('payload/manifest.json', Buffer.from('{}\n')),
      ]),
    );
    await writeFile(archive, content);
    const digest = createHash('sha256').update(content).digest('hex');
    const sidecar = `${archive}.sha256`;
    await writeFile(sidecar, `${digest}  ${basename(archive)}\n`);
    assert.equal((await inspectTarGzip(archive)).entries, 2);
    assert.equal(await verifySha256Sidecar(archive, sidecar), digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('streaming tar validator rejects traversal and links before extraction', async () => {
  const root = await fixture();
  try {
    const traversal = join(root, 'traversal.tar.gz');
    await writeFile(
      traversal,
      gzipSync(tar([tarEntry('payload/../etc/passwd', Buffer.from('bad'))])),
    );
    await assert.rejects(inspectTarGzip(traversal), /not canonical/);

    const link = join(root, 'link.tar.gz');
    await writeFile(link, gzipSync(tar([tarEntry('payload/link', Buffer.alloc(0), '2')])));
    await assert.rejects(inspectTarGzip(link), /entry type.*forbidden/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('streaming tar validator applies a bounded POSIX PAX path', async () => {
  const root = await fixture();
  try {
    const archive = join(root, 'pax.tar.gz');
    const longPath = `payload/node_modules/example/${'nested/'.repeat(16)}index.js`;
    const pax = paxRecord('path', longPath);
    await writeFile(
      archive,
      gzipSync(
        tar([
          tarEntry('PaxHeaders/index.js', pax, 'x'),
          tarEntry('payload/node_modules/example/index.js', Buffer.from('ok\n')),
        ]),
      ),
    );
    assert.equal((await inspectTarGzip(archive)).entries, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
