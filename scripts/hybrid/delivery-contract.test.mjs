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
