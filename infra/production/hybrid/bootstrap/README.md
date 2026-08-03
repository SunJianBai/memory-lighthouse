# Hybrid runtime bootstrap and fallback

This directory owns the one-time move from the verified Docker application
stack to the hybrid runtime and the stable operator interface for changing the
runtime mode afterwards. It does not deploy MySQL, Redis, MinIO, LiveKit, or
ClamAV; those infrastructure services remain in Docker in both modes.

## Runtime modes

- `hybrid`: Caddy serves the promoted immutable Web release and routes the API
  to one native systemd slot on `127.0.0.1:13101` or `127.0.0.1:13102`.
- `docker`: the retained `current` / `current-app` Compose release recreates
  `openbmb-api`, `openbmb-client-web`, and `openbmb-admin-web`, and the saved
  Docker Caddy configuration routes the stable listener to `127.0.0.1:13100`.

The normal hybrid Web path is static. The current Docker fallback deliberately
restores both Web containers as well as the API so that it is an exact fallback
to the previously verified application release. A future operator workflow may
keep the static Web release while falling back only the API, but that is not
what `switch docker` means today.

The existing enabled `openbmb.service` is retained, but an installed systemd
drop-in replaces its start/reload/stop commands with `openbmb-stack-control`.
In `hybrid` mode it starts and waits for only MySQL, Redis, Redis-LiveKit,
MinIO, ClamAV and LiveKit, then proves Docker API/Web containers absent. In
`docker` (and the safe pre-migration `uninitialized`) mode it delegates to the
complete legacy stack. If a journal is pending at boot it starts only the
stateful prerequisites and leaves all application processes to recovery.

The public, idempotent operator interface is:

```bash
sudo /usr/local/sbin/openbmb-runtime-mode status
sudo /usr/local/sbin/openbmb-runtime-mode switch hybrid
sudo /usr/local/sbin/openbmb-runtime-mode switch docker
sudo /usr/local/sbin/openbmb-runtime-mode recover
```

Requesting the already active mode succeeds only after its direct and public
health checks pass. It does not rerun Compose or rewrite runtime state. A
Docker-to-hybrid switch additionally runs `openbmb-deploy-native-api
compatibility`; it refuses a retained native release whose Prisma migration
digest, security epoch, or derived LiveKit signing credential no longer matches
`current-app`, the durable security floor, and root-only infrastructure state.
After such a slow-path release, remain in Docker mode until a
separate, explicitly reviewed rebootstrap operation introduces a compatible
native artifact; ordinary `switch hybrid` and fast deploy deliberately refuse
to improvise that transition.

## First migration

Start with a healthy full Docker deployment whose immutable release is still
reachable through `/opt/openbmb/current` and `/opt/openbmb/current-app`.

1. Export and verify the current API container with
   `api/export-current-container.sh`. Do this before stopping any container.
2. Install the control plane:

   ```bash
   sudo bash infra/production/hybrid/bootstrap/install-hybrid-control-plane.sh \
     --domain sun227454.online
   ```

3. Promote and verify a Web artifact using the interface documented in
   `../web/README.md`.
4. Stage the API artifact, its `.sha256` sidecar, and the target Caddyfile as
   root-owned regular files that are not writable by group or other users.
5. Run the one-time migration, replacing the sample paths and release ID:

   ```bash
   sudo /usr/local/sbin/openbmb-migrate-from-docker \
     --domain sun227454.online \
     --expected-current-app git-0123456789ab \
     --api-artifact /root/openbmb-stage/openbmb-api.tar.gz \
     --api-sha256 /root/openbmb-stage/openbmb-api.tar.gz.sha256 \
     --caddyfile /root/openbmb-stage/Caddyfile.hybrid
   ```

The migration pins every input to root-only transaction evidence before
validation. It validates and starts the native candidate and proves both native
health endpoints while Docker still serves `13100`. Only the final Caddy
compare-and-swap stops the Docker API. Docker application containers are
removed only after local and public hybrid health checks pass; their images and
immutable Compose release are retained for `switch docker`.

## Locking and durable recovery

All migration, mode switching, and recovery operations serialize on the exact
public lock `/run/lock/openbmb-operation.lock`. The scripts never change the
permissions of the shared `/run/lock` directory and never truncate an existing
lock file. Nested runtime/native operations inherit the exact open descriptor,
prove that it still names the public lock inode, and reuse that lock without a
recursive acquisition.

Runtime state is stored at `/var/lib/openbmb/hybrid-runtime`:

```text
mode                         committed docker or hybrid mode
configs/docker/              pinned Docker Caddyfile and environment
configs/hybrid/              pinned hybrid Caddyfile and environment
transition.pending           fsynced transition journal, present only in flight
```

Journal creation, phase changes, mode commits, and journal removal fsync both
the file and containing directory. If a process exits during a transition, its
EXIT trap attempts recovery. If the machine reboots first,
`openbmb-hybrid-recovery.service` runs before Caddy on every boot. It consumes
both the runtime journal above and the native deployer's separate
`/opt/openbmb/hybrid/native-api.pending` journal. Native candidates are not
enabled for boot until their route and pointers are committed. Boot recovery
can stage an offline Caddy upstream rollback (validate without reload), then
starts and directly verifies only the slot that must survive before Caddy is
allowed to start.

The recovery oneshot remains active for the rest of the boot and is required
by Caddy. This makes it a readiness barrier without recursively re-running it
when an online transition must restart an inactive Caddy. Even with no journal,
the barrier proves the settled mode: Docker requires a healthy `13100` API and
both native slots disabled; hybrid requires the pointer-selected native slot
active, enabled and directly ready, with the other slot inactive and disabled.
The native API unit and recovery both run only after the runtime-aware stack
has made the stateful Docker dependencies healthy.

The optional backup systemd service is also overridden by
`openbmb-backup-control`. A backup requested in hybrid mode temporarily enters
the exact Docker fallback, runs the existing quiesced MySQL/MinIO snapshot, and
then returns to hybrid mode under the same operation lock. If hybrid restoration
cannot be proven, it remains in the healthy Docker fallback and reports failure.
Consequently the `current/current-app` Docker application images must be kept;
targeted cleanup may remove only older unreachable application tags.

When rolling back to Docker, recovery installs and validates the saved Caddy
configuration first. A Caddy reload failure does not block rollback: Caddy is
stopped to release `13100`, Compose recreates and verifies the old Docker API,
and only then does ordinary native-deploy recovery run. Durable evidence is
deleted only after the previous mode is healthy.

## Storage cleanup boundary

These scripts intentionally do not delete Docker images, build cache, volumes,
or migration evidence. The Docker application image referenced by
`current-app` is part of the fallback contract and must remain present while
`switch docker` is required. Cleanup must therefore be a separate, targeted
operation after the hybrid mode has been observed healthy; never use an
unscoped `docker system prune -a`, and never delete named data volumes.

## Local checks

Run the bootstrap regression suite from a Linux or Git Bash environment:

```bash
bash infra/production/hybrid/bootstrap/test-runtime-mode.sh
```

It syntax-checks every bootstrap script and verifies lock invariants, durable
journal primitives, Caddy-failure Docker recovery ordering, idempotent mode
switching, and boot-time native-unit behavior with isolated mocks.
