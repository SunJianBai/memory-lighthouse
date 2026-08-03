#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  NODE_VERSION,
  RELEASE_ID_PATTERN,
  SLOT_PORTS,
  readSecureEnvFile,
  validateManifestShape,
} from './runtime-lib.mjs';

const DEFAULT_RELEASES_ROOT = '/opt/openbmb/hybrid/api-releases';
const DEFAULT_NATIVE_ENV = '/etc/openbmb/native-api.env';
const DEFAULT_HOSTS_FILE = '/etc/openbmb/native-api.hosts';

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--slot', '--release-link'].includes(key) || value === undefined) {
      fail('usage: launcher.mjs --slot blue|green --release-link PATH');
    }
    if (Object.hasOwn(options, key)) fail(`${key} is duplicated`);
    options[key] = value;
  }
  if (Object.keys(options).length !== 2) fail('slot and release-link are required');
  return { slot: options['--slot'], releaseLink: options['--release-link'] };
}

function assertRootOwnedReadOnly(path, kind) {
  const metadata = lstatSync(path);
  if (kind === 'directory' && !metadata.isDirectory()) fail(`${path} must be a directory`);
  if (kind === 'file' && !metadata.isFile()) fail(`${path} must be a regular file`);
  if (metadata.isSymbolicLink()) fail(`${path} must not be a symlink`);
  if (metadata.uid !== 0) fail(`${path} must be root-owned`);
  if ((metadata.mode & 0o222) !== 0) fail(`${path} must be mode-immutable`);
}

function assertPrivateHostsFile(path, expectedDomain) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0) {
    fail(`${path} must be a root-owned regular file`);
  }
  if ((metadata.mode & 0o022) !== 0) fail(`${path} must not be writable by group or other users`);
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean);
  const tokens = lines.map((line) => line.split(/\s+/));
  const hasLocalhost = tokens.some(
    ([address, ...names]) => address === '127.0.0.1' && names.includes('localhost'),
  );
  const hasHairpin = tokens.some(
    ([address, ...names]) => address === '127.0.0.1' && names.includes(expectedDomain),
  );
  if (!hasLocalhost || !hasHairpin) {
    fail(`${path} must map localhost and ${expectedDomain} to 127.0.0.1`);
  }
}

function resolveRelease(releaseLink, releasesRoot) {
  const linkMetadata = lstatSync(releaseLink);
  if (!linkMetadata.isSymbolicLink() || linkMetadata.uid !== 0) {
    fail(`${releaseLink} must be a root-owned symbolic link`);
  }
  const canonicalRoot = realpathSync(releasesRoot);
  const release = realpathSync(releaseLink);
  if (dirname(release) !== canonicalRoot || !RELEASE_ID_PATTERN.test(basename(release))) {
    fail(`${releaseLink} must target one direct git-* child of ${canonicalRoot}`);
  }
  assertRootOwnedReadOnly(release, 'directory');
  return release;
}

async function main() {
  const { slot, releaseLink } = parseArguments(process.argv.slice(2));
  if (!Object.hasOwn(SLOT_PORTS, slot)) fail('slot must be blue or green');
  if (process.version !== `v${NODE_VERSION}`) {
    fail(`launcher requires Node v${NODE_VERSION}, received ${process.version}`);
  }

  const releasesRoot = process.env.OPENBMB_NATIVE_API_RELEASES_ROOT || DEFAULT_RELEASES_ROOT;
  const nativeEnvPath = process.env.OPENBMB_NATIVE_API_ENV_FILE || DEFAULT_NATIVE_ENV;
  const hostsPath = process.env.OPENBMB_NATIVE_API_HOSTS_FILE || DEFAULT_HOSTS_FILE;
  const release = resolveRelease(releaseLink, releasesRoot);
  const manifestPath = resolve(release, 'manifest.json');
  const entrypoint = resolve(release, 'apps/server-api/dist/main.js');
  assertRootOwnedReadOnly(manifestPath, 'file');
  assertRootOwnedReadOnly(entrypoint, 'file');
  const manifest = validateManifestShape(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (manifest.releaseId !== basename(release)) fail('release directory and manifest ID differ');

  const childEnvironment = readSecureEnvFile(nativeEnvPath);
  const publicAppUrl = new URL(childEnvironment.PUBLIC_APP_URL);
  assertPrivateHostsFile(hostsPath, publicAppUrl.hostname);
  childEnvironment.NODE_ENV = 'production';
  childEnvironment.NODE_OPTIONS = '--max-old-space-size=320';
  childEnvironment.HOST = '127.0.0.1';
  childEnvironment.PORT = String(SLOT_PORTS[slot]);
  const child = spawn(process.execPath, [entrypoint], {
    cwd: resolve(release, 'apps/server-api'),
    env: childEnvironment,
    stdio: 'inherit',
    shell: false,
  });

  let forwardedSignal = null;
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      forwardedSignal = signal;
      if (!child.killed) child.kill(signal);
    });
  }
  child.once('error', (error) => {
    console.error(`LAUNCHER: unable to start NestJS: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal && signal !== forwardedSignal) {
      console.error(`LAUNCHER: NestJS terminated by ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 0;
    }
  });
}

main().catch((error) => {
  console.error(`LAUNCHER: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
