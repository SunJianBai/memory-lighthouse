import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const api = read('.github/workflows/api-production-delivery.yml');
const web = read('.github/workflows/web-production-delivery.yml');
const full = read('.github/workflows/production-delivery.yml');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = path => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

test('Web is reusable-only automatic CD, gated on both API paths', () => {
  assert.match(web, /workflow_call:/);
  assert.doesNotMatch(web, /workflow_run:/);
  assert.doesNotMatch(web, /workflow_dispatch:/);
  assert.match(web, /SOURCE_SHA: \$\{\{ inputs.source_sha }}/);
  assert.match(web, /detect-release-changes.sh web "\$SOURCE_SHA" "\$CI_RUN_ID"/);
  assert.match(api, /needs: \[plan-api, deliver-api, upgrade-api\]/);
  assert.match(api, /needs.upgrade-api.result == 'success'/);
  assert.match(api, /source_sha: \$\{\{ needs.plan-api.outputs.source_sha }}/);
  assert.match(api, /ci_run_id: \$\{\{ needs.plan-api.outputs.ci_run_id }}/);
});
test('upgrade cannot produce a native success marker before rebootstrap passes', () => {
  assert.match(api, /if: steps.reconcile.outputs.should_release == 'false' \|\| steps.promote.outcome == 'success'/);
  assert.match(full, /if: inputs.return_to_hybrid && steps.hybrid.outcome == 'success'/);
  assert.ok(full.indexOf('Restore verified hybrid runtime') < full.indexOf('Record verified upgraded API marker'));
  const groups = [api, web, full].map(text => /group: (.+)/.exec(text)[1]);
  assert.equal(new Set(groups).size, 3);
});
test('every activation rechecks same-source CI and current main', () => {
  for (const workflow of [api, web, full]) {
    assert.match(workflow, /assert-current-main.sh "\$SOURCE_SHA"\n\s+bash scripts\/hybrid\/assert-source-ci.sh "\$SOURCE_SHA"/);
  }
  const guard = read('scripts/hybrid/assert-source-ci.sh');
  for (const text of ['.head_sha == $sha', '.head_branch == "main"', '.event == "push"', '.conclusion == "success"', '.path == ".github/workflows/ci.yml"', '.head_repository.full_name == $repo']) {
    assert.ok(guard.includes(text), text);
  }
});

test('hybrid restoration uses the installed reviewed rebootstrap interface', () => {
  const restore = read('scripts/hybrid/return-to-hybrid.sh');
  assert.match(restore, /\/usr\/local\/sbin\/openbmb-rebootstrap-from-docker/);
  assert.match(restore, /--expected-current-app "\$release_id"/);
  assert.match(restore, /--expected-current-api "\$expected_current_api"/);
  assert.match(restore, /--expected-source-sha "\$source_sha"/);
  assert.ok(restore.indexOf('install-hybrid-control-plane.sh') < restore.indexOf('export-current-container.sh'));
  assert.ok(restore.indexOf('openbmb-rebootstrap-from-docker') < restore.indexOf('openbmb-hybrid-health --public'));
  const wrapper = read('infra/production/hybrid/bootstrap/rebootstrap-from-docker.sh');
  assert.match(wrapper, /--reviewed-rebootstrap/);
  assert.ok(read('scripts/hybrid/remote-promotion-guard.sh').includes('"$digest" =~ ^sha256:[0-9a-f]{64}$'));
});

test('both upgrade-only remote steps establish SSH before contacting production', () => {
  for (const name of [
    'Verify source CI and restore exact Docker fallback before building',
    'Restore verified hybrid runtime',
  ]) {
    const step = full.split(/\n      - name: /).find(block => block.startsWith(name));
    assert.ok(step, `missing step: ${name}`);
    const establish = step.indexOf('bash infra/production/scripts/ensure-ssh-master.sh tx4h4g-prod 6 5');
    const contact = step.indexOf('ssh tx4h4g-prod');
    assert.ok(establish >= 0 && contact > establish, `SSH must be established first: ${name}`);
  }
});

test('existing storage copies are pinned, verified, and never republished', () => {
  const result = spawnSync(bash, ['-c', `
    set -euo pipefail
    source infra/production/scripts/release-image-set.sh
    openbmb_load_release_image_set git-000000000000
    for index in 6 7; do
      component="\${OPENBMB_DELIVERY_COMPONENTS[$index]}"
      openbmb_existing_storage_image "$component"
      ref="$OPENBMB_EXISTING_STORAGE_REF"
      digest="$OPENBMB_EXISTING_STORAGE_DIGEST"
      image_id="$OPENBMB_EXISTING_STORAGE_ID"
      [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ && "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
      [[ "\${OPENBMB_SOURCE_IMAGES[$index]}" == "\${ref%%:*}@$digest" ]]
      openbmb_verify_existing_storage_transport "$component" "$ref" "$digest" "$image_id"
      ! openbmb_verify_existing_storage_transport "$component" "$ref-changed" "$digest" "$image_id"
      ! openbmb_verify_existing_storage_transport "$component" "$ref" "sha256:wrong" "$image_id"
      ! openbmb_verify_existing_storage_transport "$component" "$ref" "$digest" "sha256:wrong"
    done
    ! openbmb_existing_storage_image api
    [[ -z "$OPENBMB_EXISTING_STORAGE_REF" ]]
  `], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const publish = full.slice(full.indexOf('name: Publish exact release transport images'), full.indexOf('name: Transfer exact release images'));
  assert.match(publish, /openbmb_existing_storage_image "\$\{components\[\$index\]}"/);
  assert.ok(publish.indexOf('continue') < publish.indexOf('docker push'));
  assert.match(read('infra/production/scripts/verify-release-images.sh'), /openbmb_verify_existing_storage_transport/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /packages: read/);
  assert.doesNotMatch(ci, /TX4H4G_SSH|docker push/);
});

test('storage publishing verifies the pulled platform manifest, not its unavailable parent index', () => {
  // Production's original indexes contain these exact linux/amd64 children.
  // GHCR stores those children, so pulling by digest yields the child identity.
  const fixtures = [
    ['minio', '3f97c5651cb6662b880c787a232b6b34fec8d8922e08d6617b25d241a21164bb', 'a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e'],
    ['minio-mc', '9ba8cb7340dd57ee994f6e2a8e45bc0dde9d5369615b03c6021105e5b9ce4449', '7e3efb09c22c0882fbf341b9d99f61f94ae6c4c20a06f2f1a2b20ea8993d8952'],
  ];
  const publish = full.slice(full.indexOf('name: Publish exact release transport images'), full.indexOf('name: Transfer exact release images'));
  const storageGuard = publish.slice(publish.indexOf('if openbmb_existing_storage_image'), publish.indexOf('delivery_ref='));
  for (const [component, platformDigest, parentIndex] of fixtures) {
    for (const actual of [platformDigest, parentIndex, 'f'.repeat(64)]) {
      const result = spawnSync(bash, ['-c', `
        set -euo pipefail
        source infra/production/scripts/release-image-set.sh
        components=(${component})
        images=(openbmb-${component}:git-000000000000)
        transport_manifest=/dev/null
        docker() { printf '%s\\n' 'sha256:${actual}'; }
        for index in 0; do
          ${storageGuard}
        done
      `], { cwd: root, encoding: 'utf8', timeout: 15000 });
      if (actual === platformDigest) {
        assert.equal(result.status, 0, `${component}: pinned platform must pass\n${result.stderr}`);
      } else {
        assert.notEqual(result.status, 0, `${component}: a different image identity must fail`);
      }
    }
  }
});

test('public release health ignores unrelated root 404s but still rejects an unhealthy OpenBMB API', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'openbmb-health-scope-'));
  try {
    writeFileSync(join(fixture, 'verify-clamav.sh'), '#!/usr/bin/env bash\nexit 0\n');
    for (const path of ['infra/production/scripts/health-check.sh', 'infra/production/hybrid/bootstrap/openbmb-hybrid-health']) {
      const script = join(fixture, 'health.sh');
      writeFileSync(script, read(path));
      for (const failApi of [false, true]) {
        const result = spawnSync(bash, ['-c', `
          curl() {
            for arg in "$@"; do
              [[ "$arg" != https://sun227454.online/ ]] || return 22
              if [[ '${failApi}' == true && "$arg" == */openBMB/api/v1/health/ready ]]; then return 22; fi
            done
          }
          sleep() { :; }
          export -f curl sleep
          bash '${shellPath(script)}' --public
        `], { encoding: 'utf8', timeout: 15000 });
        if (failApi) assert.notEqual(result.status, 0, `${path}: API failure must block release`);
        else assert.equal(result.status, 0, `${path}: unrelated root must not block release\n${result.stderr}`);
      }
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('a newer main cannot interrupt already-activated Docker-to-hybrid completion', () => {
  const beforeActivation = full.slice(full.indexOf('Reject stale or unvalidated activation'), full.indexOf('Activate validated release'));
  assert.match(beforeActivation, /assert-current-main.sh/);
  assert.match(beforeActivation, /assert-source-ci.sh/);
  const completion = full.slice(full.indexOf('Restore verified hybrid runtime'), full.indexOf('Close pinned SSH master'));
  assert.doesNotMatch(completion, /assert-current-main.sh/);
  assert.match(completion, /assert-source-ci.sh "\$SOURCE_SHA" "\$CI_RUN_ID"/);
  const restore = read('scripts/hybrid/return-to-hybrid.sh');
  assert.ok(restore.includes('"$(readlink -f -- /opt/openbmb/current-app)" == "$release"'));
  assert.ok(restore.includes('"$(cat "$release/.openbmb-release-sha")" == "$source_sha"'));
});

for (const scenario of ['missing', 'present', 'mismatch', 'unauthorized', 'wrong-revision', 'wrong-digest', 'race', 'terminated']) {
  test(`pinned fallback restore: ${scenario}`, () => {
    // Relocate only fixed production paths and mock OS/Docker boundaries. The
    // actual restore loop, digest comparisons, no-overwrite and cleanup run.
    const fixture = mkdtempSync(join(tmpdir(), 'openbmb-fallback-test-'));
    try {
      const base = shellPath(fixture), sha = 'a'.repeat(40), release = `git-${sha.slice(0, 12)}`;
      const anchor = join(fixture, 'openbmb', 'releases', release);
      mkdirSync(join(anchor, 'infra', 'production', 'scripts'), { recursive: true });
      mkdirSync(join(fixture, 'bin')); mkdirSync(join(fixture, 'run', 'lock'), { recursive: true });
      writeFileSync(join(fixture, 'run', 'lock', 'openbmb-operation.lock'), '');
      const components = ['api', 'migrator', 'client-web', 'admin-web'];
      const digest = `sha256:${'b'.repeat(64)}`;
      writeFileSync(join(anchor, '.openbmb-images'), components.map(c => `openbmb-${c}:${release} ${digest}\n`).join(''));
      writeFileSync(join(anchor, '.openbmb-transport-digests'), components.map(c => `openbmb-${c}:${release} ghcr.io/example/memory-lighthouse-delivery:${c}-${release} ${digest}\n`).join(''));
      writeFileSync(join(anchor, '.openbmb-release-sha'), `${sha}\n`);
      writeFileSync(join(anchor, 'infra', 'production', 'scripts', 'verify-release-images.sh'), '[[ "$OPENBMB_OPERATION_LOCK_HELD" == true && "$OPENBMB_OPERATION_LOCK_FD" == 9 && -e /dev/fd/9 ]] || exit 75\n');
      // Windows directory junctions are intentionally not treated as Unix
      // symlinks; mock readlink and the initial pointer test in this fixture.
      const script = read('scripts/hybrid/restore-docker-fallback.sh')
        .replace('[[ $EUID -eq 0', '[[ 1 -eq 1')
        .replace('[[ -L /opt/openbmb/current-app ]]', '[[ true ]]')
        .replaceAll('/opt/openbmb', `${base}/openbmb`)
        .replaceAll('/run/', `${base}/run/`);
      writeFileSync(join(fixture, 'restore.sh'), script);
      const mock = (name, body) => writeFileSync(join(fixture, 'bin', name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
      mock('stat', 'echo 0'); mock('find', 'exit 0'); mock('flock', 'echo lock >> "$FIXTURE/lock-log"');
      mock('readlink', `echo '${shellPath(anchor)}'`);
      mock('timeout', 'shift; exec "$@"');
      mock('docker', `
echo "$*" >> "$FIXTURE/log"
if [[ " $* " == *" login "* ]]; then cat >/dev/null; exit 0; fi
if [[ " $* " == *" pull "* ]]; then
  [[ "$SCENARIO" != unauthorized ]] || exit 1
  [[ "$SCENARIO" != terminated ]] || kill -TERM "$PPID"
  touch "$FIXTURE/pulled"; exit 0
fi
if [[ "$1" == image && "$2" == inspect ]]; then
  if [[ "$4" == '{{.Id}}' ]]; then
    [[ "$SCENARIO" == present || "$SCENARIO" == mismatch || "$5" == *@* || ( "$SCENARIO" == race && -f "$FIXTURE/pulled" ) ]] || exit 1
    if [[ "$SCENARIO" == mismatch || "$SCENARIO" == wrong-digest || ( "$SCENARIO" == race && "$5" != *@* ) ]]; then echo sha256:${'c'.repeat(64)}; else echo ${digest}; fi
  elif [[ "$SCENARIO" == wrong-revision ]]; then echo ${'d'.repeat(40)}; else echo ${sha}; fi
fi`);
      const result = spawnSync(bash, ['-c', 'export PATH="$FIXTURE/bin:$PATH"; exec bash "$FIXTURE/restore.sh" example'], {
        env: { ...process.env, GH_TOKEN: 'synthetic-secret', FIXTURE: base, SCENARIO: scenario }, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.status, ['missing', 'present'].includes(scenario) ? 0 : scenario === 'terminated' ? 143 : 1, `${result.stdout}\n${result.stderr}`);
      const log = readFileSync(join(fixture, 'log'), 'utf8');
      assert.doesNotMatch(log, /synthetic-secret|(?:^|\s)(?:up|start|stop|rm)(?:\s|$)/);
      if (scenario === 'missing') assert.equal((log.match(/^tag /gm) ?? []).length, 4);
      if (scenario !== 'missing') assert.doesNotMatch(log, /^tag /m);
      if (scenario === 'unauthorized') assert.equal((log.match(/ pull /g) ?? []).length, 1);
      assert.deepEqual(readdirSync(join(fixture, 'run')), ['lock'], 'temporary registry credentials must be removed');
      assert.equal(readFileSync(join(fixture, 'lock-log'), 'utf8'), 'lock\n', 'nested verifier inherits the single operation lock');
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
}
