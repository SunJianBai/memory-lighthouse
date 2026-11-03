import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** This is a compatibility decision, never authorization to repair bad state. */
export function apiUpgradeRoute(localDigest, localEpoch, remote) {
  if (!/^sha256:[0-9a-f]{64}$/.test(localDigest) || !/^[1-9][0-9]*$/.test(localEpoch)) {
    throw new Error('Invalid candidate compatibility identity');
  }
  if (!remote || remote.mode !== 'hybrid' || remote.pending !== 'no' ||
      !/^127\.0\.0\.1:1310[12]$/.test(remote.upstream) ||
      !/^git-[0-9a-f]{12}$/.test(remote.currentApp) ||
      !/^git-[0-9a-f]{12}$/.test(remote.currentApi) ||
      !/^sha256:[0-9a-f]{64}$/.test(remote.migrationsDigest) ||
      !/^[1-9][0-9]*$/.test(remote.securityEpoch)) {
    throw new Error('Production compatibility state is missing, unsettled, or invalid');
  }
  if (BigInt(localEpoch) < BigInt(remote.securityEpoch)) {
    throw new Error('Candidate security epoch would downgrade the production anchor');
  }
  return localDigest === remote.migrationsDigest && localEpoch === remote.securityEpoch
    ? 'fast' : 'upgrade';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [digest, epoch, file] = process.argv.slice(2);
  if (!file || process.argv.length !== 5) throw new Error('usage: api-upgrade-route.mjs DIGEST EPOCH STATE_JSON');
  console.log(apiUpgradeRoute(digest, epoch, JSON.parse(readFileSync(file, 'utf8'))));
}
