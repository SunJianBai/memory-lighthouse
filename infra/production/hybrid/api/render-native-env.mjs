#!/usr/bin/env node

import {
  deriveApiEnvironment,
  readSecureEnvFile,
  serializeRawEnvironment,
} from './runtime-lib.mjs';

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--infra', '--api'].includes(key) || value === undefined) {
      fail('usage: render-native-env.mjs --infra FILE --api FILE');
    }
    if (Object.hasOwn(options, key)) fail(`${key} is duplicated`);
    options[key] = value;
  }
  if (Object.keys(options).length !== 2) fail('infra and api paths are required');
  return { infra: options['--infra'], api: options['--api'] };
}

async function main() {
  if (process.getuid?.() !== 0) fail('credential rendering must run as root');
  const paths = parseArguments(process.argv.slice(2));
  const infra = readSecureEnvFile(paths.infra);
  const api = readSecureEnvFile(paths.api);
  const environment = deriveApiEnvironment(infra, api, 'blue');

  // Slot identity is selected only by the systemd instance at launch time.
  delete environment.PORT;
  environment.HOST = '127.0.0.1';

  process.stdout.write(serializeRawEnvironment(environment));
}

main().catch((error) => {
  console.error(`NATIVE ENV: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
