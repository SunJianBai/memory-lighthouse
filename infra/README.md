# Infrastructure

This directory has two intentionally separate deployment profiles.

- [`compose/`](compose/) is the loopback-only development stack for MySQL,
  application Redis, isolated LiveKit Redis, MinIO, and LiveKit.
- [`production/`](production/) is the reviewed TX4H4G release, backup,
  rollback, Caddy, and CampusHub coexistence package.

The production package is the only authoritative public-routing design. It
reuses `sun227454.online` for LiveKit's standard `/rtc/v1` signaling path and
for path-style MinIO URLs under `/openbmb-assets/*`; no `rtc.*` or `assets.*`
DNS records are required.

## Local development

Copy `compose/.env.example` to the ignored `compose/.env`, replace every empty
secret independently, including a MinIO SSE-S3 key in the documented
`<name>:<base64-32-byte-key>` format, and run:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.yml up -d
```

On Windows, the non-destructive health and isolation checks are available as:

```powershell
.\infra\scripts\verify-local-stack.ps1
```

Do not run `docker compose down -v`; `-v` deletes the named data volumes.
The API-side asset worker fails closed when `CLAMAV_HOST` is absent. A local
clamd is optional for infrastructure-only checks but required for an upload to
reach `CLEAN`.

## Production

Start with [`production/README.md`](production/README.md). The production
workflow keeps CampusHub as the fallback site and does not reuse or mutate its
database, backend, or volumes. Secrets live only in `/etc/openbmb` on the
server and must never be committed. Unlike the lightweight development profile,
production includes a digest-pinned same-host ClamAV service published only on
`127.0.0.1:13310` with a persistent, rebuildable signature cache.
