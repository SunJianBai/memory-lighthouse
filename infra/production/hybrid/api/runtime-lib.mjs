import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { createGunzip } from 'node:zlib';
import { TextDecoder } from 'node:util';

export const NODE_VERSION = '22.19.0';
export const RELEASE_ID_PATTERN = /^git-([0-9a-f]{12})$/;
export const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const SLOT_PORTS = Object.freeze({ blue: 13101, green: 13102 });

const MAX_ARCHIVE_BYTES = 768 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200_000;
const MAX_PAX_BYTES = 64 * 1024;
const ZERO_BLOCK = Buffer.alloc(512);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// This is the complete reviewed surface that may flow from api.env into the
// native runtime. Unknown keys fail closed so adding a new application setting
// requires an explicit least-privilege review instead of silently exposing a
// newly added infrastructure credential.
export const NATIVE_API_SOURCE_KEYS = Object.freeze([
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_REQUIRE_TLS',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM_NAME',
  'SMTP_FROM_ADDRESS',
  'SMTP_CONNECTION_TIMEOUT_MS',
  'SMTP_GREETING_TIMEOUT_MS',
  'SMTP_SOCKET_TIMEOUT_MS',
  'AUTH_ACCESS_TOKEN_SECRET',
  'AUTH_ADMIN_ACCESS_TOKEN_SECRET',
  'AUTH_REFRESH_TOKEN_PEPPER',
  'AUTH_ONE_TIME_TOKEN_PEPPER',
  'HOUSEHOLD_INVITATION_TOKEN_PEPPER',
  'RATE_LIMIT_KEY_SECRET',
  'DEVICE_ACTIVATION_PEPPER',
  'DEVICE_CREDENTIAL_PEPPER',
  'DEVICE_ACCESS_TOKEN_SECRET',
  'DATA_ENCRYPTION_KEY_BASE64',
  'DATA_ENCRYPTION_KEY_ID',
  'CARE_WORKFLOW_ENCRYPTION_KEY',
  'AUTH_ACCESS_TOKEN_TTL_SECONDS',
  'AUTH_ADMIN_ACCESS_TOKEN_TTL_SECONDS',
  'AUTH_REFRESH_TOKEN_TTL_SECONDS',
  'AUTH_EMAIL_VERIFICATION_TTL_SECONDS',
  'AUTH_PASSWORD_RESET_TTL_SECONDS',
  'HOUSEHOLD_INVITATION_TTL_SECONDS',
  'DEVICE_ACCESS_TOKEN_TTL_SECONDS',
  'DEVICE_ACTIVATION_CHALLENGE_TTL_SECONDS',
  'DEVICE_ACTIVATION_MAX_ATTEMPTS',
  'DEVICE_CREDENTIAL_TTL_SECONDS',
  'RATE_LIMIT_REDIS_PREFIX',
  'RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS',
  'CARE_WORKFLOW_SCHEDULER_ENABLED',
  'CARE_WORKFLOW_SCHEDULER_INTERVAL_MS',
  'CARE_WORKFLOW_GENERATION_HORIZON_HOURS',
  'TRANSCRIPT_RETENTION_DAYS',
  'TRANSCRIPT_PURGE_ENABLED',
  'TRANSCRIPT_PURGE_INTERVAL_MS',
  'TRANSCRIPT_PURGE_BATCH_SIZE',
  'ASSET_LIFECYCLE_WORKER_ENABLED',
  'ASSET_LIFECYCLE_INTERVAL_MS',
  'ASSET_LIFECYCLE_CONCURRENCY',
  'ASSET_LIFECYCLE_BATCH_SIZE',
  'ASSET_LIFECYCLE_RECOVERY_BATCH_SIZE',
  'ASSET_LIFECYCLE_LEASE_MS',
  'ASSET_LIFECYCLE_RETRY_BASE_MS',
  'ASSET_LIFECYCLE_RETRY_MAX_MS',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'CLAMAV_SCAN_TIMEOUT_MS',
  'DEVICE_ONLINE_THRESHOLD_SECONDS',
  'REMOTE_SESSION_EXPIRY_ENABLED',
  'REMOTE_SESSION_EXPIRY_INTERVAL_MS',
  'REMOTE_RING_TIMEOUT_SECONDS',
  'REMOTE_CONNECT_TIMEOUT_SECONDS',
  'MINICPM_PROVIDER',
  'MINICPM_MODEL',
  'MINICPM_REALTIME_URL',
  'MINICPM_SYSTEM_PROMPT',
  'WEATHER_LOCATION_NAME',
  'WEATHER_LOCATION_QUERY',
  'WEATHER_LOCATION_LATITUDE',
  'WEATHER_LOCATION_LONGITUDE',
  'WEATHER_REQUEST_TIMEOUT_MS',
  'WEATHER_CACHE_TTL_SECONDS',
  'WEATHER_STALE_TTL_SECONDS',
  'ENABLE_DEVELOPMENT_CONTENT_INSPECTION',
]);
const NATIVE_API_SOURCE_KEY_SET = new Set(NATIVE_API_SOURCE_KEYS);

function fail(message) {
  throw new Error(message);
}

export function parseRawEnv(text, label = 'environment') {
  if (text.includes('\0')) fail(`${label} contains a NUL byte`);
  const result = Object.create(null);
  const lines = text.split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r')
      ? lines[index].slice(0, -1)
      : lines[index];
    if (/^\s*(?:#|$)/.test(line)) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) fail(`${label}:${index + 1} is not a raw KEY=VALUE entry`);
    const [, key, value] = match;
    if (Object.hasOwn(result, key)) fail(`${label} defines ${key} more than once`);
    if (/[\r\n]/.test(value)) fail(`${label}:${index + 1} contains a newline`);
    result[key] = value;
  }
  return result;
}

export function readSecureEnvFile(path, options = {}) {
  const expectedUid = options.expectedUid ?? 0;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${path} must be a regular, non-symlink file`);
  }
  if (metadata.uid !== expectedUid) fail(`${path} must be owned by UID ${expectedUid}`);
  if ((metadata.mode & 0o027) !== 0) {
    fail(`${path} must not be writable by group or accessible by other users`);
  }
  return parseRawEnv(readFileSync(path, 'utf8'), path);
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== 'string' || value.length === 0) fail(`${key} is required`);
  return value;
}

function valueOr(values, key, fallback) {
  return values[key] === undefined || values[key] === '' ? fallback : values[key];
}

function rejectCredentialReuse(values, applicationValue, privilegedKey, applicationKey) {
  if (values[privilegedKey] && applicationValue === values[privilegedKey]) {
    fail(`${applicationKey} must not reuse ${privilegedKey}`);
  }
}

function simpleName(value, key) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    fail(`${key} contains characters that are unsafe in a derived connection value`);
  }
  return value;
}

function base64UrlSecret(value, key) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(value)) {
    fail(`${key} must use the production base64url-compatible format`);
  }
  return value;
}

function port(value, key) {
  if (!/^[0-9]+$/.test(value)) fail(`${key} must be a decimal TCP port`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    fail(`${key} must be between 1 and 65535`);
  }
  return String(parsed);
}

function domain(value) {
  if (
    value.length > 253 ||
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
      value,
    )
  ) {
    fail('OPENBMB_DOMAIN must be a DNS hostname');
  }
  return value.toLowerCase();
}

export function deriveApiEnvironment(infra, api, slot) {
  const applicationPort = SLOT_PORTS[slot];
  if (!applicationPort) fail(`slot must be one of: ${Object.keys(SLOT_PORTS).join(', ')}`);

  const host = domain(valueOr(infra, 'OPENBMB_DOMAIN', 'sun227454.online'));
  const mysqlUser = simpleName(valueOr(infra, 'MYSQL_USER', 'openbmb'), 'MYSQL_USER');
  const mysqlDatabase = simpleName(
    valueOr(infra, 'MYSQL_DATABASE', 'openbmb'),
    'MYSQL_DATABASE',
  );
  const mysqlPassword = base64UrlSecret(required(infra, 'MYSQL_PASSWORD'), 'MYSQL_PASSWORD');
  const redisPassword = base64UrlSecret(
    required(infra, 'REDIS_APP_PASSWORD'),
    'REDIS_APP_PASSWORD',
  );
  const minioSecret = base64UrlSecret(
    required(infra, 'MINIO_APP_SECRET_KEY'),
    'MINIO_APP_SECRET_KEY',
  );
  const livekitSecret = base64UrlSecret(
    required(infra, 'LIVEKIT_API_SECRET'),
    'LIVEKIT_API_SECRET',
  );
  rejectCredentialReuse(infra, mysqlPassword, 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD');
  rejectCredentialReuse(
    infra,
    redisPassword,
    'REDIS_LIVEKIT_PASSWORD',
    'REDIS_APP_PASSWORD',
  );
  rejectCredentialReuse(
    infra,
    minioSecret,
    'MINIO_ROOT_PASSWORD',
    'MINIO_APP_SECRET_KEY',
  );

  const environment = Object.create(null);
  for (const [key, value] of Object.entries(api)) {
    if (!NATIVE_API_SOURCE_KEY_SET.has(key)) {
      fail(`api.env key is not approved for the native runtime: ${key}`);
    }
    environment[key] = value;
  }
  // Infrastructure root credentials are read only to derive the same narrow
  // application values Compose injects; raw infrastructure keys never enter
  // the child process environment.
  const minioAccessKey = simpleName(
    valueOr(infra, 'MINIO_APP_ACCESS_KEY', 'openbmb-api'),
    'MINIO_APP_ACCESS_KEY',
  );
  if (infra.MINIO_ROOT_USER && minioAccessKey === infra.MINIO_ROOT_USER) {
    fail('MINIO_APP_ACCESS_KEY must not reuse MINIO_ROOT_USER');
  }
  Object.assign(environment, {
    NODE_ENV: 'production',
    NODE_OPTIONS: '--max-old-space-size=320',
    HOST: '127.0.0.1',
    PORT: String(applicationPort),
    CORS_ORIGINS: `https://${host}`,
    PUBLIC_APP_URL: `https://${host}/openBMB`,
    MAIL_DELIVERY_MODE: 'smtp',
    DATABASE_URL: `mysql://${mysqlUser}:${mysqlPassword}@127.0.0.1:${port(
      valueOr(infra, 'MYSQL_HOST_PORT', '13306'),
      'MYSQL_HOST_PORT',
    )}/${mysqlDatabase}`,
    REDIS_URL: `redis://openbmb-api:${redisPassword}@127.0.0.1:${port(
      valueOr(infra, 'REDIS_HOST_PORT', '16379'),
      'REDIS_HOST_PORT',
    )}/0`,
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: port(valueOr(infra, 'CLAMAV_HOST_PORT', '13310'), 'CLAMAV_HOST_PORT'),
    OBJECT_STORAGE_ENDPOINT: `https://${host}`,
    OBJECT_STORAGE_REGION: valueOr(infra, 'OBJECT_STORAGE_REGION', 'us-east-1'),
    OBJECT_STORAGE_BUCKET: simpleName(
      valueOr(infra, 'MINIO_BUCKET', 'openbmb-assets'),
      'MINIO_BUCKET',
    ),
    OBJECT_STORAGE_ACCESS_KEY_ID: minioAccessKey,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: minioSecret,
    OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    LIVEKIT_URL: `ws://127.0.0.1:${port(
      valueOr(infra, 'LIVEKIT_SIGNAL_HOST_PORT', '17880'),
      'LIVEKIT_SIGNAL_HOST_PORT',
    )}`,
    LIVEKIT_PUBLIC_URL: `wss://${host}`,
    LIVEKIT_API_KEY: simpleName(
      valueOr(infra, 'LIVEKIT_API_KEY', 'openbmb_api'),
      'LIVEKIT_API_KEY',
    ),
    LIVEKIT_API_SECRET: livekitSecret,
    RATE_LIMIT_TRUST_PROXY_HOPS: '1',
    ENABLE_DEVELOPMENT_CONTENT_INSPECTION: 'false',
  });
  return environment;
}

export function serializeRawEnvironment(environment) {
  const lines = [];
  const keys = Object.keys(environment).sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  for (const key of keys) {
    const value = environment[key];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(`unsafe environment key: ${key}`);
    if (typeof value !== 'string' || /[\0\r\n]/.test(value)) {
      fail(`unsafe environment value: ${key}`);
    }
    lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function safeRelativePath(path, label = 'path') {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 4096 ||
    path.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.startsWith('/')
  ) {
    fail(`${label} is not a safe relative POSIX path`);
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized === '.' || normalized.startsWith('../')) {
    fail(`${label} is not canonical: ${path}`);
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      fail(`${label} contains an unsafe segment: ${path}`);
    }
  }
  return path;
}

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  const stop = end === -1 || end > start + length ? start + length : end;
  try {
    return UTF8_DECODER.decode(block.subarray(start, stop));
  } catch {
    fail('tar header contains invalid UTF-8');
  }
}

function tarNumber(block, start, length, label) {
  const field = block.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) fail(`${label} uses unsupported base-256 encoding`);
  const text = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) fail(`${label} is not an octal tar number`);
  const parsed = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`${label} is out of range`);
  return parsed;
}

function verifyTarChecksum(block) {
  const stored = tarNumber(block, 148, 8, 'tar checksum');
  let sum = 0;
  for (let index = 0; index < 512; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : block[index];
  }
  if (sum !== stored) fail('tar header checksum mismatch');
}

function parsePax(data) {
  const values = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) fail('PAX record has no length delimiter');
    const lengthText = data.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) fail('PAX record length is invalid');
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > data.length || data[end - 1] !== 0x0a) {
      fail('PAX record length does not match its data');
    }
    let record;
    try {
      record = UTF8_DECODER.decode(data.subarray(space + 1, end - 1));
    } catch {
      fail('PAX record contains invalid UTF-8');
    }
    const equals = record.indexOf('=');
    if (equals <= 0) fail('PAX record is malformed');
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (Object.hasOwn(values, key)) fail(`PAX key is duplicated: ${key}`);
    if (key === 'linkpath') fail('PAX linkpath is forbidden');
    if (!['path', 'size', 'mtime', 'atime', 'ctime'].includes(key)) {
      fail(`unsupported PAX key: ${key}`);
    }
    values[key] = value;
    offset = end;
  }
  return values;
}

export async function inspectTarGzip(archivePath) {
  const stream = createReadStream(archivePath).pipe(createGunzip());
  let buffer = Buffer.alloc(0);
  let state = 'header';
  let remaining = 0;
  let padding = 0;
  let paxData = null;
  let nextPax = null;
  let zeroBlocks = 0;
  let ended = false;
  let decompressedBytes = 0;
  let entryCount = 0;
  const paths = new Set();

  const consume = (count) => {
    const value = buffer.subarray(0, count);
    buffer = buffer.subarray(count);
    return value;
  };

  const processBuffer = () => {
    while (true) {
      if (ended) {
        if (buffer.some((byte) => byte !== 0)) fail('tar has non-zero data after its end marker');
        buffer = Buffer.alloc(0);
        return;
      }
      if (state === 'header') {
        if (buffer.length < 512) return;
        const header = consume(512);
        if (header.equals(ZERO_BLOCK)) {
          zeroBlocks += 1;
          if (zeroBlocks === 2) ended = true;
          continue;
        }
        if (zeroBlocks !== 0) fail('tar contains an entry after a partial end marker');
        verifyTarChecksum(header);
        const magic = tarString(header, 257, 6);
        if (magic !== 'ustar') fail('tar entry is not POSIX ustar/PAX');
        const type = String.fromCharCode(header[156] || 0x30);
        let size = tarNumber(header, 124, 12, 'tar entry size');
        const name = tarString(header, 0, 100);
        const prefix = tarString(header, 345, 155);
        let path = prefix ? `${prefix}/${name}` : name;
        if (nextPax?.size !== undefined) {
          if (!/^(?:0|[1-9][0-9]*)$/.test(nextPax.size)) fail('PAX size is invalid');
          const paxSize = Number(nextPax.size);
          if (!Number.isSafeInteger(paxSize) || paxSize !== size) {
            fail('PAX size must equal the ustar header size');
          }
        }
        if (nextPax?.path !== undefined) path = nextPax.path;
        nextPax = null;

        if (type === 'x') {
          if (size > MAX_PAX_BYTES) fail('PAX header is too large');
          paxData = Buffer.alloc(0);
        } else {
          if (type !== '0' && type !== '5') {
            fail(`tar entry type ${JSON.stringify(type)} is forbidden`);
          }
          if (type === '5') path = path.replace(/\/+$/, '');
          path = safeRelativePath(path, 'tar member');
          if (path === 'payload' && type !== '5') fail('tar payload root must be a directory');
          if (path !== 'payload' && !path.startsWith('payload/')) {
            fail(`tar member is outside payload/: ${path}`);
          }
          if (
            type === '5' &&
            path !== 'payload' &&
            path !== 'payload/apps' &&
            path !== 'payload/apps/server-api' &&
            path !== 'payload/apps/server-api/dist' &&
            !path.startsWith('payload/apps/server-api/dist/') &&
            path !== 'payload/node_modules' &&
            !path.startsWith('payload/node_modules/')
          ) {
            fail(`tar directory is outside the runtime allowlist: ${path}`);
          }
          if (type === '5' && size !== 0) fail(`tar directory has data: ${path}`);
          if (paths.has(path)) fail(`tar member is duplicated: ${path}`);
          paths.add(path);
          entryCount += 1;
          if (entryCount > MAX_ARCHIVE_ENTRIES) fail('tar has too many entries');
        }
        remaining = size;
        padding = (512 - (size % 512)) % 512;
        state = 'data';
        continue;
      }
      if (state === 'data') {
        if (remaining > 0) {
          if (buffer.length === 0) return;
          const count = Math.min(buffer.length, remaining);
          const data = consume(count);
          if (paxData !== null) paxData = Buffer.concat([paxData, data]);
          remaining -= count;
          if (remaining > 0) return;
        }
        if (buffer.length < padding) return;
        consume(padding);
        if (paxData !== null) {
          nextPax = parsePax(paxData);
          paxData = null;
        }
        state = 'header';
      }
    }
  };

  for await (const chunk of stream) {
    decompressedBytes += chunk.length;
    if (decompressedBytes > MAX_ARCHIVE_BYTES) fail('tar exceeds the decompressed size limit');
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    processBuffer();
  }
  processBuffer();
  if (!ended || state !== 'header' || nextPax !== null) fail('tar is truncated or has a dangling PAX header');
  return { entries: entryCount, decompressedBytes };
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function walkRegularFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const relativePath = relative(root, absolute).split(sep).join('/');
    safeRelativePath(relativePath);
    if (entry.isSymbolicLink()) fail(`release tree contains a symlink: ${relativePath}`);
    if (entry.isDirectory()) {
      files.push(...(await walkRegularFiles(root, absolute)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      fail(`release tree contains a special file: ${relativePath}`);
    }
  }
  files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return files;
}

function validatePayloadPath(path) {
  if (
    path === 'apps/server-api/package.json' ||
    path.startsWith('apps/server-api/dist/') ||
    path.startsWith('node_modules/')
  ) {
    return;
  }
  fail(`artifact contains a file outside the runtime allowlist: ${path}`);
}

export async function computeTreeDigest(root) {
  const files = await walkRegularFiles(resolve(root));
  if (files.length === 0) fail(`cannot digest an empty tree: ${root}`);
  const aggregate = createHash('sha256');
  for (const path of files) {
    const absolute = resolve(root, ...path.split('/'));
    const metadata = await stat(absolute);
    const digest = await sha256File(absolute);
    aggregate.update(`${path}\0${metadata.size}\0${digest}\n`, 'utf8');
  }
  return `sha256:${aggregate.digest('hex')}`;
}

export async function createManifest(root, metadata) {
  const absoluteRoot = resolve(root);
  const sourceSha = String(metadata.sourceSha || '').toLowerCase();
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) fail('sourceSha must be a full lowercase Git SHA');
  const releaseId = String(metadata.releaseId || '');
  const match = RELEASE_ID_PATTERN.exec(releaseId);
  if (!match || match[1] !== sourceSha.slice(0, 12)) {
    fail('releaseId must be git- plus the first 12 characters of sourceSha');
  }
  if (String(metadata.nodeVersion) !== NODE_VERSION) {
    fail(`nodeVersion must be ${NODE_VERSION}`);
  }
  const epoch = Number(metadata.securityEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 2_147_483_647) {
    fail('securityEpoch must be a positive 32-bit integer');
  }
  const migrationsDigest = String(metadata.migrationsDigest || '');
  if (!/^sha256:[0-9a-f]{64}$/.test(migrationsDigest)) {
    fail('migrationsDigest must be a sha256 digest');
  }

  const paths = (await walkRegularFiles(absoluteRoot)).filter((path) => path !== 'manifest.json');
  if (paths.includes('manifest.json')) fail('manifest filtering failed');
  if (!paths.includes('apps/server-api/package.json')) fail('server-api package.json is missing');
  if (!paths.includes('apps/server-api/dist/main.js')) fail('server-api dist/main.js is missing');
  if (!paths.some((path) => path.startsWith('node_modules/'))) fail('node_modules is empty');

  const files = [];
  for (const path of paths) {
    validatePayloadPath(path);
    const absolute = resolve(absoluteRoot, ...path.split('/'));
    const metadataForFile = await stat(absolute);
    files.push({ path, size: metadataForFile.size, sha256: await sha256File(absolute) });
  }
  return {
    schemaVersion: 1,
    releaseId,
    sourceSha,
    nodeVersion: NODE_VERSION,
    securityEpoch: epoch,
    migrationsDigest,
    entrypoint: 'apps/server-api/dist/main.js',
    files,
  };
}

export function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest must be an object');
  const allowed = new Set([
    'schemaVersion',
    'releaseId',
    'sourceSha',
    'nodeVersion',
    'securityEpoch',
    'migrationsDigest',
    'entrypoint',
    'files',
  ]);
  for (const key of Object.keys(manifest)) if (!allowed.has(key)) fail(`unknown manifest key: ${key}`);
  if (manifest.schemaVersion !== 1) fail('unsupported manifest schemaVersion');
  if (!SOURCE_SHA_PATTERN.test(manifest.sourceSha)) fail('manifest sourceSha is invalid');
  const releaseMatch = RELEASE_ID_PATTERN.exec(manifest.releaseId);
  if (!releaseMatch || releaseMatch[1] !== manifest.sourceSha.slice(0, 12)) {
    fail('manifest releaseId does not match sourceSha');
  }
  if (manifest.nodeVersion !== NODE_VERSION) fail(`manifest requires Node ${NODE_VERSION}`);
  if (!Number.isSafeInteger(manifest.securityEpoch) || manifest.securityEpoch < 1) {
    fail('manifest securityEpoch is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(manifest.migrationsDigest)) {
    fail('manifest migrationsDigest is invalid');
  }
  if (manifest.entrypoint !== 'apps/server-api/dist/main.js') fail('manifest entrypoint is invalid');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('manifest files are missing');
  const seen = new Set();
  let previous = '';
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) fail('manifest file entry is invalid');
    if (Object.keys(file).sort().join(',') !== 'path,sha256,size') fail('manifest file entry has unknown keys');
    safeRelativePath(file.path, 'manifest path');
    validatePayloadPath(file.path);
    if (previous && Buffer.compare(Buffer.from(file.path), Buffer.from(previous)) <= 0) {
      fail('manifest files must be strictly UTF-8 byte sorted');
    }
    previous = file.path;
    if (seen.has(file.path)) fail(`manifest path is duplicated: ${file.path}`);
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) fail(`manifest size is invalid: ${file.path}`);
    if (!SHA256_PATTERN.test(file.sha256)) fail(`manifest digest is invalid: ${file.path}`);
  }
  if (!seen.has('apps/server-api/package.json') || !seen.has('apps/server-api/dist/main.js')) {
    fail('manifest is missing the server entrypoint or package');
  }
  if (![...seen].some((path) => path.startsWith('node_modules/'))) fail('manifest has no dependencies');
  return manifest;
}

export async function verifyReleaseTree(root) {
  const absoluteRoot = resolve(root);
  const manifestPath = resolve(absoluteRoot, 'manifest.json');
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifest = validateManifestShape(parsed);
  const actualPaths = await walkRegularFiles(absoluteRoot);
  const expectedPaths = ['manifest.json', ...manifest.files.map((file) => file.path)].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  if (actualPaths.length !== expectedPaths.length) fail('release tree file count does not match manifest');
  for (let index = 0; index < actualPaths.length; index += 1) {
    if (actualPaths[index] !== expectedPaths[index]) {
      fail(`release tree differs from manifest at ${actualPaths[index] || '<missing>'}`);
    }
  }
  for (const expected of manifest.files) {
    const absolute = resolve(absoluteRoot, ...expected.path.split('/'));
    const metadata = await stat(absolute);
    if (metadata.size !== expected.size) fail(`file size mismatch: ${expected.path}`);
    const digest = await sha256File(absolute);
    if (digest !== expected.sha256) fail(`file digest mismatch: ${expected.path}`);
  }
  return manifest;
}

export function resolveReleaseLink(linkPath, releasesRoot) {
  const link = lstatSync(linkPath);
  if (!link.isSymbolicLink()) fail(`${linkPath} must be a symbolic link`);
  const resolvedRoot = realpathSync(releasesRoot);
  const target = realpathSync(linkPath);
  if (dirname(target) !== resolvedRoot) fail(`${linkPath} must target a direct child of ${resolvedRoot}`);
  return target;
}

export async function verifySha256Sidecar(archivePath, sidecarPath) {
  const sidecar = await readFile(sidecarPath, 'utf8');
  const lines = sidecar.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('SHA-256 sidecar must contain exactly one non-empty line');
  const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(lines[0]);
  if (!match) fail('SHA-256 sidecar must use: <lowercase digest><two spaces><basename>');
  const archiveName = archivePath.replaceAll('\\', '/').split('/').pop();
  if (match[2] !== archiveName) fail('SHA-256 sidecar names a different archive');
  const actual = await sha256File(archivePath);
  if (actual !== match[1]) fail('artifact SHA-256 does not match its sidecar');
  return actual;
}
