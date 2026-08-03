#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  NODE_VERSION,
  computeTreeDigest,
  createManifest,
  inspectTarGzip,
  validateManifestShape,
  verifyReleaseTree,
  verifySha256Sidecar,
} from './runtime-lib.mjs';

function usage() {
  console.error(`Usage:
  artifact-tool.mjs create-manifest --root DIR --source-sha SHA --release-id ID --security-epoch N --migrations-digest sha256:... --output FILE
  artifact-tool.mjs verify-archive --archive FILE.tar.gz --sha256 FILE.sha256
  artifact-tool.mjs verify-tree --root DIR
  artifact-tool.mjs tree-digest --root DIR
  artifact-tool.mjs manifest-field --manifest FILE --field releaseId|sourceSha|securityEpoch|migrationsDigest`);
  process.exitCode = 64;
}

function parseOptions(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid option sequence near ${key || '<end>'}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) throw new Error(`option ${key} is duplicated`);
    options[name] = value;
  }
  return options;
}

function exactOptions(options, required) {
  const expected = [...required].sort();
  const actual = Object.keys(options).sort();
  if (actual.join('\0') !== expected.join('\0')) {
    throw new Error(`expected options: ${expected.map((key) => `--${key}`).join(', ')}`);
  }
}

async function atomicJsonWrite(path, value) {
  const destination = resolve(path);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, destination);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) return usage();
  const options = parseOptions(rest);

  switch (command) {
    case 'create-manifest': {
      exactOptions(options, [
        'root',
        'source-sha',
        'release-id',
        'security-epoch',
        'migrations-digest',
        'output',
      ]);
      const manifest = await createManifest(options.root, {
        sourceSha: options['source-sha'],
        releaseId: options['release-id'],
        nodeVersion: NODE_VERSION,
        securityEpoch: options['security-epoch'],
        migrationsDigest: options['migrations-digest'],
      });
      await atomicJsonWrite(options.output, manifest);
      process.stdout.write(`${manifest.releaseId}\n`);
      return;
    }
    case 'verify-archive': {
      exactOptions(options, ['archive', 'sha256']);
      const digest = await verifySha256Sidecar(options.archive, options.sha256);
      const inspection = await inspectTarGzip(options.archive);
      process.stdout.write(`${JSON.stringify({ digest, ...inspection })}\n`);
      return;
    }
    case 'verify-tree': {
      exactOptions(options, ['root']);
      const manifest = await verifyReleaseTree(options.root);
      process.stdout.write(`${JSON.stringify(manifest)}\n`);
      return;
    }
    case 'tree-digest': {
      exactOptions(options, ['root']);
      process.stdout.write(`${await computeTreeDigest(options.root)}\n`);
      return;
    }
    case 'manifest-field': {
      exactOptions(options, ['manifest', 'field']);
      const allowed = new Set(['releaseId', 'sourceSha', 'securityEpoch', 'migrationsDigest']);
      if (!allowed.has(options.field)) throw new Error(`unsupported manifest field: ${options.field}`);
      const manifest = validateManifestShape(JSON.parse(await readFile(options.manifest, 'utf8')));
      process.stdout.write(`${manifest[options.field]}\n`);
      return;
    }
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(`ARTIFACT: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
